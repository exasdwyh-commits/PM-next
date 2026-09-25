/**
 * 顾问动作提议：提议 → 权限和版本检查 → 用户确认 → 业务命令 → 回执（蓝图 §5.3、§6）
 *
 * 三条不可违反的规则：
 *  1. **模型不直接写数据库**：本模块只产出「待确认提议」（PENDING_CONFIRMATION）。
 *     真正写入必须由用户确认，经服务端权限与版本检查后调用既有业务命令。
 *  2. **重复点击或重试必须幂等**：同一 idempotencyKey 只产生一条提议；
 *     确认动作按 IdempotencyRecord 记录回执，重放直接返回同一回执，不二次写入。
 *  3. **旧版本提议在产品已改变时重新校验**：提议冻结 baseVersionHash。
 *     确认前若产品最新版本指纹已变，提议标记 SUPERSEDED 并拒绝执行，绝不覆盖新修改。
 *
 * 本模块是**确定性规则**，不调用任何模型。
 */

import crypto from "crypto";
import prisma from "@/shared/db";
import { ConflictError, ForbiddenError, NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import { OrgRole, Prisma, Role } from "@prisma/client";
import { SessionContext } from "../identity/session";
import { createWorkItemInTx } from "../work/service";
import { createDevelopmentProductInTx } from "../products/service";
import { FIELD_LABELS, ProductSpecField, createRevision } from "../product-development/revision";
import { analyzeProductVersion } from "../product-development/analysis";

// ---------------------------------------------------------------------------
// 动作类型与字段白名单
// ---------------------------------------------------------------------------

export type ProposalActionType =
  | "CREATE_WORK_ITEM"
  | "UPDATE_FIELD"
  | "CREATE_REVISION"
  | "CREATE_PRODUCT";

const ACTION_TYPES: ProposalActionType[] = [
  "CREATE_WORK_ITEM",
  "UPDATE_FIELD",
  "CREATE_REVISION",
  "CREATE_PRODUCT",
];

export const ACTION_TYPE_LABELS: Record<ProposalActionType, string> = {
  CREATE_WORK_ITEM: "创建内部工作项",
  UPDATE_FIELD: "修改产品方案字段",
  CREATE_REVISION: "创建产品新版本",
  CREATE_PRODUCT: "新建产品并立项",
};

/**
 * 顾问通道允许改写的产品字段。
 *
 * 刻意**不含 targetCost**：目标成本是财务假设，其变更会连带影响毛利结论与供应商报价，
 * 不在「对话里顺手改一个数」的风险等级内，必须走产品方案页由人显式录入。
 * 也不含任何证据、审批、上市日期字段 —— 这些不是「方案描述」。
 */
export const ADVISOR_FIELD_WHITELIST: ProductSpecField[] = [
  "coreIdea",
  "targetAudience",
  "coreSellingPoints",
  "targetChannels",
  "priceExpectation",
  "formSpec",
  "forbiddenItems",
];

export const ADVISOR_FIELD_LABELS: Record<string, string> = Object.fromEntries(
  ADVISOR_FIELD_WHITELIST.map((f) => [f, FIELD_LABELS[f]])
);

function isAdvisorField(x: unknown): x is ProductSpecField {
  return typeof x === "string" && ADVISOR_FIELD_WHITELIST.includes(x as ProductSpecField);
}

/** 稳定序列化：对象键排序，保证同一内容得到同一指纹 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = canonicalize(src[k]);
    return out;
  }
  return value === undefined ? null : value;
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * 产品版本指纹：由「版本 id + 版本号 + 方案字段 + 目标成本」决定。
 * 任一字段变化都会改变指纹 —— 这正是「旧提议是否已过期」的判据。
 */
export function hashProductVersion(
  version: { id: string; versionTag: string; specs: unknown; targetCost: unknown } | null
): string | null {
  if (!version) return null;
  return sha256(
    JSON.stringify(
      canonicalize({
        id: version.id,
        versionTag: version.versionTag,
        specs: version.specs,
        targetCost: version.targetCost === null || version.targetCost === undefined ? null : String(Number(version.targetCost)),
      })
    )
  ).slice(0, 32);
}

/** 读取产品当前最新版本的指纹；没有任何版本时返回 null */
export async function productVersionHash(productId: string): Promise<string | null> {
  const latest = await prisma.productVersion.findFirst({
    where: { productId },
    orderBy: { createdAt: "desc" },
  });
  return hashProductVersion(latest);
}

type ProposalAuthorizationTarget = {
  actionType: string;
  productId?: string | null;
  projectId?: string | null;
};

/**
 * Proposal 服务边界授权。
 *
 * 提议本身也是治理状态：创建、确认、拒绝、作废都会改变正式治理队列，
 * 因此不能只依赖最终业务命令做授权。这里把“能处置某类 proposal 的人”
 * 收敛为“具备执行该类业务写入权限的人”。
 */
async function assertProposalMutationAuthorized(
  tx: Prisma.TransactionClient,
  session: SessionContext,
  target: ProposalAuthorizationTarget
): Promise<void> {
  if (target.actionType === "CREATE_WORK_ITEM") {
    const projectId = normalizeText(target.projectId);
    if (!projectId) throw new UnprocessableEntityError("提议缺少 projectId");

    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { id: true, organizationId: true },
    });
    if (!project || project.organizationId !== session.organizationId) {
      throw new NotFoundError("Project not found");
    }

    const membership = await tx.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: session.userId } },
      select: { role: true },
    });
    if (!membership || membership.role !== Role.OWNER) {
      throw new ForbiddenError("Only project owner can manage work-item proposals");
    }
    return;
  }

  if (target.actionType === "CREATE_PRODUCT") {
    // 产品还不存在，没有产品级角色可查。门槛对齐它最终要调用的业务命令
    // （POST /api/products/ingest → createDevelopmentProduct）：任何本组织成员都能入库，
    // 建的人成为 OWNER。这里不发明比产品入库表单更严的限制 ——
    // 那会让「对话里能说、页面上能点」出现无法解释的差异。
    const membership = await tx.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: session.organizationId,
          userId: session.userId,
        },
      },
      select: { role: true },
    });
    if (!membership) {
      throw new ForbiddenError("你不是该组织成员，不能新建产品");
    }
    return;
  }

  if (target.actionType === "UPDATE_FIELD" || target.actionType === "CREATE_REVISION") {
    const productId = normalizeText(target.productId);
    if (!productId) throw new UnprocessableEntityError("提议缺少 productId");

    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { id: true, organizationId: true },
    });
    if (!product || product.organizationId !== session.organizationId) {
      throw new NotFoundError("Product not found");
    }

    const [projectCount, memberships] = await Promise.all([
      tx.project.count({
        where: { productId, organizationId: session.organizationId },
      }),
      tx.projectMember.findMany({
        where: {
          userId: session.userId,
          project: { productId, organizationId: session.organizationId },
        },
        select: { role: true },
      }),
    ]);

    if (projectCount === 0) {
      const orgMembership = await tx.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: session.organizationId,
            userId: session.userId,
          },
        },
        select: { role: true },
      });
      if (orgMembership?.role !== OrgRole.ORG_ADMIN) {
        throw new ForbiddenError("该产品尚未绑定项目，仅组织管理员可管理提议");
      }
      return;
    }

    const canWrite = memberships.some(
      (membership) =>
        membership.role === Role.OWNER || membership.role === Role.DECISION_MAKER
    );
    if (!canWrite) {
      throw new ForbiddenError("You do not have product write permission for this proposal");
    }
    return;
  }

  throw new UnprocessableEntityError(`不支持的提议类型「${target.actionType}」`);
}

