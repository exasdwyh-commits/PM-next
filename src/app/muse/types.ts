import type { KernGraphV1 } from "@/modules/visual-intelligence/contracts";

export type AiState = "idle" | "working" | "needs-review" | "success" | "error" | "cancelled";
export type Tone = "accent" | "ok" | "warn" | "block" | "neutral";
export type Confidence = "high" | "medium" | "low" | "unknown";

export interface EvidenceRef {
  id: string;
  title: string;
  kind: "internal" | "literature" | "runtime" | "human";
  source: string;
  confidence: Confidence;
  verified: boolean;
  excerpt?: string;
  capturedAt: string;
}

export interface Employee {
  id: string;
  name: string;
  role: string;
  mark: string;
  state: AiState;
  currentFocus: string | null;
  load: number;
  skills: string[];
}

export interface PlanStep {
  id: string;
  title: string;
  ownerId: string | null;
  state: AiState;
  detail?: string;
  awaitsDecision?: boolean;
}

/**
 * Conversation is the primary object in Kern Chat.
 * Project/task semantics belong to Workbench and must not leak into the chat rail.
 */
export interface ConversationSummary {
  id: string;
  title: string;
  preview: string;
  state: AiState;
  productId: string | null;
  productName: string | null;
  startedAt: string;
}

export interface Decision {
  id: string;
  title: string;
  because: string;
  ifIgnored: string;
  tone: Tone;
  gate: string | null;
  conversationId: string | null;
  options: { id: string; label: string; kind: "approve" | "reject" | "defer" | "revise"; hint?: string }[];
  evidence: EvidenceRef[];
  dueLabel: string;
  raisedBy: string;
}

export type MessageBlock =
  | { kind: "text"; text: string }
  | { kind: "graph"; graph: KernGraphV1 }
  | { kind: "plan"; title: string; steps: PlanStep[] }
  | { kind: "evidence"; title: string; refs: EvidenceRef[] }
  | { kind: "runtime"; title: string; command: string; output: string; state: AiState }
  | { kind: "proposal"; title: string; summary: string; diff: { field: string; from: string; to: string }[] }
  | { kind: "verdict"; title: string; verdict: "pass" | "fail" | "unknown"; notes: string[] }
  | { kind: "unknown"; question: string; missing: string[] };

export interface Message {
  id: string;
  author: "user" | "kern";
  byEmployeeId?: string | null;
  at: string;
  state: AiState;
  blocks: MessageBlock[];
}

export interface ConversationRuntimeConfig {
  version: "kern-conversation-config/v1";
  modelProfileKey: string | null;
  advisorCodes: string[] | null;
  skillKeys: string[] | null;
  capabilityKeys: string[] | null;
}

export interface ConversationControlOption {
  key: string;
  label: string;
  description: string;
  meta?: string | null;
}

export interface ConversationControls {
  config: ConversationRuntimeConfig;
  models: ConversationControlOption[];
  advisors: ConversationControlOption[];
  skills: ConversationControlOption[];
  capabilities: ConversationControlOption[];
}

export interface RuntimeStatus {
  connected: boolean;
  host: string;
  lastHeartbeat: string;
  capabilities: string[];
  activeAction: string | null;
}

export interface ActivityItem {
  id: string;
  at: string;
  state: AiState;
  actorId: string | null;
  text: string;
  conversationId: string | null;
}

export interface ChatBrief {
  decisions: Decision[];
  conversations: ConversationSummary[];
  suggestions: { id: string; title: string; why: string; prompt: string }[];
}

export interface StudioModel {
  activeConversationId: string | null;
  managementHref: string;
  newConversationProduct: { id: string; name: string } | null;
  initialDraft: string;
  user: { name: string; role: string; org: string };
  brief: ChatBrief;
  employees: Employee[];
  messages: Message[];
  activity: ActivityItem[];
  controls: ConversationControls;
  runtime: RuntimeStatus;
  evidence: EvidenceRef[];
}
