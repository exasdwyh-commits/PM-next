import assert from "node:assert/strict";
import test from "node:test";

import {
  DecisionIntelligenceKernel,
  DecisionSpecRegistry,
  RulesDecisionEngine,
  createDefaultDecisionSpecs,
  createDefaultRulesDecisionEngine,
  evaluateDecisionPolicy,
  validateDecisionEngineResult,
  type DecisionEngine,
  type DecisionEngineResult,
  type DecisionSpec,
} from "../src/modules/decision-intelligence";

function buildDefaultKernel() {
  const specs = createDefaultDecisionSpecs();
  const rules = createDefaultRulesDecisionEngine();
  const kernel = new DecisionIntelligenceKernel(specs);
  kernel.registerEngine(rules);
  return { specs, rules, kernel };
}

test("Decision Intelligence：低风险规则路由可自动执行", async () => {
  const { kernel } = buildDefaultKernel();

  const result = await kernel.decide({
    decisionKey: "workforce.route_agent",
    state: {
      taskClass: "RESEARCH",
      needsResearch: true,
    },
    contextRefs: ["work-item:123"],
  });

  assert.equal(result.engineResult.engine, "RULES");
  assert.equal(result.engineResult.value, "research_agent");
  assert.equal(result.policy.action, "AUTO");
  assert.ok(result.engineResult.reasonCodes.includes("RESEARCH_WORK"));
});

test("Decision Intelligence：业务写入/预算/治理门命中时 needs_human 为 true", async () => {
  const { kernel } = buildDefaultKernel();

  const result = await kernel.decide({
    decisionKey: "workforce.needs_human",
    state: {
      businessMutation: true,
      budgetApproval: true,
      governanceGate: false,
    },
    contextRefs: ["proposal:1"],
  });

  assert.equal(result.engineResult.value, true);
  assert.equal(result.policy.action, "AUTO");
  assert.ok(result.engineResult.reasonCodes.includes("BUSINESS_MUTATION"));
  assert.ok(result.engineResult.reasonCodes.includes("BUDGET_APPROVAL"));
});

test("Decision Intelligence：Signal 唤醒必须同时满足 actionable、非重复、非阻断与相关度阈值", async () => {
  const { kernel } = buildDefaultKernel();

  const yes = await kernel.decide({
    decisionKey: "signal.should_wake_pm",
    state: {
      actionable: true,
      duplicate: false,
      blocked: false,
      relevanceScore: 86,
    },
    contextRefs: ["signal:381"],
  });
  assert.equal(yes.engineResult.value, true);
  assert.equal(yes.policy.action, "AUTO");

  const no = await kernel.decide({
    decisionKey: "signal.should_wake_pm",
    state: {
      actionable: true,
      duplicate: true,
      blocked: false,
      relevanceScore: 95,
    },
    contextRefs: ["signal:382"],
  });
  assert.equal(no.engineResult.value, false);
  assert.ok(no.engineResult.reasonCodes.includes("DUPLICATE"));
});

test("Decision Intelligence：高风险 DecisionSpec 无论配置如何都不能 AUTO", () => {
  const highRisk: DecisionSpec = {
    key: "governance.release",
    version: "v1",
    outputType: "BOOLEAN",
    riskClass: "HIGH",
    allowedEngines: ["RULES"],
    automation: {
      autoPolicy: "RULES_ONLY",
      escalationTarget: "HUMAN",
    },
  };

  const result: DecisionEngineResult = {
    engine: "RULES",
    engineVersion: "rules/v1",
    value: true,
    confidence: null,
    reasonCodes: ["PASS"],
    latencyMs: 1,
    calibrated: false,
    calibrationProfile: null,
    benchmarkProfile: null,
  };

  const policy = evaluateDecisionPolicy(highRisk, result);
  assert.equal(policy.action, "ESCALATE_HUMAN");
  assert.ok(policy.reasons[0]?.includes("HIGH"));
});

