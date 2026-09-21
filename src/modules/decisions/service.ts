import prisma from "@/shared/db";
import { ForbiddenError, NotFoundError, UnprocessableEntityError, ConflictError } from "@/shared/errors";
import {
  GateType,
  DecisionPacketStatus,
  DecisionOutcome,
  ProjectStage,
  ProjectMode,
  WorkExecutorType,
  WorkItemStatus,
  Role,
  Prisma,
} from "@prisma/client";
import { createAuditEventInTx } from "@/shared/audit";
import { SessionContext, requireProjectRole } from "../identity/session";
import { computeScopeHash, diffScopeInput, ScopeHashInput } from "./scope-hash";
import { computeArtifactContentHash, findSupersedingVersion, resolveAuthoritativeArtifactRefs } from "./artifact-ref";
import { computeRequestHash } from "@/shared/idempotency";
import { labelDecisionOutcome, labelDecisionPacketStatus } from "@/shared/status-labels";

/**
 * 决策命令的幂等作用域字面量。读取判定与写入必须使用**同一个常量**，
 * 避免两处字面量漂移导致「同命令被误判为跨命令」（TASK-003b）。
 */
const DECIDE_COMMAND_SCOPE = "DECIDE_DECISION_PACKET";

/**
 * **已实现**的放行门型集合。当前**只含 `RESEARCH_SAMPLING_GATE`（G1）**。
 *
 * 背景（TASK-003a 只读复现结论）：`decideDecisionPacket` 的 APPROVE 分支此前**不按 `GateType` 分派**，
 * 任何门型批准都会把 `Project.stage` 无条件推进到 `SAMPLING` 并派生「打样准备」任务。
 * 对尚未实现的门型（当前 `PRODUCTION_GATE`；`LAUNCH_GATE` 尚未进入枚举），必须 **fail-closed**：
 * 抛 422，**不写 Decision、不推进阶段、不派生任务**。
 *
 * 新增门型实现时（如 TASK-028/029 的 G2），把该门型加入此集合，并在 APPROVE 分支补对应阶段/任务分派。
 * 本批**只做封堵 + 集中保护**，不实现任何未实现门的业务逻辑。
 */
const IMPLEMENTED_GATES: ReadonlySet<GateType> = new Set<GateType>([
  GateType.RESEARCH_SAMPLING_GATE,
]);

/** 该门型是否已有实现（可放行）。 */
export function isGateImplemented(gate: GateType): boolean {
  return IMPLEMENTED_GATES.has(gate);
}

/**
 * 断言门型已实现；未实现 → **422**（fail-closed）。
 *
 * **放置纪律（硬约束）**：必须在鉴权检查**之后**、任何写入**之前**调用。
 * 鉴权检查 =「归属 + 角色」（`requireProjectRole`，**不查项目存在性**）；存在性检查（`NotFoundError`）**如该路径有**则应更早。
 * 若放在鉴权前，会把 404/403 变成 422，泄露对象存在性——这是本仓既有纪律（参见 `submitWork`）。
 */
export function assertGateImplemented(gate: GateType): void {
  if (!isGateImplemented(gate)) {
    throw new UnprocessableEntityError(
      `Gate ${gate} is not implemented yet; this operation is blocked so an unimplemented gate cannot advance the project or create decisions`
    );
  }
}

export interface CreateDecisionPacketDraftParams {
  projectId: string;
  gate?: GateType;
  productVersionId?: string;
  artifactVersions: Array<{ type: string; version: number }>;
  evidenceVersions: Array<{ id: string; hash: string }>;
  budgetAmount?: number;
  budgetCurrency?: string;
  budgetScope?: string;
  validationPlan: string;
  requiredChecks?: Record<string, any>;
}

