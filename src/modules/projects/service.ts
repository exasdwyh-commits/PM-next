import prisma from "@/shared/db";
import { ForbiddenError, NotFoundError, ConflictError, UnprocessableEntityError } from "@/shared/errors";
import { ProjectMode, ProjectStage, Role, Prisma } from "@prisma/client";
import { createAuditEventInTx } from "@/shared/audit";
import { labelProjectMode, labelProjectStage } from "@/shared/status-labels";
import { SessionContext } from "../identity/session";
import { computeScopeHash } from "../decisions/scope-hash";
import { resolveAuthoritativeArtifactRefs } from "../decisions/artifact-ref";
import { pickResolvedClaims, computeEvidenceGaps } from "../research/evidence-claims";
import { PROJECT_DETAIL_SELECT, APPROVAL_META_SELECT } from "./project-view";

export interface CreateProjectParams {
  title: string;
  target: string;
  mode: ProjectMode;
  isDemo?: boolean;
  decisionMakerId?: string;
  productVersionId?: string;
  constraints?: string;
}

export async function createProject(session: SessionContext, params: CreateProjectParams) {
  if (!params.title || !params.target) {
    throw new UnprocessableEntityError("Project title and target are required");
  }

  // R08 validation: FIXED_PRODUCT requires a confirmed product version belonging to the same organization
  if (params.mode === ProjectMode.FIXED_PRODUCT) {
    if (!params.productVersionId) {
      throw new UnprocessableEntityError("Fixed product project requires a confirmed product version");
    }
    const pv = await prisma.productVersion.findUnique({
      where: { id: params.productVersionId },
      include: { product: true },
    });
    if (!pv || pv.product.organizationId !== session.organizationId || !pv.isConfirmed) {
      throw new UnprocessableEntityError("Specified product version is invalid, unconfirmed, or belongs to another organization (R08)");
    }
  }

  // Validate decisionMaker if provided
  if (params.decisionMakerId) {
    if (params.decisionMakerId === session.userId) {
      throw new UnprocessableEntityError("Decision maker must be a distinct user from project owner (A05)");
    }
    const dm = await prisma.user.findUnique({
      where: { id: params.decisionMakerId },
    });
    if (!dm || dm.organizationId !== session.organizationId) {
      throw new UnprocessableEntityError("Decision maker must belong to the same organization");
    }
  }

  const initialStage = params.mode === ProjectMode.FIXED_PRODUCT ? ProjectStage.PRODUCTION_PREP : ProjectStage.DRAFT;

  const project = await prisma.$transaction(async (tx) => {
    const p = await tx.project.create({
      data: {
        organizationId: session.organizationId,
        title: params.title.trim(),
        target: params.target.trim(),
        mode: params.mode,
        isDemo: params.isDemo ?? false, // R07: formal isDemo flag
        stage: initialStage,
        productVersionId: params.mode === ProjectMode.FIXED_PRODUCT ? params.productVersionId : undefined, // R08: persistent link
        ownerId: session.userId,
        decisionMakerId: params.decisionMakerId,
        constraints: params.constraints,
      },
    });

    // Add owner as ProjectMember
    await tx.projectMember.create({
      data: {
        projectId: p.id,
        userId: session.userId,
        role: Role.OWNER,
      },
    });

    // Add decision maker as ProjectMember if configured
    if (params.decisionMakerId) {
      await tx.projectMember.create({
        data: {
          projectId: p.id,
          userId: params.decisionMakerId,
          role: Role.DECISION_MAKER,
        },
      });
    }

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "PROJECT_CREATED",
      objectType: "Project",
      objectId: p.id,
      revision: p.revision,
      summary: `创建项目 "${p.title}"，模式: ${labelProjectMode(p.mode)}，演示属性: ${p.isDemo}，初始阶段: ${labelProjectStage(p.stage)}`,
    });

    return p;
  });

  return project;
}

