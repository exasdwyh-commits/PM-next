/**
 * 产品判断层的「持续职责台账」（研发办公室阶段三 A 的判断侧）
 *
 * 定位：`potential-compiler` 回答「现在这个产品是什么状态」，
 * 本模块回答「**办公室接下来该做什么、以及什么时候什么都不该做**」。
 *
 * 按 `docs/superpowers/specs/2026-10-16-health-rnd-office-design.md` 的第三阶段，
 * 首批持续职责是四件事：
 *   1. 项目证据缺口
 *   2. 待核验假设
 *   3. 需要处理的工作（需人工提供的部分）
 *   4. 新证据影响评估
 * 本模块把前两项做成台账、第三项做成 `requiresHumanInput` 标记、
 * 第四项做成 `assessEvidenceDelta`。
 *
 * 三条硬约束（都来自该规格，不是本模块自创）：
 * - **幂等**：同一件事重复计算必须得到同一个键，否则办公室会重复建任务。
 * - **未接入就不派活**：外部数据源没配置时，只显示「未接入」，
 *   不创建监测任务，也不生成「已发送」式回执。
 * - **没有有效变化就待命**：`hasEffectiveChange === false` 时办公室什么都不做。
 *
 * 纯函数：不查库、不调模型、不抓网页。
 */

import {
  evidenceGapKey,
  type CompiledAssumption,
  type CompiledDimension,
  type CompileProductPotentialResult,
  type CompiledEvidenceGap,
} from "./potential-compiler";
import type {
  PotentialDimensionKey,
  PotentialVerdict,
  ProductPotentialAssessment,
} from "./potential-assessment";

// ---------------------------------------------------------------------------
// 数据源：字段 → 能提供它的通道
// ---------------------------------------------------------------------------

/**
 * 能提供某类事实的数据通道。用它而不是自由文本匹配，
 * 才能确定地回答「这个缺口现在有没有可用的来源」。
 */
export type SourceChannel =
  | "ecommerce"
  | "research_report"
  | "channel_policy"
  | "channel_feedback"
  | "supplier"
  | "internal"
  | "user_feedback"
  | "patent_db"
  | "compliance";

export const SOURCE_CHANNEL_LABELS: Record<SourceChannel, string> = {
  ecommerce: "电商平台公开数据",
  research_report: "行业报告",
  channel_policy: "渠道规则与费率",
  channel_feedback: "渠道试销与反馈",
  supplier: "工厂与供应链",
  internal: "公司内部资料",
  user_feedback: "用户反馈与口碑",
  patent_db: "专利检索",
  compliance: "法规与合规",
};

/**
 * 业务字段 → 数据通道。
 *
 * 放在这一层而不是 rubric 里：rubric 关心「这个维度需要哪些事实」，
 * 而「哪条通道能提供这个事实」是连接器/数据源的事，两者会各自演进。
 */
const FIELD_SOURCE_CHANNEL: Record<string, SourceChannel> = {
  salesVolume: "ecommerce",
  price: "ecommerce",
  channelPriceBand: "ecommerce",
  competitorComparison: "ecommerce",
  painPoint: "user_feedback",
  consumerPerception: "user_feedback",
  userFeedback: "user_feedback",
  targetAudience: "research_report",
  channel: "channel_policy",
  channelCommission: "channel_policy",
  channelFee: "channel_policy",
  channelFeedback: "channel_feedback",
  costQuote: "supplier",
  packagingFreight: "supplier",
  supplierConfirmation: "supplier",
  leadTime: "supplier",
  formulaOrTech: "internal",
  consumptionCycle: "internal",
  repurchaseData: "internal",
  subscriptionSignal: "internal",
  dosageForm: "internal",
  companyPolicy: "internal",
  existingCapability: "internal",
  channelOwnership: "internal",
  brandPortfolio: "internal",
  ipOrPatent: "patent_db",
  compliancePackaging: "compliance",
};

export function sourceChannelForField(
  fieldKey: string | null
): SourceChannel | null {
  if (!fieldKey) return null;
  return FIELD_SOURCE_CHANNEL[fieldKey] ?? null;
}

/**
 * 缺口的来源状态。
 * - `AVAILABLE`      来源已接入，可以自动补证
 * - `NOT_CONFIGURED` 来源存在但没接入 → **只显示未接入，不派活**
 * - `HUMAN_ONLY`     只能人工提供
 */
export type SourceStatus = "AVAILABLE" | "NOT_CONFIGURED" | "HUMAN_ONLY";

