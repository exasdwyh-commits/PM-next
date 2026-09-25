import assert from "node:assert/strict";
import { buildKernCollaborationPlanShadow } from "../src/modules/assistant-runtime/collaboration-planner";
import type { AssistantReflexShadowResult } from "../src/modules/assistant-runtime/reflex";

const emptyReflex: AssistantReflexShadowResult = {
  mode: "SHADOW_UNCONFIGURED",
  decisions: {},
  error: null,
};

const solo = buildKernCollaborationPlanShadow({
  text: "帮我总结一下今天要做的事",
  productBound: false,
  reflex: emptyReflex,
});
assert.equal(solo.mode, "SOLO");
assert.equal(solo.synthesisTier, "FAST");
assert.equal(solo.autoDispatchEligible, true);
assert.equal(solo.authority, "ADVISORY_ONLY");

const pair = buildKernCollaborationPlanShadow({
  text: "这个配方剂量和临床证据是否匹配？",
  productBound: true,
  reflex: emptyReflex,
});
assert.equal(pair.mode, "PAIR");
assert.deepEqual(
  new Set(pair.experts),
  new Set(["scientific_evidence_agent", "formulation_agent"])
);
assert.equal(pair.independentFirstPass, true);

const council = buildKernCollaborationPlanShadow({
  text: "请一起评估这款产品的法规、配方、成本和市场竞争力",
  productBound: true,
  reflex: emptyReflex,
});
assert.equal(council.mode, "COUNCIL");
assert.equal(council.synthesisTier, "FRONTIER");
assert.equal(council.qaRequired, true);
assert.equal(council.autoDispatchEligible, false);

const full = buildKernCollaborationPlanShadow({
  text: "对这个产品做一次完整产品研发评估",
  productBound: true,
  reflex: emptyReflex,
});
assert.equal(full.mode, "FULL_RND");
assert.equal(full.experts.length, 5);
assert.equal(full.qaRequired, true);

const red = buildKernCollaborationPlanShadow({
  text: "站在反方挑战这个判断，找最可能失败的路径",
  productBound: true,
  reflex: emptyReflex,
});
assert.equal(red.mode, "RED_TEAM");
assert.equal(red.redTeamRequired, true);
assert.equal(red.synthesisTier, "FRONTIER");

const reflex: AssistantReflexShadowResult = {
  mode: "SHADOW",
  decisions: {
    "assistant.expert_class": {
      value: "COMPLIANCE",
      confidence: 0.9,
      decisionRunId: "d1",
      policyAction: "SHADOW",
    },
    "assistant.complexity": {
      value: "MEDIUM",
      confidence: 0.8,
      decisionRunId: "d2",
      policyAction: "SHADOW",
    },
    "assistant.requires_research": {
      value: true,
      confidence: 0.85,
      decisionRunId: "d3",
      policyAction: "SHADOW",
    },
  },
  error: null,
};
const hybrid = buildKernCollaborationPlanShadow({
  text: "这个原料现在能不能在目标市场使用？",
  productBound: true,
  reflex,
});
assert.equal(hybrid.mode, "SPECIALIST");
assert.deepEqual(hybrid.experts, ["compliance_agent"]);
assert.equal(hybrid.researchRequired, true);
assert.equal(hybrid.source, "REFLEX");

const technical = buildKernCollaborationPlanShadow({
  text: "请审查这个 TypeScript API 的接口设计、数据模型和测试策略",
  productBound: false,
  reflex: emptyReflex,
});
assert.equal(technical.mode, "SPECIALIST");
assert.deepEqual(technical.experts, ["tech_architect_agent"]);
assert.equal(technical.autoDispatchEligible, true);

const codeReflex: AssistantReflexShadowResult = {
  mode: "SHADOW",
  decisions: {
    "assistant.expert_class": {
      value: "CODE",
      confidence: 0.95,
      decisionRunId: "d-code",
      policyAction: "SHADOW",
    },
  },
  error: null,
};
const codeSpecialist = buildKernCollaborationPlanShadow({
  text: "review architecture",
  productBound: false,
  reflex: codeReflex,
});
assert.deepEqual(codeSpecialist.experts, ["tech_architect_agent"]);

console.log("✅ Kern Collaboration Planner Shadow: SOLO / PAIR / COUNCIL / RED_TEAM / FULL_RND");
