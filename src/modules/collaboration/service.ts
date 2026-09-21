import prisma from "@/shared/db";
import { ForbiddenError, NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import { Role, FeedbackStatus, WorkItemStatus, WorkExecutorType } from "@prisma/client";
import { createAuditEventInTx } from "@/shared/audit";
import { labelFeedbackStatus } from "@/shared/status-labels";
import { SessionContext, requireProjectRole } from "../identity/session";

export interface CreateFeedbackParams {
  projectId: string;
  targetType: string;
  targetId: string;
  targetVersion?: string;
  content: string;
}

export async function createFeedback(session: SessionContext, params: CreateFeedbackParams) {
  if (!params.content) {
    throw new UnprocessableEntityError("Feedback content cannot be empty");
  }

  // D-008：targetType / targetId 是 Feedback 的必填列（targetId 无外键，纯字符串锚点）。
  // 此前只校验 content，缺 targetId 时以 PrismaClientValidationError 冒成 500。
  // 注：本函数是「先校验后鉴权」（矩阵已登记 validationFirst），这里不改变该顺序。
  if (!params.targetType || typeof params.targetType !== "string") {
    throw new UnprocessableEntityError("Feedback targetType 必填", {
      targetType: ["必填"],
    });
  }
  if (!params.targetId || typeof params.targetId !== "string") {
    throw new UnprocessableEntityError("Feedback targetId 必填", {
      targetId: ["必填"],
    });
  }

  // A03: Viewers cannot create feedback, but FEEDBACK_PROVIDER, OWNER, DECISION_MAKER can
  await requireProjectRole(session, params.projectId, [
    Role.OWNER,
    Role.DECISION_MAKER,
    Role.FEEDBACK_PROVIDER,
  ]);

  const feedback = await prisma.feedback.create({
    data: {
      projectId: params.projectId,
      targetType: params.targetType,
      targetId: params.targetId,
      targetVersion: params.targetVersion,
      authorId: session.userId,
      content: params.content,
      status: FeedbackStatus.OPEN,
    },
  });

  await prisma.auditEvent.create({
    data: {
      actorId: session.userId,
      action: "FEEDBACK_CREATED",
      objectType: "Feedback",
      objectId: feedback.id,
      summary: `提交针对 ${params.targetType} 的反馈意见`,
    },
  });

  return feedback;
}

export interface DisposeFeedbackParams {
  status: FeedbackStatus;
  reason: string;
  createRevisionWorkItem?: boolean;
  revisionWorkItemTitle?: string;
}

export async function disposeFeedback(
  session: SessionContext,
  feedbackId: string,
  params: DisposeFeedbackParams
) {
  const feedback = await prisma.feedback.findUnique({
    where: { id: feedbackId },
    include: { project: true },
  });

  if (!feedback || feedback.project.organizationId !== session.organizationId) {
    throw new NotFoundError("Feedback not found");
  }

  // A03: Only Project OWNER can dispose feedback
  await requireProjectRole(session, feedback.projectId, [Role.OWNER]);

  if (!params.reason) {
    throw new UnprocessableEntityError("Disposition reason is required");
  }

  return await prisma.$transaction(async (tx) => {
    let revisionWorkItemId: string | undefined = undefined;

    if (params.status === FeedbackStatus.ACCEPTED && params.createRevisionWorkItem) {
      const revItem = await tx.workItem.create({
        data: {
          projectId: feedback.projectId,
          title: params.revisionWorkItemTitle || `[反馈修订] 响应反馈 ${feedback.id.slice(0, 8)}`,
          target: `针对用户反馈进行方案修订: ${params.reason}`,
          deliverableReq: "修订后的方案或数据分析报告",
          status: WorkItemStatus.TODO,
          executorType: WorkExecutorType.HUMAN,
          inputRevision: feedback.project.revision,
        },
      });
      revisionWorkItemId = revItem.id;
    }

    const updated = await tx.feedback.update({
      where: { id: feedback.id },
      data: {
        status: params.status,
        dispositionReason: params.reason,
        revisionWorkItemId,
      },
    });

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "FEEDBACK_DISPOSED",
      objectType: "Feedback",
      objectId: feedback.id,
      summary: `负责人处置反馈为 ${labelFeedbackStatus(params.status)}。理由: ${params.reason}`,
      details: { revisionWorkItemId },
    });

    return updated;
  });
}
