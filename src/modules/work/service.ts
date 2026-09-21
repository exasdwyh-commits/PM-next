import prisma from "@/shared/db";
import { ForbiddenError, NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import { WorkExecutorType, WorkItemStatus, RunMode, RunReceiptStatus, ProducerType, Role, Prisma } from "@prisma/client";
import { createAuditEventInTx } from "@/shared/audit";
import { labelRunMode, labelWorkItemStatus } from "@/shared/status-labels";
import { SessionContext, requireProjectRole } from "../identity/session";
import { isStructuredArtifactType, isKnownArtifactSchemaVersion } from "./artifact-schema";
import { pickBusinessInput, writeStructuredArtifact, WriteStructuredArtifactParams } from "./structured-artifacts";


/**
 * 结构化成果的写入准备（TASK-009b，对应计划 TEST-006 的「坏 JSON / 未知版本 / 版本不一致」）：
 * - `content` 必须是合法 JSON 对象；坏 JSON → 422（字段级 `content` 错误，不冒 500）。
 * - 版本声明一致性：`art.schemaVersion`（列参数）与内容顶层 `schemaVersion` 若显式给出，
 *   必须一致且属于已知版本；未知版本一律拒绝（不猜、不放行）。
 * - 服务端推导字段（`organizationId` / `projectId` / `productVersionId` / `recordedBy`）一律取自
 *   受权对象与 session，不信任请求体；`confirmedBy`/`confirmedAt` 恒为 null（提交不等于确认）。
 */
function toStructuredWrite(
  art: { content: string; schemaVersion?: string | null },
  ctx: { organizationId: string; projectId: string; productVersionId: string | null },
  session: SessionContext
): { businessInput: Record<string, unknown>; envelope: WriteStructuredArtifactParams["envelope"] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(art.content);
  } catch {
    throw new UnprocessableEntityError("结构化成果的 content 必须是合法 JSON 对象", { content: ["坏 JSON：无法解析"] });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UnprocessableEntityError("结构化成果的 content 必须是 JSON 对象", { content: ["必须是 JSON 对象"] });
  }
  const obj = parsed as Record<string, unknown>;

  const claimedColumn = art.schemaVersion ?? null;
  const claimedContent = obj.schemaVersion ?? null;
  if (claimedColumn !== null && claimedContent !== null && claimedColumn !== claimedContent) {
    throw new UnprocessableEntityError("schemaVersion 列与内容顶层不一致", {
      schemaVersion: ["列与内容版本必须一致（列 = 常量，内容顶层同值）"],
    });
  }
  const claimed = claimedColumn ?? claimedContent;
  if (claimed !== null && !isKnownArtifactSchemaVersion(String(claimed))) {
    throw new UnprocessableEntityError(`未知成果 schema 版本：${String(claimed)}`, {
      schemaVersion: ["未知版本，拒绝解析（不猜）"],
    });
  }

  return {
    businessInput: pickBusinessInput(obj),
    envelope: {
      organizationId: ctx.organizationId,
      projectId: ctx.projectId,
      productVersionId: ctx.productVersionId,
      sourceRefs: (obj.sourceRefs ?? []) as readonly Record<string, unknown>[],
      // 类型层面强转；值级合法性（REAL/DEMO、数组形态、币种、非负等）由 writeStructuredArtifact 内校验兜底 → 422
      dataNature: obj.dataNature as "REAL" | "DEMO",
      assumptions: (obj.assumptions ?? []) as readonly string[],
      missingInputs: (obj.missingInputs ?? []) as readonly string[],
      recordedBy: session.userId,
      confirmedBy: null,
      confirmedAt: null,
    },
  };
}

export interface CreateWorkItemParams {
  title: string;
  target: string;
  deliverableReq: string;
  executorType?: WorkExecutorType;
  /** 前置依赖工作项 id 列表（F03）：未验收时本工作项视为阻塞（不能进入执行） */
  dependencies?: string[];
}

