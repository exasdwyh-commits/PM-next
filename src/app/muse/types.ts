/**
 * Studio 蓝图契约层（前端先行）
 *
 * 这里定义的是「理想 AI 助理系统」前端需要的视图模型形状。
 * 后端接入时的规则：`src/modules/<domain>/` 负责把数据库读模型映射成这些类型，
 * 页面与组件只消费这些类型，不再认识 Prisma 记录。
 *
 * 全部类型可序列化：可以直接从 server component 传进 client component。
 */

/** AI 交互状态。禁止只用颜色编码；每个状态都必须有文案与图标。 */
export type AiState = "idle" | "working" | "needs-review" | "success" | "error" | "cancelled";

/** 语义色调，对齐 quiet-enterprise 令牌层的 ok / warn / block / neutral / accent。 */
export type Tone = "accent" | "ok" | "warn" | "block" | "neutral";

/** 置信度。UNKNOWN 必须保持 UNKNOWN，不允许前端编一个数字出来。 */
export type Confidence = "high" | "medium" | "low" | "unknown";

export type StudioView = "brief" | "thread" | "missions" | "workforce" | "evidence";

/** 证据引用：任何 AI 结论都必须能追到来源，否则标 unknown。 */
export interface EvidenceRef {
  id: string;
  title: string;
  /** 来源类型：内部记录、外部文献、本机执行回执、人工输入 */
  kind: "internal" | "literature" | "runtime" | "human";
  source: string;
  confidence: Confidence;
  /** 独立 QA 是否已核验 */
  verified: boolean;
  excerpt?: string;
  capturedAt: string;
}

/** 数字员工 */
export interface Employee {
  id: string;
  name: string;
  role: string;
  /** 首字母/字符标记，用于头像块 */
  mark: string;
  state: AiState;
  /** 当前在做什么，一句话；idle 时为 null */
  currentFocus: string | null;
  /** 0-100，用于负载条 */
  load: number;
  skills: string[];
}

/** 计划步骤：助理把目标拆成的可读步骤 */
export interface PlanStep {
  id: string;
  title: string;
  ownerId: string | null;
  state: AiState;
  detail?: string;
  /** 需要人决策才能继续 */
  awaitsDecision?: boolean;
}

/** 一次任务/委派 */
export interface Mission {
  id: string;
  title: string;
  goal: string;
  state: AiState;
  /** 所属产品/项目，可空（纯研究类任务） */
  productId: string | null;
  productName: string | null;
  ownerId: string;
  startedAt: string;
  /** 0-100 推进度；unknown 情况用 null，不要假装 0 */
  progress: number | null;
  steps: PlanStep[];
  evidence: EvidenceRef[];
}

/** 决策项：系统推进到闸口，必须人拍板 */
export interface Decision {
  id: string;
  title: string;
  /** 为什么现在需要你 */
  because: string;
  /** 不决策的后果 */
  ifIgnored: string;
  tone: Tone;
  gate: string | null;
  missionId: string | null;
  options: { id: string; label: string; kind: "approve" | "reject" | "defer" | "revise"; hint?: string }[];
  evidence: EvidenceRef[];
  dueLabel: string;
  raisedBy: string;
}

/** 会话消息块：助理的回答不是纯文本，是结构化块 */
export type MessageBlock =
  | { kind: "text"; text: string }
  | { kind: "plan"; title: string; steps: PlanStep[] }
  | { kind: "evidence"; title: string; refs: EvidenceRef[] }
  | { kind: "runtime"; title: string; command: string; output: string; state: AiState }
  | { kind: "proposal"; title: string; summary: string; diff: { field: string; from: string; to: string }[] }
  | { kind: "verdict"; title: string; verdict: "pass" | "fail" | "unknown"; notes: string[] }
  | { kind: "unknown"; question: string; missing: string[] };

export interface Message {
  id: string;
  author: "user" | "hermes";
  /** 科恩消息可标注实际执行者；author 值 `hermes` 暂作兼容协议保留。 */
  byEmployeeId?: string | null;
  at: string;
  state: AiState;
  blocks: MessageBlock[];
}

/** 本机 Runtime 状态 */
export interface RuntimeStatus {
  connected: boolean;
  host: string;
  lastHeartbeat: string;
  capabilities: string[];
  /** 正在执行的本机动作 */
  activeAction: string | null;
}

/** 活动流条目：右栏「科恩正在做什么」 */
export interface ActivityItem {
  id: string;
  at: string;
  state: AiState;
  actorId: string | null;
  text: string;
  missionId: string | null;
}

/** 首页 Brief：只回答三个问题 */
export interface Brief {
  greeting: string;
  /** 1. 需要我决定什么 */
  decisions: Decision[];
  /** 2. 科恩现在在做什么 */
  missions: Mission[];
  /** 3. 接下来该开始什么 */
  suggestions: { id: string; title: string; why: string; prompt: string }[];
}

export interface StudioModel {
  /** 当前真正打开的会话/目标；null = Today / 新任务模式 */
  activeMissionId: string | null;
  /** 与科恩主工作台独立的专业管理后台入口 */
  managementHref: string;
  /** 从产品后台跳入科恩主工作台时，新会话应绑定的产品上下文 */
  newConversationProduct: { id: string; name: string } | null;
  /** 外部入口预填的问题，不会自动发送 */
  initialDraft: string;
  user: { name: string; role: string; org: string };
  brief: Brief;
  employees: Employee[];
  messages: Message[];
  activity: ActivityItem[];
  runtime: RuntimeStatus;
  evidence: EvidenceRef[];
}
