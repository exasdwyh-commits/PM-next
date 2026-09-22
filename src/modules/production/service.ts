import prisma from "@/shared/db";
import { createAuditEventInTx } from "@/shared/audit";
import { ConflictError, ForbiddenError, NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import {
  DecisionPacketStatus,
  GateType,
  ProjectMode,
  ProjectStage,
  Role,
  WorkExecutorType,
  WorkItemStatus,
  Prisma,
} from "@prisma/client";
import type { SessionContext } from "../identity/session";
import { requireProjectRole } from "../identity/session";
import { createDecisionPacketDraft, submitDecisionPacket } from "../decisions/service";
import { computeScopeHash } from "../decisions/scope-hash";
import { readStructuredArtifact } from "../work/structured-artifacts";
import {
  evaluateProductionGate,
  evaluateProductionPreparation,
  type ProductionProjectInput,
} from "./gate";

const PRODUCTION_PROJECT_INCLUDE = {
  productVersion: { select: { id: true, isConfirmed: true } },
  workItems: {
    include: {
      artifacts: true,
    },
  },
} as const;

const G2_PREP_WORK_ITEMS = [
  {
    key: "SUPPLIER_QUOTE",
    title: "[G2] 供应商正式报价",
    target: "取得当前产品版本对应的正式生产报价并核对有效期、MOQ、交期和付款条件",
    deliverableReq: "提交结构化 SUPPLIER_QUOTE，并由负责人验收通过",
  },
  {
    key: "PROFESSIONAL_CONFIRMATION",
    title: "[G2] 专业与合规确认",
    target: "确认当前产品身份、地区、渠道及生产相关专业/合规边界",
    deliverableReq: "提交结构化 PROFESSIONAL_CONFIRMATION，并由负责人验收通过",
  },
  {
    key: "PACKAGING_BRIEF",
    title: "[G2] 包装生产确认",
    target: "冻结当前包装版本、材质、规格与合规注意事项",
    deliverableReq: "提交结构化 PACKAGING_BRIEF，并由负责人验收通过",
  },
  {
    key: "PRODUCTION_PLAN",
    title: "[G2] 生产投入计划",
    target: "明确生产数量、预算、引用报价/样品/包装、交期、生产条件与停止条件",
    deliverableReq: "提交结构化 PRODUCTION_PLAN，并由负责人验收通过",
  },
] as const;

async function loadProductionProject(projectId: string) {
  return prisma.project.findUnique({
    where: { id: projectId },
    include: PRODUCTION_PROJECT_INCLUDE,
  });
}

function assertProjectVisible(
  project: Awaited<ReturnType<typeof loadProductionProject>>,
  session: SessionContext
): asserts project is NonNullable<Awaited<ReturnType<typeof loadProductionProject>>> {
  if (!project || project.organizationId !== session.organizationId) {
    throw new NotFoundError("Project not found");
  }
}

export async function getProductionContext(session: SessionContext, projectId: string) {
  await requireProjectRole(session, projectId, Object.values(Role));
  const project = await loadProductionProject(projectId);
  assertProjectVisible(project, session);

  const [latestG2, latestRecord] = await Promise.all([
    prisma.decisionPacket.findFirst({
      where: { projectId, gate: GateType.PRODUCTION_GATE },
      orderBy: { createdAt: "desc" },
      include: {
        decisions: {
          orderBy: { decidedAt: "desc" },
          take: 1,
          include: { actor: { select: { id: true, name: true } } },
        },
      },
    }),
    prisma.artifact.findFirst({
      where: {
        organizationId: session.organizationId,
        productVersionId: project.productVersionId,
        type: "PRODUCTION_RECORD",
        reviewStatus: "ACCEPTED",
        workItem: { projectId },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, contentVersion: true, createdAt: true },
    }),
  ]);

  const preparation = evaluateProductionPreparation(project as unknown as ProductionProjectInput);
  const gate =
    project.stage === ProjectStage.PRODUCTION_PREP
      ? evaluateProductionGate(project as unknown as ProductionProjectInput)
      : null;

  return {
    projectId: project.id,
    mode: project.mode,
    stage: project.stage,
    revision: project.revision,
    productVersionId: project.productVersionId,
    preparation,
    gate,
    latestG2,
    latestProductionRecord: latestRecord,
    canPrepare: project.ownerId === session.userId,
    canRequestG2: project.ownerId === session.userId,
    canDecideG2:
      !!project.decisionMakerId &&
      project.decisionMakerId === session.userId &&
      project.ownerId !== session.userId,
  };
}

async function ensureG2PreparationWorkItems(
  tx: Prisma.TransactionClient,
  project: {
    id: string;
    revision: number;
    workItems: Array<{ title: string }>;
  },
  inputRevision: number
) {
  const existing = new Set(project.workItems.map((w) => w.title));
  const created: string[] = [];
  for (const spec of G2_PREP_WORK_ITEMS) {
    if (existing.has(spec.title)) continue;
    const row = await tx.workItem.create({
      data: {
        projectId: project.id,
        title: spec.title,
        target: spec.target,
        deliverableReq: spec.deliverableReq,
        executorType: WorkExecutorType.HUMAN,
        status: WorkItemStatus.TODO,
        inputRevision,
      },
    });
    created.push(row.id);
  }
  return created;
}

/**
 * 新品：只有当前版本人工验收的 SAMPLE_ROUND=PASS 才能从 SAMPLING 显式进入 PRODUCTION_PREP。
 * 固定产品：创建时已从 PRODUCTION_PREP 开始，本命令只补齐 G2 准备工作项。
 */
export async function prepareProduction(session: SessionContext, projectId: string) {
  await requireProjectRole(session, projectId, [Role.OWNER]);
  const project = await loadProductionProject(projectId);
  assertProjectVisible(project, session);

  if (!project.productVersionId || !project.productVersion?.isConfirmed) {
    throw new UnprocessableEntityError("生产准备必须绑定已确认的当前产品版本");
  }

  if (project.mode === ProjectMode.NEW_PRODUCT) {
    if (project.stage !== ProjectStage.SAMPLING) {
      if (project.stage === ProjectStage.PRODUCTION_PREP) {
        return { projectId, stage: project.stage, revision: project.revision, alreadyPrepared: true };
      }
      throw new UnprocessableEntityError(
        `新品只能从 SAMPLING 显式进入 PRODUCTION_PREP，当前阶段为 ${project.stage}`
      );
    }
    const prep = evaluateProductionPreparation(project as unknown as ProductionProjectInput);
    if (!prep.ready) {
      throw new UnprocessableEntityError(
        `尚不能进入生产准备：${prep.blockers.join("；")}`
      );
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.project.updateMany({
        where: { id: project.id, revision: project.revision, stage: ProjectStage.SAMPLING },
        data: {
          stage: ProjectStage.PRODUCTION_PREP,
          revision: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new ConflictError("进入生产准备时项目基线已并发变化，请刷新后重试");
      }
      const next = await tx.project.findUnique({
        where: { id: project.id },
        include: { workItems: { select: { title: true } } },
      });
      if (!next) throw new ConflictError("项目在生产准备事务中已不存在");
      const createdWorkItemIds = await ensureG2PreparationWorkItems(
        tx,
        next,
        next.revision
      );
      await createAuditEventInTx(tx, {
        actorId: session.userId,
        action: "PRODUCTION_PREPARED",
        objectType: "Project",
        objectId: project.id,
        revision: next.revision,
        summary: "负责人确认样品阶段闭环，项目显式进入生产准备；这不代表 G2 已批准",
        details: {
          from: ProjectStage.SAMPLING,
          to: ProjectStage.PRODUCTION_PREP,
          createdWorkItemIds,
        } as Prisma.InputJsonValue,
      });
      return {
        projectId,
        stage: next.stage,
        revision: next.revision,
        createdWorkItemIds,
        alreadyPrepared: false,
      };
    });
  }

  if (project.stage !== ProjectStage.PRODUCTION_PREP) {
    throw new UnprocessableEntityError(
      `固定产品应从 PRODUCTION_PREP 开始，当前阶段为 ${project.stage}`
    );
  }

  const createdWorkItemIds = await prisma.$transaction(async (tx) =>
    ensureG2PreparationWorkItems(tx, project, project.revision)
  );
  return {
    projectId,
    stage: project.stage,
    revision: project.revision,
    createdWorkItemIds,
    alreadyPrepared: true,
  };
}

export async function requestFormalG2Approval(session: SessionContext, projectId: string) {
  await requireProjectRole(session, projectId, [Role.OWNER]);
  const project = await loadProductionProject(projectId);
  assertProjectVisible(project, session);

  if (!project.decisionMakerId || project.decisionMakerId === project.ownerId) {
    throw new UnprocessableEntityError("正式 G2 需要与负责人不同的指定决策人");
  }

  const gate = evaluateProductionGate(project as unknown as ProductionProjectInput);
  if (!gate.ready) {
    throw new UnprocessableEntityError(
      `未满足正式 G2 前置门禁：${gate.blockers.join("；")}`
    );
  }

  const active = await prisma.decisionPacket.findFirst({
    where: {
      projectId,
      gate: GateType.PRODUCTION_GATE,
      status: { in: [DecisionPacketStatus.DRAFT, DecisionPacketStatus.IN_REVIEW] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (active) {
    const activeFingerprint = packetProductionFingerprint(active);
    if (activeFingerprint === gate.productionFingerprint) {
      if (active.status === DecisionPacketStatus.IN_REVIEW) {
        return { packetId: active.id, status: active.status };
      }
      const submitted = await submitDecisionPacket(session, active.id);
      return { packetId: active.id, status: submitted?.status ?? DecisionPacketStatus.IN_REVIEW };
    }

    await prisma.$transaction(async (tx) => {
      const withdrawn = await tx.decisionPacket.updateMany({
        where: {
          id: active.id,
          status: { in: [DecisionPacketStatus.DRAFT, DecisionPacketStatus.IN_REVIEW] },
        },
        data: { status: DecisionPacketStatus.WITHDRAWN },
      });
      if (withdrawn.count > 0) {
        await createAuditEventInTx(tx, {
          actorId: session.userId,
          action: "FORMAL_G2_INVALIDATED",
          objectType: "DecisionPacket",
          objectId: active.id,
          revision: project.revision,
          summary: "生产投入关键输入已变化，旧 G2 草稿/待审批快照自动撤回",
          details: {
            projectId,
            previousFingerprint: activeFingerprint,
            currentFingerprint: gate.productionFingerprint,
          } as Prisma.InputJsonValue,
        });
      }
    });
  }

  const packet = await createDecisionPacketDraft(session, {
    projectId,
    gate: GateType.PRODUCTION_GATE,
    productVersionId: project.productVersionId ?? undefined,
    artifactVersions: gate.artifactRefs,
    evidenceVersions: [],
    budgetAmount: gate.budgetAmount ?? undefined,
    budgetCurrency: gate.budgetCurrency,
    budgetScope: gate.budgetScope ?? undefined,
    validationPlan: gate.validationPlan,
    requiredChecks: gate.requiredChecks,
  });
  const submitted = await submitDecisionPacket(session, packet.id);
  return { packetId: packet.id, status: submitted?.status ?? DecisionPacketStatus.IN_REVIEW };
}

function packetProductionFingerprint(packet: { requiredChecks: unknown }): string | null {
  const checks = (packet.requiredChecks ?? {}) as Record<string, unknown>;
  return typeof checks.productionFingerprint === "string" ? checks.productionFingerprint : null;
}

/**
 * G2 批准 != 已开工。负责人确认真实开工时，重新验证批准的生产输入仍然是当前输入，
 * 然后才从 PRODUCTION_PREP -> PRODUCTION。
 */
export async function confirmProductionStart(
  session: SessionContext,
  projectId: string,
  note: string
) {
  if (!note?.trim()) throw new UnprocessableEntityError("确认生产开工必须填写实际动作说明");
  await requireProjectRole(session, projectId, [Role.OWNER]);

  const project = await loadProductionProject(projectId);
  assertProjectVisible(project, session);
  if (project.stage !== ProjectStage.PRODUCTION_PREP) {
    throw new UnprocessableEntityError(
      `只有 PRODUCTION_PREP 阶段可以确认实际开工，当前阶段为 ${project.stage}`
    );
  }

  const approved = await prisma.decisionPacket.findFirst({
    where: {
      projectId,
      gate: GateType.PRODUCTION_GATE,
      status: DecisionPacketStatus.APPROVED,
    },
    orderBy: { createdAt: "desc" },
  });
  if (!approved) {
    throw new UnprocessableEntityError("尚无正式 G2 生产投入授权，不能确认开工");
  }

  const gate = evaluateProductionGate(project as unknown as ProductionProjectInput);
  if (!gate.ready) {
    throw new UnprocessableEntityError(
      `G2 批准后当前生产输入已不再满足门禁：${gate.blockers.join("；")}`
    );
  }

  const frozenProductionFingerprint = packetProductionFingerprint(approved);
  if (!frozenProductionFingerprint || frozenProductionFingerprint !== gate.productionFingerprint) {
    throw new ConflictError("G2 批准后的生产版本、报价、样品/确认、包装或生产计划已变化，必须重新提交 G2");
  }

  const currentScopeHash = computeScopeHash({
    projectId,
    gate: GateType.PRODUCTION_GATE,
    productVersionId: project.productVersionId,
    artifactVersions: gate.artifactRefs,
    evidenceVersions: [],
    budgetAmount: gate.budgetAmount,
    budgetCurrency: gate.budgetCurrency,
    budgetScope: gate.budgetScope,
    validationPlan: gate.validationPlan,
  });
  if (currentScopeHash !== approved.scopeHash) {
    throw new ConflictError("G2 当前范围指纹与批准快照不一致，必须重新审批");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.project.updateMany({
      where: {
        id: project.id,
        revision: project.revision,
        stage: ProjectStage.PRODUCTION_PREP,
      },
      data: {
        stage: ProjectStage.PRODUCTION,
        revision: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new ConflictError("确认开工时项目阶段或修订号已并发变化");
    }

    const next = await tx.project.findUnique({ where: { id: project.id } });
    if (!next) throw new ConflictError("项目在确认开工事务中已不存在");

    const existingTracking = await tx.workItem.findFirst({
      where: { projectId, title: "[生产执行] 批次生产与交付确认" },
      select: { id: true },
    });
    const tracking =
      existingTracking ??
      (await tx.workItem.create({
        data: {
          projectId,
          title: "[生产执行] 批次生产与交付确认",
          target: "记录真实生产批次、数量、异常与交付凭据；不得把 G2 批准时间当作生产时间",
          deliverableReq: "提交结构化 PRODUCTION_RECORD，authorizationRef 必须指向本次正式 G2 决策包",
          executorType: WorkExecutorType.HUMAN,
          status: WorkItemStatus.TODO,
          inputRevision: next.revision,
        },
      }));

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "PRODUCTION_STARTED",
      objectType: "Project",
      objectId: projectId,
      revision: next.revision,
      summary: `负责人确认实际生产开工：${note.trim()}`,
      details: {
        g2PacketId: approved.id,
        productionFingerprint: gate.productionFingerprint,
        trackingWorkItemId: tracking.id,
      } as Prisma.InputJsonValue,
    });

    return {
      projectId,
      stage: next.stage,
      revision: next.revision,
      g2PacketId: approved.id,
      trackingWorkItemId: tracking.id,
    };
  });
}

export async function confirmProductionDelivery(
  session: SessionContext,
  projectId: string,
  note: string
) {
  if (!note?.trim()) throw new UnprocessableEntityError("确认生产交付必须填写实际交付说明");
  await requireProjectRole(session, projectId, [Role.OWNER]);

  const project = await loadProductionProject(projectId);
  assertProjectVisible(project, session);
  if (project.stage !== ProjectStage.PRODUCTION) {
    throw new UnprocessableEntityError(
      `只有 PRODUCTION 阶段可以确认交付，当前阶段为 ${project.stage}`
    );
  }

  const approved = await prisma.decisionPacket.findFirst({
    where: {
      projectId,
      gate: GateType.PRODUCTION_GATE,
      status: DecisionPacketStatus.APPROVED,
    },
    orderBy: { createdAt: "desc" },
  });
  if (!approved) throw new UnprocessableEntityError("缺少正式 G2 授权记录，不能确认交付");

  const record = await prisma.artifact.findFirst({
    where: {
      organizationId: session.organizationId,
      productVersionId: project.productVersionId,
      type: "PRODUCTION_RECORD",
      reviewStatus: "ACCEPTED",
      workItem: { projectId },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!record || !record.schemaVersion) {
    throw new UnprocessableEntityError("缺少当前产品版本、负责人验收通过的结构化 PRODUCTION_RECORD");
  }

  const parsed = readStructuredArtifact({
    type: record.type,
    content: record.content,
    schemaVersion: record.schemaVersion,
  });
  if (parsed.kind !== "structured") {
    throw new UnprocessableEntityError("PRODUCTION_RECORD 不是结构化成果");
  }
  if (parsed.value.dataNature !== "REAL") {
    throw new UnprocessableEntityError("测试/演示 PRODUCTION_RECORD 不能确认真实交付");
  }
  const missing = Array.isArray(parsed.value.missingInputs) ? parsed.value.missingInputs : [];
  if (missing.length > 0) {
    throw new UnprocessableEntityError(
      `PRODUCTION_RECORD 仍有未闭合输入：${missing.join("、")}`
    );
  }
  if (parsed.value.authorizationRef !== approved.id) {
    throw new ConflictError("生产记录 authorizationRef 与当前正式 G2 授权不一致");
  }
  if (typeof parsed.value.quantity !== "number" || parsed.value.quantity <= 0) {
    throw new UnprocessableEntityError("生产记录必须包含正数实际生产数量");
  }

  const authorization = ((approved.requiredChecks as Record<string, any>)?.productionAuthorization ?? {}) as {
    quantity?: unknown;
    unit?: unknown;
    budget?: unknown;
    currency?: unknown;
  };
  if (
    typeof authorization.quantity !== "number" ||
    authorization.quantity <= 0 ||
    typeof authorization.unit !== "string" ||
    !authorization.unit.trim()
  ) {
    throw new ConflictError("正式 G2 缺少可验证的授权数量/单位边界，不能确认交付");
  }
  if (parsed.value.quantity > authorization.quantity) {
    throw new ConflictError(
      `实际生产数量 ${parsed.value.quantity} 超过 G2 授权数量 ${authorization.quantity}，必须重新提交 G2`
    );
  }
  if (parsed.value.unit !== authorization.unit) {
    throw new ConflictError(
      `生产记录单位 ${String(parsed.value.unit ?? "UNKNOWN")} 与 G2 授权单位 ${authorization.unit} 不一致，必须重新提交 G2`
    );
  }

  if (
    typeof parsed.value.deliveryConfirmation !== "string" ||
    !parsed.value.deliveryConfirmation.trim()
  ) {
    throw new UnprocessableEntityError("生产记录必须包含真实交付确认");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.project.updateMany({
      where: {
        id: project.id,
        revision: project.revision,
        stage: ProjectStage.PRODUCTION,
      },
      data: {
        stage: ProjectStage.DELIVERED,
        revision: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new ConflictError("确认交付时项目阶段或修订号已并发变化");
    const next = await tx.project.findUnique({ where: { id: project.id } });
    if (!next) throw new ConflictError("项目在确认交付事务中已不存在");

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "PRODUCTION_DELIVERED",
      objectType: "Project",
      objectId: projectId,
      revision: next.revision,
      summary: `负责人确认真实生产交付：${note.trim()}`,
      details: {
        g2PacketId: approved.id,
        productionRecordId: record.id,
        quantity: parsed.value.quantity,
        unit: parsed.value.unit,
        authorizedQuantity: authorization.quantity,
        authorizedUnit: authorization.unit,
        deliveredByEvidence: parsed.value.deliveryConfirmation,
      } as Prisma.InputJsonValue,
    });

    return {
      projectId,
      stage: next.stage,
      revision: next.revision,
      g2PacketId: approved.id,
      productionRecordId: record.id,
    };
  });
}