export async function createWorkItem(
  session: SessionContext,
  projectId: string,
  params: CreateWorkItemParams
) {
  await requireProjectRole(session, projectId, [Role.OWNER]);

  if (!params.title || !params.target || !params.deliverableReq) {
    throw new UnprocessableEntityError("Title, target and deliverable requirements are required");
  }

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError("Project not found");

  // F03: 校验依赖项必须属于同一项目，避免跨项目引用导致依赖判定失效
  const depIds: string[] = [];
  if (params.dependencies && params.dependencies.length > 0) {
    const deps = await prisma.workItem.findMany({
      where: { projectId, id: { in: params.dependencies } },
      select: { id: true },
    });
    const found = new Set(deps.map((d) => d.id));
    const missing = params.dependencies.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new UnprocessableEntityError(`依赖工作项不存在或不属于本项目: ${missing.join(", ")} (F03)`);
    }
    depIds.push(...params.dependencies);
  }

  const item = await prisma.workItem.create({
    data: {
      projectId,
      title: params.title.trim(),
      target: params.target.trim(),
      deliverableReq: params.deliverableReq.trim(),
      executorType: params.executorType ?? WorkExecutorType.HUMAN,
      dependencies: depIds.length > 0 ? depIds : undefined,
      inputRevision: project.revision,
      status: WorkItemStatus.TODO,
    },
  });

  await prisma.auditEvent.create({
    data: {
      actorId: session.userId,
      action: "WORK_ITEM_CREATED",
      objectType: "WorkItem",
      objectId: item.id,
      revision: project.revision,
      summary: `负责人创建工作项 "${item.title}"，要求交付: ${item.deliverableReq}`,
    },
  });

  return item;
}

export interface SubmitWorkParams {
  inputRevision: number;
  runMode: RunMode;
  status?: RunReceiptStatus;
  errorMessage?: string;
  artifacts?: Array<{
    type: string;
    title: string;
    content: string;
    evidenceRefs?: any;
    /**
     * 结构化成果的 schema 版本（契约 §4.3，I-003）。自由文本成果不要传 ——
     * 不声称版本比填一个默认值更诚实，落库为 NULL = 未版本化。
     */
    schemaVersion?: string;
  }>;
}

