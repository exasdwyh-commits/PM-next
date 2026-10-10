import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHealthcareInnovationBrief,
  buildHealthcareInnovationGraph,
  buildHealthcareInnovationReply,
  toHealthcareInnovationArtifactBusinessInput,
  type HealthcareInnovationInput,
} from "../src/modules/visual-intelligence/healthcare-innovation-brief";
import { validateKernGraph } from "../src/modules/visual-intelligence/contracts";
import {
  PRODUCT_DEVELOPMENT_REPORT_FORMAT,
  validateReportSections,
} from "../src/modules/visual-intelligence/report-format";
import {
  sanitizeRichFences,
  splitRichText,
  type RichBlock,
} from "../src/modules/artifacts/rich-blocks";
import { ARTIFACT_SCHEMA_VERSION } from "../src/modules/work/artifact-schema";
import { validateStructuredArtifact } from "../src/modules/work/structured-artifacts";

const SOURCES = [
  {
    id: "src-pubmed-1",
    title: "公开发表的人体研究索引",
    url: "https://pubmed.ncbi.nlm.nih.gov/",
    trust: "external" as const,
    retrievedAt: "2026-10-10",
    note: "仅作为示例来源，真实项目必须替换为项目证据",
  },
  {
    id: "src-internal-market",
    title: "内部渠道访谈纪要",
    trust: "internal" as const,
    note: "合成测试数据，不代表真实市场结论",
  },
];

const EVIDENCE = [
  {
    claim: "目标成分在成品剂型下显示出稳定的吸收记录",
    basis: "FACT" as const,
    evidenceLevel: "A" as const,
    sourceIds: ["src-pubmed-1"],
    population: "成年人群",
    limitations: ["研究周期较短"],
  },
  {
    claim: "目标成分具备抗氧化相关机制",
    basis: "FACT" as const,
    evidenceLevel: "B" as const,
    sourceIds: ["src-pubmed-1"],
    limitations: ["人群匹配待确认"],
  },
];

const MARKET = [
  {
    segment: "25-40 岁都市白领",
    need: "便捷补充抗氧化营养素",
    channel: "私域社群",
    priceBand: "80-150 元/盒",
    competitor: "同类抗氧化饮品",
    proof: "渠道访谈与竞品价格记录",
    basis: "FACT" as const,
    sourceIds: ["src-internal-market"],
  },
  {
    segment: "25-40 岁都市白领",
    need: "希望产品功效表达可信",
    channel: "内容电商",
    priceBand: "80-150 元/盒",
    competitor: "药店线下品牌",
    proof: "用户问卷与客服记录",
    basis: "FACT" as const,
    sourceIds: ["src-internal-market"],
  },
];

function makeInput(
  overrides: Partial<HealthcareInnovationInput> = {},
): HealthcareInnovationInput {
  return {
    idea: "做一款面向都市白领的便捷抗氧化大健康饮品",
    category: "保健食品候选方向",
    region: "中国大陆",
    targetUser: "25-40 岁都市白领",
    desiredOutcome: "帮助用户建立可持续的抗氧化营养补充习惯",
    constraints: ["不做疾病治疗承诺", "不夸大原料研究"],
    sources: SOURCES,
    evidence: EVIDENCE,
    marketSignals: MARKET,
    risks: [],
    unknowns: [],
    regulatoryConfirmed: true,
    stopRequested: false,
    ...overrides,
  };
}

