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
import { ForbiddenError, NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import {
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
  const checks: LaunchGateCheck[] = [];

  checks.push({
    key: "owner",
    label: "已指定负责人",
    ok: !!plan.ownerId,
    detail: plan.ownerId ? "负责人已指定" : "尚未指定负责人",
  });

  checks.push({
    key: "targetDate",
    label: "已设置目标日期",
    ok: !!plan.targetDate,
    detail: plan.targetDate ? "目标日期已设置" : "尚未设置目标日期",
  });

  checks.push({
    key: "milestones",
    label: "至少一个依赖里程碑",
    ok: plan.milestones.length > 0,
    detail: plan.milestones.length > 0 ? `已有 ${plan.milestones.length} 个里程碑` : "尚无任何依赖里程碑",
  });

  const blocked = plan.milestones.filter((m) => m.status === "BLOCKED");
  checks.push({
    key: "no_blocked",
    label: "无阻塞项",
    ok: blocked.length === 0,
    detail:
      blocked.length === 0
        ? "无阻塞项"
        : `存在 ${blocked.length} 个阻塞项：${blocked.map((m) => m.title).join("、")}`,
  });

  const unfinished = plan.milestones.filter((m) => m.status !== "DONE");
  checks.push({
    key: "all_done",
    label: "全部依赖已完成",
    ok: plan.milestones.length > 0 && unfinished.length === 0,
    detail:
      plan.milestones.length === 0
        ? "尚无里程碑，谈不上完成"
        : unfinished.length === 0
          ? "全部里程碑已完成"
          : `未完成 ${unfinished.length} 项：${unfinished
              .map((m) => `${m.title}（${m.status}）`)
              .join("、")}`,
  });

  const blockers = checks.filter((c) => !c.ok).map((c) => c.detail);
  const ready = blockers.length === 0;

  return {
    ready,
    checks,
    blockers,
    summary: ready
      ? "门禁全部满足，可提交放行（获准）。"
      : `尚有 ${blockers.length} 项未满足：${blockers.join("；")}`,
  };
}

export async function computeLaunchGate(session: SessionContext, planId: string): Promise<LaunchGate> {
  const plan = await prisma.launchPlan.findUnique({
    where: { id: planId },
    include: { milestones: { orderBy: { seq: "asc" } } },
  });
  if (!plan || plan.organizationId !== session.organizationId) throw new NotFoundError("Launch plan not found");
  return evaluateGate(plan);
}

// ---------------------------------------------------------------------------
// 放行机制来源（TASK-005b）：区分「旧机制批准 / 准备就绪」与「正式 G3 授权」
// ---------------------------------------------------------------------------

/**
 * 放行机制来源。
 * - `LEGACY_APPROVAL`：旧 `approveLaunch` 机制写入的 `approvedAt`（仅产品写角色，非指定决策人）。
 * - `FORMAL_G3`：**正式 G3 授权 —— 当前恒不存在**（未实现；待 TASK-034/035 把 `approveLaunch`
 *   改为经统一 `DecisionPacket` 授权后才会出现）。
 */
export type LaunchAuthorizationMechanism = "LEGACY_APPROVAL" | "FORMAL_G3";

export interface LaunchAuthorization {
  /** 是否已获放行（**仅凭 `approvedAt` 非空**，**不代表正式授权**） */
  approved: boolean;
  /** 机制来源：当前只可能是 `LEGACY_APPROVAL`；未放行为 `null`。 */
  mechanism: LaunchAuthorizationMechanism | null;
  /** 是否已获**正式 G3** 授权 —— 当前**恒为 `false`**。 */
  formalG3: boolean;
  /** 缺口说明：正式 G3 未授权时非空（调用方据此**显式暴露缺口**，不得视为完整授权）。 */
  gap: string | null;
}

/** 正式 G3 未实现时的固定缺口文案（供 UI 与测试共用，改一处即可）。 */
export const FORMAL_G3_UNAVAILABLE_GAP =
  "正式 G3 授权尚未实现（TASK-034/035）；当前放行仅为旧 approve 机制（LEGACY_APPROVAL · 准备就绪），不得视为完整上市授权。";

/** 确认实际开售时，因无正式 G3 授权而必须随结果一并返回的缺口文案。 */
export const LAUNCH_EXECUTION_NO_FORMAL_G3_GAP =
  "该实际开售记录是在无正式 G3 授权的情况下录入的（旧机制批准 · 准备就绪 · 非正式 G3 授权）。";

/**
 * 由 `LaunchPlan` 推导放行机制来源。**只读、无副作用、不写任何 `Decision`。**
 * 关键：即使 `approvedAt` 非空，`formalG3` 也**恒为 `false`**、`gap` 非空 ——
 * 调用方**不得**仅凭 `approvedAt` 判定"已获正式授权"。
 */
export function describeLaunchAuthorization(plan: { approvedAt: Date | null }): LaunchAuthorization {
  if (!plan.approvedAt) {
    return { approved: false, mechanism: null, formalG3: false, gap: null };
  }
  return {
    approved: true,
    mechanism: "LEGACY_APPROVAL",
    formalG3: false,
    gap: FORMAL_G3_UNAVAILABLE_GAP,
  };
}

/**
 * 确认实际开售时随结果返回的授权缺口（纯函数，便于测试）。
 * 允许记录"已发生的事实"，但**必须**显式暴露"无正式 G3 授权"这一缺口。
 */
export function describeLaunchExecutionAuthorization(): LaunchAuthorization {
  return {
    approved: true,
    mechanism: "LEGACY_APPROVAL",
    formalG3: false,
    gap: LAUNCH_EXECUTION_NO_FORMAL_G3_GAP,
  };
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
    },
  });

  // 候选负责人：该产品全部项目的成员。只列出真实成员，不伪造候选人。
  const members = await prisma.projectMember.findMany({
    where: { project: { productId, organizationId: session.organizationId } },
    select: { role: true, user: { select: { id: true, name: true, email: true } } },
    distinct: ["userId"],
  });

  // 写权限同样由服务端判定，前端据此决定是否禁用表单（不作安全边界）
  let canEdit = false;
  try {
    await assertLaunchWritePermission(session, productId);
    canEdit = true;
  } catch {
    canEdit = false;
  }

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
    gate: plan ? evaluateGate(plan) : null,
    // TASK-005b：显式携带放行机制来源（LEGACY_APPROVAL vs FORMAL_G3）；
    // 调用方不得只看 approvedAt 就以为拿到正式授权。
    authorization: plan ? describeLaunchAuthorization(plan) : null,
    canEdit,
    milestoneKinds: MILESTONE_KINDS.map((k) => ({ key: k, label: MILESTONE_KIND_LABELS[k] })),
  };
}