export async function submitWork(
  session: SessionContext,
  workItemId: string,
  params: SubmitWorkParams
) {
  const workItem = await prisma.workItem.findUnique({
    where: { id: workItemId },
    include: { project: true },
  });

  if (!workItem || workItem.project.organizationId !== session.organizationId) {
    throw new NotFoundError("WorkItem not found");
  }

  // R09: Permission check: Feedback providers and viewers CANNOT submit formal work deliverables
  const member = await prisma.projectMember.findUnique({
    where: {
      projectId_userId: { projectId: workItem.projectId, userId: session.userId },
    },
  });

  if (!member || member.role === Role.VIEWER || member.role === Role.FEEDBACK_PROVIDER) {
    throw new ForbiddenError("Only project owner or authorized task assignee can submit deliverables (R09)");
  }

  // D-008：入参校验。inputRevision 是成果的版本锚点（A09/R09 全靠它判断迟到），
  // 缺失时 Prisma 会抛 PrismaClientValidationError → 500，而生产环境响应体被
  // 消毒成「An internal server error occurred」，调用方无从得知自己少了哪个字段。
  // 位置有意放在**鉴权之后**：本路由是「先鉴权后校验」，前置会把 404 变成 422，
  // 反而给出资源存在性的旁证。
  if (!Number.isInteger(params.inputRevision) || params.inputRevision < 1) {
    throw new UnprocessableEntityError("inputRevision 必填，且必须为不小于 1 的整数", {
      inputRevision: ["必填，且必须为不小于 1 的整数"],
    });
  }
  if (params.runMode !== undefined && !Object.values(RunMode).includes(params.runMode)) {
    throw new UnprocessableEntityError(
      `runMode 非法：${String(params.runMode)}（允许值：${Object.values(RunMode).join(" / ")}）`,
      { runMode: [`允许值：${Object.values(RunMode).join(" / ")}`] }
    );
  }

  // R09: Input revision validity check: cannot submit against non-existent future revisions
  if (params.inputRevision > workItem.project.revision) {
    throw new UnprocessableEntityError(
      `Input revision ${params.inputRevision} cannot exceed current project revision ${workItem.project.revision} (R09)`
    );
  }

  const isLateArrival = params.inputRevision < workItem.project.revision || params.inputRevision < workItem.inputRevision;
  const receiptStatus = params.status ?? (params.errorMessage ? RunReceiptStatus.FAILED : RunReceiptStatus.SUCCESS);

  return await prisma.$transaction(async (tx) => {
    // 1. Always record RunReceipt
    const receipt = await tx.runReceipt.create({
      data: {
        workItemId: workItem.id,
        inputRevision: params.inputRevision,
        runMode: params.runMode,
        status: receiptStatus,
        errorMessage: params.errorMessage,
        endedAt: new Date(),
      },
    });

    // 2. If late arrival (A09): only retain receipt and artifact history, DO NOT update active submission pointer!
    if (isLateArrival) {
      const lateArtifacts: any[] = [];
      if (params.artifacts && params.artifacts.length > 0) {
        for (const art of params.artifacts) {
          // TASK-009b：结构化类型走统一 helper（同事务、追加保存）；未登记类型按既有自由文本原样写入。
          if (isStructuredArtifactType(art.type)) {
            const prepared = toStructuredWrite(
              art,
              {
                organizationId: workItem.project.organizationId,
                projectId: workItem.projectId,
                productVersionId: workItem.project.productVersionId,
              },
              session
            );
            const a = await writeStructuredArtifact(tx, {
              type: art.type,
              title: `[历史输入产物 r${params.inputRevision}] ${art.title}`,
              workItemId: workItem.id,
              submissionId: null, // 迟到提交不归属任何提交批次（A09）
              inputRevision: params.inputRevision,
              producerType: params.runMode === RunMode.TEST_STUB ? ProducerType.TEST_STUB : ProducerType.MANUAL,
              evidenceRefs: art.evidenceRefs,
              reviewStatus: "REJECTED", // A09：迟到成果保留历史但视为未通过当前审核
              ...prepared,
            });
            lateArtifacts.push(a);
            continue;
          }
          const a = await tx.artifact.create({
            data: {
              workItemId: workItem.id,
              // I-001 / I-002：成果自证归属组织与所绑产品版本（沿 workItem → project 推导，
              // 不猜测：项目没有绑定版本时就是 null）。
              organizationId: workItem.project.organizationId,
              productVersionId: workItem.project.productVersionId,
              schemaVersion: art.schemaVersion ?? null,
              type: art.type,
              title: `[历史输入产物 r${params.inputRevision}] ${art.title}`,
              content: art.content,
              producerType: params.runMode === RunMode.TEST_STUB ? ProducerType.TEST_STUB : ProducerType.MANUAL,
              inputRevision: params.inputRevision,
              evidenceRefs: art.evidenceRefs,
              reviewStatus: "REJECTED",
            },
          });
          lateArtifacts.push(a);
        }
      }

      await createAuditEventInTx(tx, {
        actorId: session.userId,
        action: "WORK_SUBMISSION_LATE_IGNORED",
        objectType: "WorkItem",
        objectId: workItem.id,
        revision: params.inputRevision,
        summary: `收到基于过期输入版本 r${params.inputRevision} 的迟到提交，保留历史回执，未覆盖当前任务成果 (A09/R09)`,
      });

      return {
        workItem,
        receipt,
        artifacts: lateArtifacts,
        isLateArrival: true,
      };
    }

    // 3. R09: Create dedicated WorkSubmission batch for the current valid submission
    const existingCount = await tx.workSubmission.count({ where: { workItemId: workItem.id } });
    const submission = await tx.workSubmission.create({
      data: {
        workItemId: workItem.id,
        attempt: existingCount + 1,
        inputRevision: params.inputRevision,
        submittedById: session.userId,
        runMode: params.runMode,
        status: "PENDING",
      },
    });

    const createdArtifacts: any[] = [];
    if (params.artifacts && params.artifacts.length > 0) {
      for (const art of params.artifacts) {
        // TASK-009b：结构化类型走统一 helper（同事务、追加保存），reviewStatus 走模型默认 PENDING
        //（提交不等于审核；正式 ACCEPTED 只由 reviewWork 写入）。未登记类型按既有自由文本原样写入。
        if (isStructuredArtifactType(art.type)) {
          const prepared = toStructuredWrite(
            art,
            {
              organizationId: workItem.project.organizationId,
              projectId: workItem.projectId,
              productVersionId: workItem.project.productVersionId,
            },
            session
          );
          const a = await writeStructuredArtifact(tx, {
            type: art.type,
            title: art.title,
            workItemId: workItem.id,
            submissionId: submission.id, // R09: attached to submission batch
            inputRevision: params.inputRevision,
            producerType: params.runMode === RunMode.TEST_STUB ? ProducerType.TEST_STUB : ProducerType.MANUAL,
            evidenceRefs: art.evidenceRefs,
            ...prepared,
          });
          createdArtifacts.push(a);
          continue;
        }
        const a = await tx.artifact.create({
          data: {
            workItemId: workItem.id,
            submissionId: submission.id, // R09: attached to submission batch
            // I-001 / I-002：成果自证归属组织与所绑产品版本
            organizationId: workItem.project.organizationId,
            productVersionId: workItem.project.productVersionId,
            schemaVersion: art.schemaVersion ?? null,
            type: art.type,
            title: art.title,
            content: art.content,
            producerType: params.runMode === RunMode.TEST_STUB ? ProducerType.TEST_STUB : ProducerType.MANUAL,
            inputRevision: params.inputRevision,
            evidenceRefs: art.evidenceRefs,
          },
        });
        createdArtifacts.push(a);
      }
    }

    // R09: If task was already ACCEPTED, a failed receipt does NOT downgrade it to TODO!
    let nextStatus = workItem.status;
    if (receiptStatus === RunReceiptStatus.SUCCESS) {
      nextStatus = WorkItemStatus.SUBMITTED;
    } else if (workItem.status !== WorkItemStatus.ACCEPTED) {
      nextStatus = WorkItemStatus.TODO;
    }

    const updatedWorkItem = await tx.workItem.update({
      where: { id: workItem.id },
      data: {
        currentSubmissionId: submission.id, // R09: point to active submission batch
        status: nextStatus,
      },
    });

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "WORK_SUBMISSION_RECEIVED",
      objectType: "WorkItem",
      objectId: workItem.id,
      revision: params.inputRevision,
      summary: `提交成果批次 #${submission.attempt}，状态: ${labelWorkItemStatus(updatedWorkItem.status)}，产物数: ${createdArtifacts.length}，运行方式: ${labelRunMode(params.runMode)}`,
    });

    return {
      workItem: updatedWorkItem,
      submission,
      receipt,
      artifacts: createdArtifacts,
      isLateArrival: false,
    };
  });
}

