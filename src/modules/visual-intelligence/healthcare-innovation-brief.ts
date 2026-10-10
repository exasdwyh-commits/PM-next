import type { RichBlock } from "../artifacts/rich-blocks";
import type { KernGraphV1 } from "./contracts";
import type { TokenUsageRecordInput, TokenUsageSummary } from "../usage/token-usage";
import {
  TOKEN_USAGE_NOTICES,
  formatCostUsd,
  formatTokenCostLine,
  formatTokenUsageSummary,
  normalizeTokenUsageRecords,
  summarizeTokenUsage,
  toTokenUsageRecord,
} from "../usage/token-usage";
import type { ReportSection } from "./report-format";
import {
  PRODUCT_DEVELOPMENT_REPORT_FORMAT,
  buildReportSection,
  fitTextToBudget,
} from "./report-format";

/**
 * 大健康创新简报构建器（纯函数，不访问数据库、不抓网页、不凭空生成市场数字）。
 *
 * 设计目标：
 * 1. 科学证据与市场信号分级展示，FACT / INFERENCE / ASSUMPTION / UNKNOWN 不混用；
 * 2. 研发流程、合规门禁、最小验证和增长闭环串成一条可审计主线；
 * 3. 输出可直接复用现有 kern-ui rich blocks 与 KernGraphV1，做项目方案和成果展示；
 * 4. 健康宣称始终受证据与法规边界约束，本模块不提供医疗建议或法律意见；
 * 5. 报告不止复述输入：在证据与市场信号之上，给出产品分析、成本结构、销售机制、
 *    风险登记册与分阶段营销策略，所有金额与市场数字一律待填写、不臆造；
 * 6. 报告遵循开品报告标准格式（report-format.ts）：摘要先行、字数预算内收敛，
 *    并可按公开参考价统计每次模型调用的 token 用量与估算成本（usage/token-usage.ts）。
 */

export type InnovationBasis = "FACT" | "INFERENCE" | "ASSUMPTION" | "UNKNOWN";
export type EvidenceLevel = "A" | "B" | "C" | "D";
export type SourceTrust = "user" | "internal" | "external" | "model";
export type InnovationImpact = "HIGH" | "MEDIUM" | "LOW";
export type InnovationRecommendation =
  | "PROCEED_TO_VALIDATE"
  | "NEEDS_EVIDENCE"
  | "PAUSE"
  | "REJECT";
export type ComplianceGate = "HOLD" | "READY_FOR_REVIEW";
export type ReadinessState = "READY_FOR_VALIDATION" | "NEEDS_EVIDENCE";

export interface InnovationSource {
  id: string;
  title: string;
  url?: string | null;
  trust: SourceTrust;
  retrievedAt?: string | null;
  note?: string | null;
}

export interface InnovationClaimInput {
  id?: string;
  claim: string;
  basis: InnovationBasis;
  evidenceLevel?: EvidenceLevel | null;
  sourceIds?: string[];
  population?: string | null;
  limitations?: string[];
}

export interface MarketSignalInput {
  id?: string;
  segment: string;
  need: string;
  channel?: string | null;
  priceBand?: string | null;
  competitor?: string | null;
  proof: string;
  basis: InnovationBasis;
  sourceIds?: string[];
}

export interface InnovationRiskInput {
  risk: string;
  impact: InnovationImpact;
  mitigation?: string | null;
  basis?: InnovationBasis;
}

export interface HealthcareInnovationInput {
  id?: string;
  idea: string;
  category?: string | null;
  region?: string | null;
  targetUser: string;
  desiredOutcome: string;
  constraints?: string[];
  sources?: InnovationSource[];
  evidence?: InnovationClaimInput[];
  marketSignals?: MarketSignalInput[];
  risks?: InnovationRiskInput[];
  unknowns?: string[];
  regulatoryConfirmed?: boolean;
  stopRequested?: boolean;
  /** 每次模型调用的 token 用量记录（可选；用于报告「Token 与成本统计」章节） */
  tokenUsage?: TokenUsageRecordInput[] | null;
}

export interface NormalizedInnovationClaim {
  id: string;
  claim: string;
  basis: InnovationBasis;
  evidenceLevel: EvidenceLevel | null;
  sourceIds: string[];
  population: string | null;
  limitations: string[];
}

export interface NormalizedMarketSignal {
  id: string;
  segment: string;
  need: string;
  channel: string | null;
  priceBand: string | null;
  competitor: string | null;
  proof: string;
  basis: InnovationBasis;
  sourceIds: string[];
}

export interface NormalizedInnovationRisk {
  risk: string;
  impact: InnovationImpact;
  mitigation: string | null;
  basis: InnovationBasis;
}

export interface EvidenceReadiness {
  state: ReadinessState;
  /** 内部优先级分，不等于功效强度或市场规模。 */
  score: number;
  verifiedCount: number;
  strongEvidenceCount: number;
  inferenceCount: number;
  assumptionCount: number;
  unknownCount: number;
  limitedEvidenceCount: number;
  missing: string[];
  summary: string;
}

export interface MarketReadiness {
  state: ReadinessState;
  /** 内部优先级分，不等于市场规模。 */
  score: number;
  verifiedCount: number;
  inferenceCount: number;
  assumptionCount: number;
  coverageDimensions: string[];
  missing: string[];
  summary: string;
}

export interface InnovationStage {
  id: string;
  name: string;
  objective: string;
  entryCriteria: string[];
  deliverables: string[];
  exitCriteria: string[];
  ownerRole: string;
  dependsOn: string[];
  stopConditions: string[];
}

export interface GrowthLoopStage {
  key: "ACQUISITION" | "ACTIVATION" | "RETENTION" | "REVENUE" | "REFERRAL";
  label: string;
  objective: string;
  metric: string;
  guardrail: string;
  experiment: string;
  dataNeeded: string;
}

export interface MarketingPrinciple {
  key: string;
  principle: string;
  practice: string;
  antiPattern: string;
}

export interface ProductAnalysis {
  /** 一句话定位（含目标人群、类目与核心诉求） */
  positioning: string;
  /** 价值主张；证据不足时明确指出表达须降级 */
  valueProposition: string;
  /** 差异化方向（整体为推断，须经最小市场验证确认） */
  differentiation: string[];
  /** 使用场景（基于人群与期望结果推导，待访谈确认） */
  useScenarios: string[];
  /** 明确不做什么（来自约束与合规边界） */
  nonGoals: string[];
  summary: string;
}

export interface CostCategory {
  key: string;
  label: string;
  /** 需要调用方补充的具体内容（报价、政策、费用等） */
  placeholders: string;
  /** 该类成本的口径或公式提示 */
  formula: string;
}

export interface CostStructure {
  categories: CostCategory[];
  /** 单位毛利公式 */
  unitEconomics: string;
  /** 回本周期公式 */
  breakEven: string;
  /** 定价与验证预算前必须补齐的输入 */
  missingInputs: string[];
  summary: string;
}

export interface ChannelOption {
  channel: string;
  /** 适合条件 */
  fitWhen: string;
  pros: string[];
  cons: string[];
  /** 合规提示（广告、资质、宣称边界） */
  complianceNotes: string[];
  /** 最小验证方式 */
  verification: string;
  basis: InnovationBasis;
}

export type RiskCategory =
  | "证据"
  | "合规"
  | "市场"
  | "供应"
  | "财务"
  | "隐私伦理"
  | "声誉"
  | "运营";

export interface RiskAssessmentRow {
  risk: string;
  category: RiskCategory;
  likelihood: InnovationImpact;
  impact: InnovationImpact;
  mitigation: string;
  /** 负责角色 */
  owner: string;
  /** 可观测的触发信号（用于及早止损） */
  trigger: string;
  basis: InnovationBasis;
}

export interface MarketingTactic {
  /** 与 growthLoop 的阶段 label 对齐 */
  stage: string;
  tactic: string;
  /** 依据的营销原则 */
  rationale: string;
  metric: string;
  guardrail: string;
  basis: InnovationBasis;
}

export interface HealthcareInnovationBrief {
  id: string;
  idea: string;
  category: string;
  region: string;
  targetUser: string;
  desiredOutcome: string;
  constraints: string[];
  recommendation: InnovationRecommendation;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  complianceGate: ComplianceGate;
  evidenceReadiness: EvidenceReadiness;
  marketReadiness: MarketReadiness;
  stagePlan: InnovationStage[];
  growthLoop: GrowthLoopStage[];
  marketingPrinciples: MarketingPrinciple[];
  risks: NormalizedInnovationRisk[];
  unknowns: string[];
  nextActions: string[];
  against: string[];
  sources: InnovationSource[];
  claims: NormalizedInnovationClaim[];
  marketSignals: NormalizedMarketSignal[];
  notices: string[];
  /** 产品分析：定位、价值主张、差异化、场景与不做什么 */
  productAnalysis: ProductAnalysis;
  /** 成本结构：六类列支与单位经济/回本公式（金额一律待填写） */
  costStructure: CostStructure;
  /** 销售机制与渠道建议（推断，须经最小市场验证确认） */
  salesMechanism: ChannelOption[];
  /** 风险登记册：类别、可能性、影响、缓解、负责人与触发信号 */
  riskRegister: RiskAssessmentRow[];
  /** 分阶段营销策略（与增长闭环阶段对齐） */
  marketingStrategy: MarketingTactic[];
  /** 开品报告标准格式章节（摘要先行 + 字数预算内详细层） */
  reportSections: ReportSection[];
  /** 执行摘要层（可独立阅读，字数受预算约束） */
  executiveSummary: string;
  /** 模型调用 token 用量与估算成本；未提供用量时为 null */
  tokenUsage: TokenUsageSummary | null;
}