export async function createDecisionPacketDraft(
  session: SessionContext,
  params: CreateDecisionPacketDraftParams
) {
  // Only Project OWNER can draft decision packets
  await requireProjectRole(session, params.projectId, [Role.OWNER]);

  // D-018：决策包的范围指纹必须由调用方**显式声明范围**。缺字段此前会一路冒到
  // `computeScopeHash` 的 `[...input.artifactVersions]`，抛**原生 TypeError**（"... is not
  // iterable"）→ 被当成「服务端崩了」的 500。修法沿用 createProduct / createDevelopmentProduct
  // 的既有范式：收集缺失项 → 一次 422 并点名字段。
  // 判定用 Array.isArray（**不是** `!params.x`）：要同时挡住 undefined、null，以及传了字符串/对象
  // 这类「有值但不是数组」的错类型。**允许空数组 `[]`**（空范围是否该被业务允许是另一个问题，
  // 本批不改，不擅自加 length > 0）。
  const missingScopes = [
    ["artifactVersions", Array.isArray(params.artifactVersions)],
    ["evidenceVersions", Array.isArray(params.evidenceVersions)],
  ]
    .filter(([, ok]) => !ok)
    .map(([k]) => k);
  if (missingScopes.length > 0) {
    throw new UnprocessableEntityError(
      `决策包必填项缺失或类型不是数组：${missingScopes.join("、")}`
    );
  }

  const gate = params.gate || GateType.RESEARCH_SAMPLING_GATE;

  // TASK-003b: 门禁集中保护。此处位于 requireProjectRole()（**归属 + 角色**，不查项目存在性）之后、
  // 首个写入（prisma.decisionPacket.create）之前，未实现门型 fail-closed 422。
  // 注：本路径无独立存在性检查——跨组织与「不存在项目」均由 requireProjectRole 以 403 拒绝（见契约 D-022）。
  assertGateImplemented(gate);

  // C01: 打样门决策包必须显式绑定产品版本。未显式传入时绑定项目当前产品版本，
  // 避免决策包指纹与基线复核使用不同产品版本，导致批准后永远无法判定为有效批准。
  let productVersionId = params.productVersionId ?? null;
  if (!productVersionId && gate === GateType.RESEARCH_SAMPLING_GATE) {
    const project = await prisma.project.findUnique({
      where: { id: params.projectId },
      select: { productVersionId: true },
    });
    productVersionId = project?.productVersionId ?? null;
  }

  const scopeHash = computeScopeHash({
    projectId: params.projectId,
    gate,
    productVersionId,
    artifactVersions: params.artifactVersions,
    evidenceVersions: params.evidenceVersions,
    budgetAmount: params.budgetAmount,
    budgetCurrency: params.budgetCurrency,
    budgetScope: params.budgetScope,
    validationPlan: params.validationPlan,
  });

  const packet = await prisma.decisionPacket.create({
    data: {
      projectId: params.projectId,
      gate,
      productVersionId,
      artifactVersions: params.artifactVersions as any,
      evidenceVersions: params.evidenceVersions as any,
      budgetAmount: params.budgetAmount,
      budgetCurrency: params.budgetCurrency || "CNY",
      budgetScope: params.budgetScope,
      validationPlan: params.validationPlan,
      requiredChecks: params.requiredChecks || {},
      scopeHash,
      status: DecisionPacketStatus.DRAFT,
    },
  });

  await prisma.auditEvent.create({
    data: {
      actorId: session.userId,
      action: "DECISION_PACKET_DRAFT_CREATED",
      objectType: "DecisionPacket",
      objectId: packet.id,
      summary: `负责人创建研发打样门决策草稿，结构化指纹: ${scopeHash.slice(0, 16)}`,
    },
  });

  return packet;
}

