import type { SessionContext } from "@/modules/identity/session";
import type {
  KernCapabilityContext,
  KernCapabilityHandler,
  KernCapabilityIntent,
  KernCapabilityResult,
} from "./contracts";
import { handleDesktopCapability } from "./desktop";
import { handleProductRndCapability } from "./product-rnd";
import { handleWorkspaceReadCapability } from "./workspace-read";
import { handleProductWriteCapability } from "./product-write";
import { handleChallengeCapability } from "./challenge";
import { handleKnowledgeCapability } from "./knowledge";
import { capabilityKeyForIntent } from "./catalog";

const HANDLERS: KernCapabilityHandler[] = [
  handleDesktopCapability,
  handleProductRndCapability,
  handleWorkspaceReadCapability,
  handleProductWriteCapability,
  handleChallengeCapability,
  handleKnowledgeCapability,
];

export async function executeKernCapability(
  session: SessionContext,
  intent: KernCapabilityIntent,
  context: KernCapabilityContext
): Promise<KernCapabilityResult> {
  const capabilityKey = capabilityKeyForIntent(intent);
  if (
    intent === "UNSUPPORTED" &&
    context.capabilityKeys !== null &&
    context.capabilityKeys !== undefined &&
    !context.capabilityKeys.includes("knowledge")
  ) {
    return {
      toolKey: "none",
      text: "这是普通对话，本轮不会调用你已关闭的额外功能。",
      citations: [],
    };
  }

  if (
    capabilityKey &&
    context.capabilityKeys !== null &&
    context.capabilityKeys !== undefined &&
    !context.capabilityKeys.includes(capabilityKey)
  ) {
    return {
      toolKey: "kern.capability.disabled",
      text: `这个 Conversation 没有启用「${capabilityKey}」功能。可以在输入框下方的“功能”里重新打开，或切回自动。`,
      citations: [],
    };
  }

  for (const handler of HANDLERS) {
    const result = await handler(session, intent, context);
    if (result) return result;
  }

  throw new Error(`No Kern capability handler registered for intent: ${intent}`);
}

export const KERN_NATIVE_CAPABILITY_INTENTS = new Set<KernCapabilityIntent>([
  "DESKTOP_EXECUTION",
  "START_PRODUCT_RND",
  "PRODUCT_RND_STATUS",
  "PRODUCT_RND_REPORT",
  "PENDING_DECISIONS",
  "PRODUCT_STATUS",
  "WORKSPACE_STATUS",
  "PENDING_PROPOSALS",
  "PROPOSE_FIELD_CHANGE",
  "PROPOSE_CREATE_WORK_ITEM",
  "NEW_PRODUCT_INTAKE",
  "CHALLENGE_THESIS",
  "KNOWLEDGE_SEARCH",
  "UNSUPPORTED",
]);