const BASIS_SET: ReadonlySet<string> = new Set([
  "FACT",
  "INFERENCE",
  "ASSUMPTION",
  "UNKNOWN",
]);
const TRUST_SET: ReadonlySet<string> = new Set([
  "user",
  "internal",
  "external",
  "model",
]);
const LEVEL_SET: ReadonlySet<string> = new Set(["A", "B", "C", "D"]);
const IMPACT_SET: ReadonlySet<string> = new Set(["HIGH", "MEDIUM", "LOW"]);
const BLOCKING_CLAIM_RE =
  /(包治|包好|保证治愈|根治|治疗|治愈|诊断|处方|药品|药物|疾病|癌症|肿瘤|医疗器械)/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(message);
}

function cleanText(value: unknown, label: string, max = 200): string {
  if (typeof value !== "string") fail(`${label} 必须是字符串`);
  const text = value.trim().slice(0, max);
  if (!text) fail(`${label} 不能为空`);
  return text;
}

function cleanOptionalText(
  value: unknown,
  label: string,
  max = 200,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") fail(`${label} 必须是字符串`);
  const text = value.trim().slice(0, max);
  return text || null;
}

function cleanStringArray(
  value: unknown,
  label: string,
  maxItems: number,
  max = 200,
): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(`${label} 必须是数组`);
  if (value.length > maxItems) fail(`${label} 不能超过 ${maxItems} 条`);
  const out: string[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string") fail(`${label} 第 ${index + 1} 项必须是字符串`);
    const text = item.trim().slice(0, max);
    if (!text) fail(`${label} 第 ${index + 1} 项不能为空`);
    if (!out.includes(text)) out.push(text);
  }
  return out;
}

function cleanBasis(value: unknown, label: string): InnovationBasis {
  const basis = cleanText(value, label, 20).toUpperCase();
  if (!BASIS_SET.has(basis)) {
    fail(`${label} 必须是 FACT / INFERENCE / ASSUMPTION / UNKNOWN`);
  }
  return basis as InnovationBasis;
}

function cleanImpact(value: unknown, label: string): InnovationImpact {
  const impact = cleanText(value, label, 20).toUpperCase();
  if (!IMPACT_SET.has(impact)) fail(`${label} 必须是 HIGH / MEDIUM / LOW`);
  return impact as InnovationImpact;
}

function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 2246822507);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizeSources(value: unknown): InnovationSource[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail("sources 必须是数组");
  if (value.length > 12) fail("sources 不能超过 12 条");
  const ids = new Set<string>();
  const out: InnovationSource[] = [];
  for (const [index, raw] of value.entries()) {
    if (!isRecord(raw)) fail(`来源第 ${index + 1} 项必须是对象`);
    const id = cleanText(raw.id, `来源第 ${index + 1} 项的 id`, 80);
    if (ids.has(id)) fail(`来源 id 重复：${id}`);
    ids.add(id);
    const title = cleanText(raw.title, `来源「${id}」的标题`, 160);
    const trustRaw = cleanText(raw.trust, `来源「${id}」的信任等级`, 20);
    if (!TRUST_SET.has(trustRaw)) {
      fail(`来源「${id}」的信任等级必须是 user / internal / external / model`);
    }
    const url = cleanOptionalText(raw.url, `来源「${id}」的链接`, 500);
    if (url && !/^https?:\/\//i.test(url)) {
      fail(`来源「${id}」的链接必须是 http(s) 地址`);
    }
    const retrievedAt = cleanOptionalText(
      raw.retrievedAt,
      `来源「${id}」的采集时间`,
      40,
    );
    if (retrievedAt && !/^\d{4}-\d{2}-\d{2}/.test(retrievedAt)) {
      fail(`来源「${id}」的采集时间必须是 YYYY-MM-DD 或 ISO 时间`);
    }
    const note = cleanOptionalText(raw.note, `来源「${id}」的备注`, 200);
    out.push({
      id,
      title,
      url,
      trust: trustRaw as SourceTrust,
      retrievedAt,
      note,
    });
  }
  return out;
}

function normalizeClaims(
  value: unknown,
  sourceIds: ReadonlySet<string>,
): NormalizedInnovationClaim[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail("evidence 必须是数组");
  if (value.length > 20) fail("evidence 不能超过 20 条");
  return value.map((raw, index) => {
    if (!isRecord(raw)) fail(`证据第 ${index + 1} 项必须是对象`);
    const label = `证据第 ${index + 1} 项`;
    const claim = cleanText(raw.claim, `${label}的内容`, 300);
    const basis = cleanBasis(raw.basis, `${label}的等级`);
    const sourceList = cleanStringArray(
      raw.sourceIds,
      `${label}的来源`,
      6,
      80,
    );
    if (basis === "FACT" && sourceList.length === 0) {
      fail(`${label}标记为 FACT，必须提供至少一个来源`);
    }
    for (const sourceId of sourceList) {
      if (!sourceIds.has(sourceId)) {
        fail(`${label}引用了未提供的来源：${sourceId}`);
      }
    }
    let evidenceLevel: EvidenceLevel | null = null;
    if (raw.evidenceLevel !== undefined && raw.evidenceLevel !== null) {
      const level = cleanText(raw.evidenceLevel, `${label}的证据级别`, 10).toUpperCase();
      if (!LEVEL_SET.has(level)) fail(`${label}的证据级别必须是 A / B / C / D`);
      evidenceLevel = level as EvidenceLevel;
    }
    return {
      id: cleanOptionalText(raw.id, `${label}的 id`, 80) ?? `claim-${index + 1}`,
      claim,
      basis,
      evidenceLevel,
      sourceIds: sourceList,
      population: cleanOptionalText(raw.population, `${label}的人群`, 120),
      limitations: cleanStringArray(raw.limitations, `${label}的限制`, 8, 120),
    };
  });
}

function normalizeMarketSignals(
  value: unknown,
  sourceIds: ReadonlySet<string>,
): NormalizedMarketSignal[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail("marketSignals 必须是数组");
  if (value.length > 20) fail("marketSignals 不能超过 20 条");
  return value.map((raw, index) => {
    if (!isRecord(raw)) fail(`市场信号第 ${index + 1} 项必须是对象`);
    const label = `市场信号第 ${index + 1} 项`;
    const segment = cleanText(raw.segment, `${label}的人群`, 120);
    const need = cleanText(raw.need, `${label}的需求`, 200);
    const proof = cleanText(raw.proof, `${label}的验证方式或资料`, 200);
    const basis = cleanBasis(raw.basis, `${label}的等级`);
    const sourceList = cleanStringArray(
      raw.sourceIds,
      `${label}的来源`,
      6,
      80,
    );
    if (basis === "FACT" && sourceList.length === 0) {
      fail(`${label}标记为 FACT，必须提供至少一个来源`);
    }
    for (const sourceId of sourceList) {
      if (!sourceIds.has(sourceId)) {
        fail(`${label}引用了未提供的来源：${sourceId}`);
      }
    }
    return {
      id:
        cleanOptionalText(raw.id, `${label}的 id`, 80) ?? `signal-${index + 1}`,
      segment,
      need,
      channel: cleanOptionalText(raw.channel, `${label}的渠道`, 120),
      priceBand: cleanOptionalText(raw.priceBand, `${label}的价格带`, 80),
      competitor: cleanOptionalText(raw.competitor, `${label}的竞品`, 120),
      proof,
      basis,
      sourceIds: sourceList,
    };
  });
}

function normalizeRisks(value: unknown): NormalizedInnovationRisk[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail("risks 必须是数组");
  if (value.length > 12) fail("risks 不能超过 12 条");
  return value.map((raw, index) => {
    if (!isRecord(raw)) fail(`风险第 ${index + 1} 项必须是对象`);
    const label = `风险第 ${index + 1} 项`;
    return {
      risk: cleanText(raw.risk, `${label}的描述`, 200),
      impact: cleanImpact(raw.impact, `${label}的影响`),
      mitigation: cleanOptionalText(raw.mitigation, `${label}的缓解措施`, 200),
      basis: raw.basis === undefined ? "INFERENCE" : cleanBasis(raw.basis, `${label}的等级`),
    };
  });
}

function assessEvidence(claims: NormalizedInnovationClaim[]): EvidenceReadiness {
  const verified = claims.filter((claim) => claim.basis === "FACT");
  const strong = verified.filter(
    (claim) => claim.evidenceLevel === "A" || claim.evidenceLevel === "B",
  );
  const inference = claims.filter((claim) => claim.basis === "INFERENCE");
  const assumption = claims.filter((claim) => claim.basis === "ASSUMPTION");
  const unknown = claims.filter((claim) => claim.basis === "UNKNOWN");
  const limited = claims.filter((claim) => claim.limitations.length > 0);
  const score = Math.min(
    100,
    strong.length * 35 + verified.length * 10 + inference.length * 8 + assumption.length * 3,
  );
  const missing: string[] = [];
  if (strong.length < 2) {
    missing.push("至少 2 条 A/B 级可追溯证据，或 1 条针对成品的人体研究证据");
  }
  if (limited.length > 0) {
    missing.push("补充研究限制、人群匹配、剂量与使用条件说明");
  }
  if (unknown.length > 0) {
    missing.push("把未知证据项改写为可验证问题");
  }
  if (verified.length === 0) missing.push("补充可追溯证据来源");
  return {
    state: strong.length >= 2 ? "READY_FOR_VALIDATION" : "NEEDS_EVIDENCE",
    score,
    verifiedCount: verified.length,
    strongEvidenceCount: strong.length,
    inferenceCount: inference.length,
    assumptionCount: assumption.length,
    unknownCount: unknown.length,
    limitedEvidenceCount: limited.length,
    missing,
    summary: `A/B 级证据 ${strong.length} 条；已核实 ${verified.length} 条；推断 ${inference.length} 条；假设 ${assumption.length} 条；未知 ${unknown.length} 条。`,
  };
}

