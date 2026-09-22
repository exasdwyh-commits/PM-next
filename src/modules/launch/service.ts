/**
 * 上市计划命令层（蓝图 §4.3、§4.5）
 *
 * 三条硬约束：
 *  1. 上市计划必须有负责人、目标日期、依赖里程碑、状态、阻塞原因、实际完成时间。
 *  2. **审批通过只表示"获准"，不自动把产品标为已上市。** 实际上市必须由独立的
 *     实际动作/证据确认（confirmLaunchExecution），两步之间不可合并。
 *  3. **未完成阻塞项不得自动放行。** 门禁由服务端 computeLaunchGate 计算，
 *     前端只展示结果，不允许前端自行判断。
 *
 * 权限依据：`User` 上没有组织级角色，角色只存在于 `ProjectMember`。
 * 因此写入权限判定为「在**该产品所属的任一项目**中担任 OWNER 或 DECISION_MAKER」。
 * 产品入库时会原子创建一个项目并把创建者设为 OWNER，所以正常路径下产品负责人天然可写；
 * 仅当该用户在产品全部项目里都没有这两个角色时才拒绝。
 */

import prisma from "@/shared/db";
import { ConflictError, ForbiddenError, NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import {
  GateType,
  LaunchMilestoneStatus,
  LaunchPlanStatus,
  Prisma,
  ProductLifecycleStage,
  Role,
} from "@prisma/client";
import { createAuditEventInTx } from "@/shared/audit";
import { SessionContext } from "../identity/session";
import { PRODUCT_WRITE_ROLES, requireProductRole } from "../identity/product-access";
import { assertOrgUser, assertWorkItemRef } from "../identity/ownership";
import { LAUNCH_MILESTONE_KIND_LABELS, labelLaunchMilestoneKind, labelLaunchMilestoneStatus } from "@/shared/status-labels";
import { evaluateGate as evaluateLaunchGate } from "./gate";
import { createDecisionPacketDraft, submitDecisionPacket } from "../decisions/service";
import { inspectLaunchProductionBasis } from "../production/launch-basis";
import { stableStringify } from "../decisions/artifact-ref";

export interface LaunchGateCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface LaunchGate {
  ready: boolean;
  checks: LaunchGateCheck[];
  /** 人类可读的阻断原因；空数组表示可放行 */
  blockers: string[];
  summary: string;
}

export type MilestoneKind = "MATERIAL" | "CHANNEL" | "SUPPLY" | "COMPLIANCE" | "OTHER";

export interface LaunchMilestoneInput {
  /** 有 id = 更新，无 id = 新增 */
  id?: string;
  title: string;
  kind?: MilestoneKind;
  dueDate?: string | null;
  ownerId?: string | null;
  status?: LaunchMilestoneStatus;
  blockerReason?: string | null;
  workItemId?: string | null;
}

/**
 * 里程碑类型的中文标签与合法取值，唯一来源在 `src/shared/status-labels.ts`
 * （客户端组件也要用同一张表，而本模块依赖 prisma，无法被客户端 import）。
 * `MILESTONE_KINDS` 由表的键派生——新增类型时改一处，校验白名单与下拉项同步跟上，
 * 不会再出现「表里有、白名单没有」而把新类型静默降级成 OTHER 的情况。
 */
export const MILESTONE_KIND_LABELS: Record<MilestoneKind, string> = LAUNCH_MILESTONE_KIND_LABELS;

const MILESTONE_KINDS: MilestoneKind[] = Object.keys(LAUNCH_MILESTONE_KIND_LABELS) as MilestoneKind[];

// ---------------------------------------------------------------------------
// 权限
// ---------------------------------------------------------------------------

/**
 * 校验写入权限，并返回可用于挂载计划的 projectId（优先取用户担任 OWNER 的项目）。
 * 只认 ProjectMember 角色，不认任何前端传入的身份。
 */
async function assertLaunchWritePermission(session: SessionContext, productId: string): Promise<string | null> {
  // Phase 3A · B4：产品级授权口径已统一收口到 requireProductRole
  // （src/modules/identity/product-access.ts）。本函数保留为薄封装，
  // 以免继续在此处维护第二套「产品 → 项目成员 → 角色」判断。
  const access = await requireProductRole(session, productId, PRODUCT_WRITE_ROLES);

  const ownerMembership = access.memberships
    .filter((m) => m.role === Role.OWNER)
    .sort((a, b) => a.projectId.localeCompare(b.projectId))[0];
  return (ownerMembership ?? access.memberships[0])?.projectId ?? null;
}

// ---------------------------------------------------------------------------
// 门禁（唯一判定处，服务端计算）
// ---------------------------------------------------------------------------

/**
 * 放行门禁。规则故意从严：
 *  - 必须已指定负责人、目标日期，且至少有一个里程碑；
 *  - 不得存在 BLOCKED 里程碑；
 *  - 所有里程碑必须 DONE —— 即"未完成阻塞项不会被自动放行"。
 */
export function evaluateGate(plan: {
  ownerId: string | null;
  targetDate: Date | null;
  milestones: { title: string; status: LaunchMilestoneStatus }[];
}): LaunchGate {
  return evaluateLaunchGate(plan);
}

async function evaluateFormalG3Gate(
  session: SessionContext,
  plan: {
    projectId: string | null;
    organizationId: string;
    ownerId: string | null;
    targetDate: Date | null;
    milestones: { title: string; status: LaunchMilestoneStatus }[];
    project?: { productVersionId: string | null } | null;
  }
): Promise<LaunchGate> {
  const base = evaluateGate(plan);
  const productVersionId = plan.project?.productVersionId ?? null;
  const productionStatus = plan.projectId
    ? await inspectLaunchProductionBasis(prisma, {
        projectId: plan.projectId,
        organizationId: session.organizationId,
        productVersionId,
      })
    : {
        ready: false,
        blockers: ["正式 G3 上市计划必须绑定已完成生产交付的项目"],
        basis: null,
      };

  const productionCheck: LaunchGateCheck = {
    key: "production_delivery",
    label: "正式 G2 与真实生产交付已闭环",
    ok: productionStatus.ready,
    detail: productionStatus.ready
      ? "当前产品版本已有正式 G2 授权、真实生产记录且项目已交付"
      : productionStatus.blockers.join("；"),
  };
  const checks = [...base.checks, productionCheck];
  const blockers = checks.filter((check) => !check.ok).map((check) => check.detail);
  return {
    ready: blockers.length === 0,
    checks,
    blockers,
    summary:
      blockers.length === 0
        ? "门禁全部满足，可提交正式 G3 上市授权审批。"
        : `尚有 ${blockers.length} 项未满足：${blockers.join("；")}`,
  };
}

export async function computeLaunchGate(session: SessionContext, planId: string): Promise<LaunchGate> {
  const plan = await prisma.launchPlan.findUnique({
    where: { id: planId },
    include: {
      milestones: { orderBy: { seq: "asc" } },
      project: { select: { productVersionId: true } },
    },
  });
  if (!plan || plan.organizationId !== session.organizationId) throw new NotFoundError("Launch plan not found");
  return evaluateFormalG3Gate(session, plan);
}

// ---------------------------------------------------------------------------
// 放行机制来源（TASK-005b）：区分「旧机制批准 / 准备就绪」与「正式 G3 授权」
// ---------------------------------------------------------------------------

/**
 * 放行机制来源。
 * - `LEGACY_APPROVAL`：旧 `approveLaunch` 机制写入的 `approvedAt`（仅产品写角色，非指定决策人）。
 * - `FORMAL_G3`：由统一 DecisionPacket 的 LAUNCH_GATE 经指定决策人批准后产生。
 */
export type LaunchAuthorizationMechanism = "LEGACY_APPROVAL" | "FORMAL_G3";

export interface LaunchAuthorization {
  approved: boolean;
  mechanism: LaunchAuthorizationMechanism | null;
  formalG3: boolean;
  gap: string | null;
  packetId?: string | null;
  approvedAt?: string | null;
}

export const FORMAL_G3_UNAVAILABLE_GAP =
  "当前上市计划尚未取得正式 G3 授权；旧 approve 记录仅代表历史准备就绪，不能替代指定决策人的正式上市授权。";

export const LAUNCH_EXECUTION_NO_FORMAL_G3_GAP =
  "实际上市必须先取得正式 G3 授权；仅有旧机制批准时不得确认上市执行。";

export function describeLaunchAuthorization(plan: {
  approvedAt: Date | null;
  formalG3ApprovedAt?: Date | null;
  formalG3PacketId?: string | null;
}): LaunchAuthorization {
  if (plan.formalG3ApprovedAt && plan.formalG3PacketId) {
    return {
      approved: true,
      mechanism: "FORMAL_G3",
      formalG3: true,
      gap: null,
      packetId: plan.formalG3PacketId,
      approvedAt: plan.formalG3ApprovedAt.toISOString(),
    };
  }
  if (!plan.approvedAt) {
    return { approved: false, mechanism: null, formalG3: false, gap: null, packetId: null, approvedAt: null };
  }
  return {
    approved: true,
    mechanism: "LEGACY_APPROVAL",
    formalG3: false,
    gap: FORMAL_G3_UNAVAILABLE_GAP,
    packetId: null,
    approvedAt: plan.approvedAt.toISOString(),
  };
}

export function describeLaunchExecutionAuthorization(plan: {
  formalG3ApprovedAt?: Date | null;
  formalG3PacketId?: string | null;
}): LaunchAuthorization {
  if (plan.formalG3ApprovedAt && plan.formalG3PacketId) {
    return {
      approved: true,
      mechanism: "FORMAL_G3",
      formalG3: true,
      gap: null,
      packetId: plan.formalG3PacketId,
      approvedAt: plan.formalG3ApprovedAt.toISOString(),
    };
  }
  return {
    approved: false,
    mechanism: null,
    formalG3: false,
    gap: LAUNCH_EXECUTION_NO_FORMAL_G3_GAP,
    packetId: null,
    approvedAt: null,
  };
}

interface FormalG3Validity {
  valid: boolean;
  blockers: string[];
}

async function inspectFormalG3Validity(
  session: SessionContext,
  plan: any
): Promise<FormalG3Validity> {
  if (!plan.formalG3PacketId || !plan.formalG3ApprovedAt || !plan.formalG3Packet) {
    return { valid: false, blockers: ["当前没有正式 G3 授权"] };
  }

  const blockers: string[] = [];
  const packet = plan.formalG3Packet;
  const project = plan.project;
  const checks = (packet.requiredChecks ?? {}) as Record<string, any>;

  if (packet.status !== "APPROVED") blockers.push("当前 G3 决策包不再是 APPROVED");
  if (!project || plan.projectId !== project.id) blockers.push("上市计划绑定项目已变化");
  if (checks.launchGovernanceRevision !== plan.governanceRevision) {
    blockers.push("上市计划治理修订号已变化");
  }
  if (project && checks.projectRevision !== project.revision) {
    blockers.push(
      `G3 批准后项目基线已变化（批准 r${String(checks.projectRevision ?? "UNKNOWN")}，当前 r${project.revision}）`
    );
  }
  if (project && packet.productVersionId !== project.productVersionId) {
    blockers.push("G3 批准后当前产品版本已变化");
  }

  if (project) {
    const productionStatus = await inspectLaunchProductionBasis(prisma, {
      projectId: project.id,
      organizationId: session.organizationId,
      productVersionId: project.productVersionId,
    });
    if (!productionStatus.ready || !productionStatus.basis) {
      blockers.push(...productionStatus.blockers);
    } else {
      const frozenBasis = checks.productionBasis ?? null;
      if (!frozenBasis || stableStringify(frozenBasis) !== stableStringify(productionStatus.basis)) {
        blockers.push("G3 批准后正式 G2 / 生产交付依据已变化");
      }
    }
  }

  return { valid: blockers.length === 0, blockers };
}

async function invalidateFormalG3ForExternalDrift(
  session: SessionContext,
  plan: any,
  blockers: string[]
) {
  if (!plan.formalG3PacketId) return;
  const invalidated = await prisma.$transaction(async (tx) => {
    const result = await tx.launchPlan.updateMany({
      where: {
        id: plan.id,
        governanceRevision: plan.governanceRevision,
        formalG3PacketId: plan.formalG3PacketId,
      },
      data: {
        governanceRevision: { increment: 1 },
        approvedAt: null,
        formalG3PacketId: null,
        formalG3ApprovedAt: null,
      },
    });
    if (result.count !== 1) return false;
    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "FORMAL_G3_INVALIDATED",
      objectType: "Product",
      objectId: plan.productId,
      summary: "正式 G3 因项目/生产交付外部基线变化而失效",
      details: {
        planId: plan.id,
        previousG3PacketId: plan.formalG3PacketId,
        previousGovernanceRevision: plan.governanceRevision,
        blockers,
      } as Prisma.InputJsonValue,
    });
    return true;
  });
  if (!invalidated) {
    throw new ConflictError("G3 失效处理时上市计划已并发变化，请刷新后重试");
  }
}

