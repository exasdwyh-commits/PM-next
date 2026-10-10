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
  sanitizeRichFences,
  splitRichText,
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