function assessMarket(signals: NormalizedMarketSignal[]): MarketReadiness {
  const verified = signals.filter((signal) => signal.basis === "FACT");
  const inference = signals.filter((signal) => signal.basis === "INFERENCE");
  const assumption = signals.filter((signal) => signal.basis === "ASSUMPTION");
  const dimensions: Array<{ key: string; label: string; present: boolean }> = [
    { key: "segment", label: "人群", present: signals.some((signal) => signal.segment) },
    { key: "need", label: "需求", present: signals.some((signal) => signal.need) },
    { key: "channel", label: "渠道", present: signals.some((signal) => signal.channel) },
    { key: "priceBand", label: "价格带", present: signals.some((signal) => signal.priceBand) },
    { key: "competitor", label: "竞品", present: signals.some((signal) => signal.competitor) },
    { key: "proof", label: "验证方式", present: signals.some((signal) => signal.proof) },
  ];
  const coverage = dimensions.filter((dimension) => dimension.present).length;
  const score = Math.min(
    100,
    verified.length * 30 +
      inference.length * 10 +
      assumption.length * 5 +
      Math.max(0, coverage - 2) * 5,
  );
  const missing: string[] = [];
  if (verified.length < 2) missing.push("至少 2 条可追溯市场信号");
  for (const dimension of dimensions) {
    if (!dimension.present) missing.push(`补充${dimension.label}验证`);
  }
  return {
    state: verified.length >= 2 && coverage >= 5 ? "READY_FOR_VALIDATION" : "NEEDS_EVIDENCE",
    score,
    verifiedCount: verified.length,
    inferenceCount: inference.length,
    assumptionCount: assumption.length,
    coverageDimensions: dimensions
      .filter((dimension) => dimension.present)
      .map((dimension) => dimension.label),
    missing,
    summary: `已核实市场信号 ${verified.length} 条；推断 ${inference.length} 条；假设 ${assumption.length} 条；覆盖维度 ${coverage}/6。`,
  };
}

function buildStagePlan(): InnovationStage[] {
  const stages: Array<Omit<InnovationStage, "dependsOn">> = [
    {
      id: "discover",
      name: "机会识别",
      objective: "把用户问题、健康场景和商业机会收敛成一个可验证假设。",
      entryCriteria: ["有明确的目标人群", "有一句话产品想法", "知道要解决什么健康场景"],
      deliverables: ["机会假设卡", "目标人群与场景", "首轮反证问题"],
      exitCriteria: ["假设可被验证", "不与法规红线直接冲突", "负责人确认值得继续"],
      ownerRole: "产品负责人",
      stopConditions: ["只是追热点但没有真实用户问题", "机会依赖无法核验的功效承诺"],
    },
    {
      id: "evidence-review",
      name: "证据审查",
      objective: "梳理原料证据、成品证据、人群证据与证据缺口，形成证据等级。",
      entryCriteria: ["已识别核心成分或核心机制", "已收集可追溯来源"],
      deliverables: ["证据清单", "证据等级与限制", "宣称边界"],
      exitCriteria: ["每句功效表达都能对应证据等级", "缺口进入待办", "冲突证据并列展示"],
      ownerRole: "证据研究员",
      stopConditions: ["用动物/体外研究冒充人体结论", "隐藏反证或资助偏倚"],
    },
    {
      id: "user-insight",
      name: "用户洞察",
      objective: "验证目标人群、使用场景、购买动机、顾虑和替代方案。",
      entryCriteria: ["有初步人群假设", "有可接触的用户或渠道专家"],
      deliverables: ["用户访谈纪要", "场景与痛点", "支付意愿与顾虑"],
      exitCriteria: ["至少一轮真实用户反馈", "需求优先级明确", "隐私与伦理边界已识别"],
      ownerRole: "用户研究员",
      stopConditions: ["只听内部判断，没有真实用户证据", "收集健康数据但未做最小化与授权"],
    },
    {
      id: "product-definition",
      name: "产品定义",
      objective: "形成产品定位、剂型规格、核心卖点、价格带和不做什么。",
      entryCriteria: ["证据边界清楚", "用户需求已排序", "法规类目初步判断"],
      deliverables: ["产品定义卡", "卖点与禁用宣称清单", "目标价格与成本红线"],
      exitCriteria: ["定位与证据能力匹配", "卖点可解释、可验证", "不做清单外承诺"],
      ownerRole: "产品负责人",
      stopConditions: ["用疾病治疗承诺换取短期转化", "价格与价值明显脱节"],
    },
    {
      id: "technical-feasibility",
      name: "技术与供应验证",
      objective: "确认配方、工艺、稳定性、供应链和成本是否可落地。",
      entryCriteria: ["产品定义已冻结", "有候选原料或代工方案"],
      deliverables: ["配方与工艺方案", "供应商与成本报价", "样品测试计划"],
      exitCriteria: ["关键工艺可重复", "成本在目标区间", "供应风险有替代方案"],
      ownerRole: "研发与供应链负责人",
      stopConditions: ["核心原料无稳定供应", "工艺放大后关键指标失控"],
    },
    {
      id: "compliance-gate",
      name: "合规门禁",
      objective: "完成类目判断、注册/备案路径、标签审核与广告审查准备。",
      entryCriteria: ["产品定义与卖点清单已冻结", "目标市场明确"],
      deliverables: ["法规路径评估", "标签与包装审核", "广告宣称白名单与黑名单"],
      exitCriteria: ["法规负责人确认路径", "对外表达全部通过审查", "生产经营资质路径明确"],
      ownerRole: "法规与合规负责人",
      stopConditions: ["需要医疗器械/药品路径但团队不具备条件", "广告内容未经审查"],
    },
    {
      id: "market-validation",
      name: "最小市场验证",
      objective: "用最小成本验证真实需求、转化、留存、复购和渠道可行性。",
      entryCriteria: ["合规边界已确认", "有可投放的小规模样品或内容"],
      deliverables: ["验证实验设计", "渠道小规模投放结果", "留存、复购与退款数据"],
      exitCriteria: ["样本与观察窗口满足预设要求", "目标指标达到预设阈值", "风险指标未触发停止线"],
      ownerRole: "增长与渠道负责人",
      stopConditions: ["转化依赖虚假承诺", "退款或投诉异常升高", "渠道履约不可持续"],
    },
    {
      id: "growth-loop",
      name: "增长与迭代",
      objective: "把验证有效的产品放大，并持续用数据驱动产品、内容和渠道迭代。",
      entryCriteria: ["最小验证通过", "增长指标与 guardrail 已定义"],
      deliverables: ["增长漏斗看板", "内容与渠道实验记录", "产品迭代决策"],
      exitCriteria: ["获客、激活、留存、收入、推荐形成闭环", "每次投放都能复盘", "高风险动作有熔断机制"],
      ownerRole: "增长负责人与治理委员会",
      stopConditions: ["指标改善来自刷单或夸大宣传", "合规风险超过收益"],
    },
  ];
  return stages.map((stage, index) => ({
    ...stage,
    dependsOn: index === 0 ? [] : [stages[index - 1].id],
  }));
}

function buildGrowthLoop(): GrowthLoopStage[] {
  return [
    {
      key: "ACQUISITION",
      label: "获客",
      objective: "让目标人群低成本看到产品，并产生可追踪的兴趣。",
      metric: "有效触达成本、渠道线索成本、内容点击率",
      guardrail: "不得夸大功效；投放素材先过广告审查",
      experiment: "同一卖点在两个渠道投放，比较点击质量与线索成本",
      dataNeeded: "渠道、人群、曝光、点击、线索、成本、素材版本",
    },
    {
      key: "ACTIVATION",
      label: "首次价值",
      objective: "让新用户快速理解价值并完成第一次正向体验。",
      metric: "首单转化率、到店核销率、试用完成率、首次反馈率",
      guardrail: "不做虚假承诺，不隐藏使用门槛与风险",
      experiment: "比较免费试用、内容教育、老客推荐等不同激活利益点",
      dataNeeded: "曝光人群、激活动作、转化、首次体验评价、客服问题",
    },
    {
      key: "RETENTION",
      label: "留存复购",
      objective: "验证产品是否持续解决问题，并形成复购与订阅。",
      metric: "30/60/90 日留存、复购率、订阅续费率、活跃频次",
      guardrail: "不刷单、不诱导囤货、不隐瞒退款与副作用",
      experiment: "比较会员权益、场景提醒、订阅装与组合装",
      dataNeeded: "用户分层、复购周期、退款、客诉、产品使用记录",
    },
    {
      key: "REVENUE",
      label: "收入与利润",
      objective: "确认价格、成本、渠道费用和回本周期是否健康。",
      metric: "客单价、毛利率、渠道费用率、回本周期、现金流",
      guardrail: "价格不得与证据价值脱节；不透支渠道利润",
      experiment: "测试定价梯度、组合销售与促销节奏",
      dataNeeded: "订单、退款、履约成本、渠道佣金、广告成本、库存周转",
    },
    {
      key: "REFERRAL",
      label: "口碑推荐",
      objective: "让真实价值驱动传播，形成可持续的信任资产。",
      metric: "推荐率、裂变转化率、UGC 采纳率、社区复访率",
      guardrail: "不得诱导虚假好评或制造恐惧营销",
      experiment: "测试老客推荐激励、内容共创与专家科普合作",
      dataNeeded: "推荐链路、转化、内容质量、客服反馈、舆情风险",
    },
  ];
}

