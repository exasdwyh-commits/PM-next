import type { ExecutiveReportCitation } from "@/shared/executive-report-citation";
/** Muse 对话界面的读模型类型（KX-71 从 app/muse/types.ts 下沉到 muse 模块；页面文件 re-export）。 */
import type { KernGraphV1 } from "@/modules/visual-intelligence/contracts";
import type { ArtifactCitation } from "@/modules/artifacts/protocol";
import type { SourceAuthority } from "@/shared/vocabulary";

export type AiState = "idle" | "working" | "needs-review" | "success" | "error" | "cancelled";
export type Tone = "accent" | "ok" | "warn" | "block" | "neutral";

/**
 * 来源可靠度（显示层）。
 *
 * 这是 `@/shared/vocabulary` 里 `SourceAuthority` 的**别名** —— 词表只有一份，
 * muse 层沿用 `Confidence` 这个历史名字，值为
 *  confirmed 已确认 · internal 内部来源 · curated 精选来源 · public 公开来源 · unrated 未评级。
 *
 * 约定：**「未评级」是中性态，不是错误**。没算过就说没算过，不猜档位——
 * 猜出来的绿标比老实说「未评级」更糟。
 */
export type Confidence = SourceAuthority;

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
  /** 提议内容摘要：确认前必须能看清「将要写入什么」，只有标题等于让用户盲批。 */
  summary?: string[];
  /** 证据为空时的提示：不同来源的提议依据不同，不能一律说「没有任何依据」。 */
  emptyEvidenceHint?: string;
}

export type MessageBlock =
  /** `artifacts`: kern-artifact citations referenced by `[[kern-artifact:id@v]]` markers in `text`. */
  | { kind: "text"; text: string; artifacts?: ArtifactCitation[] }
  /** A completed mission conclusion: rendered as a ResponseEnvelope, `text` is the Markdown fallback. */
  | { kind: "conclusion"; ref: string; text: string }
  | { kind: "graph"; graph: KernGraphV1 }
  | { kind: "plan"; title: string; steps: PlanStep[] }
  | { kind: "mission"; ref: string }
  | { kind: "brief"; ref: string }
  | { kind: "report"; citation: ExecutiveReportCitation }
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
  /** 文件式能力包 id（`<域>.<名称>`）；null = 不限，走自动识别。 */
  capabilityPackIds: string[] | null;
  /** 授权档位：auto 常规协作；full 全委托（Kern 自行决定方案取舍，不再回问草稿细节；业务执行确认仍走服务端既有人工确认入口）。 */
  delegationMode: "auto" | "full";
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
  capabilityPacks: ConversationControlOption[];
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

export interface AttentionItemView {
  id: string;
  level: "AUTO_HANDLE" | "WATCH" | "SURFACE" | "INTERRUPT";
  title: string;
  why: string;
  href: string | null;
  conversationId: string | null;
}

export interface ChatBrief {
  decisions: Decision[];
  conversations: ConversationSummary[];
  attention: {
    needsYou: AttentionItemView[];
    inProgress: AttentionItemView[];
    handledQuietly: number;
    completedRecently: number;
  };
  suggestions: { id: string; title: string; why: string; prompt: string }[];
}

export interface StudioModel {
  activeConversationId: string | null;
  /** Can Kern run any model right now? Drives the one honest banner. */
  modelReady: boolean;
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

/**
 * 输入坞里一份已上传的材料。
 *
 * 与服务端 `ConversationAttachment` 的公共视图一一对应，但**不带 fileKey**：
 * 存储键对客户端没有正当用途，留在内存里只会通过 props 泄漏到各处。
 */
export interface ConversationAttachmentItem {
  id: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  /** PENDING 只在极端时序下出现：上传接口已经解析完才返回，正常链路直接是终态 */
  parseStatus: "PENDING" | "READY" | "UNSUPPORTED" | "FAILED";
  parsedKind: string | null;
  parseNote: string | null;
  indexForSearch: boolean;
  createdAt: string;
  /** 解析结果的一小段预览，仅用于上传完成时的即时反馈 */
  preview?: string;
}
