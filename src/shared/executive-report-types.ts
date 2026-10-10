/**
 * 管理报告的「面向负责人的结构化视图」契约。
 *
 * 后端 `ProductRndExecutiveReport`（artifact content，JSON）是完整事实源；
 * 前端只消费这份被裁剪过的子集，避免把整份 artifact 文本塞进页面。
 *
 * 放在 shared 而不是 components：服务端（API preview 构造）与客户端（渲染）
 * 必须共用同一份契约，否则字段一改两边就漂移。
 */

export interface ExecutiveReportConclusion {
  claim: string;
  claimKind?: string | null;
  evidenceLevel?: string | null;
  evidenceRef?: string | null;
  verificationRefs?: string[];
  freshness?: string | null;
}

export interface ExecutiveReportAdvisoryNote {
  agentCode: string;
  agentName?: string | null;
  status?: string | null;
  /** 执行器写入的 outputSummary（含诚实缺省时「缺什么」的可读说明）。 */
  summary?: string | null;
  errorReason?: string | null;
}

export interface ExecutiveReportProvenance {
  sourceRefs: string[];
  agentRunRefs: string[];
  modelRunRefs: string[];
  knowledgeDebtRefs: string[];
  researchSnapshotRef: string | null;
}


/**
 * 操盘手角色投影（批次B，纯增量可选字段）。
 *
 * 设计约定：
 * - 全部字段可选：后端 envelope 没有产出该投影时，前端一律渲染「UNKNOWN 缺口块」，
 *   写明缺什么、如何补齐，绝不编造内容。
 * - 数据轻嵌在现有 payload 上（report.operator），不动既有字段结构；
 *   跑顺后再评估是否拆独立任务模型。
 */

/** 甘特阶段条：window 形如 "W1-2" / "W3-4"，前端按桶位正则映射。 */
export interface ExecutiveReportOperatorPhase {
  name?: string | null;
  /** 例如 "W1-2"、"W3-4"；缺省时视图归入 UNDEFINED 缺口处理。 */
  window?: string | null;
  /** done | active | planned | critical；未知/未给一律视为 planned 弱化展示。 */
  state?: string | null;
  owner?: string | null;
  note?: string | null;
}

/** RAG 式卡点：severity 用 P0/P1/P2 或 high/medium/low，视图统一归一。 */
export interface ExecutiveReportOperatorBlocker {
  title?: string | null;
  severity?: string | null;
  owner?: string | null;
  eta?: string | null;
  note?: string | null;
}

export interface ExecutiveReportOperatorSla {
  name?: string | null;
  target?: string | null;
  current?: string | null;
  /** ok | tight | late；未知时前端显示 UNKNOWN 章。 */
  status?: string | null;
}

/** 渠道漏斗一层：stage + count/rate，count 允许字符串（后端可能给 "—"）。 */
export interface ExecutiveReportOperatorFunnelStage {
  stage?: string | null;
  count?: string | number | null;
  rate?: string | null;
}

/** 复盘判据：通过/未过/待定，带结论三态沿用 claimKind 语义。 */
export interface ExecutiveReportOperatorCriterion {
  item?: string | null;
  result?: string | null;
  /** fact | inference | estimate | unknown，与结论章共用三态徽章。 */
  kind?: string | null;
}

export interface ExecutiveReportOperator {
  currentWeek?: string | null;
  phases?: ExecutiveReportOperatorPhase[];
  blockers?: ExecutiveReportOperatorBlocker[];
  slas?: ExecutiveReportOperatorSla[];
  funnel?: ExecutiveReportOperatorFunnelStage[];
  criteria?: ExecutiveReportOperatorCriterion[];
}


/**
 * 执行层深度报告（批次 C，report-full 九大块标准结构）。
 * 原则沿用 operator 投影：全部可选；无实数据时以 sections[].ready=false 表达，
 * 视图渲染 UNKNOWN 占位并附「如何补齐」，绝不整段消失或编造。
 */

export interface ExecutiveReportDeepSpecRow {
  name?: string;
  value?: string;
  unit?: string;
  note?: string;
  /** 三态沿用结论章语义：FACT / INFERENCE / ESTIMATE / UNKNOWN。 */
  claimKind?: string;
  evidenceRef?: string;
}

export interface ExecutiveReportDeepSpec {
  title?: string;
  dosageForm?: string;
  rows: ExecutiveReportDeepSpecRow[];
}

export interface ExecutiveReportDeepBomLine {
  item?: string;
  /** 数量/单价/合计允许字符串（后端可用 "—" 显式标缺）。 */
  qty?: number | string;
  uom?: string;
  unitCost?: number | string;
  total?: number | string;
  /** 价格来源（supplier:xxx / quoteId）；无来源的报价不得出现。 */
  sourceRef?: string | null;
  note?: string;
}

export interface ExecutiveReportDeepBom {
  currency?: string;
  /** 口径（如「60 片/瓶 · 批产 N 瓶」）。 */
  basis?: string;
  lines: ExecutiveReportDeepBomLine[];
}

export interface ExecutiveReportDeepValidationItem {
  claim?: string;
  /** SUPPORTED / CONTRADICTED / NOT_FOUND / AMBIGUOUS / NO_VERIFICATION。 */
  latestStatus?: string;
  checkedAt?: string | null;
  claimKind?: string;
  evidenceLevel?: string;
}

export interface ExecutiveReportDeepValidation {
  totals?: { claims: number; supported: number; unverified: number };
  items: ExecutiveReportDeepValidationItem[];
  /** 未闭合缺口（DataGap/知识债/零证据守卫等去重后的原文）。 */
  gaps?: string[];
  qaStatus?: string;
}

export type ExecutiveReportDeepSectionKey =
  | "definition" | "bom" | "process" | "quality" | "economics"
  | "compliance" | "fmea" | "validation" | "appendix";

export interface ExecutiveReportDeepSection {
  key: ExecutiveReportDeepSectionKey;
  title: string;
  /** 有实数据才 true；否则视图渲染 UNKNOWN 占位。 */
  ready: boolean;
  /** 缺数据时的「如何补齐」说明（UNKNOWN 占位块用）。 */
  gap?: string;
}

export interface ExecutiveReportDeep {
  spec?: ExecutiveReportDeepSpec;
  bom?: ExecutiveReportDeepBom;
  validation?: ExecutiveReportDeepValidation;
  /** 九块骨架状态（渲染导航与占位块的数据源）。 */
  sections: ExecutiveReportDeepSection[];
}

export interface ExecutiveReportPayload {
  summary?: string | null;
  verificationStatus?: string | null;
  conclusions?: ExecutiveReportConclusion[];
  unknowns?: string[];
  risks?: string[];
  decisionsRequired?: string[];
  recommendedActions?: string[];
  assumptions?: string[];
  advisoryNotes?: ExecutiveReportAdvisoryNote[];
  /** 操盘手角色投影（可选；缺省时视图显示缺口块，不编数据）。 */
  operator?: ExecutiveReportOperator;
  /** 执行层深度报告（可选；缺省时视图渲染九块 UNKNOWN 占位骨架，不编数据）。 */
  deepReport?: ExecutiveReportDeep;
  provenance?: ExecutiveReportProvenance;
  /** artifact 元信息（渲染头部用） */
  artifactId?: string;
  title?: string;
  contentVersion?: number;
  createdAt?: string;
}

/** 溯源列表在前端只展示前 N 条，避免长文档刷屏。 */
export const EXECUTIVE_REPORT_PROVENANCE_PREVIEW_LIMIT = 6;