function buildMarketingPrinciples(): MarketingPrinciple[] {
  return [
    {
      key: "evidence-first",
      principle: "证据先于表达",
      practice: "每句功效表达绑定证据等级、来源与适用边界。",
      antiPattern: "把原料研究包装成成品结论，或隐藏反证。",
    },
    {
      key: "segment-scenario",
      principle: "人群场景驱动",
      practice: "先定义人群、场景、动机、顾虑和替代方案。",
      antiPattern: "一套通用话术投所有人群。",
    },
    {
      key: "channel-fit",
      principle: "渠道匹配价值",
      practice: "让内容、价格、佣金、履约与渠道能力匹配。",
      antiPattern: "盲目铺货或高佣金透支长期利润。",
    },
    {
      key: "lifecycle",
      principle: "全生命周期运营",
      practice: "按获客、激活、留存、收入、推荐分段设计动作。",
      antiPattern: "只看拉新，不看留存、复购与售后体验。",
    },
    {
      key: "compliance",
      principle: "合规是增长底线",
      practice: "发布前完成广告审查、标签审核与宣称边界确认。",
      antiPattern: "先投放后补证据，或用恐惧刺激转化。",
    },
    {
      key: "measurement",
      principle: "可测量、可复盘",
      practice: "每个动作绑定指标、观察窗口、样本要求与停止条件。",
      antiPattern: "凭感觉优化，且数据口径前后不一。",
    },
    {
      key: "trust",
      principle: "信任资产优先",
      practice: "公开证据、退换规则、客服路径与风险提示。",
      antiPattern: "用夸大案例、虚假认证或制造焦虑换取短期订单。",
    },
  ];
}

