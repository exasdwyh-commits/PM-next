import { Prisma } from "@prisma/client";
import prisma from "@/shared/db";
import type { SessionContext } from "@/modules/identity/session";
import { sendMessage as sendLegacyAdvisorMessage } from "@/modules/advisor/service";
import { buildDepartmentAssistantContext } from "./context-builder";
import { runDepartmentAssistantReflexShadow } from "./reflex";
import { buildKernCollaborationPlanShadow } from "./collaboration-planner";
import { resolveKernDispatchReadiness } from "./dispatch-readiness";
import {
  enqueueKernSpecialistDispatch,
  type KernSpecialistDispatchResult,
} from "./specialist-dispatch";

function asJsonObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * Stable conversational entry point for the final product.
 *
 * V1 intentionally reuses the mature Advisor execution path while moving the
 * product identity and context ownership to Department Assistant. This is a
 * migration seam, not a second chat/runtime implementation.
 */
export async function sendDepartmentAssistantMessage(
  session: SessionContext,
  conversationId: string,
  content: string,
  options?: { runId?: string }
) {
  const context = await buildDepartmentAssistantContext(session, conversationId);
  const reflexPromise = runDepartmentAssistantReflexShadow(session, {
    text: content,
    conversationId,
    productId: context.productId,
    linkedProjectIds: context.linkedProjectIds,
    confirmedCompanyFactRefs: context.confirmedCompanyFactRefs,
  });
  const result = await sendLegacyAdvisorMessage(
    session,
    conversationId,
    content,
    options
  );
  const reflex = await reflexPromise;
  const plannedCollaboration = buildKernCollaborationPlanShadow({
    text: content,
    productBound: Boolean(context.productId),
    reflex,
  });
  const dispatchReadiness = await resolveKernDispatchReadiness({
    organizationId: session.organizationId,
    plan: plannedCollaboration,
  });
  const collaborationPlanShadow = {
    ...plannedCollaboration,
    autoDispatchEligible: dispatchReadiness.eligible,
  };

  let specialistDispatch: KernSpecialistDispatchResult | null = null;
  let specialistDispatchError: string | null = null;
  let responseMessage = result.message;

  if (
    collaborationPlanShadow.mode === "SPECIALIST" &&
    dispatchReadiness.eligible &&
    dispatchReadiness.state === "EXECUTOR_READY"
  ) {
    try {
      specialistDispatch = await enqueueKernSpecialistDispatch({
        session,
        conversationId,
        sourceRunId: result.runId,
        goal: content,
        readiness: dispatchReadiness,
      });

      if (specialistDispatch) {
        const dispatchNote = [
          "Kern 协作路由：已将这条低风险技术请求交给 Tech Architect。",
          `当前任务状态：${specialistDispatch.status}。专家完成后，回执会自动追加到本会话。`,
        ].join("\n");
        const originalContent = result.message.content;
        const nextContent = originalContent.includes("Kern 协作路由：")
          ? originalContent
          : `${originalContent}\n\n——\n${dispatchNote}`;
        const existingCitations = Array.isArray(result.message.citations)
          ? result.message.citations
          : [];

        responseMessage = await prisma.message.update({
          where: { id: result.message.id },
          data: {
            content: nextContent,
            citations: [
              ...existingCitations,
              {
                kind: "agent-task",
                ref: specialistDispatch.taskId,
                title: "Tech Architect · " + specialistDispatch.status,
              },
            ] as Prisma.InputJsonValue,
          },
        });
      }
    } catch (error: unknown) {
      specialistDispatchError =
        error instanceof Error ? error.message : String(error);
    }
  }

  const routingReceipt = {
    version: "kern-routing-receipt/v1" as const,
    runId: result.runId,
    phase: specialistDispatch ? ("AUTO" as const) : ("SHADOW" as const),
    authority: collaborationPlanShadow.authority,
    recommendedMode: collaborationPlanShadow.mode,
    recommendedExperts: collaborationPlanShadow.experts,
    synthesisTier: collaborationPlanShadow.synthesisTier,
    researchRequired: collaborationPlanShadow.researchRequired,
    qaRequired: collaborationPlanShadow.qaRequired,
    redTeamRequired: collaborationPlanShadow.redTeamRequired,
    autoDispatchCandidate: collaborationPlanShadow.autoDispatchCandidate,
    autoDispatchEligible: collaborationPlanShadow.autoDispatchEligible,
    dispatchReadiness,
    dispatchedAgentCodes: specialistDispatch
      ? [specialistDispatch.agentCode]
      : ([] as string[]),
    dispatchTaskId: specialistDispatch?.taskId ?? null,
    dispatchTaskStatus: specialistDispatch?.status ?? null,
    dispatchError: specialistDispatchError,
  };

  const run = await prisma.agentRun.findUnique({
    where: { id: result.runId },
    select: { contextSnapshot: true },
  });
  if (run) {
    await prisma.agentRun.update({
      where: { id: result.runId },
      data: {
        contextSnapshot: asInputJson({
          ...asJsonObject(run.contextSnapshot),
          assistantRuntime: context.runtimeVersion,
          collaborationMode: context.collaborationMode,
          linkedProjectIds: context.linkedProjectIds,
          confirmedCompanyFactRefs: context.confirmedCompanyFactRefs,
          reflexMode: reflex.mode,
          reflexDecisions: reflex.decisions,
          reflexError: reflex.error,
          collaborationPlanShadow,
          routingReceipt,
        }),
      },
    });
  }

  return {
    ...result,
    message: responseMessage,
    specialistDispatch,
    specialistDispatchError,
    assistantRuntime: context.runtimeVersion,
    reflexMode: reflex.mode,
    collaborationPlanShadow,
    routingReceipt,
  };
}