test("Decision Intelligence：未来模型即使返回高置信，缺 benchmark/calibration 仍不得 AUTO", () => {
  const spec: DecisionSpec = {
    key: "signal.relevance",
    version: "v1",
    outputType: "BOOLEAN",
    riskClass: "LOW",
    allowedEngines: ["MODEL"],
    automation: {
      autoPolicy: "BENCHMARKED_ENGINE",
      escalationTarget: "AGENT",
      minConfidence: 0.9,
      requireCalibrated: true,
      requireBenchmarkProfile: true,
    },
  };

  const unqualified: DecisionEngineResult = {
    engine: "MODEL",
    engineVersion: "laya/example",
    value: true,
    confidence: 0.99,
    reasonCodes: ["MODEL_YES"],
    latencyMs: 4,
    calibrated: false,
    calibrationProfile: null,
    benchmarkProfile: null,
  };

  const policy = evaluateDecisionPolicy(spec, unqualified);
  assert.equal(policy.action, "ESCALATE_AGENT");

  const qualified: DecisionEngineResult = {
    ...unqualified,
    calibrated: true,
    calibrationProfile: "signal-relevance-calibration/v1",
    benchmarkProfile: "hermes-signal-benchmark/v1",
  };
  const qualifiedPolicy = evaluateDecisionPolicy(spec, qualified);
  assert.equal(qualifiedPolicy.action, "AUTO");
});

test("Decision Intelligence：RULES_ONLY spec 遇到 MODEL 结果必须升级，不可自动执行", () => {
  const spec: DecisionSpec = {
    key: "workforce.route_agent",
    version: "v1",
    outputType: "CHOICE",
    riskClass: "LOW",
    allowedEngines: ["RULES", "MODEL"],
    allowedChoices: ["hermes_pm", "research_agent"],
    automation: {
      autoPolicy: "RULES_ONLY",
      escalationTarget: "AGENT",
    },
  };

  const modelResult: DecisionEngineResult = {
    engine: "MODEL",
    engineVersion: "future-model/v1",
    value: "research_agent",
    confidence: 0.999,
    reasonCodes: ["MODEL_ROUTE"],
    latencyMs: 3,
    calibrated: true,
    calibrationProfile: "cal/v1",
    benchmarkProfile: "bench/v1",
  };

  const policy = evaluateDecisionPolicy(spec, modelResult);
  assert.equal(policy.action, "ESCALATE_AGENT");
});

test("Decision Intelligence：类型化输出会拒绝模型返回非法 choice", () => {
  const spec: DecisionSpec = {
    key: "workforce.route_agent",
    version: "v1",
    outputType: "CHOICE",
    riskClass: "LOW",
    allowedEngines: ["MODEL"],
    allowedChoices: ["hermes_pm", "research_agent"],
    automation: {
      autoPolicy: "DISABLED",
      escalationTarget: "AGENT",
    },
  };

  assert.throws(
    () =>
      validateDecisionEngineResult(spec, {
        engine: "MODEL",
        engineVersion: "bad/v1",
        value: "unknown_agent",
        confidence: 0.8,
        reasonCodes: [],
        latencyMs: 1,
        calibrated: false,
        calibrationProfile: null,
        benchmarkProfile: null,
      }),
    /disallowed choice/
  );
});