// ---------------------------------------------------------------------------
// 1. 创建提议（幂等）
// ---------------------------------------------------------------------------

export interface UpdateFieldPayload {
  productId: string;
  /** 生成提议时依据的版本；确认前会重新校验，不一致即作废 */
  baseVersionId: string;
  field: ProductSpecField;
  /** 新值；null / 空串表示清空该字段 */
  value: string | null;
  /** 变动理由（人工确认时填写或由顾问给出），写入版本留痕 */
  note?: string | null;
}

export interface CreateWorkItemPayload {
  projectId: string;
  title: string;
  target: string;
  deliverableReq: string;
}

export interface CreateProposalParams {
  actionType: string;
  payload: unknown;
  productId?: string | null;
  projectId?: string | null;
  conversationId?: string | null;
  runId?: string | null;
  /** 幂等键：同一键只创建一条提议；重复提交返回既有提议且 created=false */
  idempotencyKey?: string | null;
  /** 提议依据说明（展示在卡片上），不是模型思维过程 */
  rationale?: string | null;
}

export interface CreateProposalResult {
  proposalId: string;
  created: boolean;
  status: string;
  /** 提议冻结的版本指纹（仅 UPDATE_FIELD / CREATE_REVISION 有） */
  baseVersionHash: string | null;
}

function normalizeText(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim();
  return s.length > 0 ? s : null;
}