// ---------------------------------------------------------------------------
// 持续职责台账
// ---------------------------------------------------------------------------

export type StandingDutyKind =
  | "EVIDENCE_GAP"
  | "UNVERIFIED_ASSUMPTION"
  | "DIMENSION_REGRESSION";

export interface StandingDuty {
  /** 幂等键。同一件事重复计算得到同一个键。 */
  key: string;
  kind: StandingDutyKind;
  dimension: PotentialDimensionKey | null;
  gateKey: string | null;
  title: string;
  detail: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  /** 必须由人提供（工厂报价、渠道试销、负责人确认）。 */
  requiresHumanInput: boolean;
  /** 可由研究链路自动补证。 */
  canAutoResearch: boolean;
  sourceChannel: SourceChannel | null;
  sourceStatus: SourceStatus;
  /**
   * 是否真的可以派活。
   *
   * `sourceStatus === "NOT_CONFIGURED"` 时必须为 false ——
   * 外部数据源没接入就不能创建监测任务，也不得生成「已发送」式回执。
   */
  actionable: boolean;
  suggestedQuery: string;
}

export interface StandingDutiesParams {
  compiled: CompileProductPotentialResult;
  /** 已配置的数据源通道。缺省为空数组 = 什么都没接入（保守，且是诚实默认）。 */
  availableSources?: SourceChannel[];
  /** 上一轮已经存在的职责键；用于只挑出「新增」的职责。 */
  knownDutyKeys?: string[];
}

const PRIORITY_ORDER: Record<StandingDuty["priority"], number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

function resolveSourceStatus(params: {
  requiresHumanInput: boolean;
  channel: SourceChannel | null;
  available: Set<SourceChannel>;
}): SourceStatus {
  if (params.requiresHumanInput) return "HUMAN_ONLY";
  if (!params.channel) return "NOT_CONFIGURED";
  return params.available.has(params.channel) ? "AVAILABLE" : "NOT_CONFIGURED";
}

/**
 * 把编译结果摊平成办公室可以直接消费的职责清单。
 *
 * 排序只按优先级与键，保证同样的输入得到同样的顺序（否则界面上会无谓跳动）。
 */
export function buildStandingDuties(
  params: StandingDutiesParams
): StandingDuty[] {
  const available = new Set<SourceChannel>(params.availableSources ?? []);
  const duties: StandingDuty[] = [];

  for (const gap of params.compiled.gaps) {
    const channel = sourceChannelForField(gap.fieldKey);
    const sourceStatus = resolveSourceStatus({
      requiresHumanInput: gap.requiresHumanInput,
      channel,
      available,
    });
    duties.push({
      key: evidenceGapKey(gap),
      kind: "EVIDENCE_GAP",
      dimension: gap.dimension,
      gateKey: gap.gateKey,
      title: gap.missingFact,
      detail: gap.whyItMatters,
      priority: gap.priority,
      requiresHumanInput: gap.requiresHumanInput,
      canAutoResearch: gap.canAutoResearch,
      sourceChannel: channel,
      sourceStatus,
      actionable: sourceStatus === "AVAILABLE",
      suggestedQuery: gap.suggestedQuery,
    });
  }

  for (const assumption of params.compiled.assumptions) {
    const channel = sourceChannelForField(assumption.fieldKey);
    // 模板假设不可能通过补证升级，只能被真实来源替换，所以优先级低于待核验假设。
    const requiresHumanInput = assumption.basis === "TEMPLATE";
    const sourceStatus = resolveSourceStatus({
      requiresHumanInput,
      channel,
      available,
    });
    duties.push({
      key: assumption.key,
      kind: "UNVERIFIED_ASSUMPTION",
      dimension: assumption.dimension,
      gateKey: null,
      title: `待核验假设：${assumption.label}`,
      detail: assumption.whyUnverified,
      priority: assumption.basis === "HYPOTHESIS" ? "MEDIUM" : "LOW",
      requiresHumanInput,
      canAutoResearch: !requiresHumanInput,
      sourceChannel: channel,
      sourceStatus,
      actionable: sourceStatus === "AVAILABLE",
      suggestedQuery: assumption.verificationSuggestion,
    });
  }

  return duties
    .sort(
      (a, b) =>
        PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
        a.key.localeCompare(b.key)
    )
    .filter(
      (duty, index, all) =>
        all.findIndex((item) => item.key === duty.key) === index
    );
}

