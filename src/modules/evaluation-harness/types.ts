/**
 * Hermes Decision Evaluation Harness contracts.
 *
 * 目标：
 * - 用固定输入/固定期望验证产品判断与模型路由，不靠“看起来合理”的主观验收；
 * - 把预测与后续真实结果绑定到同一产品版本/渠道路线指纹，避免拿改版后的成功反证旧版本；
 * - 经验只能形成候选，不得自动改权重、门槛或 Governance。
 */

export type HarnessCheckStatus = "PASS" | "FAIL" | "SKIP";
export type HarnessSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface HarnessCheck {
  key: string;
  status: HarnessCheckStatus;
  severity: HarnessSeverity;
  message: string;
  expected?: unknown;
  actual?: unknown;
}

export interface HarnessCaseResult<TOutput = unknown> {
  caseId: string;
  title: string;
  output: TOutput;
  checks: HarnessCheck[];
  passed: boolean;
  criticalFailures: number;
}

export interface HarnessSuiteResult<TOutput = unknown> {
  suiteId: string;
  caseCount: number;
  passedCases: number;
  failedCases: number;
  criticalFailures: number;
  results: Array<HarnessCaseResult<TOutput>>;
}

export interface FrozenDecisionIdentity {
  organizationId: string;
  productId: string;
  productVersionId: string;
  productVersionFingerprint: string;
  channelRouteId?: string | null;
  channelRouteFingerprint?: string | null;
  assessmentRuleVersion: string;
  evaluatedAt: string;
}

export type ProductValidationOutcome =
  | "SUCCESS"
  | "FAILURE"
  | "INCONCLUSIVE"
  | "NOT_RUN";

export interface VerifiedProductOutcome {
  identity: FrozenDecisionIdentity;
  outcome: ProductValidationOutcome;
  /**
   * 真实结果必须有证据引用。没有证据的“感觉不错/不好”不能成为训练或校准标签。
   */
  evidenceRefs: string[];
  verifiedByUserId: string | null;
  verifiedAt: string | null;

  channelAccepted?: boolean | null;
  launched?: boolean | null;
  actualContributionMarginRate?: number | null;
  actualReturnRate?: number | null;
  repeatPurchaseRate?: number | null;
  observationDays?: number | null;
  notes?: string[];
}

export type ExperienceCandidateStatus =
  | "CANDIDATE"
  | "APPROVED"
  | "REJECTED"
  | "SUPERSEDED";

export interface ExperienceLessonCandidate {
  key: string;
  segmentKey: string;
  statement: string;
  supportCount: number;
  contradictionCount: number;
  sampleSize: number;
  evidenceRefs: string[];
  status: ExperienceCandidateStatus;
  /**
   * 即使达到最低样本量，也只表示“值得复核”，不表示可自动进入正式规则。
   */
  readyForReview: boolean;
  limitations: string[];
}