export async function submitDecisionPacket(session: SessionContext, packetId: string) {
  const packet = await prisma.decisionPacket.findUnique({
    where: { id: packetId },
    include: { project: true },
  });

  if (!packet || packet.project.organizationId !== session.organizationId) {
    throw new NotFoundError("Decision packet not found");
  }

  // Only Project OWNER can submit packet
  await requireProjectRole(session, packet.projectId, [Role.OWNER]);

  // TASK-003b: 门禁集中保护。此处位于存在性（NotFoundError）+ 归属 + 角色检查之后、
  // 任何写入（$transaction 内的 updateMany）之前，未实现门型 fail-closed 422。
  assertGateImplemented(packet.gate);

  // R04: State machine precondition guard: Can ONLY submit from DRAFT or CHANGES_REQUESTED
  if (
    packet.status !== DecisionPacketStatus.DRAFT &&
    packet.status !== DecisionPacketStatus.CHANGES_REQUESTED
  ) {
    throw new ConflictError(
      `Cannot submit decision packet with status ${packet.status}; approved or in-review snapshots cannot be overwritten (R04)`
    );
  }

  if (!packet.validationPlan || packet.validationPlan.trim() === "") {
    throw new UnprocessableEntityError("Validation plan is required to submit decision packet");
  }

  // Freeze immutable snapshot of submission
  const frozenSnapshot = {
    packetId: packet.id,
    projectId: packet.projectId,
    projectTitle: packet.project.title,
    projectTarget: packet.project.target,
    projectConstraints: packet.project.constraints,
    projectRevision: packet.project.revision,
    gate: packet.gate,
    scopeHash: packet.scopeHash,
    productVersionId: packet.productVersionId,
    artifactVersions: packet.artifactVersions,
    evidenceVersions: packet.evidenceVersions,
    budgetAmount: packet.budgetAmount ? String(packet.budgetAmount) : null,
    budgetCurrency: packet.budgetCurrency,
    budgetScope: packet.budgetScope,
    validationPlan: packet.validationPlan,
    requiredChecks: packet.requiredChecks,
    submittedBy: session.userId,
    submittedAt: new Date().toISOString(),
  };

  // R04: Conditional update to ensure concurrency protection
  return await prisma.$transaction(async (tx) => {
    const updateResult = await tx.decisionPacket.updateMany({
      where: {
        id: packet.id,
        status: packet.status, // Precondition guard
      },
      data: {
        status: DecisionPacketStatus.IN_REVIEW,
        snapshot: frozenSnapshot as Prisma.InputJsonValue,
        submittedAt: new Date(),
      },
    });

    if (updateResult.count === 0) {
      throw new ConflictError("Concurrent modification: packet status has changed (R04)");
    }

    const updated = await tx.decisionPacket.findUnique({ where: { id: packet.id } });

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "DECISION_PACKET_SUBMITTED",
      objectType: "DecisionPacket",
      objectId: packet.id,
      summary: `负责人提交决策包并冻结快照，状态流转为 ${labelDecisionPacketStatus(DecisionPacketStatus.IN_REVIEW)}`,
    });

    return updated;
  });
}

export interface DecideParams {
  decision: DecisionOutcome;
  reason: string;
  obligations?: string;
  idempotencyKey?: string;
}