test("完整输入生成可验证、可展示、不伪造市场结论的创新简报", () => {
  const brief = buildHealthcareInnovationBrief(makeInput());
  assert.equal(brief.recommendation, "PROCEED_TO_VALIDATE");
  assert.equal(brief.complianceGate, "READY_FOR_REVIEW");
  assert.equal(brief.evidenceReadiness.strongEvidenceCount, 2);
  assert.equal(brief.marketReadiness.verifiedCount, 2);
  assert.equal(brief.stagePlan.length, 8);
  assert.equal(brief.growthLoop.length, 5);
  assert.ok(brief.marketingPrinciples.length >= 6);
  assert.ok(brief.nextActions.length > 0);
  assert.ok(brief.risks.length > 0);
  assert.ok(brief.unknowns.length > 0);
  assert.ok(!brief.evidenceReadiness.summary.includes("市场规模"));
  assert.ok(!brief.marketReadiness.summary.includes("市场规模"));

  const graph = buildHealthcareInnovationGraph(brief);
  assert.ok(validateKernGraph(graph).ok, JSON.stringify(validateKernGraph(graph).diagnostics));

  const reply = buildHealthcareInnovationReply(brief);
  const sanitized = sanitizeRichFences(reply);
  assert.deepEqual(sanitized.issues, []);
  const segments = splitRichText(reply);
  assert.ok(segments.some((segment) => segment.t === "block"));
  assert.ok(!segments.some((segment) => segment.t === "invalid"));
  assert.match(reply, /## 研发流程/);
  assert.match(reply, /## 增长与营销/);
  assert.doesNotMatch(reply, /<html|<script/i);
});

test("缺少证据、市场信号与法规确认时，建议退回补证而不是进入验证", () => {
  const brief = buildHealthcareInnovationBrief(
    makeInput({
      sources: [],
      evidence: [],
      marketSignals: [],
      regulatoryConfirmed: false,
    }),
  );
  assert.equal(brief.recommendation, "NEEDS_EVIDENCE");
  assert.equal(brief.complianceGate, "HOLD");
  assert.equal(brief.confidence, "LOW");
  assert.ok(brief.unknowns.some((item) => item.includes("成品人体证据")));
  assert.ok(brief.unknowns.some((item) => item.includes("支付意愿")));
  assert.ok(brief.unknowns.some((item) => item.includes("备案/注册路径")));
  assert.ok(brief.risks.some((risk) => risk.risk.includes("法规与广告宣称边界未确认")));
  assert.ok(brief.risks.some((risk) => risk.risk.includes("科学证据不足")));
  assert.ok(brief.risks.some((risk) => risk.risk.includes("市场信号缺少可追溯验证")));
  assert.ok(brief.nextActions.some((action) => action.includes("补齐证据")));
  assert.ok(brief.nextActions.some((action) => action.includes("法规路径")));
});

test("疾病治疗类高风险宣称触发暂停，而不是进入增长阶段", () => {
  const brief = buildHealthcareInnovationBrief(
    makeInput({
      evidence: [
        {
          claim: "该产品可以治疗疲劳相关疾病",
          basis: "INFERENCE",
          sourceIds: ["src-pubmed-1"],
        },
      ],
    }),
  );
  assert.equal(brief.recommendation, "PAUSE");
  assert.equal(brief.confidence, "HIGH");
  assert.ok(brief.against.some((item) => item.includes("高风险疾病或治疗表达")));
  const graph = buildHealthcareInnovationGraph(brief);
  assert.ok(validateKernGraph(graph).ok);
});

test("FACT 必须绑定来源，未知来源和空想法都会被拒绝", () => {
  assert.throws(
    () =>
      buildHealthcareInnovationBrief(
        makeInput({
          evidence: [{ claim: "有证据支持", basis: "FACT", sourceIds: [] }],
        }),
      ),
    /必须提供至少一个来源/,
  );
  assert.throws(
    () =>
      buildHealthcareInnovationBrief(
        makeInput({
          evidence: [{ claim: "有证据支持", basis: "FACT", sourceIds: ["missing"] }],
        }),
      ),
    /未提供的来源/,
  );
  assert.throws(
    () => buildHealthcareInnovationBrief(makeInput({ idea: "   " })),
    /不能为空/,
  );
});

test("创新简报可以进入结构化成果注册表，且非法建议会被拒绝", () => {
  const brief = buildHealthcareInnovationBrief(makeInput());
  const business = toHealthcareInnovationArtifactBusinessInput(brief);
  const value: Record<string, unknown> = {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    organizationId: "org_demo",
    projectId: "proj_demo",
    productId: null,
    productVersionId: null,
    sourceRefs: [],
    inputFingerprint: "0".repeat(64),
    dataNature: "DEMO",
    assumptions: [],
    missingInputs: [
      ...brief.evidenceReadiness.missing,
      ...brief.marketReadiness.missing,
    ],
    recordedBy: "tester",
    confirmedBy: null,
    confirmedAt: null,
    ...business,
  };
  const ok = validateStructuredArtifact({
    type: "HEALTHCARE_INNOVATION_BRIEF",
    value,
  });
  assert.ok(ok.ok, JSON.stringify(ok.fieldErrors));

  const bad = validateStructuredArtifact({
    type: "HEALTHCARE_INNOVATION_BRIEF",
    value: { ...value, recommendation: "MAYBE" },
  });
  assert.equal(bad.ok, false);
  assert.ok(Object.keys(bad.fieldErrors).includes("recommendation"));
});

test("开品报告格式：章节齐全、预算合规、成本与市场数字不伪造", () => {
  const brief = buildHealthcareInnovationBrief(makeInput());
  const validation = validateReportSections(brief.reportSections);
  assert.ok(validation.ok, JSON.stringify(validation.problems));
  const ids = brief.reportSections.map((section) => section.id);
  for (const required of [
    "opportunity",
    "positioning",
    "cost-structure",
    "sales-mechanism",
    "risk-assessment",
    "marketing-strategy",
    "compliance",
    "roadmap",
    "growth",
    "appendix",
  ]) {
    assert.ok(ids.includes(required), `缺少必需章节 ${required}`);
  }
  assert.ok(brief.executiveSummary.length <= PRODUCT_DEVELOPMENT_REPORT_FORMAT.summaryLayerMaxChars);

  const costSection = brief.reportSections.find((section) => section.id === "cost-structure");
  assert.ok(costSection);
  const costText = costSection.details.join("\n");
  assert.ok(costText.includes("待填写"), "成本章节必须明确标注待填写");
  assert.doesNotMatch(costText, /\d+元|\d+万元|市场规模|预计销量/);
  const reply = buildHealthcareInnovationReply(brief);
  assert.doesNotMatch(reply, /市场规模[为是达]\s*\d|预计销量|销量预测|转化率达到\s*\d|包治|保证治愈/);
});

test("产品分析、销售机制、风险登记册与营销策略来自输入且标注推断", () => {
  const brief = buildHealthcareInnovationBrief(makeInput());
  assert.ok(brief.productAnalysis.positioning.includes("25-40 岁都市白领"));
  assert.ok(brief.productAnalysis.valueProposition.includes("A级"));
  assert.ok(brief.productAnalysis.nonGoals.some((item) => item.includes("疾病预防")));
  assert.ok(brief.productAnalysis.differentiation.every((item) => item.length > 0));

  assert.equal(brief.costStructure.categories.length, 6);
  assert.ok(brief.costStructure.missingInputs.length >= 4);
  assert.ok(brief.costStructure.unitEconomics.includes("单位毛利"));
  assert.ok(brief.costStructure.breakEven.includes("回本周期"));

  assert.ok(brief.salesMechanism.length >= 1 && brief.salesMechanism.length <= 3);
  assert.ok(brief.salesMechanism[0].channel.includes("私域"), "输入信号提到的渠道应优先推荐");
  for (const channel of brief.salesMechanism) {
    assert.ok(channel.complianceNotes.length > 0, "渠道建议必须带合规提示");
    assert.equal(channel.basis, "INFERENCE");
    assert.ok(channel.verification.length > 0);
  }

  assert.ok(brief.riskRegister.length > 0);
  for (const row of brief.riskRegister) {
    assert.ok(row.owner.length > 0, "风险必须有负责人");
    assert.ok(row.trigger.length > 0, "风险必须有触发信号");
    assert.ok(["HIGH", "MEDIUM", "LOW"].includes(row.likelihood));
    assert.ok(["HIGH", "MEDIUM", "LOW"].includes(row.impact));
  }
  assert.ok(brief.riskRegister.some((row) => row.category === "财务"));
  assert.ok(brief.riskRegister.some((row) => row.category === "隐私伦理"));
  const weakBrief = buildHealthcareInnovationBrief(
    makeInput({ sources: [], evidence: [], marketSignals: [], regulatoryConfirmed: false }),
  );
  for (const category of ["合规", "证据", "市场", "财务"]) {
    assert.ok(
      weakBrief.riskRegister.some((row) => row.category === category),
      `缺证据输入下风险登记册应包含「${category}」类风险`,
    );
  }

  assert.deepEqual(
    brief.marketingStrategy.map((tactic) => tactic.stage),
    ["获客", "首次价值", "留存复购", "收入与利润", "口碑推荐"],
  );
  for (const tactic of brief.marketingStrategy) {
    assert.equal(tactic.basis, "INFERENCE");
    assert.ok(tactic.metric.length > 0 && tactic.guardrail.length > 0);
  }
});

test("Token 用量统计进入报告与结构化成果，非法输入被拒绝", () => {
  const brief = buildHealthcareInnovationBrief(
    makeInput({
      tokenUsage: [
        { model: "gpt-4o", purpose: "创新简报生成", inputTokens: 8000, outputTokens: 4345 },
        { model: "unknown-model-x", inputTokens: 1000, outputTokens: 500 },
      ],
    }),
  );
  assert.ok(brief.tokenUsage);
  assert.equal(brief.tokenUsage.calls, 2);
  assert.equal(brief.tokenUsage.totalTokens, 8000 + 4345 + 1500);
  assert.equal(brief.tokenUsage.unknownPricingCalls, 1);
  assert.equal(brief.tokenUsage.estimatedCostUsd, null, "有未知定价调用时合计为 null");
  assert.ok(brief.tokenUsage.knownCostUsd > 0);

  const reply = buildHealthcareInnovationReply(brief);
  assert.match(reply, /## Token 与成本统计/);
  assert.match(reply, /tokens/);
  assert.match(reply, /账单/);
  const sanitized = sanitizeRichFences(reply);
  assert.deepEqual(sanitized.issues, []);

  const business = toHealthcareInnovationArtifactBusinessInput(brief);
  assert.ok(business.tokenUsage);
  const value: Record<string, unknown> = {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    organizationId: "org_demo",
    projectId: "proj_demo",
    productId: null,
    productVersionId: null,
    sourceRefs: [],
    inputFingerprint: "0".repeat(64),
    dataNature: "DEMO",
    assumptions: [],
    missingInputs: [],
    recordedBy: "tester",
    confirmedBy: null,
    confirmedAt: null,
    ...business,
  };
  const ok = validateStructuredArtifact({ type: "HEALTHCARE_INNOVATION_BRIEF", value });
  assert.ok(ok.ok, JSON.stringify(ok.fieldErrors));

  const brief2 = buildHealthcareInnovationBrief(
    makeInput({ tokenUsage: [{ model: "gpt-4o-mini", inputTokens: 1000, outputTokens: 1000 }] }),
  );
  assert.ok(brief2.tokenUsage);
  assert.equal(brief2.tokenUsage.estimatedCostUsd, 0.00075);

  const brief3 = buildHealthcareInnovationBrief(makeInput());
  assert.equal(brief3.tokenUsage, null);
  const reply3 = buildHealthcareInnovationReply(brief3);
  assert.doesNotMatch(reply3, /## Token 与成本统计/);
  assert.match(reply3, /未提供 token 用量/);

  assert.throws(
    () => buildHealthcareInnovationBrief(makeInput({ tokenUsage: [{ model: "  ", inputTokens: 1 }] })),
    /模型名/,
  );
  assert.throws(
    () => buildHealthcareInnovationBrief(makeInput({ tokenUsage: [{ model: "gpt-4o", inputTokens: -1 }] })),
    /整数/,
  );
  assert.throws(
    () => buildHealthcareInnovationBrief(makeInput({ tokenUsage: [{ model: "gpt-4o" }] })),
    /至少提供/,
  );
});

test("报告回复遵循开品报告格式：分组齐全、正文守预算、新增块可解析", () => {
  const brief = buildHealthcareInnovationBrief(makeInput());
  const reply = buildHealthcareInnovationReply(brief);
  for (const heading of [
    "## 执行摘要",
    "## 产品分析",
    "## 成本与销售机制",
    "## 风险评估",
    "## 研发流程",
    "## 增长与营销",
    "## 合规边界",
    "## 附录：证据、未知与下一步",
  ]) {
    assert.ok(reply.includes(heading), `回复缺少分组 ${heading}`);
  }
  const markdownPart = reply.split("```kern-ui")[0];
  assert.ok(
    markdownPart.length <= PRODUCT_DEVELOPMENT_REPORT_FORMAT.maxBodyChars,
    `报告正文 ${markdownPart.length} 字超出预算 ${PRODUCT_DEVELOPMENT_REPORT_FORMAT.maxBodyChars}`,
  );
  const sanitized = sanitizeRichFences(reply);
  assert.deepEqual(sanitized.issues, []);
  const blocks = splitRichText(reply)
    .filter((segment): segment is Extract<typeof segment, { t: "block" }> => segment.t === "block")
    .map((segment) => (segment as { block: RichBlock }).block);
  const types = new Set(blocks.map((block) => block.type));
  assert.ok(types.has("table"), "报告应包含成本/渠道/风险/营销表格块");
  assert.ok(types.has("metrics"));
  assert.ok(types.has("decision"));
  assert.ok(!reply.includes("<html") && !reply.includes("<script"));
});
