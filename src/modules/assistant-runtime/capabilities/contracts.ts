import type { KernCapabilityKey } from "./catalog";

export type KernCapabilityIntent =
  | "WORKSPACE_STATUS"
  | "PENDING_DECISIONS"
  | "PRODUCT_STATUS"
  | "PENDING_PROPOSALS"
  | "PROPOSE_FIELD_CHANGE"
  | "PROPOSE_CREATE_WORK_ITEM"
  | "NEW_PRODUCT_INTAKE"
  | "START_PRODUCT_RND"
  | "PRODUCT_RND_STATUS"
  | "PRODUCT_RND_REPORT"
  | "KNOWLEDGE_SEARCH"
  | "CHALLENGE_THESIS"
  | "DESKTOP_EXECUTION"
  | "UNSUPPORTED";

export interface KernCapabilityContext {
  conversationId: string;
  productId: string | null;
  text: string;
  capabilityKeys: KernCapabilityKey[] | null;
}

export interface KernCapabilityResult {
  toolKey: string;
  text: string;
  citations: { kind: string; ref: string; title: string }[];
  proposal?: {
    proposalId: string;
    created: boolean;
    actionType: string;
  } | null;
  challengeReport?: unknown | null;
}

export type KernCapabilityHandler = (
  session: import("@/modules/identity/session").SessionContext,
  intent: KernCapabilityIntent,
  context: KernCapabilityContext
) => Promise<KernCapabilityResult | null>;