// ---------------------------------------------------------------------------
// 读取
// ---------------------------------------------------------------------------

export async function getLaunchContext(session: SessionContext, productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, lifecycleStage: true, targetLaunchDate: true, organizationId: true },
  });
  if (!product || product.organizationId !== session.organizationId) throw new NotFoundError("Product not found");

  const plan = await prisma.launchPlan.findFirst({
    where: { productId, organizationId: session.organizationId },
    orderBy: { createdAt: "desc" },
    include: {
      milestones: { orderBy: { seq: "asc" }, include: { owner: { select: { id: true, name: true } } } },
      owner: { select: { id: true, name: true } },
      project: { select: { id: true, title: true, ownerId: true, decisionMakerId: true, revision: true, productVersionId: true } },
      formalG3Packet: {
        include: {
          decisions: { orderBy: { decidedAt: "desc" }, take: 1, include: { actor: { select: { id: true, name: true } } } },
        },
      },
    },
  });

  // 候选负责人：该产品全部项目的成员。只列出真实成员，不伪造候选人。
  const members = await prisma.projectMember.findMany({
    where: { project: { productId, organizationId: session.organizationId } },
    select: { role: true, user: { select: { id: true, name: true, email: true } } },
    distinct: ["userId"],
  });

  const g3Packet = plan
    ? await prisma.decisionPacket.findFirst({
        where: { launchPlanId: plan.id, gate: GateType.LAUNCH_GATE },
        orderBy: { createdAt: "desc" },
        include: {
          decisions: { orderBy: { decidedAt: "desc" }, take: 1, include: { actor: { select: { id: true, name: true } } } },
        },
      })
    : null;

  const canRequestG3 = !!plan?.project && plan.project.ownerId === session.userId;
  const canDecideG3 =
    !!plan?.project &&
    !!plan.project.decisionMakerId &&
    plan.project.decisionMakerId === session.userId &&
    plan.project.ownerId !== session.userId;

  // 写权限同样由服务端判定，前端据此决定是否禁用表单（不作安全边界）
  let canEdit = false;
  try {
    await assertLaunchWritePermission(session, productId);
    canEdit = true;
  } catch {
    canEdit = false;
  }

  const gate = plan ? await evaluateFormalG3Gate(session, plan) : null;
  const formalG3Validity =
    plan?.formalG3PacketId && plan.formalG3Packet
      ? await inspectFormalG3Validity(session, plan)
      : null;
  const authorization = plan
    ? formalG3Validity && !formalG3Validity.valid
      ? {
          approved: false,
          mechanism: null,
          formalG3: false,
          gap: `当前正式 G3 已失效：${formalG3Validity.blockers.join("；")}`,
          packetId: plan.formalG3PacketId,
          approvedAt: plan.formalG3ApprovedAt?.toISOString() ?? null,
        } satisfies LaunchAuthorization
      : describeLaunchAuthorization(plan)
    : null;

  return {
    product: {
      id: product.id,
      name: product.name,
      lifecycleStage: product.lifecycleStage,
      targetLaunchDate: product.targetLaunchDate,
    },
    plan,
    ownerCandidates: members.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
    })),
    gate,
    // TASK-005b：显式携带放行机制来源（LEGACY_APPROVAL vs FORMAL_G3）；
    // 调用方不得只看 approvedAt 就以为拿到正式授权。
    authorization,
    g3Packet,
    canRequestG3,
    canDecideG3,
    canEdit,
    milestoneKinds: MILESTONE_KINDS.map((k) => ({ key: k, label: MILESTONE_KIND_LABELS[k] })),
  };
}

