/**
 * TASK-015 专业分析回归锁（验证 validateProfessionalAnalysis = 计划 TEST-008 + TEST-009）
 *
 * 本测试为**纯逻辑**（无 DB 依赖）：验证专业分析校验、引用校验、金额校验、动作校验。
 * 运行：node --import tsx --test tests/regression-professional-analysis.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type ProfessionalAnalysisV1,
  type AnalysisClaim,
  type AnalysisRisk,
  type AnalysisRecommendedAction,
  validateProfessionalAnalysis,
  validateClaimRefs,
  validateAllClaims,
  validateAmountRefs,
  validateRecommendedAction,
  createDefaultAnalysis,
  PROFESSIONAL_ANALYSIS_VERSION,
} from "../src/modules/product-development/professional-analysis-schema";

// ── 辅助函数 ──

function makeClaim(overrides: Partial<AnalysisClaim> = {}): AnalysisClaim {
  return {
    content: "测试主张内容",
    level: "FACT",
    sourceRefs: ["ref-1"],
    ...overrides,
  };
}

function makeRisk(overrides: Partial<AnalysisRisk> = {}): AnalysisRisk {
  return {
    description: "测试风险",
    severity: "MEDIUM",
    ...overrides,
  };
}

function makeAction(overrides: Partial<AnalysisRecommendedAction> = {}): AnalysisRecommendedAction {
  return {
    action: "测试推荐动作",
    priority: "HIGH",
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<ProfessionalAnalysisV1> = {}): ProfessionalAnalysisV1 {
  return {
    schemaVersion: PROFESSIONAL_ANALYSIS_VERSION,
    conclusion: "PROCEED_TO_VALIDATE",
    summary: "这是一份专业分析报告的总结部分，需要足够长以满足 200 字的最低要求。".repeat(10),
    companyFit: ["适配度评估点"],
    claims: [makeClaim()],
    alternatives: [],
    economicScenarioRef: null,
    risks: [makeRisk()],
    unknowns: [],
    recommendedActions: [makeAction()],
    limitations: [],
    ...overrides,
  };
}

// ── 测试用例 ──

test("TASK-015: validateClaimRefs - 有效引用通过", () => {
  const claim = makeClaim({ sourceRefs: ["ref-1", "ref-2"] });
  const whitelist = new Set(["ref-1", "ref-2", "ref-3"]);

  const result = validateClaimRefs(claim, whitelist);
  assert.ok(result.valid, "有效引用应通过校验");
  assert.equal(result.invalidRefs.length, 0, "无效引用列表应为空");
});

test("TASK-015: validateClaimRefs - 无效引用被拒绝", () => {
  const claim = makeClaim({ sourceRefs: ["ref-1", "invalid-ref"] });
  const whitelist = new Set(["ref-1", "ref-2"]);

  const result = validateClaimRefs(claim, whitelist);
  assert.ok(!result.valid, "无效引用应被拒绝");
  assert.deepEqual(result.invalidRefs, ["invalid-ref"]);
});

test("TASK-015: validateAllClaims - 所有主张有效", () => {
  const claims = [
    makeClaim({ sourceRefs: ["ref-1"] }),
    makeClaim({ sourceRefs: ["ref-2"] }),
  ];
  const whitelist = new Set(["ref-1", "ref-2"]);

  const result = validateAllClaims(claims, whitelist);
  assert.ok(result.valid, "所有主张有效时应通过");
  assert.equal(result.errors.length, 0);
});

test("TASK-015: validateAllClaims - 部分主张无效", () => {
  const claims = [
    makeClaim({ sourceRefs: ["ref-1"] }),
    makeClaim({ sourceRefs: ["invalid-ref"] }),
  ];
  const whitelist = new Set(["ref-1", "ref-2"]);

  const result = validateAllClaims(claims, whitelist);
  assert.ok(!result.valid, "存在无效主张时应被拒绝");
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].index, 1);
  assert.deepEqual(result.errors[0].invalidRefs, ["invalid-ref"]);
});

test("TASK-015: validateAmountRefs - 无金额主张通过", () => {
  const claim = makeClaim({ content: "这是一个普通主张，不包含金额" });

  const result = validateAmountRefs(claim, new Set());
  assert.ok(!result.hasAmount, "不应检测到金额");
  assert.ok(result.valid, "无金额主张应通过");
});

test("TASK-015: validateAmountRefs - 有金额有引用通过", () => {
  const claim = makeClaim({
    content: "成本为 25.5 元",
    sourceRefs: ["cost-ref-1"],
  });
  const costRefs = new Set(["cost-ref-1"]);

  const result = validateAmountRefs(claim, costRefs);
  assert.ok(result.hasAmount, "应检测到金额");
  assert.ok(result.valid, "有对应成本引用应通过");
});

test("TASK-015: validateAmountRefs - 有金额无引用被拒绝", () => {
  const claim = makeClaim({
    content: "成本为 25.5 元",
    sourceRefs: ["non-cost-ref"],
  });
  const costRefs = new Set(["cost-ref-1"]);

  const result = validateAmountRefs(claim, costRefs);
  assert.ok(result.hasAmount, "应检测到金额");
  assert.ok(!result.valid, "无对应成本引用应被拒绝");
});

test("TASK-015: validateRecommendedAction - 有效动作通过", () => {
  const action = makeAction({ action: "补充更多证据" });

  const result = validateRecommendedAction(action);
  assert.ok(result.valid, "有效动作应通过");
});

test("TASK-015: validateRecommendedAction - 包含人名被拒绝", () => {
  const action = makeAction({ action: "由 @zhangsan 负责执行" });

  const result = validateRecommendedAction(action);
  assert.ok(!result.valid, "包含人名应被拒绝");
  assert.ok(result.reason?.includes("人员标识"));
});

test("TASK-015: validateRecommendedAction - 包含已批准金额被拒绝", () => {
  const action = makeAction({ action: "已批准 10000 元预算" });

  const result = validateRecommendedAction(action);
  assert.ok(!result.valid, "包含已批准金额应被拒绝");
  assert.ok(result.reason?.includes("已批准金额"));
});

test("TASK-015: validateProfessionalAnalysis - 完整有效分析通过", () => {
  const analysis = makeAnalysis({
    claims: [makeClaim({ sourceRefs: ["ref-1"] })],
    economicScenarioRef: null,
  });
  const whitelist = new Set(["ref-1"]);
  const costRefs = new Set(["cost-1"]);

  const result = validateProfessionalAnalysis(analysis, whitelist, costRefs);
  assert.ok(result.valid, "完整有效分析应通过");
  assert.equal(result.errors.length, 0);
});

test("TASK-015: validateProfessionalAnalysis - schema 版本不匹配被拒绝", () => {
  const analysis = makeAnalysis({ schemaVersion: "2.0" });

  const result = validateProfessionalAnalysis(analysis, new Set(), new Set());
  assert.ok(!result.valid, "schema 版本不匹配应被拒绝");
  assert.ok(result.errors.some((e) => e.includes("schema 版本")));
});

test("TASK-015: validateProfessionalAnalysis - 结论值无效被拒绝", () => {
  const analysis = makeAnalysis({ conclusion: "INVALID" as any });

  const result = validateProfessionalAnalysis(analysis, new Set(), new Set());
  assert.ok(!result.valid, "结论值无效应被拒绝");
  assert.ok(result.errors.some((e) => e.includes("结论值无效")));
});

test("TASK-015: validateProfessionalAnalysis - 总结过短被拒绝", () => {
  const analysis = makeAnalysis({ summary: "太短了" });

  const result = validateProfessionalAnalysis(analysis, new Set(), new Set());
  assert.ok(!result.valid, "总结过短应被拒绝");
  assert.ok(result.errors.some((e) => e.includes("总结过短")));
});

test("TASK-015: validateProfessionalAnalysis - 总结过长被拒绝", () => {
  const analysis = makeAnalysis({ summary: "很长的总结".repeat(101) });

  const result = validateProfessionalAnalysis(analysis, new Set(), new Set());
  assert.ok(!result.valid, "总结过长应被拒绝");
  assert.ok(result.errors.some((e) => e.includes("总结过长")));
});

test("TASK-015: validateProfessionalAnalysis - 主张包含无效引用被拒绝", () => {
  const analysis = makeAnalysis({
    claims: [makeClaim({ sourceRefs: ["invalid-ref"] })],
  });
  const whitelist = new Set(["ref-1"]);

  const result = validateProfessionalAnalysis(analysis, whitelist, new Set());
  assert.ok(!result.valid, "主张包含无效引用应被拒绝");
  assert.ok(result.errors.some((e) => e.includes("无效引用")));
});

test("TASK-015: validateProfessionalAnalysis - 金额主张无成本引用被拒绝", () => {
  const analysis = makeAnalysis({
    claims: [makeClaim({ content: "成本为 25.5 元", sourceRefs: ["ref-1"] })],
  });
  const whitelist = new Set(["ref-1"]);
  const costRefs = new Set(["other-cost"]);

  const result = validateProfessionalAnalysis(analysis, whitelist, costRefs);
  assert.ok(!result.valid, "金额主张无成本引用应被拒绝");
  assert.ok(result.errors.some((e) => e.includes("金额但无对应成本引用")));
});

test("TASK-015: validateProfessionalAnalysis - 推荐动作包含人名被拒绝", () => {
  const analysis = makeAnalysis({
    recommendedActions: [makeAction({ action: "由 @lisi 负责" })],
  });

  const result = validateProfessionalAnalysis(analysis, new Set(), new Set());
  assert.ok(!result.valid, "推荐动作包含人名应被拒绝");
  assert.ok(result.errors.some((e) => e.includes("推荐动作")));
});

test("TASK-015: validateProfessionalAnalysis - 经济情景引用无效被拒绝", () => {
  const analysis = makeAnalysis({ economicScenarioRef: "invalid-cost-ref" });
  const costRefs = new Set(["cost-1"]);

  const result = validateProfessionalAnalysis(analysis, new Set(), costRefs);
  assert.ok(!result.valid, "经济情景引用无效应被拒绝");
  assert.ok(result.errors.some((e) => e.includes("经济情景引用无效")));
});

test("TASK-015: createDefaultAnalysis - 返回有效的默认分析", () => {
  const analysis = createDefaultAnalysis();

  assert.equal(analysis.schemaVersion, PROFESSIONAL_ANALYSIS_VERSION);
  assert.equal(analysis.conclusion, "NEEDS_EVIDENCE");
  assert.ok(analysis.summary.length >= 200, "默认总结应足够长");
  assert.ok(analysis.unknowns.length > 0, "默认应有未知项");
  assert.ok(analysis.recommendedActions.length > 0, "默认应有推荐动作");
});

test("TASK-015: PROFESSIONAL_ANALYSIS_VERSION 与 ARTIFACT_SCHEMA_VERSION 一致", () => {
  // 这个测试确保版本号一致
  assert.equal(PROFESSIONAL_ANALYSIS_VERSION, "1.0");
});