export async function createProposal(
  session: SessionContext,
  params: CreateProposalParams
): Promise<CreateProposalResult> {
  const actionType = params.actionType as ProposalActionType;
  if (!ACTION_TYPES.includes(actionType)) {
    throw new UnprocessableEntityError(
      `不支持的提议类型「${params.actionType}」。当前支持：${ACTION_TYPES.join("、")}`
    );
  }

  // 幂等：同键直接返回既有提议（不重复创建，也不重复校验）
  const rawKey = normalizeText(params.idempotencyKey);
  if (rawKey) {
    const existing = await prisma.actionProposal.findUnique({ where: { idempotencyKey: rawKey } });
    if (existing) {
      if (
        existing.organizationId !== session.organizationId ||
        existing.proposedById !== session.userId
      ) {
        throw new NotFoundError("Proposal not found");
      }
      return {
        proposalId: existing.id,
        created: false,
        status: existing.status,
        baseVersionHash: existing.baseVersionHash,
      };
    }
  }

  const raw = (params.payload && typeof params.payload === "object" ? params.payload : {}) as Record<string, unknown>;

  let normalizedPayload: Record<string, unknown>;
  let productId: string | null = null;
  let projectId: string | null = null;
  let baseVersionHash: string | null = null;
  let expectedRevision: number | null = null;

  if (actionType === "UPDATE_FIELD") {
    const targetProductId = normalizeText(raw.productId) ?? normalizeText(params.productId);
    if (!targetProductId) throw new UnprocessableEntityError("UPDATE_FIELD 提议必须指定 productId");

    const product = await prisma.product.findUnique({
      where: { id: targetProductId },
      include: { versions: { orderBy: { createdAt: "desc" } } },
    });
    if (!product || product.organizationId !== session.organizationId) {
      throw new NotFoundError("Product not found");
    }
    if (product.versions.length === 0) {
      throw new UnprocessableEntityError("该产品还没有任何版本，无法提出字段修改");
    }

    if (!isAdvisorField(raw.field)) {
      throw new UnprocessableEntityError(
        `字段「${String(raw.field ?? "")}」不在顾问可改写白名单内。可改写：` +
          ADVISOR_FIELD_WHITELIST.map((f) => `${ADVISOR_FIELD_LABELS[f]}(${f})`).join("、")
      );
    }
    const field: ProductSpecField = raw.field;

    const latest = product.versions[0];
    const requestedBaseId = normalizeText(raw.baseVersionId);
    const base = requestedBaseId ? product.versions.find((v) => v.id === requestedBaseId) : latest;
    if (!base) {
      throw new NotFoundError("提议依据的产品版本不存在");
    }
    if (base.id !== latest.id) {
      throw new ConflictError(
        `提议依据 ${base.versionTag}，但产品当前最新版本已是 ${latest.versionTag}。` +
          `请基于最新版本重新生成提议，本轮不覆盖新修改。`
      );
    }

    const value = normalizeText(raw.value);
    normalizedPayload = {
      productId: product.id,
      baseVersionId: base.id,
      baseVersionTag: base.versionTag,
      field,
      fieldLabel: FIELD_LABELS[field],
      value,
    };
    productId = product.id;
    baseVersionHash = hashProductVersion(base);
    expectedRevision = product.methodRevision;
  } else if (actionType === "CREATE_WORK_ITEM") {
    const targetProjectId = normalizeText(raw.projectId) ?? normalizeText(params.projectId);
    if (!targetProjectId) throw new UnprocessableEntityError("CREATE_WORK_ITEM 提议必须指定 projectId");

    const project = await prisma.project.findUnique({ where: { id: targetProjectId } });
    if (!project || project.organizationId !== session.organizationId) {
      throw new NotFoundError("Project not found");
    }

    const title = normalizeText(raw.title);
    const target = normalizeText(raw.target) ?? normalizeText(raw.description) ?? title;
    const deliverableReq = normalizeText(raw.deliverableReq) ?? "工作项交付物与结论说明";
    if (!title) {
      throw new UnprocessableEntityError("工作项提议必须给出 title");
    }

    normalizedPayload = { projectId: project.id, projectTitle: project.title, title, target, deliverableReq };
    projectId = project.id;
  } else if (actionType === "CREATE_PRODUCT") {
    // 五个必填项与产品入库表单完全一致（见 products/service.ts createDevelopmentProductInTx）。
    // 缺项就在这里拒绝，不允许用占位值凑齐 —— 提议卡上写的每个字都必须是用户自己说过的话，
    // 确认之后这些值会原样成为产品的 v1 版本内容。
    const fields = {
      name: normalizeText(raw.name),
      coreIdea: normalizeText(raw.coreIdea),
      targetAudience: normalizeText(raw.targetAudience),
      coreSellingPoints: normalizeText(raw.coreSellingPoints),
      targetChannels: normalizeText(raw.targetChannels),
    };
    const missing = (
      [
        ["名称", fields.name],
        ["一句话想法", fields.coreIdea],
        ["目标人群与场景", fields.targetAudience],
        ["核心卖点", fields.coreSellingPoints],
        ["预期渠道", fields.targetChannels],
      ] as const
    )
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length > 0) {
      throw new UnprocessableEntityError(`新建产品提议缺少必填项：${missing.join("、")}`);
    }

    normalizedPayload = {
      ...fields,
      // 选填项缺失时保持 null。产品入库会把它们如实记进版本的 unknowns，
      // 不要在这里补默认值，否则用户会以为自己填过。
      priceExpectation: normalizeText(raw.priceExpectation),
      formSpec: normalizeText(raw.formSpec),
      forbiddenItems: normalizeText(raw.forbiddenItems),
    };
    // 产品尚不存在：没有 productId、没有版本指纹可冻结，也就不存在「基线已变」的冲突。
  } else {
    // CREATE_REVISION：顾问通道尚未实现（多轮优化有独立面板与命令，避免两条路径写同一份版本）
    throw new UnprocessableEntityError(
      "顾问通道尚未支持直接创建产品新版本。请到产品的「分析与评分」页签使用多轮优化面板采纳修改。"
    );
  }

  // 关联对象归属校验：不允许把提议挂到别的组织的会话/运行上
  if (params.conversationId) {
    const convo = await prisma.conversation.findUnique({ where: { id: params.conversationId } });
    if (!convo || convo.organizationId !== session.organizationId || convo.ownerId !== session.userId) {
      throw new NotFoundError("Conversation not found");
    }
  }
  if (params.runId) {
    const run = await prisma.agentRun.findUnique({ where: { id: params.runId } });
    if (!run || run.organizationId !== session.organizationId) {
      throw new NotFoundError("Agent run not found");
    }
  }

  try {
    const proposal = await prisma.$transaction(async (tx) => {
      await assertProposalMutationAuthorized(tx, session, {
        actionType,
        productId,
        projectId,
      });

      if (actionType === "UPDATE_FIELD" && productId) {
        const [currentProduct, latestVersion] = await Promise.all([
          tx.product.findUnique({
            where: { id: productId },
            select: { methodRevision: true },
          }),
          tx.productVersion.findFirst({
            where: { productId },
            orderBy: { createdAt: "desc" },
          }),
        ]);

        const currentHash = hashProductVersion(latestVersion);
        if (
          !currentProduct ||
          currentProduct.methodRevision !== expectedRevision ||
          currentHash !== baseVersionHash
        ) {
          throw new ConflictError(
            "产品在 proposal 创建过程中已发生变化，请基于最新版本重新生成提议"
          );
        }
      }

      const created = await tx.actionProposal.create({
        data: {
          organizationId: session.organizationId,
          runId: params.runId || null,
          conversationId: params.conversationId || null,
          productId: productId ?? normalizeText(params.productId),
          projectId: projectId ?? normalizeText(params.projectId),
          actionType,
          payloadJson: {
            ...normalizedPayload,
            rationale: normalizeText(params.rationale),
          } as Prisma.InputJsonValue,
          status: "PENDING_CONFIRMATION",
          proposedById: session.userId,
          idempotencyKey: rawKey,
          baseVersionHash,
          expectedRevision,
        },
      });

      // proposal 存在但审计缺失会形成不可追溯状态，因此二者必须原子提交。
      await tx.auditEvent.create({
        data: {
          actorId: session.userId,
          action: "ACTION_PROPOSAL_CREATED",
          objectType: "ActionProposal",
          objectId: created.id,
          summary: `顾问产出待确认提议「${ACTION_TYPE_LABELS[actionType]}」，未确认前不写入业务数据`,
          details: {
            actionType,
            payload: normalizedPayload,
            baseVersionHash,
            expectedRevision,
            rationale: normalizeText(params.rationale),
          } as Prisma.InputJsonValue,
        },
      });

      return created;
    });

    return { proposalId: proposal.id, created: true, status: proposal.status, baseVersionHash };
  } catch (e: any) {
    // 并发下唯一键冲突：按幂等语义返回既有提议
    if (rawKey && e?.code === "P2002") {
      const existing = await prisma.actionProposal.findUnique({ where: { idempotencyKey: rawKey } });
      if (
        existing &&
        existing.organizationId === session.organizationId &&
        existing.proposedById === session.userId
      ) {
        return {
          proposalId: existing.id,
          created: false,
          status: existing.status,
          baseVersionHash: existing.baseVersionHash,
        };
      }
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// 2. 查询与过期处理
// ---------------------------------------------------------------------------

export interface ListProposalsOptions {
  productId?: string | null;
  conversationId?: string | null;
  status?: string | null;
  take?: number;
}

export async function listProposals(session: SessionContext, opts: ListProposalsOptions = {}) {
  const rows = await prisma.actionProposal.findMany({
    where: {
      organizationId: session.organizationId,
      ...(opts.productId ? { productId: opts.productId } : {}),
      ...(opts.conversationId ? { conversationId: opts.conversationId } : {}),
      ...(opts.status ? { status: opts.status as any } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(opts.take ?? 30, 1), 100),
    include: {
      product: { select: { id: true, name: true } },
      proposedBy: { select: { id: true, name: true } },
    },
  });

  // ActionProposal 只有 projectId 而没有 project 关系字段（schema 未声明反向关系），
  // 因此项目标题单独查一次，不做隐式 join 假设。
  const projectIds = [...new Set(rows.map((r) => r.projectId).filter((x): x is string => !!x))];
  const projects =
    projectIds.length > 0
      ? await prisma.project.findMany({
          where: { id: { in: projectIds }, organizationId: session.organizationId },
          select: { id: true, title: true },
        })
      : [];
  const projectMap = new Map(projects.map((p) => [p.id, p]));

  const currentHash = opts.productId ? await productVersionHash(opts.productId) : null;

  return rows.map((r) => ({
    id: r.id,
    actionType: r.actionType,
    actionLabel: ACTION_TYPE_LABELS[r.actionType as ProposalActionType] ?? r.actionType,
    status: r.status,
    conversationId: r.conversationId,
    payloadJson: r.payloadJson,
    proposedBy: r.proposedBy ? { id: r.proposedBy.id, name: r.proposedBy.name } : null,
    product: r.product,
    project: r.projectId ? projectMap.get(r.projectId) ?? null : null,
    baseVersionHash: r.baseVersionHash,
    decidedAt: r.decidedAt,
    decisionReason: r.decisionReason,
    appliedObjectType: r.appliedObjectType,
    appliedObjectId: r.appliedObjectId,
    createdAt: r.createdAt,
    isStale:
      r.status === "PENDING_CONFIRMATION" &&
      r.baseVersionHash !== null &&
      currentHash !== null &&
      r.baseVersionHash !== currentHash,
  }));
}

export type ProposalRow = Awaited<ReturnType<typeof listProposals>>[number];

/**
 * 把已过期的待确认提议标为 SUPERSEDED。
 * 判据：提议冻结的 baseVersionHash 与产品当前最新版本指纹不一致。
 * 在用户打开产品页 / 顾问会话时调用，避免界面上堆积"看起来还能点，点了必然失败"的提议。
 */
export async function supersedeStaleProposals(
  session: SessionContext,
  productId: string
) {
  return prisma.$transaction(async (tx) => {
    await assertProposalMutationAuthorized(tx, session, {
      actionType: "UPDATE_FIELD",
      productId,
    });

    // 锁定 Product：与 createRevision 的 methodRevision CAS 串行化，
    // 防止我们刚算完 currentHash，另一事务立刻发布新版本。
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "Product"
      WHERE "id" = ${productId}
        AND "organizationId" = ${session.organizationId}
      FOR UPDATE
    `);

    const latest = await tx.productVersion.findFirst({
      where: { productId },
      orderBy: { createdAt: "desc" },
    });
    const currentHash = hashProductVersion(latest);

    const pending = await tx.actionProposal.findMany({
      where: {
        organizationId: session.organizationId,
        productId,
        status: "PENDING_CONFIRMATION",
      },
      select: { id: true, baseVersionHash: true },
    });

    const staleIds = pending
      .filter((proposal) =>
        proposal.baseVersionHash !== null && proposal.baseVersionHash !== currentHash
      )
      .map((proposal) => proposal.id);

    if (staleIds.length === 0) {
      return { superseded: 0, currentHash };
    }

    const changed = await tx.actionProposal.updateMany({
      where: {
        id: { in: staleIds },
        organizationId: session.organizationId,
        status: "PENDING_CONFIRMATION",
      },
      data: {
        status: "SUPERSEDED",
        decidedAt: new Date(),
        decidedById: session.userId,
        decisionReason: "产品方案已产生更新版本，该提议依据的旧版本已失效，未执行",
      },
    });

    if (changed.count > 0) {
      await tx.auditEvent.create({
        data: {
          actorId: session.userId,
          action: "ACTION_PROPOSAL_SUPERSEDED",
          objectType: "Product",
          objectId: productId,
          summary: `产品方案已变更，${changed.count} 条待确认提议因依据版本失效被作废（未写入业务数据）`,
          details: {
            proposalIds: staleIds,
            currentHash,
            changedCount: changed.count,
          } as Prisma.InputJsonValue,
        },
      });
    }

    return { superseded: changed.count, currentHash };
  });
}

// ---------------------------------------------------------------------------
// 3. 确认 → 应用（幂等回执）
// ---------------------------------------------------------------------------

export interface ApplyProposalOptions {
  /** 客户端幂等键（通常来自 Idempotency-Key 请求头） */
  idempotencyKey?: string | null;
  /** 人工确认说明 */
  reason?: string | null;
}

export interface ProposalReceipt {
  proposalId: string;
  actionType: string;
  status: string;
  appliedObjectType: string | null;
  appliedObjectId: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  /** true = 命中幂等（未发生新的写入） */
  idempotent: boolean;
  /** 业务回执明细；幂等重放时来自 IdempotencyRecord */
  result: Record<string, unknown> | null;
}

/** IdempotencyRecord 的 key 需要在全库唯一，因此按「命令域#原始键」组合存储 */
function composeIdemKey(scope: string, rawKey: string): string {
  return `${scope}#${rawKey}`;
}

/** responseStatus = 0 是"处理中"占位，不是 HTTP 状态码（模型要求 Int，故用 0 表示未完成） */
const IDEM_IN_PROGRESS = 0;

function receiptOf(
  p: {
    id: string;
    actionType: string;
    status: string;
    appliedObjectType: string | null;
    appliedObjectId: string | null;
    decidedAt: Date | null;
    decisionReason: string | null;
  },
  idempotent: boolean,
  result: Record<string, unknown> | null
): ProposalReceipt {
  return {
    proposalId: p.id,
    actionType: p.actionType,
    status: p.status,
    appliedObjectType: p.appliedObjectType,
    appliedObjectId: p.appliedObjectId,
    decidedAt: p.decidedAt ? p.decidedAt.toISOString() : null,
    decisionReason: p.decisionReason,
    idempotent,
    result,
  };
}

/**
 * 应用提议。
 *
 * 顺序刻意如此（蓝图 §5.3）：幂等重放 → 状态检查 → 占位加锁 → 版本/权限检查 → 业务命令 → 写回执。
 * 任一环节失败都会把提议还原为 PENDING_CONFIRMATION，绝不留下"半应用"状态。
 */
export async function applyProposal(
  session: SessionContext,
  proposalId: string,
  opts: ApplyProposalOptions = {}
): Promise<ProposalReceipt> {
  const rawKey = normalizeText(opts.idempotencyKey);
  const reason = normalizeText(opts.reason);
  const scope = "proposal.apply";
  const idemKey = rawKey ? composeIdemKey(scope, rawKey) : null;
  const requestHash = sha256(
    JSON.stringify(canonicalize({ proposalId, reason, actorId: session.userId }))
  );

  // 快速幂等重放。主事务拿到 proposal 行锁后会再次检查，覆盖并发窗口。
  if (idemKey) {
    const rec = await prisma.idempotencyRecord.findUnique({ where: { key: idemKey } });
    if (rec) {
      if (rec.actorId !== session.userId) throw new NotFoundError("Proposal not found");
      if (rec.commandScope !== scope || rec.requestHash !== requestHash) {
        throw new ConflictError("该幂等键已用于内容不同的请求，已拒绝执行");
      }
      if (rec.responseStatus === IDEM_IN_PROGRESS) {
        throw new ConflictError("上一次相同请求仍在处理中，请稍后刷新查看结果（未重复写入）");
      }
      return {
        ...((rec.responseBody ?? {}) as unknown as ProposalReceipt),
        idempotent: true,
      };
    }
  }

  type TxOutcome =
    | { kind: "ok"; receipt: ProposalReceipt; postCommitAnalysis: null | { productId: string; versionId: string; previousRunId: string | null } }
    | { kind: "superseded"; reason: string };

  let outcome: TxOutcome;
  try {
    outcome = await prisma.$transaction(async (tx): Promise<TxOutcome> => {
      // PostgreSQL 行锁：并发确认同一 proposal 时，第二个请求必须等第一个事务结束后再判断状态。
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "ActionProposal"
        WHERE "id" = ${proposalId}
          AND "organizationId" = ${session.organizationId}
        FOR UPDATE
      `);

      // 再次检查幂等键，关闭“事务开始前未看到、等待行锁期间另一请求已提交”的窗口。
      if (idemKey) {
        const replay = await tx.idempotencyRecord.findUnique({ where: { key: idemKey } });
        if (replay) {
          if (
            replay.actorId !== session.userId ||
            replay.commandScope !== scope ||
            replay.requestHash !== requestHash
          ) {
            throw new ConflictError("该幂等键已用于不同请求，已拒绝执行");
          }
          if (replay.responseStatus === IDEM_IN_PROGRESS) {
            throw new ConflictError("上一次相同请求仍在处理中，请稍后刷新查看结果（未重复写入）");
          }
          return {
            kind: "ok",
            receipt: {
              ...((replay.responseBody ?? {}) as unknown as ProposalReceipt),
              idempotent: true,
            },
            postCommitAnalysis: null,
          };
        }
      }

      const proposal = await tx.actionProposal.findUnique({ where: { id: proposalId } });
      if (!proposal || proposal.organizationId !== session.organizationId) {
        throw new NotFoundError("Proposal not found");
      }

      if (proposal.status === "APPLIED") {
        const receipt = receiptOf(
          proposal,
          true,
          { objectType: proposal.appliedObjectType, objectId: proposal.appliedObjectId }
        );
        if (idemKey) {
          await tx.idempotencyRecord.create({
            data: {
              key: idemKey,
              actorId: session.userId,
              commandScope: scope,
              requestHash,
              responseStatus: 200,
              responseBody: receipt as unknown as Prisma.InputJsonValue,
            },
          });
        }
        return { kind: "ok", receipt, postCommitAnalysis: null };
      }
      if (proposal.status === "SUPERSEDED") {
        throw new ConflictError(
          proposal.decisionReason || "该提议依据的产品版本已失效（产品产生了更新版本），未执行"
        );
      }
      if (proposal.status === "REJECTED") {
        throw new UnprocessableEntityError(proposal.decisionReason || "该提议已被拒绝，不能再次应用");
      }
      if (proposal.status === "EXPIRED") {
        throw new UnprocessableEntityError("该提议已过期，不能应用");
      }
      if (proposal.status !== "PENDING_CONFIRMATION") {
        throw new UnprocessableEntityError(`提议当前状态为 ${proposal.status}，不能应用`);
      }

      await assertProposalMutationAuthorized(tx, session, {
        actionType: proposal.actionType,
        productId: proposal.productId,
        projectId: proposal.projectId,
      });

      const payload = (
        proposal.payloadJson &&
        typeof proposal.payloadJson === "object" &&
        !Array.isArray(proposal.payloadJson)
          ? (proposal.payloadJson as Record<string, unknown>)
          : {}
      ) as Record<string, unknown>;

      let result: Record<string, unknown>;
      let appliedObjectType: string;
      let appliedObjectId: string;
      let postCommitAnalysis: { productId: string; versionId: string; previousRunId: string | null } | null = null;

      if (proposal.actionType === "CREATE_WORK_ITEM") {
        const projectId = String(payload.projectId ?? proposal.projectId ?? "");
        if (!projectId) throw new UnprocessableEntityError("提议缺少 projectId，无法创建工作项");

        const project = await tx.project.findUnique({ where: { id: projectId } });
        if (!project || project.organizationId !== session.organizationId) {
          throw new NotFoundError("Project not found");
        }
        const membership = await tx.projectMember.findUnique({
          where: { projectId_userId: { projectId, userId: session.userId } },
        });
        if (!membership || membership.role !== Role.OWNER) {
          throw new ForbiddenError("Only project owner can create work items");
        }

        const item = await createWorkItemInTx(tx, session, projectId, {
          title: String(payload.title ?? ""),
          target: String(payload.target ?? ""),
          deliverableReq: String(payload.deliverableReq ?? ""),
        });
        appliedObjectType = "WorkItem";
        appliedObjectId = item.id;
        result = { workItem: { id: item.id, title: item.title, status: item.status } };
      } else if (proposal.actionType === "UPDATE_FIELD") {
        const productId = String(payload.productId ?? proposal.productId ?? "");
        const baseVersionId = String(payload.baseVersionId ?? "");
        const field = String(payload.field ?? "");
        const product = await tx.product.findUnique({ where: { id: productId } });
        if (!product || product.organizationId !== session.organizationId) {
          throw new NotFoundError("Product not found");
        }

        const latest = await tx.productVersion.findFirst({
          where: { productId },
          orderBy: { createdAt: "desc" },
        });
        const currentHash = hashProductVersion(latest);
        if (proposal.baseVersionHash !== currentHash) {
          const supersededReason =
            "提议依据的产品版本已变更为更新版本，该提议未执行（不覆盖新修改）";
          await tx.actionProposal.update({
            where: { id: proposal.id },
            data: {
              status: "SUPERSEDED",
              decidedById: session.userId,
              decidedAt: new Date(),
              decisionReason: supersededReason,
            },
          });
          await tx.auditEvent.create({
            data: {
              actorId: session.userId,
              action: "ACTION_PROPOSAL_SUPERSEDED",
              objectType: "ActionProposal",
              objectId: proposal.id,
              summary: supersededReason,
              details: {
                baseVersionHash: proposal.baseVersionHash,
                currentHash,
              } as Prisma.InputJsonValue,
            },
          });
          return { kind: "superseded", reason: supersededReason };
        }

        // 版本写入、methodRevision CAS、写后读回和 PRODUCT_VERSION_REVISED 审计
        // 都复用同一个上层事务，不再出现“业务已提交但 proposal/receipt 未提交”。
        const revision = await createRevision(
          session,
          {
            productId,
            baseVersionId,
            adoptedKeys: [`advisor:UPDATE_FIELD:${field}`],
            changes: {
              [field]:
                payload.value === null || payload.value === undefined
                  ? null
                  : String(payload.value),
            },
            note: reason
              ? `顾问提议确认：${reason}`
              : `顾问提议确认：修改「${String(payload.fieldLabel ?? field)}」`,
            expectedMethodRevision: proposal.expectedRevision ?? undefined,
          },
          { tx, deferAnalysis: true }
        );

        appliedObjectType = "ProductVersion";
        appliedObjectId = revision.versionId;
        result = {
          versionTag: revision.versionTag,
          supersedesVersionTag: revision.supersedesVersionTag,
          changedFields: revision.diff.filter((d) => d.changed).map((d) => d.field),
          diff: revision.diff
            .filter((d) => d.changed)
            .map((d) => ({ field: d.field, label: d.label, before: d.before, after: d.after })),
          affectedDimensions: revision.affectedDimensions,
          analysisRunId: null,
          analysisRequested: true,
          methodRevision: revision.methodRevision,
        };
        postCommitAnalysis = {
          productId,
          versionId: revision.versionId,
          previousRunId: revision.previousRunId,
        };
      } else if (proposal.actionType === "CREATE_PRODUCT") {
        // 走产品入库这条既有业务命令，一次原子建出 Product + v1 + Project + 成员 + 审计。
        // sourceKind 记 AI_EXTRACTED：字段是从对话里提取的草稿，用户在提议卡上确认过，
        // 这与手工填表不是同一种来源，后续要能分辨。
        const created = await createDevelopmentProductInTx(tx, session, {
          name: String(payload.name ?? ""),
          coreIdea: String(payload.coreIdea ?? ""),
          targetAudience: String(payload.targetAudience ?? ""),
          coreSellingPoints: String(payload.coreSellingPoints ?? ""),
          targetChannels: String(payload.targetChannels ?? ""),
          priceExpectation: normalizeText(payload.priceExpectation) ?? undefined,
          formSpec: normalizeText(payload.formSpec) ?? undefined,
          forbiddenItems: normalizeText(payload.forbiddenItems) ?? undefined,
          sourceKind: "AI_EXTRACTED",
        });

        // 对话是 Kern 的主操作层：如果这份新产品提议来自一个全局 Kern 会话，
        // 确认成功后必须在**同一事务**把原会话绑定到刚创建的产品。
        // 否则用户下一句“继续优化这个产品”会重新落回未绑定上下文，
        // 被迫跳到产品页再新开会话，破坏 conversation-first 主链。
        //
        // 用条件 updateMany 而不是无条件 update：
        // - 只有仍然未绑定产品的原会话才允许绑定；
        // - 如果确认前会话上下文已被别的动作改变，整个事务回滚，
        //   不留下“产品已创建但会话指向别处”的半完成状态。
        if (proposal.conversationId) {
          const bound = await tx.conversation.updateMany({
            where: {
              id: proposal.conversationId,
              organizationId: session.organizationId,
              ownerId: session.userId,
              productId: null,
            },
            data: {
              productId: created.product.id,
              kind: "PRODUCT",
            },
          });
          if (bound.count !== 1) {
            throw new ConflictError(
              "确认前 Kern 会话上下文已变化，未创建产品。请回到当前会话重新发起新产品提议"
            );
          }
        }

        appliedObjectType = "Product";
        appliedObjectId = created.product.id;
        result = {
          product: {
            id: created.product.id,
            name: created.product.name,
            identityCode: created.product.identityCode,
            lifecycleStage: created.product.lifecycleStage,
          },
          versionTag: created.version.versionTag,
          project: { id: created.project.id, title: created.project.title },
          conversationBound: Boolean(proposal.conversationId),
        };
      } else if (proposal.actionType === "CREATE_REVISION") {
        throw new UnprocessableEntityError(
          "顾问通道尚未支持创建产品新版本，请在产品的多轮优化面板中采纳修改"
        );
      } else {
        throw new UnprocessableEntityError(`不支持的提议类型「${proposal.actionType}」`);
      }

      const decidedAt = new Date();
      const finalized = await tx.actionProposal.update({
        where: { id: proposal.id },
        data: {
          status: "APPLIED",
          decidedById: session.userId,
          decidedAt,
          decisionReason: reason || "用户确认应用",
          appliedObjectType,
          appliedObjectId,
        },
      });

      const receipt = receiptOf(finalized, false, result);

      await tx.auditEvent.create({
        data: {
          actorId: session.userId,
          action: "ACTION_PROPOSAL_APPLIED",
          objectType: appliedObjectType,
          objectId: appliedObjectId,
          summary:
            `确认并应用顾问提议「${ACTION_TYPE_LABELS[proposal.actionType as ProposalActionType] ?? proposal.actionType}」` +
            `→ ${appliedObjectType} ${appliedObjectId}；确认说明：${reason || "未填写"}`,
          details: {
            proposalId: proposal.id,
            actionType: proposal.actionType,
            result,
            idempotencyKey: rawKey,
            expectedRevision: proposal.expectedRevision,
          } as Prisma.InputJsonValue,
        },
      });

      if (idemKey) {
        await tx.idempotencyRecord.create({
          data: {
            key: idemKey,
            actorId: session.userId,
            commandScope: scope,
            requestHash,
            responseStatus: 200,
            responseBody: receipt as unknown as Prisma.InputJsonValue,
          },
        });
      }

      return { kind: "ok", receipt, postCommitAnalysis };
    });
  } catch (e: any) {
    // 跨 proposal 复用同一幂等键时，唯一约束会让整个事务回滚；
    // 回滚后再读取已提交的原回执，确保不会留下第二份业务写入。
    if (idemKey && e?.code === "P2002") {
      const rec = await prisma.idempotencyRecord.findUnique({ where: { key: idemKey } });
      if (
        rec &&
        rec.actorId === session.userId &&
        rec.commandScope === scope &&
        rec.requestHash === requestHash &&
        rec.responseStatus !== IDEM_IN_PROGRESS
      ) {
        return {
          ...((rec.responseBody ?? {}) as unknown as ProposalReceipt),
          idempotent: true,
        };
      }
      throw new ConflictError("该幂等键已被其他请求占用，且请求内容不一致");
    }
    throw e;
  }

  if (outcome.kind === "superseded") {
    throw new ConflictError(outcome.reason);
  }

  // 自动重评属于派生计算，不参与核心 Receipt。
  // Receipt 一旦在治理事务中落库就保持不可变，保证首次响应与幂等重放语义一致。
  if (outcome.postCommitAnalysis) {
    const meta = outcome.postCommitAnalysis;
    try {
      await analyzeProductVersion(session, {
        productId: meta.productId,
        productVersionId: meta.versionId,
        kind: "REVISION_REVIEW",
        supersedesRunId: meta.previousRunId ?? undefined,
      });
    } catch (e) {
      // 派生分析失败不反向污染已经成功提交的业务事实；
      // 单独留痕，后续可重试/补跑。
      await prisma.auditEvent.create({
        data: {
          actorId: session.userId,
          action: "PROPOSAL_REANALYSIS_FAILED",
          objectType: "ProductVersion",
          objectId: meta.versionId,
          summary: `顾问提议已成功应用，但自动重评失败：${(e as Error).message}`,
          details: {
            proposalId,
            productId: meta.productId,
            productVersionId: meta.versionId,
            supersedesRunId: meta.previousRunId,
          } as Prisma.InputJsonValue,
        },
      }).catch(() => {
        // 核心治理事务已经提交；派生失败日志不得改写核心 Receipt 或制造“业务失败”假象。
      });
    }
  }

  return outcome.receipt;
}

/** 蓝图 §7 接口名为 applyProposal；confirm 为同一命令的对外别名 */
export const confirmProposal = applyProposal;

// ---------------------------------------------------------------------------
// 4. 拒绝
// ---------------------------------------------------------------------------

export async function rejectProposal(
  session: SessionContext,
  proposalId: string,
  reason: string | null
) {
  const text = normalizeText(reason);
  if (!text) {
    throw new UnprocessableEntityError("拒绝提议必须填写理由（用于留痕与后续回归）");
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "ActionProposal"
      WHERE "id" = ${proposalId}
        AND "organizationId" = ${session.organizationId}
      FOR UPDATE
    `);

    const proposal = await tx.actionProposal.findUnique({
      where: { id: proposalId },
    });
    if (!proposal || proposal.organizationId !== session.organizationId) {
      throw new NotFoundError("Proposal not found");
    }

    await assertProposalMutationAuthorized(tx, session, {
      actionType: proposal.actionType,
      productId: proposal.productId,
      projectId: proposal.projectId,
    });

    if (proposal.status === "APPLIED") {
      throw new ConflictError("该提议已应用，不能改为拒绝；如需撤销请走对应业务命令");
    }
    if (proposal.status === "REJECTED") {
      return {
        proposalId: proposal.id,
        status: proposal.status,
        idempotent: true,
      };
    }
    if (proposal.status !== "PENDING_CONFIRMATION") {
      throw new UnprocessableEntityError(
        `提议当前状态为 ${proposal.status}，不能拒绝`
      );
    }

    const now = new Date();
    const updated = await tx.actionProposal.update({
      where: { id: proposal.id },
      data: {
        status: "REJECTED",
        decidedById: session.userId,
        decidedAt: now,
        decisionReason: text,
      },
    });

    await tx.auditEvent.create({
      data: {
        actorId: session.userId,
        action: "ACTION_PROPOSAL_REJECTED",
        objectType: "ActionProposal",
        objectId: proposal.id,
        summary: `拒绝顾问提议，未写入业务数据。理由：${text}`,
        details: {
          actionType: proposal.actionType,
          productId: proposal.productId,
          projectId: proposal.projectId,
        } as Prisma.InputJsonValue,
      },
    });

    return {
      proposalId: updated.id,
      status: updated.status,
      idempotent: false,
    };
  });
}

// ---------------------------------------------------------------------------
// 5. 专业分析 → 提议转换
// ---------------------------------------------------------------------------

/** 专业分析推荐动作类型 */
export type ProfessionalAnalysisActionType = 
  | "SUPPLEMENT_EVIDENCE"   // 补证任务 → CREATE_WORK_ITEM
  | "UPDATE_FIELD"          // 字段差异 → UPDATE_FIELD
  | "REQUEST_REVISION";     // 局部修订 → CREATE_REVISION

/** 专业分析推荐动作标签 */
export const PROFESSIONAL_ANALYSIS_ACTION_LABELS: Record<ProfessionalAnalysisActionType, string> = {
  SUPPLEMENT_EVIDENCE: "补充证据任务",
  UPDATE_FIELD: "修改产品方案字段",
  REQUEST_REVISION: "创建产品新版本",
};

/**
 * 从专业分析输出生成可采纳提议
 *
 * 将专业分析的 recommendedActions、unknowns、risks 转换为：
 * - SUPPLEMENT_EVIDENCE → CREATE_WORK_ITEM（补证任务）
 * - UPDATE_FIELD → UPDATE_FIELD（字段差异）
 * - REQUEST_REVISION → CREATE_REVISION（局部修订）
 *
 * 保持白名单、revision、幂等；不能让新分析直接发布版本或批准。
 */
export async function createProposalsFromProfessionalAnalysis(
  session: SessionContext,
  params: {
    /** 产品 ID */
    productId: string;
    /** 产品版本 ID */
    productVersionId: string;
    /** 专业分析推荐动作 */
    recommendedActions: Array<{
      action: string;
      priority: "HIGH" | "MEDIUM" | "LOW";
      owner?: string;
    }>;
    /** 未知项（补证任务来源） */
    unknowns?: string[];
    /** 风险列表（高风险项可能需要补证） */
    risks?: Array<{
      description: string;
      severity: "HIGH" | "MEDIUM" | "LOW";
      mitigation?: string;
    }>;
    /** 关联的运行 ID */
    runId?: string;
    /** 关联的会话 ID */
    conversationId?: string;
    /** 项目 ID（用于创建工作项） */
    projectId?: string;
    /** 提议理由说明 */
    rationale?: string;
  }
): Promise<Array<{
  actionType: ProposalActionType;
  proposalId: string;
  created: boolean;
  status: string;
  /** 转换后的下游动作类型 */
  derivedAction: ProfessionalAnalysisActionType;
  /** 动作描述 */
  description: string;
}>> {
  const results: Array<{
    actionType: ProposalActionType;
    proposalId: string;
    created: boolean;
    status: string;
    derivedAction: ProfessionalAnalysisActionType;
    description: string;
  }> = [];

  // 1. 从 recommendedActions 创建补证任务
  for (const action of params.recommendedActions) {
    if (!action.action || action.action.trim().length === 0) continue;

    const derivedAction: ProfessionalAnalysisActionType = "SUPPLEMENT_EVIDENCE";
    const description = `[专业分析建议] ${action.action}（优先级：${action.priority}）`;

    try {
      const proposal = await createProposal(session, {
        actionType: "CREATE_WORK_ITEM",
        payload: {
          projectId: params.projectId,
          title: action.action.slice(0, 100), // 截断到合理长度
          target: action.action,
          deliverableReq: `补证任务：${action.action}`,
        },
        productId: params.productId,
        runId: params.runId,
        conversationId: params.conversationId,
        rationale: params.rationale || `专业分析推荐补证（优先级：${action.priority}）`,
      });

      results.push({
        actionType: "CREATE_WORK_ITEM",
        proposalId: proposal.proposalId,
        created: proposal.created,
        status: proposal.status,
        derivedAction,
        description,
      });
    } catch {
      // 跳过无效提议（如项目不存在等）
    }
  }

  // 2. 从 unknowns 创建补证任务
  for (const unknown of (params.unknowns ?? [])) {
    if (!unknown || unknown.trim().length === 0) continue;

    const derivedAction: ProfessionalAnalysisActionType = "SUPPLEMENT_EVIDENCE";
    const description = `[专业分析未知项] ${unknown}`;

    try {
      const proposal = await createProposal(session, {
        actionType: "CREATE_WORK_ITEM",
        payload: {
          projectId: params.projectId,
          title: `补证：${unknown.slice(0, 80)}`,
          target: unknown,
          deliverableReq: `需要收集或验证以下信息：${unknown}`,
        },
        productId: params.productId,
        runId: params.runId,
        conversationId: params.conversationId,
        rationale: params.rationale || "专业分析识别的未知项需要补证",
      });

      results.push({
        actionType: "CREATE_WORK_ITEM",
        proposalId: proposal.proposalId,
        created: proposal.created,
        status: proposal.status,
        derivedAction,
        description,
      });
    } catch {
      // 跳过无效提议
    }
  }

  // 3. 从高风险项创建补证任务（仅 HIGH 风险）
  for (const risk of (params.risks ?? []).filter((r) => r.severity === "HIGH")) {
    if (!risk.description || risk.description.trim().length === 0) continue;

    const derivedAction: ProfessionalAnalysisActionType = "SUPPLEMENT_EVIDENCE";
    const description = `[专业分析高风险] ${risk.description}`;

    try {
      const proposal = await createProposal(session, {
        actionType: "CREATE_WORK_ITEM",
        payload: {
          projectId: params.projectId,
          title: `风险缓解：${risk.description.slice(0, 80)}`,
          target: risk.description,
          deliverableReq: risk.mitigation
            ? `缓解措施：${risk.mitigation}`
            : "需要评估风险并制定缓解措施",
        },
        productId: params.productId,
        runId: params.runId,
        conversationId: params.conversationId,
        rationale: params.rationale || "专业分析识别的高风险项需要补证",
      });

      results.push({
        actionType: "CREATE_WORK_ITEM",
        proposalId: proposal.proposalId,
        created: proposal.created,
        status: proposal.status,
        derivedAction,
        description,
      });
    } catch {
      // 跳过无效提议
    }
  }

  return results;
}

/**
 * 从专业分析输出生成字段修改提议
 *
 * 专门处理字段差异类的推荐动作（如"修改目标受众"、"调整核心卖点"等）。
 * 需要明确的字段名和目标值才能创建 UPDATE_FIELD 提议。
 */
export async function createFieldUpdateProposalFromAnalysis(
  session: SessionContext,
  params: {
    /** 产品 ID */
    productId: string;
    /** 产品版本 ID */
    productVersionId: string;
    /** 目标字段 */
    field: ProductSpecField;
    /** 目标值 */
    value: string;
    /** 来源分析的推荐动作 */
    sourceAction: string;
    /** 优先级 */
    priority: "HIGH" | "MEDIUM" | "LOW";
    /** 关联的运行 ID */
    runId?: string;
    /** 关联的会话 ID */
    conversationId?: string;
    /** 提议理由说明 */
    rationale?: string;
  }
): Promise<{
  actionType: ProposalActionType;
  proposalId: string;
  created: boolean;
  status: string;
  derivedAction: ProfessionalAnalysisActionType;
  description: string;
}> {
  if (!isAdvisorField(params.field)) {
    throw new UnprocessableEntityError(
      `字段「${params.field}」不在顾问可改写白名单内。可改写：` +
        ADVISOR_FIELD_WHITELIST.map((f) => `${ADVISOR_FIELD_LABELS[f]}(${f})`).join("、")
    );
  }

  const derivedAction: ProfessionalAnalysisActionType = "UPDATE_FIELD";
  const description = `[专业分析] ${params.sourceAction}（优先级：${params.priority}）`;

  const proposal = await createProposal(session, {
    actionType: "UPDATE_FIELD",
    payload: {
      productId: params.productId,
      field: params.field,
      value: params.value,
    },
    runId: params.runId,
    conversationId: params.conversationId,
    rationale: params.rationale || `专业分析推荐修改「${FIELD_LABELS[params.field]}」`,
  });

  return {
    actionType: "UPDATE_FIELD",
    proposalId: proposal.proposalId,
    created: proposal.created,
    status: proposal.status,
    derivedAction,
    description,
  };
}