// ---------------------------------------------------------------------------
// 写入
// ---------------------------------------------------------------------------

async function claimLaunchPlanMutation(
  tx: Prisma.TransactionClient,
  plan: { id: string; productId: string; governanceRevision: number; approvedAt: Date | null; formalG3PacketId: string | null },
  actorId: string,
  reason: string
) {
  const claimed = await tx.launchPlan.updateMany({
    where: { id: plan.id, governanceRevision: plan.governanceRevision },
    data: {
      governanceRevision: { increment: 1 },
      approvedAt: null,
      formalG3PacketId: null,
      formalG3ApprovedAt: null,
    },
  });
  if (claimed.count !== 1) {
    throw new ConflictError("上市计划已被其他操作修改，本次变更未写入，请刷新后重试");
  }

  // 计划一旦变化，正在送审的旧 G3 快照也必须退出评审队列，否则重新提交会捡回旧包。
  const invalidatedReviews = await tx.decisionPacket.updateMany({
    where: {
      launchPlanId: plan.id,
      gate: GateType.LAUNCH_GATE,
      status: { in: ["DRAFT", "IN_REVIEW"] },
    },
    data: { status: "WITHDRAWN" },
  });

  if (plan.approvedAt || plan.formalG3PacketId || invalidatedReviews.count > 0) {
    await createAuditEventInTx(tx, {
      actorId,
      action: "FORMAL_G3_INVALIDATED",
      objectType: "Product",
      objectId: plan.productId,
      summary: `上市计划发生实质修改，原 G3 授权/待审批快照已失效：${reason}`,
      details: {
        planId: plan.id,
        previousGovernanceRevision: plan.governanceRevision,
        formalG3PacketId: plan.formalG3PacketId,
        invalidatedReviewCount: invalidatedReviews.count,
        reason,
      } as Prisma.InputJsonValue,
    });
  }
}