test("Decision Intelligence：spec version 可冻结，active 升级不改变显式 v1 请求", async () => {
  const specs = new DecisionSpecRegistry();
  specs.register({
    key: "workforce.route_agent",
    version: "v1",
    outputType: "CHOICE",
    riskClass: "LOW",
    allowedEngines: ["RULES"],
    allowedChoices: ["hermes_pm", "research_agent"],
    automation: { autoPolicy: "RULES_ONLY", escalationTarget: "AGENT" },
  });
  specs.register({
    key: "workforce.route_agent",
    version: "v2",
    outputType: "CHOICE",
    riskClass: "LOW",
    allowedEngines: ["RULES"],
    allowedChoices: ["hermes_pm", "research_agent"],
    automation: { autoPolicy: "DISABLED", escalationTarget: "AGENT" },
  });

  const engine = new RulesDecisionEngine();
  engine.register("workforce.route_agent", "v1", () => ({
    value: "research_agent",
    reasonCodes: ["V1"],
  }));
  engine.register("workforce.route_agent", "v2", () => ({
    value: "hermes_pm",
    reasonCodes: ["V2"],
  }));

  const kernel = new DecisionIntelligenceKernel(specs);
  kernel.registerEngine(engine);

  const active = await kernel.decide({
    decisionKey: "workforce.route_agent",
    state: {},
    contextRefs: [],
  });
  assert.equal(active.spec.version, "v2");
  assert.equal(active.engineResult.value, "hermes_pm");
  assert.equal(active.policy.action, "ESCALATE_AGENT");

  const frozen = await kernel.decide({
    decisionKey: "workforce.route_agent",
    specVersion: "v1",
    state: {},
    contextRefs: [],
  });
  assert.equal(frozen.spec.version, "v1");
  assert.equal(frozen.engineResult.value, "research_agent");
  assert.equal(frozen.policy.action, "AUTO");
});

test("Decision Intelligence：没有任何允许引擎可处理时显式失败", async () => {
  const specs = new DecisionSpecRegistry();
  specs.register({
    key: "x",
    version: "v1",
    outputType: "BOOLEAN",
    riskClass: "LOW",
    allowedEngines: ["MODEL"],
    automation: { autoPolicy: "DISABLED", escalationTarget: "AGENT" },
  });
  const kernel = new DecisionIntelligenceKernel(specs);

  await assert.rejects(
    () =>
      kernel.decide({
        decisionKey: "x",
        state: {},
        contextRefs: [],
      }),
    /No registered engine/
  );
});


test("Decision Intelligence：Signal V2 只用真实分级与价值依据，不依赖伪造 relevance 分", async () => {
  const { kernel } = buildDefaultKernel();

  const wake = await kernel.decide({
    decisionKey: "signal.should_wake_pm",
    specVersion: "v2",
    state: {
      valueTier: "high",
      hasValueReason: true,
      nature: "REAL",
    },
    contextRefs: ["signal:real-fields"],
  });
  assert.equal(wake.engineResult.value, true);
  assert.equal(wake.policy.action, "AUTO");
  assert.ok(wake.engineResult.reasonCodes.includes("HIGH_VALUE_TIER"));
  assert.ok(wake.engineResult.reasonCodes.includes("VALUE_REASON_PRESENT"));

  const noReason = await kernel.decide({
    decisionKey: "signal.should_wake_pm",
    specVersion: "v2",
    state: {
      valueTier: "high",
      hasValueReason: false,
      nature: "REAL",
      relevanceScore: 100,
    },
    contextRefs: ["signal:no-reason"],
  });
  assert.equal(noReason.engineResult.value, false);
  assert.ok(noReason.engineResult.reasonCodes.includes("VALUE_REASON_MISSING"));
});

test("Decision Intelligence：发布不可变 ProductVersion 会触发 Red Team 判断", async () => {
  const { kernel } = buildDefaultKernel();
  const result = await kernel.decide({
    decisionKey: "product_version.should_red_team",
    state: {
      versionTag: "v2",
      isImmutable: true,
      isConfirmed: false,
      hasUnknowns: true,
    },
    contextRefs: ["product-version:v2"],
  });
  assert.equal(result.engineResult.value, true);
  assert.equal(result.policy.action, "AUTO");
});

test("Decision Intelligence：只有 VERIFIED + REAL 证据自动唤醒 Hermes PM", async () => {
  const { kernel } = buildDefaultKernel();

  const verified = await kernel.decide({
    decisionKey: "evidence.should_wake_pm",
    state: { verifyStatus: "VERIFIED", nature: "REAL" },
    contextRefs: ["evidence:1"],
  });
  assert.equal(verified.engineResult.value, true);

  const demo = await kernel.decide({
    decisionKey: "evidence.should_wake_pm",
    state: { verifyStatus: "VERIFIED", nature: "DEMO" },
    contextRefs: ["evidence:2"],
  });
  assert.equal(demo.engineResult.value, false);
});