// ---------------------------------------------------------------------------
// 写入
// ---------------------------------------------------------------------------

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
  const plan = await prisma.launchPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.organizationId !== session.organizationId) throw new NotFoundError("Launch plan not found");
  await assertLaunchWritePermission(session, plan.productId);

  // B5：ownerId 来自请求体，必须为本组织活跃用户（不接受外组织用户）
  if (params.ownerId) {
    await assertOrgUser(session, params.ownerId, "上市计划负责人");
  }

  const targetDate =
    params.targetDate === undefined ? plan.targetDate : parseDateOrNull(params.targetDate, "目标上市日期");

  await prisma.$transaction(async (tx) => {
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
 * 放行（获准）。
 * 必须通过门禁；只写 approvedAt，**不写 actualLaunchedAt、不改 Product.lifecycleStage**。
 */
export async function approveLaunch(
  session: SessionContext,
  planId: string,
  note?: string | null
): Promise<{ approvedAt: string }> {
  const plan = await prisma.launchPlan.findUnique({
    where: { id: planId },
    include: { milestones: true },
  });
  if (!plan || plan.organizationId !== session.organizationId) throw new NotFoundError("Launch plan not found");
  await assertLaunchWritePermission(session, plan.productId);

  const gate = evaluateGate(plan);
  if (!gate.ready) {
    throw new UnprocessableEntityError(`未通过放行门禁，不得放行：${gate.blockers.join("；")}`);
  }

  const approvedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.launchPlan.update({
      where: { id: plan.id },
      data: { approvedAt, status: LaunchPlanStatus.ACTIVE },
    });
    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "LAUNCH_APPROVED",
      objectType: "Product",
      objectId: plan.productId,
      summary: `上市计划获准（approve）。获准只表示允许推进，产品不会被自动标记为已上市`,
      details: { planId: plan.id, approvedAt: approvedAt.toISOString(), note: note ?? null, gateChecks: gate.checks } as unknown as Prisma.InputJsonValue,
    });
  });

  return { approvedAt: approvedAt.toISOString() };
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

  await prisma.$transaction(async (tx) => {
    await tx.launchPlan.update({ where: { id: plan.id }, data: { approvedAt: null } });
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
 * 前置：必须已获准；且必须提供实际动作说明（可选附证据 id）。
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

  const plan = await prisma.launchPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.organizationId !== session.organizationId) throw new NotFoundError("Launch plan not found");
  await assertLaunchWritePermission(session, plan.productId);

  if (!plan.approvedAt) {
    throw new UnprocessableEntityError("该上市计划尚未获准，不能确认实际上市。审批通过只表示获准，需先通过放行门禁并获得批准。");
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
    await tx.launchPlan.update({
      where: { id: plan.id },
      data: {
        actualLaunchedAt,
        status: LaunchPlanStatus.COMPLETED,
        notes: params.note.trim(),
      },
    });
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
        actualLaunchedAt: actualLaunchedAt.toISOString(),
        evidenceId: params.evidenceId ?? null,
      } as Prisma.InputJsonValue,
    });
  });

  return {
    actualLaunchedAt: actualLaunchedAt.toISOString(),
    lifecycleStage: "LAUNCHED",
    // TASK-005b：允许记录实际开售（已发生的事实不因授权缺失被挡），但**必须显式暴露缺口**。
    authorization: describeLaunchExecutionAuthorization(),
  };
}