function parseDateOrNull(input: string | null | undefined, fieldLabel: string): Date | null {
  if (!input) return null;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) throw new UnprocessableEntityError(`${fieldLabel}格式无效`);
  return d;
}

export async function prepareLaunch(
  session: SessionContext,
  params: {
    productId: string;
    title?: string;
    targetDate?: string | null;
    ownerId: string;
    notes?: string | null;
    projectId?: string | null;
    milestones?: LaunchMilestoneInput[];
  }
): Promise<{ planId: string }> {
  if (!params.ownerId) throw new UnprocessableEntityError("必须指定上市计划负责人");
  if (!params.targetDate) throw new UnprocessableEntityError("必须设置目标上市日期");

  const product = await prisma.product.findUnique({
    where: { id: params.productId },
    select: { id: true, name: true, organizationId: true, lifecycleStage: true },
  });
  if (!product || product.organizationId !== session.organizationId) throw new NotFoundError("Product not found");

  const fallbackProjectId = await assertLaunchWritePermission(session, product.id);

  // B5：ownerId 来自请求体，不可信 —— 必须是**本组织的活跃用户**。
  // 此前只校验非空，可把外组织用户写成上市计划负责人。
  await assertOrgUser(session, params.ownerId, "上市计划负责人");

  const targetDate = parseDateOrNull(params.targetDate, "目标上市日期");

  const existing = await prisma.launchPlan.findFirst({
    where: { productId: product.id, organizationId: session.organizationId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (existing) {
    throw new UnprocessableEntityError("该产品已有上市计划，请直接编辑现有计划");
  }

  const milestones = (params.milestones ?? []).filter((m) => m.title?.trim());

  // B5：里程碑上的 ownerId / workItemId 同样来自请求体，必须逐个校验归属 ——
  // 否则可把外组织用户写成里程碑负责人，或把**其它产品/项目**的工作项挂到本计划上。
  for (const m of milestones) {
    if (m.ownerId) await assertOrgUser(session, m.ownerId, "里程碑负责人");
    if (m.workItemId) {
      await assertWorkItemRef(session, m.workItemId, {
        productId: product.id,
        label: "关联工作项",
      });
    }
  }

  const plan = await prisma.$transaction(async (tx) => {
    const created = await tx.launchPlan.create({
      data: {
        organizationId: session.organizationId,
        productId: product.id,
        projectId: params.projectId ?? fallbackProjectId,
        title: params.title?.trim() || `${product.name} 上市计划`,
        targetDate,
        ownerId: params.ownerId,
        notes: params.notes?.trim() || null,
        createdById: session.userId,
        status: LaunchPlanStatus.ACTIVE,
      },
    });

    let seq = 0;
    for (const m of milestones) {
      await tx.launchMilestone.create({
        data: {
          planId: created.id,
          organizationId: session.organizationId,
          title: m.title.trim(),
          kind: m.kind && MILESTONE_KINDS.includes(m.kind) ? m.kind : "OTHER",
          seq: seq++,
          dueDate: parseDateOrNull(m.dueDate, "里程碑截止日期"),
          ownerId: m.ownerId ?? null,
          status: m.status ?? LaunchMilestoneStatus.PENDING,
          workItemId: m.workItemId ?? null,
        },
      });
    }

    // 阶段推进：建立上市计划代表进入「上市准备」。不跨越、不回退已到后期/已上市的阶段。
    if (product.lifecycleStage === ProductLifecycleStage.IDEA || product.lifecycleStage === ProductLifecycleStage.ANALYSIS) {
      await tx.product.update({
        where: { id: product.id },
        data: { lifecycleStage: ProductLifecycleStage.LAUNCH_PREP },
      });
    }

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "LAUNCH_PLAN_PREPARED",
      objectType: "Product",
      objectId: product.id,
      summary: `建立上市计划「${created.title}」，目标日期 ${targetDate?.toISOString().slice(0, 10)}，负责人已指定，含 ${milestones.length} 个里程碑`,
      details: {
        planId: created.id,
        targetDate: targetDate?.toISOString() ?? null,
        ownerId: params.ownerId,
        milestoneCount: milestones.length,
        kindOfPlan: "LAUNCH_PREP",
      } as Prisma.InputJsonValue,
    });

    return created;
  });

  return { planId: plan.id };
}

export async function updateLaunchBasics(
  session: SessionContext,
  planId: string,
  params: { title?: string; targetDate?: string | null; ownerId?: string | null; notes?: string | null }
): Promise<void> {
  const plan = await prisma.launchPlan.findUnique({
    where: { id: planId },
    include: { formalG3Packet: true },
  });
  if (!plan || plan.organizationId !== session.organizationId) throw new NotFoundError("Launch plan not found");
  await assertLaunchWritePermission(session, plan.productId);

  // B5：ownerId 来自请求体，必须为本组织活跃用户（不接受外组织用户）
  if (params.ownerId) {
    await assertOrgUser(session, params.ownerId, "上市计划负责人");
  }

  if (plan.actualLaunchedAt) {
    throw new UnprocessableEntityError("产品已确认实际上市；历史上市计划不可再修改，请进入复盘流程记录后续变化");
  }

  const targetDate =
    params.targetDate === undefined ? plan.targetDate : parseDateOrNull(params.targetDate, "目标上市日期");

  await prisma.$transaction(async (tx) => {
    await claimLaunchPlanMutation(tx, plan, session.userId, "更新上市计划基本信息");
    await tx.launchPlan.update({
      where: { id: plan.id },
      data: {
        title: params.title === undefined ? plan.title : params.title.trim() || plan.title,
        targetDate,
        ownerId: params.ownerId === undefined ? plan.ownerId : params.ownerId,
        notes: params.notes === undefined ? plan.notes : params.notes?.trim() || null,
      },
    });
    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "LAUNCH_PLAN_UPDATED",
      objectType: "Product",
      objectId: plan.productId,
      summary: `更新上市计划基本信息`,
      details: { planId: plan.id, before: { title: plan.title, targetDate: plan.targetDate, ownerId: plan.ownerId }, after: params } as Prisma.InputJsonValue,
    });
  });
}