export async function getProjectDetail(session: SessionContext, projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    // B6 收尾：对外形状统一由 project-view 白名单决定，页面 SSR 与本服务共用同一份定义，
    // 不再各自 include 整行（原实现会下发内部关联 id、Json 与整个 productVersion/product）
    select: PROJECT_DETAIL_SELECT,
  });

  if (!project || project.organizationId !== session.organizationId) {
    throw new NotFoundError("Project not found");
  }

  const currentMember = project.members.find((m) => m.userId === session.userId);
  if (!currentMember) {
    throw new ForbiddenError("You are not authorized to view this project");
  }

  // R07: Calculate gaps strictly: Verified REAL evidence required for non-demo projects
  const verifiedEvidences = project.evidences.filter((e) => e.verifyStatus === "VERIFIED");
  const verifiedRealEvidences = verifiedEvidences.filter((e) => e.nature === "REAL");
  const latestPacket = project.decisionPackets[0];

  const gaps: string[] = [];
  if (!project.isDemo && verifiedRealEvidences.length === 0) {
    gaps.push("缺少核实有效的真实市场依据 (VERIFIED REAL Evidence)");
  }
  if (!latestPacket || !latestPacket.budgetAmount || !latestPacket.budgetScope) {
    gaps.push("拟投入预算金额或明确授权动作范围未确定");
  }
  if (!project.decisionMakerId) {
    gaps.push("未指定独立项目决策人");
  }

  // P1-01: 证据缺口 —— 仅基于已核实 FACT 断言计算，缺失关键业务字段保持 OPEN，不自动补成事实
  const claimRows = project.evidences.flatMap((ev) =>
    (ev.claims ?? []).map((c) => ({ ...c, evidence: { source: ev.source, verifyStatus: ev.verifyStatus } }))
  );
  const { selected: resolvedFields } = pickResolvedClaims(claimRows);
  const evidenceGaps = computeEvidenceGaps(resolvedFields.map((s) => s.fieldKey));
  const structuredEvidence = {
    resolved: resolvedFields,
    gaps: evidenceGaps,
  };

  // R06: Real dynamic validity calculation:
  // Check if current authoritative baseline matches the approved packet's scopeHash and requirement snapshot
  let hasValidApproval = false;
  let approvalWarning: string | null = null;

  const approvedPacket =
    project.stage === ProjectStage.SAMPLING
      ? // B6：批准比对的原像 Json（artifactVersions / evidenceVersions / snapshot）不下发客户端，
        // 故按需单独窄查询，而不是留在对外白名单里
        await prisma.decisionPacket.findFirst({
          where: { projectId: project.id, status: "APPROVED" },
          orderBy: { createdAt: "desc" },
          select: APPROVAL_META_SELECT,
        })
      : null;
  if (approvedPacket) {
    // 权威成果：同一类型仅取已验收的最高版本（历史修订版本保留但不参与基线判定）
    const currentArtifacts = resolveAuthoritativeArtifactRefs(
      project.workItems.flatMap((w) => w.artifacts)
    );
    const currentEvidences = project.evidences.filter((e) => e.verifyStatus === "VERIFIED").map((e) => ({ id: e.id, hash: e.hash }));

    const snapshot = approvedPacket.snapshot as any;
    const projectRequirementDrifted = Boolean(
      snapshot &&
      ((snapshot.projectTarget !== undefined && snapshot.projectTarget !== project.target) ||
       (snapshot.projectConstraints !== undefined && snapshot.projectConstraints !== project.constraints))
    );

    const currentAuthoritativeScopeHash = computeScopeHash({
      projectId: project.id,
      gate: approvedPacket.gate,
      productVersionId: project.productVersionId,
      artifactVersions: currentArtifacts.length > 0 ? currentArtifacts : (approvedPacket.artifactVersions as any),
      evidenceVersions: currentEvidences.length > 0 ? currentEvidences : (approvedPacket.evidenceVersions as any),
      budgetAmount: approvedPacket.budgetAmount ? Number(approvedPacket.budgetAmount) : null,
      budgetCurrency: approvedPacket.budgetCurrency,
      budgetScope: approvedPacket.budgetScope,
      validationPlan: approvedPacket.validationPlan,
    });

    if (currentAuthoritativeScopeHash === approvedPacket.scopeHash && !projectRequirementDrifted) {
      hasValidApproval = true;
    } else {
      hasValidApproval = false;
      approvalWarning = "基准要素（产品版本、业务目标/技术约束、成果或证据）已发生变更，原打样门批准当前不适用，项目处于待复核状态 (R06)";
    }
  }

  // `members` 只用于上面的成员鉴权与角色判定，不属于对外字段（客户端不消费该关系）；
  // 必须显式摘除：否则 `...project` 会把成员 userId/role 一并下发到浏览器。
  const { members: _members, ...projectPublic } = project;

  return {
    ...projectPublic,
    currentRole: currentMember.role,
    gaps,
    structuredEvidence,
    hasValidApproval,
    approvalWarning,
  };
}

export async function updateProject(
  session: SessionContext,
  projectId: string,
  updates: { target?: string; constraints?: string; expectedRevision: number }
) {
  const member = await prisma.projectMember.findUnique({
    where: {
      projectId_userId: { projectId, userId: session.userId },
    },
    include: { project: true },
  });

  if (!member || member.project.organizationId !== session.organizationId) {
    throw new NotFoundError("Project not found");
  }

  if (member.role !== Role.OWNER) {
    throw new ForbiddenError("Only project owner can update project requirements");
  }

  // R06: Concurrency optimistic lock directly in atomic update statement
  return await prisma.$transaction(async (tx) => {
    const updateResult = await tx.project.updateMany({
      where: {
        id: projectId,
        revision: updates.expectedRevision,
      },
      data: {
        target: updates.target !== undefined ? updates.target.trim() : undefined,
        constraints: updates.constraints !== undefined ? updates.constraints : undefined,
        revision: { increment: 1 },
      },
    });

    if (updateResult.count === 0) {
      throw new ConflictError(`Concurrent revision conflict: expected revision ${updates.expectedRevision}`);
    }

    const updated = await tx.project.findUnique({ where: { id: projectId } });

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "PROJECT_UPDATED",
      objectType: "Project",
      objectId: projectId,
      revision: updated?.revision,
      summary: `更新项目需求目标或约束，版本更新至 r${updated?.revision}`,
    });

    return updated;
  });
}