export interface ReviewWorkParams {
  accepted: boolean;
  reason: string;
}

export async function reviewWork(
  session: SessionContext,
  workItemId: string,
  params: ReviewWorkParams
) {
  const workItem = await prisma.workItem.findUnique({
    where: { id: workItemId },
    include: { project: true },
  });

  if (!workItem || workItem.project.organizationId !== session.organizationId) {
    throw new NotFoundError("WorkItem not found");
  }

  // Only project owner can review (A04)
  await requireProjectRole(session, workItem.projectId, [Role.OWNER]);

  if (!params.reason || params.reason.trim() === "") {
    throw new UnprocessableEntityError("Review reason is required");
  }

  return await prisma.$transaction(async (tx) => {
    // R09: Identify current submission batch
    const currentSubmission = workItem.currentSubmissionId
      ? await tx.workSubmission.findUnique({ where: { id: workItem.currentSubmissionId } })
      : await tx.workSubmission.findFirst({
          where: { workItemId: workItem.id, status: "PENDING" },
          orderBy: { createdAt: "desc" },
        });

    if (!currentSubmission) {
      throw new UnprocessableEntityError("No active submission batch to review for this work item (R09)");
    }

    const newOutcome = params.accepted ? "ACCEPTED" : "REJECTED";
    const newWorkStatus = params.accepted ? WorkItemStatus.ACCEPTED : WorkItemStatus.CHANGES_REQUESTED;

    // R09: Update ONLY the current submission batch and its artifacts; historical batches stay intact!
    await tx.workSubmission.update({
      where: { id: currentSubmission.id },
      data: {
        status: newOutcome,
        reviewReason: params.reason.trim(),
        reviewedAt: new Date(),
        reviewedById: session.userId,
      },
    });

    await tx.artifact.updateMany({
      where: { submissionId: currentSubmission.id },
      data: {
        reviewStatus: newOutcome,
      },
    });

    // 局部修订中沿用旧基线成果的适用性记录：负责人验收该批次时一并确认（或否决）
    const carriedForward = await tx.artifactApplicability.updateMany({
      where: { submissionId: currentSubmission.id, status: "PENDING" },
      data: {
        status: params.accepted ? "CONFIRMED" : "REJECTED",
        confirmedById: session.userId,
        confirmedAt: new Date(),
      },
    });

    const updated = await tx.workItem.update({
      where: { id: workItem.id },
      data: { status: newWorkStatus },
    });

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: params.accepted ? "WORK_ITEM_ACCEPTED" : "WORK_ITEM_CHANGES_REQUESTED",
      objectType: "WorkItem",
      objectId: workItem.id,
      summary:
        `负责人审查批次 #${currentSubmission.attempt}: ${params.accepted ? "验收通过" : "退回修改"}。理由: ${params.reason}` +
        (carriedForward.count > 0
          ? `。本批次沿用旧基线成果 ${carriedForward.count} 项，负责人已${params.accepted ? "确认" : "否决"}其适用于当前输入基线 r${currentSubmission.inputRevision}`
          : ""),
    });

    return updated;
  });
}