function dedupeStrings(values: string[], max = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = value.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function buildRisks(input: {
  risks: NormalizedInnovationRisk[];
  evidence: EvidenceReadiness;
  market: MarketReadiness;
  complianceGate: ComplianceGate;
}): NormalizedInnovationRisk[] {
  const derived: NormalizedInnovationRisk[] = [];
  if (input.complianceGate === "HOLD") {
    derived.push({
      risk: "法规与广告宣称边界未确认",
      impact: "HIGH",
      mitigation: "先完成产品类目、备案/注册路径与广告审查",
      basis: "FACT",
    });
  }
  if (input.evidence.strongEvidenceCount < 2) {
    derived.push({
      risk: "科学证据不足或不匹配成品场景",
      impact: "HIGH",
      mitigation: "补做成品研究、人群研究或调整宣称",
      basis: "INFERENCE",
    });
  }
  if (input.market.verifiedCount < 2) {
    derived.push({
      risk: "市场信号缺少可追溯验证",
      impact: "MEDIUM",
      mitigation: "补充渠道、人群、竞品与支付意愿验证",
      basis: "INFERENCE",
    });
  }
  derived.push({
    risk: "健康人群数据可能涉及隐私与伦理风险",
    impact: "MEDIUM",
    mitigation: "最小化采集、取得授权、匿名化处理并保留删除路径",
    basis: "ASSUMPTION",
  });
  const all = [...input.risks, ...derived];
  const seen = new Set<string>();
  const out: NormalizedInnovationRisk[] = [];
  for (const risk of all) {
    if (seen.has(risk.risk)) continue;
    seen.add(risk.risk);
    out.push(risk);
    if (out.length >= 12) break;
  }
  return out;
}

function buildUnknowns(input: {
  unknowns: string[];
  evidence: EvidenceReadiness;
  market: MarketReadiness;
  complianceGate: ComplianceGate;
  sources: InnovationSource[];
}): string[] {
  const derived = [...input.unknowns];
  if (input.evidence.strongEvidenceCount < 2) {
    derived.push("成品人体证据、剂量范围与长期使用边界");
  }
  if (input.market.verifiedCount < 2) {
    derived.push("目标人群支付意愿、渠道转化与竞品替代成本");
  }
  if (input.complianceGate === "HOLD") {
    derived.push("适用类目、备案/注册路径与广告宣称边界");
  }
  if (input.sources.length === 0) derived.push("可追溯证据来源");
  derived.push("最小验证指标、样本量与观察窗口");
  return dedupeStrings(derived, 12);
}

function buildNextActions(recommendation: InnovationRecommendation): string[] {
  if (recommendation === "PROCEED_TO_VALIDATE") {
    return [
      "设计最小可行验证实验：目标、指标、样本、窗口与停止条件",
      "完成法规路径与广告宣称审查",
      "小规模投放后复盘留存、复购、退款与客诉",
    ];
  }
  if (recommendation === "PAUSE") {
    return [
      "暂停对外表达、投放与样品承诺",
      "移除或降级高风险宣称",
      "补充证据、法规与伦理审查后再评估",
    ];
  }
  if (recommendation === "REJECT") {
    return [
      "记录否决原因与关键反证",
      "归档当前假设与证据缺口",
      "重新定义用户问题与产品机会",
    ];
  }
  return [
    "补齐证据：至少两条可追溯 A/B 级或成品研究证据",
    "补齐市场验证：人群、渠道、价格带与竞品信号",
    "确认法规路径与广告宣称边界",
  ];
}

function recommendationLabel(recommendation: InnovationRecommendation): string {
  switch (recommendation) {
    case "PROCEED_TO_VALIDATE":
      return "进入受控验证";
    case "NEEDS_EVIDENCE":
      return "先补证据与市场验证";
    case "PAUSE":
      return "暂停对外推进";
    case "REJECT":
      return "否决当前方向";
  }
}

function stateLabel(state: ReadinessState): string {
  return state === "READY_FOR_VALIDATION" ? "可进入验证" : "需要补证";
}

function complianceLabel(gate: ComplianceGate): string {
  return gate === "READY_FOR_REVIEW" ? "可进入人工法规审查" : "待确认";
}

const COST_CATEGORIES: CostCategory[] = [
  {
    key: "rnd",
    label: "研发与打样",
    placeholders: "配方开发、打样、感官与稳定性测试费用",
    formula: "按项目一次性投入填写",
  },
  {
    key: "material",
    label: "原料与生产代工",
    placeholders: "原料采购、代工费、最低起订量对应的单位成本",
    formula: "计入单位完全成本",
  },
  {
    key: "testing",
    label: "检测认证与备案",
    placeholders: "第三方检测、备案/注册费用与周期",
    formula: "按产品类目路径填写",
  },
  {
    key: "packaging",
    label: "包装与仓储物流",
    placeholders: "包材、仓储、履约配送费用",
    formula: "计入单位完全成本",
  },
  {
    key: "channel",
    label: "渠道佣金与营销",
    placeholders: "渠道佣金率、广告投放、内容制作费用",
    formula: "渠道费用率 = 渠道费用 ÷ 销售收入",
  },
  {
    key: "compliance",
    label: "合规与客服储备",
    placeholders: "广告审查、标签审核、客服与退款储备",
    formula: "建议按销售收入比例预留",
  },
];

function buildCostStructure(): CostStructure {
  return {
    categories: COST_CATEGORIES,
    unitEconomics: "单位毛利 = 零售价 − 单位完全成本（原料 + 代工 + 包材 + 物流 + 渠道佣金 + 营销分摊）",
    breakEven: "回本周期 = 固定投入（研发 + 检测 + 备案等一次性费用）÷ 月度毛利",
    missingInputs: ["零售价与价格带确认", "供应商与代工报价", "检测与备案费用报价", "渠道佣金政策", "广告与内容预算"],
    summary: "成本分六类列支，金额全部待填写；先用单位毛利与回本周期两条公式约束产品定义。",
  };
}

const CHANNEL_LIBRARY: Array<Omit<ChannelOption, "basis">> = [
  {
    channel: "私域社群与内容电商",
    fitWhen: "客单价中等、可沉淀人群、能持续产出合规内容",
    pros: ["触达精准", "可积累信任资产", "适合最小验证"],
    cons: ["规模有限", "依赖内容持续产出"],
    complianceNotes: ["内容须先过广告审查", "保健食品须标明本品不能代替药物", "不得疾病预防/治疗宣称"],
    verification: "小规模种草并私域成交，记录转化与复购",
  },
  {
    channel: "平台电商",
    fitWhen: "价格带清晰、可承担平台费用、有评价运营能力",
    pros: ["流量大", "评价可沉淀"],
    cons: ["平台扣点高", "退货率敏感"],
    complianceNotes: ["详情页宣称须先过广告审查", "不得刷单与虚假好评"],
    verification: "小规模投放链接，观察点击-收藏-加购-成交漏斗",
  },
  {
    channel: "药店与商超终端",
    fitWhen: "法规路径清晰、有线下铺货与动销能力",
    pros: ["信任度高", "覆盖家庭采购人群"],
    cons: ["进场费高", "账期长"],
    complianceNotes: ["经营资质路径须确认（预包装食品备案或食品经营许可）", "标签与说明书须审核"],
    verification: "先谈一两家门店做陈列测试，不压货不进量",
  },
  {
    channel: "经销代理",
    fitWhen: "有区域资源、能承担压货与回款",
    pros: ["可快速覆盖区域"],
    cons: ["价格体系难控", "串货与低价风险"],
    complianceNotes: ["经销商广告物料须统一审核", "不得授权超范围宣称"],
    verification: "签区域试销协议，约定退货与价格红线",
  },
];

function buildSalesMechanism(input: {
  marketSignals: NormalizedMarketSignal[];
}): ChannelOption[] {
  const mentioned = dedupeStrings(
    input.marketSignals
      .map((signal) => signal.channel)
      .filter((channel): channel is string => Boolean(channel)),
    4,
  );
  const scored = CHANNEL_LIBRARY.map((option) => {
    const hit = mentioned.findIndex(
      (channel) => option.channel.includes(channel) || channel.includes(option.channel),
    );
    return { option, score: hit >= 0 ? 100 - hit : 0 };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map(({ option }) => ({ ...option, basis: "INFERENCE" as const }));
}

function classifyRiskCategory(risk: string): RiskCategory {
  if (/法规|广告|宣称|合规|备案|注册|许可|标签/.test(risk)) return "合规";
  if (/证据|功效|研究|科学|临床/.test(risk)) return "证据";
  if (/市场|渠道|竞品|转化|留存|复购|投放/.test(risk)) return "市场";
  if (/隐私|伦理|授权|匿名/.test(risk)) return "隐私伦理";
  if (/成本|价格|毛利|回本|资金|财务|现金流/.test(risk)) return "财务";
  if (/供应|原料|工艺|代工|稳定性/.test(risk)) return "供应";
  if (/声誉|口碑|投诉|舆情|信任/.test(risk)) return "声誉";
  return "运营";
}

const RISK_OWNER_BY_CATEGORY: Record<RiskCategory, string> = {
  证据: "证据研究员",
  合规: "法规与合规负责人",
  市场: "增长与渠道负责人",
  供应: "研发与供应链负责人",
  财务: "产品负责人与财务",
  隐私伦理: "法规与合规负责人",
  声誉: "增长负责人",
  运营: "项目负责人",
};

const RISK_TRIGGER_BY_CATEGORY: Record<RiskCategory, string> = {
  证据: "出现无法溯源或与成品不匹配的功效宣称",
  合规: "对外物料未通过广告审查时立即停投",
  市场: "小规模验证的转化、留存低于预设阈值",
  供应: "核心原料断供或工艺放大后指标失控",
  财务: "定价会议上无法给出单位毛利与回本测算",
  隐私伦理: "健康数据采集未做最小化与授权",
  声誉: "退款率或客诉率异常升高",
  运营: "里程碑连续延期且无止损动作",
};

function buildRiskRegister(input: {
  risks: NormalizedInnovationRisk[];
  evidence: EvidenceReadiness;
  market: MarketReadiness;
  complianceGate: ComplianceGate;
}): RiskAssessmentRow[] {
  const rows: RiskAssessmentRow[] = [];
  const push = (
    risk: string,
    impact: InnovationImpact,
    mitigation: string,
    likelihood: InnovationImpact,
    basis: InnovationBasis,
  ) => {
    const category = classifyRiskCategory(risk);
    rows.push({
      risk,
      category,
      likelihood,
      impact,
      mitigation,
      owner: RISK_OWNER_BY_CATEGORY[category],
      trigger: RISK_TRIGGER_BY_CATEGORY[category],
      basis,
    });
  };
  if (input.complianceGate === "HOLD") {
    push("法规与广告宣称边界未确认", "HIGH", "先完成产品类目、备案/注册路径与广告审查", "HIGH", "FACT");
  }
  if (input.evidence.strongEvidenceCount < 2) {
    push("科学证据不足或不匹配成品场景", "HIGH", "补做成品研究、人群研究或调整宣称", "HIGH", "INFERENCE");
  }
  if (input.market.verifiedCount < 2) {
    push("市场信号缺少可追溯验证", "MEDIUM", "补充渠道、人群、竞品与支付意愿验证", "MEDIUM", "INFERENCE");
  }
  push(
    "成本结构未填写，单位毛利与回本周期无法测算",
    "HIGH",
    "先完成六类成本列支与供应商报价，再做定价与验证预算",
    "HIGH",
    "FACT",
  );
  push(
    "健康人群数据可能涉及隐私与伦理风险",
    "MEDIUM",
    "最小化采集、取得授权、匿名化处理并保留删除路径",
    "MEDIUM",
    "ASSUMPTION",
  );
  for (const risk of input.risks) {
    push(risk.risk, risk.impact, risk.mitigation ?? "待补充缓解措施", "MEDIUM", risk.basis);
  }
  const seen = new Set<string>();
  const out: RiskAssessmentRow[] = [];
  for (const row of rows) {
    if (seen.has(row.risk)) continue;
    seen.add(row.risk);
    out.push(row);
    if (out.length >= 10) break;
  }
  return out;
}

function buildMarketingStrategy(growthLoop: GrowthLoopStage[]): MarketingTactic[] {
  const tacticByStage: Record<string, { tactic: string; rationale: string }> = {
    获客: { tactic: "以证据科普内容切入目标人群痛点，同一卖点分渠道投放并比较线索成本", rationale: "证据先于表达 + 可测量复盘" },
    首次价值: { tactic: "提供清晰的首次使用指引与可感知价值，降低首次决策门槛", rationale: "人群场景驱动" },
    留存复购: { tactic: "按使用场景设计会员权益与订阅/复购提醒", rationale: "全生命周期运营" },
    收入与利润: { tactic: "测试定价梯度、组合销售与促销节奏，关注毛利而非单量", rationale: "可测量、可复盘" },
    口碑推荐: { tactic: "鼓励老客分享真实体验，配合专家科普共创内容", rationale: "信任资产优先" },
  };
  return growthLoop.map((stage) => ({
    stage: stage.label,
    tactic: tacticByStage[stage.label]?.tactic ?? stage.experiment,
    rationale: tacticByStage[stage.label]?.rationale ?? "渠道匹配价值",
    metric: stage.metric,
    guardrail: stage.guardrail,
    basis: "INFERENCE" as const,
  }));
}

function buildProductAnalysis(input: {
  idea: string;
  category: string;
  targetUser: string;
  desiredOutcome: string;
  constraints: string[];
  claims: NormalizedInnovationClaim[];
  marketSignals: NormalizedMarketSignal[];
}): ProductAnalysis {
  const strongClaims = input.claims.filter(
    (claim) => claim.basis === "FACT" && (claim.evidenceLevel === "A" || claim.evidenceLevel === "B"),
  );
  const positioning = `面向${input.targetUser}的${input.category}产品：「${input.idea}」，期望达成「${input.desiredOutcome}」。`;
  const valueProposition =
    strongClaims.length > 0
      ? `价值主张：以「${strongClaims[0].claim}」为证据支撑（${strongClaims[0].evidenceLevel ?? "未分级"}级），服务「${input.desiredOutcome}」；表达边界以证据等级为准。`
      : `价值主张：围绕「${input.desiredOutcome}」构建；当前缺少 A/B 级成品证据，功效表达须先降级或暂停。`;
  const competitors = dedupeStrings(
    input.marketSignals
      .map((signal) => signal.competitor)
      .filter((competitor): competitor is string => Boolean(competitor)),
    3,
  );
  const differentiation: string[] = [];
  if (strongClaims.length > 0) {
    differentiation.push(`证据可解释的卖点：「${strongClaims[0].claim}」，须配合适用人群与边界表达`);
  }
  for (const competitor of competitors) {
    differentiation.push(`与竞品「${competitor}」的差异化方向待用户洞察与渠道验证确认`);
  }
  differentiation.push("以上差异化均为推断（INFERENCE），须经最小市场验证确认");
  const useScenarios = [
    `场景：${input.targetUser}在日常健康管理中需要「${input.desiredOutcome}」；使用频次与剂量待产品定义确认`,
    "更多真实场景待用户访谈补充，当前场景为假设（ASSUMPTION）",
  ];
  const nonGoals = dedupeStrings(
    [
      ...input.constraints,
      "不做疾病预防、治疗类表达",
      "不做未经证据支撑的功效承诺",
      "不虚构市场规模与销量数字",
    ],
    4,
  );
  return {
    positioning,
    valueProposition,
    differentiation: differentiation.slice(0, 4),
    useScenarios,
    nonGoals,
    summary: fitTextToBudget(positioning, 100),
  };
}

interface ReportBuildContext {
  idea: string;
  targetUser: string;
  desiredOutcome: string;
  complianceGate: ComplianceGate;
  evidenceReadiness: EvidenceReadiness;
  marketReadiness: MarketReadiness;
  stagePlan: InnovationStage[];
  growthLoop: GrowthLoopStage[];
  riskRegister: RiskAssessmentRow[];
  unknowns: string[];
  against: string[];
  sources: InnovationSource[];
  claims: NormalizedInnovationClaim[];
  notices: string[];
  productAnalysis: ProductAnalysis;
  costStructure: CostStructure;
  salesMechanism: ChannelOption[];
  marketingStrategy: MarketingTactic[];
  tokenUsage: TokenUsageSummary | null;
}

function buildReportSections(ctx: ReportBuildContext): ReportSection[] {
  const specOf = (id: string) => {
    const spec = PRODUCT_DEVELOPMENT_REPORT_FORMAT.sections.find((item) => item.id === id);
    if (!spec) fail(`报告格式缺少章节：${id}`);
    return spec;
  };
  const impactZh = (impact: InnovationImpact) => ({ HIGH: "高", MEDIUM: "中", LOW: "低" }[impact]);
  const { productAnalysis, costStructure, marketReadiness, evidenceReadiness } = ctx;

  const sections: ReportSection[] = [];

  sections.push(
    buildReportSection(
      specOf("opportunity"),
      `机会：「${ctx.idea}」；目标人群 ${ctx.targetUser}；市场信号已核实 ${marketReadiness.verifiedCount} 条。`,
      [
        `期望结果：${ctx.desiredOutcome}。`,
        `市场验证覆盖：${marketReadiness.coverageDimensions.join("、") || "暂无"}；缺口：${marketReadiness.missing.slice(0, 2).join("；") || "无"}。`,
        "本节不含市场规模与销量估算，数字仅来自输入信号。",
      ],
    ),
  );

  sections.push(
    buildReportSection(specOf("positioning"), productAnalysis.summary, [
      productAnalysis.valueProposition,
      ...productAnalysis.useScenarios.slice(0, 2),
      `不做什么：${productAnalysis.nonGoals.join("；")}。`,
    ]),
  );

  sections.push(
    buildReportSection(
      specOf("competition"),
      `差异化：${productAnalysis.differentiation[0] ?? "待验证"}。`,
      productAnalysis.differentiation.length > 0
        ? productAnalysis.differentiation.slice(0, 3)
        : ["暂无竞品信号，差异化待用户洞察确认。"],
    ),
  );

  sections.push(
    buildReportSection(specOf("cost-structure"), costStructure.summary, [
      ...costStructure.categories.map((category) => `${category.label}：待填写（${category.placeholders}）；${category.formula}。`),
      `单位经济：${costStructure.unitEconomics}。`,
      `回本测算：${costStructure.breakEven}。`,
    ]),
  );

  sections.push(
    buildReportSection(
      specOf("sales-mechanism"),
      ctx.salesMechanism.length > 0
        ? `建议先从「${ctx.salesMechanism[0].channel}」做最小验证；渠道佣金与履约能力待商务确认。`
        : "暂无渠道建议，先补充市场信号。",
      ctx.salesMechanism.map(
        (channel) =>
          `${channel.channel}：适合「${channel.fitWhen}」；优势${channel.pros.slice(0, 2).join("、")}；注意${channel.cons.slice(0, 2).join("、")}；合规${channel.complianceNotes[0] ?? "待确认"}；先做「${channel.verification}」。`,
      ),
    ),
  );

  sections.push(
    buildReportSection(
      specOf("risk-assessment"),
      `共 ${ctx.riskRegister.length} 项风险，高影响 ${ctx.riskRegister.filter((row) => row.impact === "HIGH").length} 项；首要风险：${ctx.riskRegister[0]?.risk ?? "暂无"}。`,
      ctx.riskRegister.slice(0, 5).map(
        (row) =>
          `${row.risk}（${row.category}；可能性${impactZh(row.likelihood)}、影响${impactZh(row.impact)}）：${row.mitigation}；负责人：${row.owner}；触发信号：${row.trigger}。`,
      ),
    ),
  );

  sections.push(
    buildReportSection(
      specOf("marketing-strategy"),
      `按${ctx.marketingStrategy.map((tactic) => tactic.stage).join("、")}分阶段推进，每阶段绑定指标与合规 guardrail。`,
      ctx.marketingStrategy.map(
        (tactic) => `${tactic.stage}：${tactic.tactic}；指标：${tactic.metric}；guardrail：${tactic.guardrail}。`,
      ),
    ),
  );

  sections.push(
    buildReportSection(
      specOf("compliance"),
      `合规门禁：${complianceLabel(ctx.complianceGate)}；当前不宜：${ctx.against[0] ?? "无"}。`,
      [
        ...ctx.against.slice(0, 2).map((item) => `不宜：${item}。`),
        "门禁为 READY_FOR_REVIEW 仅表示可进入人工审查，不代表已批准上市。",
      ],
    ),
  );

  sections.push(
    buildReportSection(
      specOf("roadmap"),
      `共 ${ctx.stagePlan.length} 个阶段串行推进：${ctx.stagePlan.map((stage) => stage.name).join("、")}。`,
      ctx.stagePlan.slice(0, 6).map(
        (stage) =>
          `${stage.name}：交付「${stage.deliverables[0] ?? stage.objective}」；停止条件：${stage.stopConditions[0] ?? "待定义"}。`,
      ),
    ),
  );

  sections.push(
    buildReportSection(
      specOf("growth"),
      `增长闭环覆盖：${ctx.growthLoop.map((stage) => stage.label).join("、")}。`,
      ctx.growthLoop.map((stage) => `${stage.label}：指标 ${stage.metric}；guardrail ${stage.guardrail}。`),
    ),
  );

  sections.push(
    buildReportSection(
      specOf("token-cost"),
      ctx.tokenUsage ? formatTokenCostLine(ctx.tokenUsage) : "未提供模型用量数据，成本统计暂缺。",
      ctx.tokenUsage
        ? formatTokenUsageSummary(ctx.tokenUsage).slice(0, 4)
        : [
            "在输入中补充 tokenUsage（模型、输入/输出 token 数）后，可自动生成调用次数、用量与估算成本。",
            ...TOKEN_USAGE_NOTICES.slice(0, 1),
          ],
    ),
  );

  sections.push(
    buildReportSection(
      specOf("appendix"),
      `证据 ${ctx.claims.length} 条（A/B 级 ${evidenceReadiness.strongEvidenceCount} 条）；未知项 ${ctx.unknowns.length} 条；来源 ${ctx.sources.length} 个。`,
      [
        ...ctx.unknowns.slice(0, 3).map((item) => `未知：${item}。`),
        `边界：${ctx.notices[0]}`,
      ],
    ),
  );

  return sections;
}

function buildBriefExecutiveSummary(input: {
  recommendation: InnovationRecommendation;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  evidence: EvidenceReadiness;
  market: MarketReadiness;
  complianceGate: ComplianceGate;
  tokenUsage: TokenUsageSummary | null;
}): string {
  const confidenceZh = { HIGH: "高", MEDIUM: "中", LOW: "低" }[input.confidence];
  const parts = [
    `建议：${recommendationLabel(input.recommendation)}（置信度${confidenceZh}）。`,
    `证据准备度 ${input.evidence.score}/100（${stateLabel(input.evidence.state)}），市场准备度 ${input.market.score}/100（${stateLabel(input.market.state)}），合规门禁：${complianceLabel(input.complianceGate)}。`,
    `关键缺口：${[...input.evidence.missing, ...input.market.missing].slice(0, 2).join("；") || "暂无关键缺口"}。`,
  ];
  if (input.tokenUsage) parts.push(formatTokenCostLine(input.tokenUsage));
  return fitTextToBudget(parts.join(""), PRODUCT_DEVELOPMENT_REPORT_FORMAT.summaryLayerMaxChars);
}

export function buildHealthcareInnovationBrief(
  input: HealthcareInnovationInput,
): HealthcareInnovationBrief {
  if (!isRecord(input)) fail("创新输入必须是对象");
  const idea = cleanText(input.idea, "创新想法", 120);
  const targetUser = cleanText(input.targetUser, "目标人群", 120);
  const desiredOutcome = cleanText(input.desiredOutcome, "期望结果", 200);
  const category = cleanOptionalText(input.category, "产品类目", 80) ?? "大健康";
  const region = cleanOptionalText(input.region, "目标市场", 80) ?? "中国大陆";
  const constraints = cleanStringArray(input.constraints, "约束条件", 12, 160);
  const sources = normalizeSources(input.sources);
  const sourceIdSet = new Set(sources.map((source) => source.id));
  const claims = normalizeClaims(input.evidence, sourceIdSet);
  const marketSignals = normalizeMarketSignals(input.marketSignals, sourceIdSet);
  const risksInput = normalizeRisks(input.risks);
  const unknownsInput = cleanStringArray(input.unknowns, "未知事项", 12, 200);
  const regulatoryConfirmed = input.regulatoryConfirmed === true;
  const stopRequested = input.stopRequested === true;

  const evidenceReadiness = assessEvidence(claims);
  const marketReadiness = assessMarket(marketSignals);
  const complianceGate: ComplianceGate = regulatoryConfirmed
    ? "READY_FOR_REVIEW"
    : "HOLD";
  const blockingClaims = claims.filter((claim) => BLOCKING_CLAIM_RE.test(claim.claim));
  const recommendation: InnovationRecommendation = stopRequested
    ? "REJECT"
    : blockingClaims.length > 0
      ? "PAUSE"
      : evidenceReadiness.state === "READY_FOR_VALIDATION" &&
          marketReadiness.state === "READY_FOR_VALIDATION"
        ? "PROCEED_TO_VALIDATE"
        : "NEEDS_EVIDENCE";
  const confidence: "HIGH" | "MEDIUM" | "LOW" =
    recommendation === "PAUSE" || recommendation === "REJECT"
      ? "HIGH"
      : recommendation === "PROCEED_TO_VALIDATE"
        ? regulatoryConfirmed && evidenceReadiness.strongEvidenceCount >= 2 && marketReadiness.verifiedCount >= 2
          ? "HIGH"
          : "MEDIUM"
        : evidenceReadiness.verifiedCount +
                evidenceReadiness.inferenceCount +
                marketReadiness.verifiedCount +
                marketReadiness.inferenceCount >
            0
          ? "MEDIUM"
          : "LOW";

  const against: string[] = [];
  if (complianceGate === "HOLD") against.push("对外广告投放与功效表达");
  if (evidenceReadiness.state !== "READY_FOR_VALIDATION") {
    against.push("把原料或机制研究包装成成品结论");
  }
  if (marketReadiness.state !== "READY_FOR_VALIDATION") {
    against.push("未经渠道验证的规模化投放");
  }
  if (blockingClaims.length > 0) against.push("高风险疾病或治疗表达");
  if (against.length === 0) against.push("未经真实投放验证的规模化扩张");

  const risks = buildRisks({
    risks: risksInput,
    evidence: evidenceReadiness,
    market: marketReadiness,
    complianceGate,
  });
  const unknowns = buildUnknowns({
    unknowns: unknownsInput,
    evidence: evidenceReadiness,
    market: marketReadiness,
    complianceGate,
    sources,
  });
  const id = cleanOptionalText(input.id, "创新简报 id", 80) ?? `innovation-${hashText(idea)}`;

  const tokenUsageRecords = normalizeTokenUsageRecords(input.tokenUsage).map((record) =>
    toTokenUsageRecord(record),
  );
  const tokenUsage = tokenUsageRecords.length > 0 ? summarizeTokenUsage(tokenUsageRecords) : null;
  const productAnalysis = buildProductAnalysis({
    idea,
    category,
    targetUser,
    desiredOutcome,
    constraints,
    claims,
    marketSignals,
  });
  const costStructure = buildCostStructure();
  const salesMechanism = buildSalesMechanism({ marketSignals });
  const riskRegister = buildRiskRegister({
    risks: risksInput,
    evidence: evidenceReadiness,
    market: marketReadiness,
    complianceGate,
  });
  const stagePlan = buildStagePlan();
  const growthLoop = buildGrowthLoop();
  const marketingStrategy = buildMarketingStrategy(growthLoop);
  const notices = [
    "本简报用于研发优先级排序与方案讨论，不构成医疗建议、法律意见或上市批准。",
    "健康功效表达必须绑定证据等级、来源与法规边界。",
    "准备度评分仅用于内部排序，不等于市场规模或功效结论。",
  ];
  const reportSections = buildReportSections({
    idea,
    targetUser,
    desiredOutcome,
    complianceGate,
    evidenceReadiness,
    marketReadiness,
    stagePlan,
    growthLoop,
    riskRegister,
    unknowns,
    against,
    sources,
    claims,
    notices,
    productAnalysis,
    costStructure,
    salesMechanism,
    marketingStrategy,
    tokenUsage,
  });
  const executiveSummary = buildBriefExecutiveSummary({
    recommendation,
    confidence,
    evidence: evidenceReadiness,
    market: marketReadiness,
    complianceGate,
    tokenUsage,
  });

  return {
    id,
    idea,
    category,
    region,
    targetUser,
    desiredOutcome,
    constraints,
    recommendation,
    confidence,
    complianceGate,
    evidenceReadiness,
    marketReadiness,
    stagePlan,
    growthLoop,
    marketingPrinciples: buildMarketingPrinciples(),
    risks,
    unknowns,
    nextActions: buildNextActions(recommendation),
    against,
    sources,
    claims,
    marketSignals,
    notices,
    productAnalysis,
    costStructure,
    salesMechanism,
    riskRegister,
    marketingStrategy,
    reportSections,
    executiveSummary,
    tokenUsage,
  };
}

function toRichBasis(basis: InnovationBasis): "fact" | "inference" | "assumption" | "unknown" {
  return basis.toLowerCase() as "fact" | "inference" | "assumption" | "unknown";
}

function impactLabel(impact: InnovationImpact): string {
  return { HIGH: "高", MEDIUM: "中", LOW: "低" }[impact];
}

function nextActionLabel(action: string): string {
  if (action.includes("证据")) return "补齐证据";
  if (action.includes("市场验证")) return "补齐市场验证";
  if (action.includes("法规")) return "确认法规边界";
  if (action.includes("实验")) return "设计验证实验";
  if (action.includes("投放")) return "小规模投放";
  if (action.includes("暂停")) return "暂停对外推进";
  if (action.includes("否决") || action.includes("归档")) return "归档并重启";
  return "下一步推进";
}

export function buildHealthcareInnovationRichBlocks(
  brief: HealthcareInnovationBrief,
): RichBlock[] {
  const blocks: RichBlock[] = [];
  blocks.push({
    type: "decision",
    title: "创新建议",
    headline: `${recommendationLabel(brief.recommendation)}：${brief.idea}`,
    confidence: brief.confidence,
    recommend: brief.nextActions.slice(0, 3),
    against: brief.against.slice(0, 4),
    risks: brief.risks.slice(0, 3).map((risk) => risk.risk),
  });
  blocks.push({
    type: "metrics",
    title: "准备度",
    items: [
      {
        label: "证据准备度",
        value: `${brief.evidenceReadiness.score} / 100`,
        note: stateLabel(brief.evidenceReadiness.state),
        basis: "inference",
      },
      {
        label: "市场准备度",
        value: `${brief.marketReadiness.score} / 100`,
        note: stateLabel(brief.marketReadiness.state),
        basis: "inference",
      },
      {
        label: "合规门禁",
        value: complianceLabel(brief.complianceGate),
        basis: "fact",
      },
      {
        label: "强证据数",
        value: String(brief.evidenceReadiness.strongEvidenceCount),
        basis: brief.evidenceReadiness.strongEvidenceCount > 0 ? "fact" : "unknown",
      },
    ],
  });
  blocks.push({
    type: "timeline",
    title: "研发与验证流程",
    items: brief.stagePlan.map((stage) => ({
      when: "待排期",
      phase: stage.name,
      deliverable: stage.deliverables[0] ?? stage.objective,
      status: "todo" as const,
    })),
  });
  const validateOption = {
    name: "进入受控验证",
    tagline: "先完成法规审查，再做最小市场验证",
    pros: ["风险前置", "用真实数据决定是否放大"],
    cons: ["不能直接规模化投放"],
    pick: brief.recommendation === "PROCEED_TO_VALIDATE",
  };
  const evidenceOption = {
    name: "补证据后再评估",
    tagline: "先补科学、市场与法规缺口",
    pros: ["降低返工与合规风险"],
    cons: ["短期推进速度较慢"],
    pick: brief.recommendation === "NEEDS_EVIDENCE",
  };
  blocks.push({
    type: "compare",
    title: "推进策略",
    options: [validateOption, evidenceOption],
    criteria: [
      {
        label: "科学证据",
        values: [stateLabel(brief.evidenceReadiness.state), stateLabel(brief.evidenceReadiness.state)],
      },
      {
        label: "市场验证",
        values: [stateLabel(brief.marketReadiness.state), stateLabel(brief.marketReadiness.state)],
      },
      { label: "合规边界", values: [complianceLabel(brief.complianceGate), complianceLabel(brief.complianceGate)] },
      { label: "时间成本", values: ["先验证后放大", "先补证据后验证"] },
    ],
  });
  blocks.push({
    type: "risks",
    title: "关键风险",
    items: brief.risks.slice(0, 8).map((risk) => ({
      risk: risk.risk,
      impact: risk.impact.toLowerCase() as "high" | "medium" | "low",
      ...(risk.mitigation ? { mitigation: risk.mitigation } : {}),
      basis: toRichBasis(risk.basis),
    })),
  });
  if (brief.sources.length > 0) {
    blocks.push({
      type: "sources",
      title: "证据与来源",
      items: brief.sources.map((source, index) => ({
        n: index + 1,
        title: source.title,
        ...(source.url ? { url: source.url } : {}),
        trust: source.trust,
        ...(source.note ? { note: source.note } : {}),
      })),
    });
  }
  blocks.push({
    type: "unknown",
    title: "仍需确认",
    items: brief.unknowns.slice(0, 8).map((question) => ({
      question,
      needs: "补充可追溯资料或负责人确认",
    })),
  });
  blocks.push({
    type: "next",
    title: "下一步",
    items: brief.nextActions.slice(0, 3).map((action) => ({
      label: nextActionLabel(action),
      prompt: action,
    })),
  });
  const keypoints: Array<{ kind: "fact" | "inference" | "unknown"; text: string }> = [
    { kind: "fact", text: `机会：${brief.idea}` },
    { kind: "fact", text: `目标人群：${brief.targetUser}` },
    { kind: "fact", text: `期望结果：${brief.desiredOutcome}` },
  ];
  for (const claim of brief.claims.slice(0, 7)) {
    keypoints.push({
      kind: claim.basis === "FACT" ? "fact" : claim.basis === "UNKNOWN" ? "unknown" : "inference",
      text: claim.claim,
    });
    if (keypoints.length >= 10) break;
  }
  blocks.push({ type: "keypoints", title: "关键事实与推断", items: keypoints });
  blocks.push({
    type: "table",
    title: "成本结构（金额待填写）",
    caption: "六类列支；金额全部待填写，本报告不估算具体数字",
    cols: [{ label: "成本类目" }, { label: "待填写内容" }, { label: "口径" }],
    rows: brief.costStructure.categories.map((category) => ({
      cells: [category.label, category.placeholders, category.formula],
    })),
  });
  blocks.push({
    type: "table",
    title: "单位经济与回本",
    cols: [{ label: "项目" }, { label: "说明" }],
    rows: [
      { cells: ["单位毛利", brief.costStructure.unitEconomics], pick: true },
      { cells: ["回本周期", brief.costStructure.breakEven] },
      { cells: ["待补输入", brief.costStructure.missingInputs.join("；")] },
    ],
  });
  blocks.push({
    type: "table",
    title: "销售机制与渠道建议",
    caption: "渠道建议为推断（INFERENCE），须经最小市场验证确认",
    cols: [{ label: "渠道" }, { label: "适合条件" }, { label: "优势" }, { label: "注意" }, { label: "合规提示" }],
    rows: brief.salesMechanism.map((channel) => ({
      cells: [
        channel.channel,
        channel.fitWhen,
        channel.pros.slice(0, 2).join("、"),
        channel.cons.slice(0, 2).join("、"),
        channel.complianceNotes.slice(0, 2).join("；"),
      ],
    })),
  });
  blocks.push({
    type: "table",
    title: "风险评估矩阵",
    cols: [{ label: "风险" }, { label: "可能性" }, { label: "影响" }, { label: "缓解措施" }, { label: "负责人" }],
    rows: brief.riskRegister.slice(0, 8).map((row) => ({
      cells: [row.risk, impactLabel(row.likelihood), impactLabel(row.impact), row.mitigation, row.owner],
    })),
  });
  blocks.push({
    type: "table",
    title: "营销策略（分阶段）",
    cols: [{ label: "阶段" }, { label: "动作" }, { label: "指标" }, { label: "Guardrail" }],
    rows: brief.marketingStrategy.map((tactic) => ({
      cells: [tactic.stage, tactic.tactic, tactic.metric, tactic.guardrail],
    })),
  });
  if (brief.tokenUsage) {
    const tokenSummary = brief.tokenUsage;
    blocks.push({
      type: "metrics",
      title: "Token 与成本统计",
      items: [
        { label: "模型调用", value: `${tokenSummary.calls} 次`, basis: "fact" },
        { label: "总 tokens", value: tokenSummary.totalTokens.toLocaleString("en-US"), basis: "fact" },
        {
          label: "输入 / 输出",
          value: `${tokenSummary.totalInputTokens.toLocaleString("en-US")} / ${tokenSummary.totalOutputTokens.toLocaleString("en-US")}`,
          basis: "fact",
        },
        {
          label: "预估成本",
          value:
            tokenSummary.estimatedCostUsd !== null
              ? formatCostUsd(tokenSummary.estimatedCostUsd)
              : `${formatCostUsd(tokenSummary.knownCostUsd)}+`,
          note:
            tokenSummary.unknownPricingCalls > 0
              ? "部分模型定价未知；公开参考价，以账单为准"
              : "公开参考价，以账单为准",
          basis: "inference",
        },
      ],
    });
  }
  blocks.push({
    type: "callout",
    tone: brief.complianceGate === "HOLD" ? "warn" : "info",
    title: "边界",
    body: brief.notices[0],
  });
  return blocks;
}

function blockFence(block: RichBlock): string {
  return ["```kern-ui", JSON.stringify(block), "```"].join("\n");
}

export function buildHealthcareInnovationReply(
  brief: HealthcareInnovationBrief,
): string {
  const blocks = buildHealthcareInnovationRichBlocks(brief);
  const recommendationSentence = (() => {
    switch (brief.recommendation) {
      case "PROCEED_TO_VALIDATE":
        return "先完成法规审查，再设计最小验证实验，不直接规模化投放。";
      case "NEEDS_EVIDENCE":
        return "当前证据或市场信号不足，先补齐关键缺口，不急于打样和投放。";
      case "PAUSE":
        return "存在高风险宣称或阻断条件，暂停对外表达与投放。";
      case "REJECT":
        return "当前方向不建议继续推进，先归档原因并重新定义机会。";
    }
  })();
  const renderSection = (id: string): string => {
    const section = brief.reportSections.find((item) => item.id === id);
    if (!section) return "";
    return [
      `### ${section.title}`,
      section.summary,
      ...section.details.map((detail) => `- ${detail}`),
    ].join("\n");
  };
  const renderGroup = (title: string, ids: string[]): string =>
    [`## ${title}`, ...ids.map(renderSection)].filter(Boolean).join("\n\n");
  const parts: string[] = [
    `结论：${recommendationSentence}`,
    `证据准备度 ${brief.evidenceReadiness.score}/100（${stateLabel(brief.evidenceReadiness.state)}），市场准备度 ${brief.marketReadiness.score}/100（${stateLabel(brief.marketReadiness.state)}），合规门禁：${complianceLabel(brief.complianceGate)}。`,
    "## 执行摘要",
    brief.executiveSummary,
    ...(brief.tokenUsage
      ? []
      : ["- 模型成本：未提供 token 用量数据，暂无法估算；在输入中补充 tokenUsage 后自动生成。"]),
    renderGroup("产品分析", ["opportunity", "positioning", "competition"]),
    renderGroup("成本与销售机制", ["cost-structure", "sales-mechanism"]),
    renderGroup("风险评估", ["risk-assessment"]),
    [
      "## 研发流程",
      brief.stagePlan
        .map((stage, index) => `${index + 1}. **${stage.name}**：${stage.objective}`)
        .join("\n"),
    ].join("\n"),
    renderGroup("增长与营销", ["growth", "marketing-strategy"]),
    [
      "### 营销原则",
      brief.marketingPrinciples
        .map((principle) => `- **${principle.principle}**：${principle.practice}`)
        .join("\n"),
    ].join("\n"),
    renderGroup("合规边界", ["compliance"]),
    ...(brief.tokenUsage ? [renderGroup("Token 与成本统计", ["token-cost"])] : []),
    renderGroup("附录：证据、未知与下一步", ["appendix"]),
    [
      "### 下一步",
      ...brief.nextActions.map((action, index) => `${index + 1}. ${action}`),
    ].join("\n"),
  ];
  let markdown = parts.filter(Boolean).join("\n\n");
  if (markdown.length > PRODUCT_DEVELOPMENT_REPORT_FORMAT.maxBodyChars) {
    markdown = `${fitTextToBudget(markdown, PRODUCT_DEVELOPMENT_REPORT_FORMAT.maxBodyChars)}\n\n> 报告正文超出字数预算，已按句边界收敛；完整结构化内容见简报字段与下方 kern-ui 块。`;
  }
  return [markdown, ...blocks.map(blockFence)].join("\n\n");
}

export function buildHealthcareInnovationGraph(
  brief: HealthcareInnovationBrief,
): KernGraphV1 {
  const readinessTruth = (readiness: { state: ReadinessState; verifiedCount: number; inferenceCount: number }) =>
    readiness.state === "READY_FOR_VALIDATION"
      ? ("VERIFIED" as const)
      : readiness.verifiedCount > 0 || readiness.inferenceCount > 0
        ? ("INFERRED" as const)
        : ("UNKNOWN" as const);
  const evidenceTruth = readinessTruth({
    state: brief.evidenceReadiness.state,
    verifiedCount: brief.evidenceReadiness.verifiedCount,
    inferenceCount: brief.evidenceReadiness.inferenceCount,
  });
  const marketTruth = readinessTruth({
    state: brief.marketReadiness.state,
    verifiedCount: brief.marketReadiness.verifiedCount,
    inferenceCount: brief.marketReadiness.inferenceCount,
  });
  const complianceTruth: "INFERRED" | "UNKNOWN" =
    brief.complianceGate === "READY_FOR_REVIEW" ? "INFERRED" : "UNKNOWN";
  const nodes: KernGraphV1["nodes"] = [
    {
      id: "opportunity",
      type: "OPPORTUNITY",
      label: "机会假设",
      detail: brief.idea,
      layer: 0,
      truth: "INFERRED",
      metadata: { category: brief.category, targetUser: brief.targetUser },
    },
    {
      id: "evidence",
      type: "EVIDENCE",
      label: "科学证据",
      detail: brief.evidenceReadiness.summary,
      layer: 1,
      truth: evidenceTruth,
      metadata: {
        score: brief.evidenceReadiness.score,
        strongEvidenceCount: brief.evidenceReadiness.strongEvidenceCount,
      },
    },
    {
      id: "market",
      type: "MARKET_SIGNAL",
      label: "市场信号",
      detail: brief.marketReadiness.summary,
      layer: 1,
      truth: marketTruth,
      metadata: {
        score: brief.marketReadiness.score,
        verifiedCount: brief.marketReadiness.verifiedCount,
      },
    },
    {
      id: "product",
      type: "PRODUCT_DEFINITION",
      label: "产品定义",
      detail: `${brief.targetUser} -> ${brief.desiredOutcome}`,
      layer: 2,
      truth: "INFERRED",
    },
    {
      id: "compliance",
      type: "COMPLIANCE_GATE",
      label: "合规门禁",
      detail: `状态：${complianceLabel(brief.complianceGate)}；不代表已批准上市。`,
      layer: 3,
      truth: complianceTruth,
    },
    {
      id: "validation",
      type: "VALIDATION",
      label: "最小验证",
      detail: "用真实渠道、留存、复购、退款与客诉验证产品价值。",
      layer: 4,
      truth: "INFERRED",
    },
    {
      id: "growth",
      type: "GROWTH",
      label: "增长闭环",
      detail: "获客、激活、留存、收入与推荐持续复盘。",
      layer: 5,
      truth: "INFERRED",
    },
    {
      id: "decision",
      type: "DECISION",
      label: "当前建议",
      detail: recommendationLabel(brief.recommendation),
      layer: 6,
      truth: "INFERRED",
      metadata: { confidence: brief.confidence },
    },
  ];
  const edges: KernGraphV1["edges"] = [
    { id: "e-opportunity-evidence", from: "opportunity", to: "evidence", relation: "requires_evidence", label: "需要证据支撑", truth: evidenceTruth },
    { id: "e-opportunity-market", from: "opportunity", to: "market", relation: "requires_market_signal", label: "需要市场验证", truth: marketTruth },
    { id: "e-evidence-product", from: "evidence", to: "product", relation: "constrains_definition", label: "约束产品定义", truth: evidenceTruth },
    { id: "e-market-product", from: "market", to: "product", relation: "constrains_positioning", label: "约束产品定位", truth: marketTruth },
    { id: "e-product-compliance", from: "product", to: "compliance", relation: "enters_review", label: "进入合规审查", truth: "INFERRED" },
    { id: "e-evidence-validation", from: "evidence", to: "validation", relation: "defines_metrics", label: "设计验证指标", truth: evidenceTruth },
    { id: "e-market-validation", from: "market", to: "validation", relation: "selects_channel", label: "选择验证渠道", truth: marketTruth },
    { id: "e-compliance-validation", from: "compliance", to: "validation", relation: "gates_experiment", label: "放行受控实验", truth: complianceTruth },
    { id: "e-validation-growth", from: "validation", to: "growth", relation: "scales_on_evidence", label: "验证通过后放大", truth: "INFERRED" },
    { id: "e-opportunity-decision", from: "opportunity", to: "decision", relation: "summarizes_to", label: "汇总为建议", truth: "INFERRED" },
  ];
  return {
    version: "kern-graph/v1",
    id: brief.id,
    title: `大健康创新流程：${brief.idea}`.slice(0, 80),
    summary: `${recommendationLabel(brief.recommendation)}；证据准备度 ${brief.evidenceReadiness.score}，市场准备度 ${brief.marketReadiness.score}。`,
    view: "EXECUTION",
    subject: { kind: "healthcare-innovation", label: brief.idea.slice(0, 80) },
    generator: "DETERMINISTIC",
    nodes,
    edges,
    notices: brief.notices.slice(0, 3),
  };
}

export function toHealthcareInnovationArtifactBusinessInput(
  brief: HealthcareInnovationBrief,
): Record<string, unknown> {
  return {
    recommendation: brief.recommendation,
    summary: `${brief.idea}：${recommendationLabel(brief.recommendation)}。证据准备度 ${brief.evidenceReadiness.score}/100，市场准备度 ${brief.marketReadiness.score}/100。`,
    evidenceReadiness: brief.evidenceReadiness,
    marketReadiness: brief.marketReadiness,
    stagePlan: brief.stagePlan,
    growthLoop: brief.growthLoop,
    claims: brief.claims,
    risks: brief.risks.map((risk) => risk.risk),
    unknowns: brief.unknowns,
    nextActions: brief.nextActions,
    tokenUsage: brief.tokenUsage,
  };
}
