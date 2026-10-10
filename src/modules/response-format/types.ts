/**
 * Kern Response Envelope
 * ======================
 * Kern 不直接产出 HTML / Markdown 长文，而是产出这个结构化信封；排版由前端唯一决定。
 * 好处：同一份内容在对话卡、右侧工作区、导出 PDF 里长得完全一致，且可被 harness 机械校验。
 *
 * 规范原文见 docs/KERN_RESPONSE_SPEC.md。
 */

export type Confidence = "HIGH" | "MEDIUM" | "LOW";
export type ClaimKind = "fact" | "inference" | "unknown";
export type Trust = "trusted" | "untrusted" | "internal" | "demo";
export type Tone = "info" | "ok" | "warn" | "blocked";

/** 信封的四种场景。同一套 Block 渲染器服务全部四种。 */
export type EnvelopeKind =
  | "ANSWER" // 直接回答
  | "BRIEF" // 开工前：澄清 + 计划
  | "PROGRESS" // 进行中：实时进度
  | "CONCLUSION"; // 收尾：结论 + 决策

export interface ProseBlock {
  type: "prose";
  title?: string;
  full?: boolean;
  /** 每个元素是一段。以 "### " 开头是小标题，以 "> " 开头是引言。 */
  body: string[];
}

export interface KeypointsBlock {
  type: "keypoints";
  title?: string;
  full?: boolean;
  items: { kind: ClaimKind; text: string }[];
}

export interface TableBlock {
  type: "table";
  title?: string;
  full?: boolean;
  caption?: string;
  cols: { label: string; num?: boolean }[];
  rows: { cells: string[]; pick?: boolean }[];
}

export interface ChartBlock {
  type: "chart";
  title?: string;
  full?: boolean;
  label: string;
  unit: string;
  series: { label: string; value: number; display?: string; hi?: boolean }[];
  source: string;
}

export interface ChecklistBlock {
  type: "checklist";
  title?: string;
  full?: boolean;
  items: { hypothesis: string; method: string; gate: string; duration: string; budget: string }[];
}

export interface TimelineBlock {
  type: "timeline";
  title?: string;
  full?: boolean;
  items: { when: string; phase: string; deliverable: string }[];
}

export interface DecisionBlock {
  type: "decision";
  title?: string;
  full?: boolean;
  headline: string;
  confidence: Confidence;
  recommend: string[];
  against: string[];
  risks: string[];
}

export interface QaBlock {
  type: "qa";
  title?: string;
  full?: boolean;
  trail: { verdict: "rej" | "fix" | "pass"; who: string; round: number; message: string }[];
}

export interface CalloutBlock {
  type: "callout";
  full?: boolean;
  tone: Tone;
  title: string;
  body: string;
}

export interface UnknownBlock {
  type: "unknown";
  title?: string;
  full?: boolean;
  items: { question: string; needs: string }[];
}

export interface EvidenceBlock {
  type: "evidence";
  title?: string;
  items: { n: number; title: string; trust: Trust; fetchedAt: string; url: string; sourceId?: string; eventId?: string; contentHash?: string; snapshot?: string; truncated?: boolean }[];
}

export interface CodeBlock {
  type: "code";
  title?: string;
  full?: boolean;
  lang: string;
  note?: string;
  body: string;
}

/** 进度块：PROGRESS 信封专用，由 KernMissionEvent 流驱动。 */
export interface ProgressBlock {
  type: "progress";
  title?: string;
  full?: boolean;
  done: number;
  total: number;
  paused?: boolean;
  steps: {
    key: string;
    label: string;
    agent: string;
    state: "queued" | "running" | "done" | "blocked" | "skipped";
    /** 流式增量文本；渲染成打字效果。 */
    delta?: string;
    elapsedMs?: number;
  }[];
}

/** 澄清块：BRIEF 信封专用。 */
export interface ClarifyBlock {
  type: "clarify";
  title?: string;
  full?: boolean;
  questions: {
    id: string;
    ask: string;
    why: string;
    options: string[];
    remembered?: string;
  }[];
}

/** HTML富可视化Artifact块 - Kern完美结合，Claude风格 */
export interface HtmlBlock {
  type: "html";
  title?: string;
  full?: boolean;
  html: string; // 内联样式HTML，无外部依赖
  height?: number;
  artifact?: boolean; // 是否作为Artifact在右侧展示
}

export type Block =
  | ProseBlock | KeypointsBlock | TableBlock | ChartBlock | ChecklistBlock
  | TimelineBlock | DecisionBlock | QaBlock | CalloutBlock | UnknownBlock
  | EvidenceBlock | CodeBlock | ProgressBlock | ClarifyBlock | HtmlBlock;

export interface Ask {
  question: string;
  why_you: string;
  options: { label: string; consequence: string }[];
}

export type AudienceRole = "leadership" | "product" | "sales" | "operator" | "auto";

export interface Meta {
  model: string;
  elapsedMs: number;
  steps: number;
  quota: { used: number; limit: number | null } | null;
  memoriesUsed: string[];
  sources: number;
  /** Kern 建议的呈现角色，前端可自动切换 */
  suggestedRole?: AudienceRole;
  audience?: AudienceRole;
  /** Kern 识别到的用户意图对应的角色 */
  detectedRole?: AudienceRole;
  roleConfidence?: number;
  roleReason?: string;
}

export interface ResponseEnvelope {
  v: 1;
  kind: EnvelopeKind;
  /** true = 演示数据：全局标注、不写业务数据、不占额度。 */
  demo: boolean;
  /** 一句话结论，≤ 60 字。 */
  lede: string;
  confidence: Confidence;
  blocks: Block[];
  ask?: Ask;
  meta: Meta;
}

export const CLAIM_LABEL: Record<ClaimKind, string> = {
  fact: "事实",
  inference: "推断",
  unknown: "未知",
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
};

export const TRUST_LABEL: Record<Trust, string> = {
  trusted: "可信",
  untrusted: "外部未验证",
  internal: "内部",
  demo: "演示",
};
