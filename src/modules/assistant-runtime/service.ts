import { Prisma } from "@prisma/client";
import prisma from "@/shared/db";
import type { SessionContext } from "@/modules/identity/session";
import { sendMessage as sendLegacyAdvisorMessage } from "@/modules/advisor/service";
import { buildDepartmentAssistantContext } from "./context-builder";
import { runDepartmentAssistantReflexShadow } from "./reflex";
import { buildKernCollaborationPlanShadow } from "./collaboration-planner";

function asJsonObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
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
  const collaborationPlanShadow = buildKernCollaborationPlanShadow({
    text: content,
    productBound: Boolean(context.productId),
    reflex,
  });

  const run = await prisma.agentRun.findUnique({
    where: { id: result.runId },
    select: { contextSnapshot: true },
  });
  if (run) {
    await prisma.agentRun.update({
      where: { id: result.runId },
      data: {
        contextSnapshot: {
          ...asJsonObject(run.contextSnapshot),
          assistantRuntime: context.runtimeVersion,
          collaborationMode: context.collaborationMode,
          linkedProjectIds: context.linkedProjectIds,
          confirmedCompanyFactRefs: context.confirmedCompanyFactRefs,
          reflexMode: reflex.mode,
          reflexDecisions: reflex.decisions,
          reflexError: reflex.error,
          collaborationPlanShadow,
        } as Prisma.InputJsonValue,
      },
    });
  }

  return {
    ...result,
    assistantRuntime: context.runtimeVersion,
    reflexMode: reflex.mode,
    collaborationPlanShadow,
  };
}
