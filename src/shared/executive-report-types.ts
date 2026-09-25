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
  provenance?: ExecutiveReportProvenance;
  /** artifact 元信息（渲染头部用） */
  artifactId?: string;
  title?: string;
  contentVersion?: number;
  createdAt?: string;
}

/** 溯源列表在前端只展示前 N 条，避免长文档刷屏。 */
export const EXECUTIVE_REPORT_PROVENANCE_PREVIEW_LIMIT = 6;