export async function upsertMilestone(
  session: SessionContext,
  planId: string,
  input: LaunchMilestoneInput
): Promise<{ milestoneId: string }> {
  if (!input.title?.trim()) throw new UnprocessableEntityError("里程碑标题必填");

  const plan = await prisma.launchPlan.findUnique({
    where: { id: planId },
    include: { milestones: true },
  });
  if (!plan || plan.organizationId !== session.organizationId) throw new NotFoundError("Launch plan not found");
  await assertLaunchWritePermission(session, plan.productId);
  if (plan.actualLaunchedAt) {
    throw new UnprocessableEntityError("产品已确认实际上市；历史上市里程碑不可再修改，请进入复盘流程");
  }

  // B5：里程碑上可选的 ownerId / workItemId 来自请求体，必须校验归属 ——
  // 外组织的用户、其它产品/项目的工作项都必须被拒绝。
  if (input.ownerId) {
    await assertOrgUser(session, input.ownerId, "里程碑负责人");
  }
  if (input.workItemId) {
    await assertWorkItemRef(session, input.workItemId, {
      productId: plan.productId,
      label: "关联工作项",
    });
  }

  // 标记 BLOCKED 必须写明原因：没有原因的阻塞无法被处理，也会让门禁失去意义
  if (input.status === "BLOCKED" && !input.blockerReason?.trim()) {
    throw new UnprocessableEntityError("标记为阻塞时必须填写阻塞原因");
  }

  const dueDate = parseDateOrNull(input.dueDate, "里程碑截止日期");
  const kind = input.kind && MILESTONE_KINDS.includes(input.kind) ? input.kind : undefined;

  if (input.id) {
    const existing = plan.milestones.find((m) => m.id === input.id);
    if (!existing) throw new NotFoundError("Milestone not found");

    const status = input.status ?? existing.status;
    await prisma.$transaction(async (tx) => {
      await claimLaunchPlanMutation(tx, plan, session.userId, `更新里程碑「${input.title.trim()}」`);
      await tx.launchMilestone.update({
        where: { id: existing.id },
        data: {
          title: input.title.trim(),
          kind: kind ?? existing.kind,
          dueDate: input.dueDate === undefined ? existing.dueDate : dueDate,
          ownerId: input.ownerId === undefined ? existing.ownerId : input.ownerId,
          status,
          blockerReason: status === "BLOCKED" ? input.blockerReason!.trim() : null,
          // 完成时间由状态驱动，不由调用方随意填写
          completedAt: status === "DONE" ? existing.completedAt ?? new Date() : null,
          workItemId: input.workItemId === undefined ? existing.workItemId : input.workItemId,
        },
      });
      await createAuditEventInTx(tx, {
        actorId: session.userId,
        action: "LAUNCH_MILESTONE_UPDATED",
        objectType: "Product",
        objectId: plan.productId,
        summary: `更新里程碑「${input.title.trim()}」状态 ${labelLaunchMilestoneStatus(existing.status)} → ${labelLaunchMilestoneStatus(status)}`,
        details: { planId: plan.id, milestoneId: existing.id, from: existing.status, to: status, blockerReason: input.blockerReason ?? null } as Prisma.InputJsonValue,
      });
    });
    return { milestoneId: existing.id };
  }

  const status = input.status ?? LaunchMilestoneStatus.PENDING;
  const maxSeq = plan.milestones.reduce((a, m) => Math.max(a, m.seq), -1);

  const created = await prisma.$transaction(async (tx) => {
    await claimLaunchPlanMutation(tx, plan, session.userId, `新增里程碑「${input.title.trim()}」`);
    const m = await tx.launchMilestone.create({
      data: {
        planId: plan.id,
        organizationId: session.organizationId,
        title: input.title.trim(),
        kind: kind ?? "OTHER",
        seq: maxSeq + 1,
        dueDate,
        ownerId: input.ownerId ?? null,
        status,
        blockerReason: status === "BLOCKED" ? input.blockerReason!.trim() : null,
        completedAt: status === "DONE" ? new Date() : null,
        workItemId: input.workItemId ?? null,
      },
    });
    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "LAUNCH_MILESTONE_ADDED",
      objectType: "Product",
      objectId: plan.productId,
      summary: `新增里程碑「${m.title}」（${labelLaunchMilestoneKind(kind ?? "OTHER")}）`,
      details: { planId: plan.id, milestoneId: m.id, status } as Prisma.InputJsonValue,
    });
    return m;
  });

  return { milestoneId: created.id };
}