/** 只挑出上一轮没有的职责——办公室据此决定「要不要新建任务」。 */
export function selectNewDuties(
  duties: StandingDuty[],
  knownDutyKeys: string[] = []
): StandingDuty[] {
  const known = new Set(knownDutyKeys);
  return duties.filter((duty) => !known.has(duty.key));
}

// ---------------------------------------------------------------------------
// 新证据影响评估
// ---------------------------------------------------------------------------

export interface JudgmentSnapshot {
  verdict: PotentialVerdict;
  dimensions: CompiledDimension[];
  gaps: CompiledEvidenceGap[];
  assumptions: CompiledAssumption[];
}

export function toJudgmentSnapshot(
  compiled: CompileProductPotentialResult,
  assessment: ProductPotentialAssessment
): JudgmentSnapshot {
  return {
    verdict: assessment.verdict,
    dimensions: compiled.dimensions,
    gaps: compiled.gaps,
    assumptions: compiled.assumptions,
  };
}

export type DimensionDirection = "UP" | "DOWN" | "STATE_ONLY" | "UNCHANGED";

export interface DimensionChange {
  key: PotentialDimensionKey;
  from: { score: number | null; evidenceState: string };
  to: { score: number | null; evidenceState: string };
  direction: DimensionDirection;
}

export interface EvidenceDelta {
  /** 有没有**有效**变化。false 时办公室应当待命，不做任何事。 */
  hasEffectiveChange: boolean;
  reason: string;
  /** 本轮新增的证据 id（上一轮没见过）。 */
  newEvidenceIds: string[];
  dimensionChanges: DimensionChange[];
  closedGapKeys: string[];
  openedGapKeys: string[];
  verdictChanged: { from: PotentialVerdict; to: PotentialVerdict } | null;
}

function directionOf(
  from: { score: number | null; evidenceState: string },
  to: { score: number | null; evidenceState: string }
): DimensionDirection {
  const stateChanged = from.evidenceState !== to.evidenceState;
  const scoreChanged = from.score !== to.score;
  if (!stateChanged && !scoreChanged) return "UNCHANGED";
  if (from.score === null || to.score === null) return "STATE_ONLY";
  if (to.score > from.score) return "UP";
  if (to.score < from.score) return "DOWN";
  return "STATE_ONLY";
}

function evidenceIdSet(snapshot: JudgmentSnapshot): Set<string> {
  return new Set(
    snapshot.dimensions.flatMap((dimension) => dimension.evidenceIds)
  );
}

/**
 * 从**已落库的**评估记录重建上一轮快照，用于算「新证据影响评估」。
 *
 * 为什么能重建：维度快照里已经存了 `missingEvidence`（该维度缺哪些字段）
 * 与 `gateSnapshot`（门槛状态），两者足以还原缺口键；而 `assessEvidenceDelta`
 * 判定「有没有有效变化」只用维度、缺口与结论，不用假设台账。
 *
 * 返回 null 表示没有可用的基线（首次评估）。
 */
export function snapshotFromStoredRecord(record: {
  verdict: string;
  dimensions: unknown;
  gates: unknown;
}): JudgmentSnapshot | null {
  const rawDimensions = Array.isArray(record.dimensions) ? record.dimensions : [];
  if (rawDimensions.length === 0) return null;

  const asStrings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

  const dimensions: CompiledDimension[] = [];
  const gaps: CompiledEvidenceGap[] = [];

  for (const raw of rawDimensions) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.key !== "string") continue;
    const dimensionKey = item.key as PotentialDimensionKey;
    const missingEvidence = asStrings(item.missingEvidence);

    dimensions.push({
      key: dimensionKey,
      score: typeof item.score === "number" ? item.score : null,
      evidenceState:
        typeof item.evidenceState === "string"
          ? (item.evidenceState as CompiledDimension["evidenceState"])
          : "UNKNOWN",
      rationale: typeof item.rationale === "string" ? item.rationale : "",
      sourceRefs: asStrings(item.sourceRefs),
      evidenceIds: asStrings(item.evidenceIds),
      claimIds: asStrings(item.claimIds),
      missingEvidence,
      firewallClasses: [],
      rubricBand: null,
      inferenceOnly: false,
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
    });

    for (const fieldKey of missingEvidence) {
      gaps.push({
        dimension: dimensionKey,
        gateKey: null,
        fieldKey,
        missingFact: fieldKey,
        whyItMatters: "",
        suggestedSource: "",
        suggestedQuery: "",
        priority: "MEDIUM",
        canAutoResearch: false,
        requiresHumanInput: false,
      });
    }
  }

  for (const raw of Array.isArray(record.gates) ? record.gates : []) {
    if (!raw || typeof raw !== "object") continue;
    const gate = raw as Record<string, unknown>;
    if (gate.status !== "UNKNOWN" || typeof gate.key !== "string") continue;
    gaps.push({
      dimension: null,
      gateKey: gate.key,
      fieldKey: null,
      missingFact: typeof gate.label === "string" ? gate.label : gate.key,
      whyItMatters: "",
      suggestedSource: "",
      suggestedQuery: "",
      priority: "HIGH",
      canAutoResearch: false,
      requiresHumanInput: false,
    });
  }

  return {
    verdict: record.verdict as PotentialVerdict,
    dimensions,
    gaps,
    assumptions: [],
  };
}

