import { Prisma } from "@prisma/client";
import prisma from "@/shared/db";
import type { SessionContext } from "@/modules/identity/session";
import { executeKernConversationTurn } from "./conversation-engine";
import { buildDepartmentAssistantContext } from "./context-builder";
import { runDepartmentAssistantReflexShadow } from "./reflex";
import { buildKernCollaborationPlanShadow } from "./collaboration-planner";
import {
  buildKernCouncilGraph,
  shouldAttachKernCouncilGraph,
  toKernGraphCitation,
} from "@/modules/visual-intelligence";

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
 * Kern owns the conversation lifecycle, routing and capability execution.
 * Advisor modules are compatibility/support libraries only.
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
  const result = await executeKernConversationTurn(
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
    selectedAdvisorCodes: result.runtimeSelection.config.advisorCodes,
  });
  const visualAllowed =
    result.runtimeSelection.config.capabilityKeys === null ||
    result.runtimeSelection.config.capabilityKeys.includes("visualize");
  const visualGraphShadow =
    visualAllowed &&
    shouldAttachKernCouncilGraph(content, collaborationPlanShadow)
    ? buildKernCouncilGraph({
        graphId: `${result.runId}:council-shadow`,
        goal: content,
        plan: collaborationPlanShadow,
      })
    : null;

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
          visualGraphShadow,
          conversationRuntimeConfig: result.runtimeSelection.config,
          selectedAdvisors: result.runtimeSelection.advisors,
          selectedSkills: result.runtimeSelection.skills,
        }),
      },
    });
  }

  let message = result.message;
  if (visualGraphShadow) {
    const existingCitations = Array.isArray(result.message.citations)
      ? result.message.citations.filter((citation) => {
          if (!citation || typeof citation !== "object" || Array.isArray(citation)) {
            return true;
          }
          return (citation as Record<string, unknown>).kind !== "kern-graph";
        })
      : [];
    message = await prisma.message.update({
      where: { id: result.message.id },
      data: {
        citations: asInputJson([
          ...existingCitations,
          toKernGraphCitation(visualGraphShadow),
        ]),
      },
    });
  }

  return {
    ...result,
    message,
    assistantRuntime: context.runtimeVersion,
    reflexMode: reflex.mode,
    collaborationPlanShadow,
    visualGraphShadow,
  };
}