export async function decideDecisionPacket(
  session: SessionContext,
  packetId: string,
  params: DecideParams
) {
  if (!params.reason || params.reason.trim() === "") {
    throw new UnprocessableEntityError("Decision reason is required");
  }

  const reqHash = computeRequestHash({ packetId, ...params });

  // R05: Enclose all checks, competitive locking, decisions, stage advancement, idempotency and audit into ONE transaction
  return await prisma.$transaction(async (tx) => {
    // 1. Idempotency Check within transaction (R05)
    if (params.idempotencyKey) {
      const existingIdemp = await tx.idempotencyRecord.findUnique({
        where: { key: params.idempotencyKey },
      });
      if (existingIdemp) {
        // TASK-003b: 幂等读取必须同时比对 commandScope——同键跨命令不得复用。
        // 此前只比 payload/actor，会把别的命令的历史响应当作当前命令的结果返回（跨命令重放）。
        // 错误信息按原因分类，但**不回显请求体内容**。
        const conflicts: string[] = [];
        if (existingIdemp.commandScope !== DECIDE_COMMAND_SCOPE) conflicts.push("commandScope");
        if (existingIdemp.requestHash !== reqHash) conflicts.push("requestHash");
        if (existingIdemp.actorId !== session.userId) conflicts.push("actorId");
        if (conflicts.length > 0) {
          throw new ConflictError(
            `Idempotency key reused with different ${conflicts.join(" / ")}`
          );
        }
        return existingIdemp.responseBody as any;
      }
    }

    // 2. Fetch packet with full relations
    const packet = await tx.decisionPacket.findUnique({
      where: { id: packetId },
      include: {
        productVersion: {
          include: { product: true },
        },
        project: {
          include: {
            evidences: true,
            workItems: {
              include: {
                artifacts: true,
              },
            },
          },
        },
        decisions: true,
      },
    });

    if (!packet || packet.project.organizationId !== session.organizationId) {
      throw new NotFoundError("Decision packet not found");
    }

    // 3. Permission checks
    if (packet.project.decisionMakerId !== session.userId) {
      throw new ForbiddenError("Only the designated project decision maker can decide this packet (A05)");
    }

    if (session.userId === packet.project.ownerId) {
      throw new ForbiddenError("Project owner cannot self-approve decision packet (A05)");
    }

    // R05: State Precondition within transaction
    if (packet.status !== DecisionPacketStatus.IN_REVIEW) {
      throw new ConflictError(`Cannot decide packet in status ${packet.status}; packet must be IN_REVIEW (R05)`);
    }

    // TASK-003b: 门禁集中保护。此处位于存在性（NotFoundError）+ 归属 + 指定决策人/防自批角色检查
    // 与状态前置检查之后、任何写入（后续 updateMany/create）之前，未实现门型 fail-closed 422。
    // 保证「未实现门型被批准」的路径在写入前即被拦死。
    assertGateImplemented(packet.gate);

    // R07: Mode & Gate constraint: FIXED_PRODUCT cannot be advanced to SAMPLING by research gate
    if (packet.project.mode === ProjectMode.FIXED_PRODUCT && packet.gate === GateType.RESEARCH_SAMPLING_GATE) {
      throw new UnprocessableEntityError("Fixed product projects do not execute research sampling gate (R07)");
    }

    // 4. Precondition verification if APPROVING
    if (params.decision === DecisionOutcome.APPROVE) {
      // Budget check
      if (!packet.budgetAmount || !packet.budgetScope || packet.budgetScope.trim() === "") {
        throw new UnprocessableEntityError("Missing budget amount or explicit budget scope; approval blocked (A05)");
      }

      // Evidence completeness & REAL/DEMO check (R07)
      const evidenceVersions = (packet.evidenceVersions as Array<{ id: string; hash: string }>) || [];
      if (evidenceVersions.length === 0) {
        throw new UnprocessableEntityError("Market opportunity evidence is required for gate approval (A05)");
      }

      for (const evRef of evidenceVersions) {
        const found = packet.project.evidences.find((e) => e.id === evRef.id);
        if (!found) {
          throw new UnprocessableEntityError(`Referenced evidence ${evRef.id} does not exist in project`);
        }
        // R07: Verify status must be VERIFIED
        if (found.verifyStatus !== "VERIFIED") {
          throw new UnprocessableEntityError(`Referenced evidence ${found.id} has not been formally verified (R07)`);
        }
        // R07: Hash must match actual stored hash
        if (found.hash !== evRef.hash) {
          throw new ConflictError(`Referenced evidence ${found.id} hash has been tampered with or modified (R07)`);
        }
        // R07: Formal isDemo property check
          if (found.nature === "DEMO" && !packet.project.isDemo) {
            throw new UnprocessableEntityError(
              `DEMO evidence (${found.id}) cannot be used for REAL project gate approval (A10/R07)`
            );
          }
        }

        // R2-02: Snapshot drift check against authoritative current project state
      const snapshot = packet.snapshot as any;
      if (snapshot) {
        if (
          (snapshot.projectTarget !== undefined && snapshot.projectTarget !== packet.project.target) ||
          (snapshot.projectConstraints !== undefined && snapshot.projectConstraints !== packet.project.constraints)
        ) {
          throw new ConflictError(
            "Project target or constraints have changed since the decision packet was submitted. Snapshot is stale and must be re-submitted (R2-02)"
          );
        }
        if (snapshot.projectRevision !== undefined && snapshot.projectRevision !== packet.project.revision) {
          throw new ConflictError(
            `Project revision drift detected (snapshot: r${snapshot.projectRevision}, project: r${packet.project.revision}). Decision packet is obsolete (R2-02)`
          );
        }
        if (snapshot.scopeHash !== undefined && snapshot.scopeHash !== packet.scopeHash) {
          throw new ConflictError(
            "Decision packet content has been altered since submission snapshot. Scope hash mismatch (R06/A08)"
          );
        }
      }

      // R2-02 & C01: Product version check for RESEARCH_SAMPLING_GATE
      if (packet.gate === GateType.RESEARCH_SAMPLING_GATE) {
        const targetProductVersionId = packet.productVersionId || packet.project.productVersionId;
        if (!targetProductVersionId) {
          throw new UnprocessableEntityError("Research sampling gate requires an associated product version (C01/R2-02)");
        }
        const pv = packet.productVersion || (await tx.productVersion.findUnique({
          where: { id: targetProductVersionId },
          include: { product: true },
        }));
        if (!pv || pv.product.organizationId !== session.organizationId) {
          throw new UnprocessableEntityError("Associated product version is invalid or belongs to another organization (C01)");
        }
        // C01 版本一致性: 决策包引用的产品版本必须是项目当前绑定的产品版本，旧版本决策包一律判定过期
        if (
          packet.project.productVersionId &&
          targetProductVersionId !== packet.project.productVersionId
        ) {
          throw new ConflictError(
            `Decision packet references product version ${targetProductVersionId}, but the project is currently bound to ${packet.project.productVersionId}; the packet is obsolete and must be re-created from the revised baseline (C01)`
          );
        }
        if (!pv.isConfirmed) {
          throw new UnprocessableEntityError(
            "Product version has unconfirmed business assumptions or is not confirmed; gate approval blocked (C04/R2-06)"
          );
        }
      }

      // C04: Required checks validation (feasibility must be cleared)
      const checks = (packet.requiredChecks as Record<string, any>) || {};
      if (checks.economicsFeasibilityPassed === false) {
        throw new UnprocessableEntityError(
          "Gate approval blocked: Economic feasibility check has not passed due to unconfirmed assumptions (C04)"
        );
      }

      // P1-02: 关键证据缺口必须已闭合（与 commit 时服务端阻断同口径，防御式兜底）
      if (checks.keyEvidenceGapsFilled === false) {
        throw new UnprocessableEntityError(
          "Gate approval blocked: Key evidence gaps are not filled (P1-02); real, verified evidence for critical business fields is required"
        );
      }

      // R2-02 & C01: Deliverables / Artifacts completeness check (disallow empty or phantom artifact fallback)
      const projectArtifacts = packet.project.workItems.flatMap((w) => w.artifacts);
      // 权威成果：同一类型仅取已验收的最高版本，历史低版本成果保留但不参与基线
      const currentArtifacts = resolveAuthoritativeArtifactRefs(projectArtifacts);

      const packetArtifacts = (packet.artifactVersions as Array<{
        id?: string;
        type: string;
        version: number;
        contentHash?: string;
        inputRevision?: number;
      }>) || [];

      if (packetArtifacts.length === 0 && currentArtifacts.length === 0) {
        throw new UnprocessableEntityError(
          "Gate approval requires verified deliverables/artifacts; empty deliverable packages cannot be approved (R2-02)"
        );
      }

      const baselineRevision =
        typeof (packet.requiredChecks as Record<string, any>)?.inputBaselineRevision === "number"
          ? (packet.requiredChecks as Record<string, any>).inputBaselineRevision
          : null;

      // C01: 逐条按权威记录核对引用成果（ID + 精确版本 + 内容指纹 + 输入基线 + 是否被新版本取代）
      for (const pa of packetArtifacts) {
        let artifact: (typeof projectArtifacts)[number] | undefined;

        if (pa.id) {
          artifact = projectArtifacts.find((a) => a.id === pa.id);
          if (!artifact) {
            throw new UnprocessableEntityError(
              `Referenced deliverable '${pa.type}' (${pa.id}) does not exist in this project; approval blocked (C01)`
            );
          }
          if (artifact.type !== pa.type) {
            throw new ConflictError(
              `Referenced deliverable ${pa.id} type mismatch (expected '${pa.type}', actual '${artifact.type}') (C01)`
            );
          }
          if (artifact.contentVersion !== pa.version) {
            throw new ConflictError(
              `Referenced deliverable '${pa.type}' version drift (packet: v${pa.version}, authoritative: v${artifact.contentVersion}) (C01)`
            );
          }
          if (pa.contentHash && computeArtifactContentHash(artifact.content) !== pa.contentHash) {
            throw new ConflictError(
              `Referenced deliverable '${pa.type}' v${pa.version} content fingerprint mismatch; the deliverable was altered (C01)`
            );
          }
        } else {
          // 老格式引用（无成果 ID）：按类型匹配已验收成果，但同样禁止批准已被新版本取代的成果
          artifact = projectArtifacts.find(
            (a) => a.type === pa.type && a.contentVersion >= pa.version && a.reviewStatus === "ACCEPTED"
          );
          if (!artifact) {
            throw new UnprocessableEntityError(
              `Referenced deliverable '${pa.type}' (v${pa.version}) does not exist in project with ACCEPTED status (C01)`
            );
          }
        }

        if (artifact.reviewStatus !== "ACCEPTED") {
          throw new UnprocessableEntityError(
            `Referenced deliverable '${artifact.type}' v${artifact.contentVersion} has not been reviewed and accepted by the owner yet; approval blocked (C01)`
          );
        }

        if (baselineRevision !== null && artifact.inputRevision !== baselineRevision) {
          // 局部修订沿用旧基线成果：成果本身未重新生成（不应伪装成重新研究），
          // 但必须有负责人确认「该成果适用于当前基线」的记录，且确认后内容不得再变化。
          const applicability = await tx.artifactApplicability.findFirst({
            where: {
              artifactId: artifact.id,
              baselineRevision,
              status: "CONFIRMED",
              confirmedById: { not: null },
              submission: { status: "ACCEPTED" },
            },
            orderBy: { confirmedAt: "desc" },
          });

          if (!applicability) {
            throw new ConflictError(
              `Referenced deliverable '${artifact.type}' v${artifact.contentVersion} was produced at input baseline r${artifact.inputRevision} and has no owner-confirmed applicability record for baseline r${baselineRevision}; approval blocked (C01)`
            );
          }

          if (applicability.contentHash !== computeArtifactContentHash(artifact.content)) {
            throw new ConflictError(
              `Referenced deliverable '${artifact.type}' v${artifact.contentVersion} changed after its applicability to baseline r${baselineRevision} was confirmed; approval blocked (C01)`
            );
          }
        }

        const supersededBy = findSupersedingVersion(projectArtifacts, artifact.type, artifact.contentVersion);
        if (supersededBy !== null) {
          throw new ConflictError(
            `Referenced deliverable '${artifact.type}' v${artifact.contentVersion} is superseded by v${supersededBy}; decision packet references obsolete deliverables (C01 version consistency)`
          );
        }
      }

      // R06: Read actual current authoritative project state to verify scopeHash
      const currentVerifiedEvidences = packet.project.evidences
        .filter((e) => e.verifyStatus === "VERIFIED")
        .map((e) => ({ id: e.id, hash: e.hash }));

      const currentActualScopeHash = computeScopeHash({
        projectId: packet.projectId,
        gate: packet.gate,
        productVersionId: packet.productVersionId,
        artifactVersions: currentArtifacts.length > 0 ? currentArtifacts : packetArtifacts,
        evidenceVersions: currentVerifiedEvidences.length > 0 ? currentVerifiedEvidences : (packet.evidenceVersions as any),
        budgetAmount: packet.budgetAmount ? Number(packet.budgetAmount) : null,
        budgetCurrency: packet.budgetCurrency,
        budgetScope: packet.budgetScope,
        validationPlan: packet.validationPlan,
      });

      if (currentActualScopeHash !== packet.scopeHash) {
        // FINGER-PRINT DIFF：列出导致旧批准失效的具体变化维度（移植自老版 diffFingerprintDetail）
        const frozen: Partial<ScopeHashInput> = {
          projectId: packet.projectId,
          gate: packet.gate,
          productVersionId: packet.productVersionId,
          artifactVersions: (packet.artifactVersions as any) || [],
          evidenceVersions: (packet.evidenceVersions as any) || [],
          budgetAmount: packet.budgetAmount ? Number(packet.budgetAmount) : null,
          budgetCurrency: packet.budgetCurrency,
          budgetScope: packet.budgetScope,
          validationPlan: packet.validationPlan,
        };
        const changed = diffScopeInput(frozen, {
          ...frozen,
          artifactVersions: currentArtifacts.length > 0 ? currentArtifacts : packetArtifacts,
          evidenceVersions: currentVerifiedEvidences.length > 0 ? currentVerifiedEvidences : (packet.evidenceVersions as any),
        });
        const changeText =
          changed.length > 0 ? "变更维度：" + changed.join("、") : "（方案内容已变化）";
        throw new ConflictError(
          `Scope hash mismatch: ${changeText}。当前快照已过期，原批准自动失效，需对当前方案重新提交审批 (R06/R2-02)`
        );
      }
    }

    // 5. Atomic State Transition using Conditional Update (R05)
    let newPacketStatus: DecisionPacketStatus = DecisionPacketStatus.APPROVED;
    if (params.decision === DecisionOutcome.REQUEST_CHANGES) newPacketStatus = DecisionPacketStatus.CHANGES_REQUESTED;
    else if (params.decision === DecisionOutcome.DEFER) newPacketStatus = DecisionPacketStatus.DEFERRED;
    else if (params.decision === DecisionOutcome.REJECT) newPacketStatus = DecisionPacketStatus.REJECTED;
    else if (params.decision === DecisionOutcome.WITHDRAW) newPacketStatus = DecisionPacketStatus.WITHDRAWN;

    const packetUpdateResult = await tx.decisionPacket.updateMany({
      where: {
        id: packet.id,
        status: DecisionPacketStatus.IN_REVIEW, // Concurrency guard
      },
      data: { status: newPacketStatus },
    });

    if (packetUpdateResult.count === 0) {
      throw new ConflictError("Concurrent decision conflict: packet is no longer IN_REVIEW (R05)");
    }

    const updatedPacket = await tx.decisionPacket.findUnique({ where: { id: packet.id } });

    // Append-only Decision record
    const decisionRecord = await tx.decision.create({
      data: {
        packetId: packet.id,
        actorId: session.userId,
        decision: params.decision,
        reason: params.reason.trim(),
        obligations: params.obligations ? params.obligations.trim() : undefined,
      },
    });

    let updatedProject = packet.project;
    let nextWorkItem: any = null;

    // Advance stage & generate single preparation task ONLY upon APPROVE.
    // TASK-003b: 阶段推进**按门分派**——只有 G1（RESEARCH_SAMPLING_GATE）批准才推进到 SAMPLING
    // 并派生打样任务。未实现门型已在上方 assertGateImplemented() 处 422 拦截，不会走到这里；
    // 此处显式按门判断，杜绝「某门批准却推进到 SAMPLING」的路径。
    // G2/G3 的阶段与任务分派待 TASK-028/029 实现，本批不实现。
    if (params.decision === DecisionOutcome.APPROVE) {
      if (packet.gate === GateType.RESEARCH_SAMPLING_GATE) {
        // R2-02: Apply optimistic concurrency revision guard on Project
        const projectUpdateResult = await tx.project.updateMany({
          where: {
            id: packet.projectId,
            revision: packet.project.revision,
          },
          data: {
            stage: ProjectStage.SAMPLING,
            revision: { increment: 1 },
          },
        });

        if (projectUpdateResult.count === 0) {
          throw new ConflictError(
            "Concurrent project modification detected during approval. Project revision changed (R2-02)"
          );
        }

        updatedProject = (await tx.project.findUnique({
          where: { id: packet.projectId },
          include: { evidences: true, workItems: { include: { artifacts: true } } },
        }))!;

        nextWorkItem = await tx.workItem.create({
          data: {
            projectId: packet.projectId,
            title: "打样准备与工厂技术对接",
            target: "落实第一期打样原料采购与实验室试制排期",
            deliverableReq: "第一期原料采购清单及实验室试制确认单",
            status: WorkItemStatus.TODO,
            executorType: WorkExecutorType.HUMAN,
            inputRevision: updatedProject.revision,
          },
        });
      }
    }

    const audit = await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: `DECISION_${params.decision}`,
      objectType: "DecisionPacket",
      objectId: packet.id,
      revision: updatedProject.revision,
      summary: `指定决策人执行审查决定: ${labelDecisionOutcome(params.decision)}。理由: ${params.reason}`,
      details: {
        decisionId: decisionRecord.id,
        newStage: updatedProject.stage,
        nextWorkItemId: nextWorkItem?.id,
      },
    });

    const responsePayload = {
      packet: updatedPacket,
      decision: decisionRecord,
      project: {
        id: updatedProject.id,
        stage: updatedProject.stage,
        revision: updatedProject.revision,
      },
      nextWorkItem,
      auditId: audit.id,
    };

    // R05: Record idempotency directly in the same transaction
    if (params.idempotencyKey) {
      await tx.idempotencyRecord.create({
        data: {
          key: params.idempotencyKey,
          actorId: session.userId,
          commandScope: DECIDE_COMMAND_SCOPE,
          requestHash: reqHash,
          responseStatus: 200,
          responseBody: responsePayload as any,
        },
      });
    }

    return responsePayload;
  });
}