/**
 * 新证据影响评估。
 *
 * `previous` 为 null 表示首次评估——首次一律算「有变化」（要交付一次），
 * 而不是待命。
 */
export function assessEvidenceDelta(
  previous: JudgmentSnapshot | null,
  current: JudgmentSnapshot
): EvidenceDelta {
  if (!previous) {
    return {
      hasEffectiveChange: true,
      reason: "首次评估，尚无基线，需要交付一次",
      newEvidenceIds: [...evidenceIdSet(current)].sort(),
      dimensionChanges: [],
      closedGapKeys: [],
      openedGapKeys: current.gaps.map(evidenceGapKey).sort(),
      verdictChanged: null,
    };
  }

  const beforeEvidence = evidenceIdSet(previous);
  const newEvidenceIds = [...evidenceIdSet(current)]
    .filter((id) => !beforeEvidence.has(id))
    .sort();

  const beforeDimensions = new Map(
    previous.dimensions.map((dimension) => [dimension.key, dimension])
  );
  const dimensionChanges: DimensionChange[] = [];
  for (const dimension of current.dimensions) {
    const before = beforeDimensions.get(dimension.key);
    if (!before) continue;
    const from = { score: before.score, evidenceState: before.evidenceState };
    const to = { score: dimension.score, evidenceState: dimension.evidenceState };
    dimensionChanges.push({
      key: dimension.key,
      from,
      to,
      direction: directionOf(from, to),
    });
  }
  const changedDimensions = dimensionChanges.filter(
    (change) => change.direction !== "UNCHANGED"
  );

  const beforeGaps = new Set(previous.gaps.map(evidenceGapKey));
  const afterGaps = new Set(current.gaps.map(evidenceGapKey));
  const closedGapKeys = [...beforeGaps].filter((key) => !afterGaps.has(key)).sort();
  const openedGapKeys = [...afterGaps].filter((key) => !beforeGaps.has(key)).sort();

  const verdictChanged =
    previous.verdict === current.verdict
      ? null
      : { from: previous.verdict, to: current.verdict };

  const hasEffectiveChange =
    changedDimensions.length > 0 ||
    closedGapKeys.length > 0 ||
    openedGapKeys.length > 0 ||
    verdictChanged !== null;

  const changeParts: string[] = [];
  if (verdictChanged) {
    changeParts.push(`结论由 ${verdictChanged.from} 变为 ${verdictChanged.to}`);
  }
  if (changedDimensions.length > 0) {
    changeParts.push(`${changedDimensions.length} 个维度发生变化`);
  }
  if (closedGapKeys.length > 0) {
    changeParts.push(`补上 ${closedGapKeys.length} 个缺口`);
  }
  if (openedGapKeys.length > 0) {
    changeParts.push(`新增 ${openedGapKeys.length} 个缺口`);
  }

  // 没有有效变化时必须给出「待命」结论，不能只报「新增 N 条证据」——
  // 那读起来像是发生了什么事，会让办公室为重复抓取白跑一轮。
  const reason =
    changeParts.length > 0
      ? changeParts.join("；")
      : newEvidenceIds.length > 0
        ? `本轮新增 ${newEvidenceIds.length} 条证据，但没有改变任何维度、缺口或结论，办公室保持待命`
        : "维度、缺口、结论与证据集合都没有变化，办公室保持待命";

  return {
    hasEffectiveChange,
    reason,
    newEvidenceIds,
    dimensionChanges,
    closedGapKeys,
    openedGapKeys,
    verdictChanged,
  };
}