/**
 * 提交正式 G3 上市授权审批。
 * 负责人只能“提交”，不能自批；最终决定必须由 Project.decisionMakerId 经统一 DecisionPacket 做出。
 */
export async function requestFormalG3Approval(
  session: SessionContext,
  planId: string
): Promise<{ packetId: string; status: string }> {
  let plan = await prisma.launchPlan.findUnique({
    where: { id: planId },
    include: { milestones: true, project: true, formalG3Packet: true },
  });
  if (!plan || plan.organizationId !== session.organizationId) throw new NotFoundError("Launch plan not found");
  if (plan.actualLaunchedAt) {
    throw new UnprocessableEntityError("产品已经确认实际上市，不能再次提交 G3");
  }
  if (!plan.projectId || !plan.project) {
    throw new UnprocessableEntityError("正式 G3 需要上市计划绑定项目");
  }
  if (plan.project.ownerId !== session.userId) {
    throw new ForbiddenError("只有项目负责人可以提交正式 G3 上市授权审批");
  }
  if (!plan.project.decisionMakerId || plan.project.decisionMakerId === plan.project.ownerId) {
    throw new UnprocessableEntityError("正式 G3 需要独立的指定决策人，且不得由负责人自批");
  }

  if (plan.formalG3PacketId && plan.formalG3Packet) {
    const currentValidity = await inspectFormalG3Validity(session, plan);
    if (currentValidity.valid) {
      return { packetId: plan.formalG3PacketId, status: "APPROVED" };
    }
    await invalidateFormalG3ForExternalDrift(session, plan, currentValidity.blockers);
    plan = await prisma.launchPlan.findUnique({
      where: { id: planId },
      include: { milestones: true, project: true, formalG3Packet: true },
    });
    if (!plan || plan.organizationId !== session.organizationId) {
      throw new ConflictError("G3 失效后重新读取上市计划失败");
    }
  }

  const gate = await evaluateFormalG3Gate(session, plan);
  if (!gate.ready) {
    throw new UnprocessableEntityError(`未通过 G3 前置门禁：${gate.blockers.join("；")}`);
  }

  const active = await prisma.decisionPacket.findFirst({
    where: {
      launchPlanId: plan.id,
      gate: GateType.LAUNCH_GATE,
      status: { in: ["DRAFT", "IN_REVIEW"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (active) {
    if (active.status === "IN_REVIEW") return { packetId: active.id, status: active.status };
    const submitted = await submitDecisionPacket(session, active.id);
    return { packetId: active.id, status: submitted?.status ?? "IN_REVIEW" };
  }

  if (!plan.projectId || !plan.project) {
    throw new ConflictError("正式 G3 提交前上市计划已失去项目关联");
  }
  const packet = await createDecisionPacketDraft(session, {
    projectId: plan.projectId,
    gate: GateType.LAUNCH_GATE,
    productVersionId: plan.project.productVersionId ?? undefined,
    launchPlanId: plan.id,
    artifactVersions: [],
    evidenceVersions: [],
    validationPlan: "正式 G3 上市授权：冻结上市计划、里程碑、产品版本与项目基线，审批时重新验证未发生漂移",
    requiredChecks: {},
  });
  const submitted = await submitDecisionPacket(session, packet.id);
  return { packetId: packet.id, status: submitted?.status ?? "IN_REVIEW" };
}

/** @deprecated 旧直接放行入口已收口为正式 G3 提交，不再直接写 approvedAt。 */
export async function approveLaunch(
  session: SessionContext,
  planId: string,
  _note?: string | null
): Promise<{ packetId: string; status: string }> {
  return requestFormalG3Approval(session, planId);
}

export async function revokeLaunchApproval(
  session: SessionContext,
  planId: string,
  reason: string
): Promise<void> {
  if (!reason?.trim()) throw new UnprocessableEntityError("撤销获准必须填写原因");
  const plan = await prisma.launchPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.organizationId !== session.organizationId) throw new NotFoundError("Launch plan not found");
  await assertLaunchWritePermission(session, plan.productId);

  if (plan.formalG3PacketId || plan.formalG3ApprovedAt) {
    throw new UnprocessableEntityError(
      "正式 G3 决策为不可变审计记录，不能用旧“撤销获准”按钮删除。若方案变化，请修改上市计划使当前 G3 自动失效后重新送审。"
    );
  }

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.launchPlan.updateMany({
      where: { id: plan.id, governanceRevision: plan.governanceRevision },
      data: { approvedAt: null, governanceRevision: { increment: 1 } },
    });
    if (claimed.count !== 1) throw new ConflictError("上市计划已发生并发修改，请刷新后重试");
    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "LAUNCH_APPROVAL_REVOKED",
      objectType: "Product",
      objectId: plan.productId,
      summary: `撤销上市计划获准：${reason.trim()}`,
      details: { planId: plan.id, reason: reason.trim() } as Prisma.InputJsonValue,
    });
  });
}

