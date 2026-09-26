/**
 * @deprecated Kern compatibility facade.
 *
 * The primary conversation runtime, routing and capability execution now live
 * under src/modules/assistant-runtime/. This file intentionally contains no
 * product logic or orchestration; it only preserves historical imports while
 * the remaining callers migrate.
 */

import type { SessionContext } from "@/modules/identity/session";
import {
  createKernConversation,
  getKernConversation,
  listKernConversations,
} from "@/modules/assistant-runtime/conversations";
import { executeKernConversationTurn } from "@/modules/assistant-runtime/conversation-engine";
import {
  modelRouteForIntent,
  resolveKernIntent,
  type IntentRoutingDecision,
} from "@/modules/assistant-runtime/router";
import {
  executeKernCapability,
  type KernCapabilityContext,
  type KernCapabilityIntent,
  type KernCapabilityResult,
} from "@/modules/assistant-runtime/capabilities";

export type Intent = KernCapabilityIntent;
export type ToolContext = KernCapabilityContext;
export type ToolResult = KernCapabilityResult;
export type { IntentRoutingDecision };

/** @deprecated Use assistant-runtime/conversations. */
export const listConversations = listKernConversations;
/** @deprecated Use assistant-runtime/conversations. */
export const createConversation = createKernConversation;
/** @deprecated Use assistant-runtime/conversations. */
export const getConversation = getKernConversation;

/** @deprecated Use assistant-runtime/router.resolveKernIntent. */
export const resolveIntentWithKernPlanner = resolveKernIntent;
/** @deprecated Use assistant-runtime/router.modelRouteForIntent. */
export const advisorModelRouteForIntent = modelRouteForIntent;

/** @deprecated Use assistant-runtime/capabilities.executeKernCapability. */
export const runLegacyAdvisorCapability = executeKernCapability;
/** @deprecated Use assistant-runtime/capabilities.executeKernCapability. */
export const runTool = executeKernCapability;

/**
 * @deprecated Use sendDepartmentAssistantMessage for the product entry point,
 * or executeKernConversationTurn for the low-level run lifecycle.
 */
export async function sendMessage(
  session: SessionContext,
  conversationId: string,
  content: string,
  options?: { runId?: string }
) {
  return executeKernConversationTurn(
    session,
    conversationId,
    content,
    options
  );
}