/**
 * 实际上市确认（与获准分开）。
 * 前置：必须持有当前有效的正式 G3；且必须提供实际动作说明（可选附证据 id）。
 * 写入 actualLaunchedAt 并把 Product.lifecycleStage 置为 LAUNCHED。
 */
export async function confirmLaunchExecution(
  session: SessionContext,
  planId: string,
  params: { evidenceId?: string | null; note: string }
): Promise<{ actualLaunchedAt: string; lifecycleStage: string; authorization: LaunchAuthorization }> {
  if (!params.note?.trim()) {
    throw new UnprocessableEntityError("确认实际上市必须填写实际动作说明（如渠道上线记录、首批出货凭证）");
  }

  const plan = await prisma.launchPlan.findUnique({
    where: { id: planId },
    include: {
      formalG3Packet: true,
      project: true,
    },
  });
  if (!plan || plan.organizationId !== session.organizationId) throw new NotFoundError("Launch plan not found");
  await assertLaunchWritePermission(session, plan.productId);

  if (
    !plan.formalG3PacketId ||
    !plan.formalG3ApprovedAt ||
    !plan.formalG3Packet ||
    plan.formalG3Packet.status !== "APPROVED"
  ) {
    throw new UnprocessableEntityError(
      "该上市计划尚未取得当前有效的正式 G3 授权，不能确认实际上市。旧机制批准不能替代正式 G3。"
    );
  }

  const currentG3Validity = await inspectFormalG3Validity(session, plan);
  if (!currentG3Validity.valid) {
    await invalidateFormalG3ForExternalDrift(session, plan, currentG3Validity.blockers);
    throw new ConflictError(
      `当前正式 G3 已因项目/生产交付基线变化而失效，必须重新审批：${currentG3Validity.blockers.join("；")}`
    );
  }

  if (plan.actualLaunchedAt) {
    throw new UnprocessableEntityError("实际上市时间已记录，不可重复确认");
  }

  // 若提供了证据，必须真实存在且属于本组织的项目 —— 不接受任意字符串当"证据"
  if (params.evidenceId) {
    const ev = await prisma.evidence.findUnique({
      where: { id: params.evidenceId },
      select: { id: true, project: { select: { organizationId: true } } },
    });
    if (!ev || ev.project.organizationId !== session.organizationId) {
      throw new UnprocessableEntityError("引用的证据不存在或不属于当前组织");
    }
  }

  const actualLaunchedAt = new Date();

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.launchPlan.updateMany({
      where: {
        id: plan.id,
        governanceRevision: plan.governanceRevision,
        formalG3PacketId: plan.formalG3PacketId,
        formalG3ApprovedAt: plan.formalG3ApprovedAt,
        actualLaunchedAt: null,
      },
      data: {
        actualLaunchedAt,
        status: LaunchPlanStatus.COMPLETED,
        notes: params.note.trim(),
      },
    });
    if (claimed.count !== 1) {
      throw new ConflictError("确认上市时 G3 授权或上市计划已发生变化，请刷新后重试");
    }
    await tx.product.update({
      where: { id: plan.productId },
      data: { lifecycleStage: ProductLifecycleStage.LAUNCHED },
    });
    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "LAUNCH_EXECUTED",
      objectType: "Product",
      objectId: plan.productId,
      summary: `确认实际上市：${params.note.trim()}`,
      details: {
        planId: plan.id,
        approvedAt: plan.approvedAt?.toISOString() ?? null,
        formalG3PacketId: plan.formalG3PacketId,
        formalG3ApprovedAt: plan.formalG3ApprovedAt?.toISOString() ?? null,
        actualLaunchedAt: actualLaunchedAt.toISOString(),
        evidenceId: params.evidenceId ?? null,
      } as Prisma.InputJsonValue,
    });
  });

  return {
    actualLaunchedAt: actualLaunchedAt.toISOString(),
    lifecycleStage: "LAUNCHED",
    authorization: describeLaunchExecutionAuthorization(plan),
  };
}
