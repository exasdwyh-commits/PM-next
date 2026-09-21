/**
 * TASK-018 科学证据来源区分回归锁
 *
 * 验证原料/成品证据来源区分、研究对象、限制、来源校验。
 * 运行：node --import tsx --test tests/regression-scientific-evidence-source.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getSourceTypeLabel,
  getResearchSubjectsLabel,
  getLimitationLabel,
  validateEvidenceSourceConsistency,
  summarizeEvidenceSource,
  normalizeScientificEvidence,
  type ScientificEvidenceInput,
  type EvidenceSourceType,
  type EvidenceLimitationType,
} from "../src/modules/research/scientific-evidence";

// ── 测试工具 ──────────────────────────────────────────

function makeInput(overrides: Partial<ScientificEvidenceInput> = {}): ScientificEvidenceInput {
  return {
    ingredient: "AKG",
    claim: "支持健康老龄化",
    evidenceLevel: "B",
    humanRCTCount: 2,
    sampleSizeTotal: 110,
    doseRange: "1-3 g/day",
    mechanism: "mTOR / AMPK",
    marketingSay: "支持健康老龄化",
    marketingNever: "逆龄/延寿",
    confidence: 72,
    lastReviewed: "2026-09-19",
    status: "CONFIRMED",
    ...overrides,
  };
}

// ── 来源类型标签测试 ──

test("TASK-018: getSourceTypeLabel 返回正确的中文标签", () => {
  assert.equal(getSourceTypeLabel("RAW_MATERIAL_STUDY"), "原料研究");
  assert.equal(getSourceTypeLabel("FINISHED_PRODUCT_STUDY"), "成品研究");
  assert.equal(getSourceTypeLabel("MECHANISM_ONLY"), "仅机制研究");
  assert.equal(getSourceTypeLabel("EXPERT_OPINION"), "专家意见");
  assert.equal(getSourceTypeLabel("TRADITIONAL_USE"), "传统使用经验");
  assert.equal(getSourceTypeLabel("REGULATORY_REFERENCE"), "监管/法规参考");
  assert.equal(getSourceTypeLabel(null), "未指定来源");
});

test("TASK-018: getResearchSubjectsLabel 返回正确的中文标签", () => {
  assert.equal(getResearchSubjectsLabel("IN_VITRO"), "体外实验");
  assert.equal(getResearchSubjectsLabel("ANIMAL"), "动物研究");
  assert.equal(getResearchSubjectsLabel("HUMAN"), "人体研究");
  assert.equal(getResearchSubjectsLabel("MIXED"), "混合研究（体外/动物/人体）");
  assert.equal(getResearchSubjectsLabel(null), "未指定研究对象");
});

test("TASK-018: getLimitationLabel 返回正确的中文标签", () => {
  assert.equal(getLimitationLabel("SAMPLE_SIZE_SMALL"), "样本量不足");
  assert.equal(getLimitationLabel("NO_CONTROL_GROUP"), "无对照组");
  assert.equal(getLimitationLabel("OPEN_LABEL_ONLY"), "仅开放标签");
  assert.equal(getLimitationLabel("SHORT_DURATION"), "研究周期短");
  assert.equal(getLimitationLabel("ANIMAL_MODEL_ONLY"), "仅动物模型");
  assert.equal(getLimitationLabel("IN_VITRO_ONLY"), "仅体外实验");
  assert.equal(getLimitationLabel("CONFLICTING_DATA"), "数据冲突");
  assert.equal(getLimitationLabel("VENDOR_FUNDED"), "供应商资助");
  assert.equal(getLimitationLabel("POPULATION_MISMATCH"), "研究人群与目标人群不匹配");
});

// ── 证据来源一致性校验测试 ──

test("TASK-018: 成品研究必须有成品引用", () => {
  const input = makeInput({
    sourceType: "FINISHED_PRODUCT_STUDY",
    finishedProductRef: null,
  });
  const result = validateEvidenceSourceConsistency(input);
  assert.ok(!result.valid);
  assert.ok(result.errors.some((e) => e.includes("缺少成品引用")));
});

test("TASK-018: 成品研究有成品引用时校验通过", () => {
  const input = makeInput({
    sourceType: "FINISHED_PRODUCT_STUDY",
    finishedProductRef: "Product ABC Batch 2026-01",
  });
  const result = validateEvidenceSourceConsistency(input);
  assert.ok(result.valid);
});

test("TASK-018: 仅机制研究不能是人体研究对象", () => {
  const input = makeInput({
    sourceType: "MECHANISM_ONLY",
    researchSubjects: "HUMAN",
  });
  const result = validateEvidenceSourceConsistency(input);
  assert.ok(!result.valid);
  assert.ok(result.errors.some((e) => e.includes("仅机制研究")));
});

test("TASK-018: 仅机制研究可以是动物/体外研究对象", () => {
  const input = makeInput({
    sourceType: "MECHANISM_ONLY",
    researchSubjects: "ANIMAL",
  });
  const result = validateEvidenceSourceConsistency(input);
  assert.ok(result.valid);
});

test("TASK-018: 传统使用经验不能有人体 RCT 数据", () => {
  const input = makeInput({
    sourceType: "TRADITIONAL_USE",
    humanRCTCount: 5,
  });
  const result = validateEvidenceSourceConsistency(input);
  assert.ok(!result.valid);
  assert.ok(result.errors.some((e) => e.includes("传统使用经验")));
});

test("TASK-018: 传统使用经验无人体 RCT 数据时校验通过", () => {
  const input = makeInput({
    sourceType: "TRADITIONAL_USE",
    humanRCTCount: 0,
  });
  const result = validateEvidenceSourceConsistency(input);
  assert.ok(result.valid);
});

// ── 证据来源摘要测试 ──

test("TASK-018: summarizeEvidenceSource 统计来源类型", () => {
  const cards = [
    makeInput({ sourceType: "RAW_MATERIAL_STUDY" }),
    makeInput({ ingredient: "HMB", sourceType: "RAW_MATERIAL_STUDY" }),
    makeInput({ ingredient: "Vitamin D", sourceType: "FINISHED_PRODUCT_STUDY", finishedProductRef: "Product XYZ" }),
    makeInput({ ingredient: "Collagen", sourceType: "MECHANISM_ONLY" }),
  ];
  
  const summary = summarizeEvidenceSource(cards);
  assert.equal(summary.totalCards, 4);
  assert.equal(summary.bySourceType.RAW_MATERIAL_STUDY, 2);
  assert.equal(summary.bySourceType.FINISHED_PRODUCT_STUDY, 1);
  assert.equal(summary.bySourceType.MECHANISM_ONLY, 1);
  assert.equal(summary.rawMaterialStudies, 2);
  assert.equal(summary.finishedProductStudies, 1);
  assert.equal(summary.mechanismOnlyStudies, 1);
});

test("TASK-018: summarizeEvidenceSource 统计研究对象", () => {
  const cards = [
    makeInput({ researchSubjects: "HUMAN" }),
    makeInput({ ingredient: "HMB", researchSubjects: "ANIMAL" }),
    makeInput({ ingredient: "Vitamin D", researchSubjects: "IN_VITRO" }),
    makeInput({ ingredient: "Collagen" }), // 未指定
  ];
  
  const summary = summarizeEvidenceSource(cards);
  assert.equal(summary.byResearchSubjects.HUMAN, 1);
  assert.equal(summary.byResearchSubjects.ANIMAL, 1);
  assert.equal(summary.byResearchSubjects.IN_VITRO, 1);
  assert.equal(summary.byResearchSubjects.UNSPECIFIED, 1);
});

test("TASK-018: summarizeEvidenceSource 统计限制", () => {
  const cards = [
    makeInput({ limitations: ["SAMPLE_SIZE_SMALL", "NO_CONTROL_GROUP"] }),
    makeInput({ ingredient: "HMB", limitations: ["SAMPLE_SIZE_SMALL"] }),
    makeInput({ ingredient: "Vitamin D" }), // 无限制
  ];
  
  const summary = summarizeEvidenceSource(cards);
  assert.equal(summary.withLimitations, 2);
  assert.equal(summary.limitationsBreakdown.SAMPLE_SIZE_SMALL, 2);
  assert.equal(summary.limitationsBreakdown.NO_CONTROL_GROUP, 1);
});

test("TASK-018: summarizeEvidenceSource 空数组返回零摘要", () => {
  const summary = summarizeEvidenceSource([]);
  assert.equal(summary.totalCards, 0);
  assert.equal(summary.rawMaterialStudies, 0);
  assert.equal(summary.finishedProductStudies, 0);
  assert.equal(summary.mechanismOnlyStudies, 0);
  assert.equal(summary.withLimitations, 0);
});

// ── normalizeScientificEvidence 新字段测试 ──

test("TASK-018: normalizeScientificEvidence 保留新字段", () => {
  const input = makeInput({
    sourceType: "RAW_MATERIAL_STUDY",
    studyConditions: "双盲随机对照试验",
    limitations: ["SAMPLE_SIZE_SMALL"],
    dataSources: "PubMed, Cochrane Library",
    researchSubjects: "HUMAN",
    finishedProductRef: null,
  });
  
  const result = normalizeScientificEvidence(input, 0);
  assert.ok(result);
  assert.equal(result.sourceType, "RAW_MATERIAL_STUDY");
  assert.equal(result.studyConditions, "双盲随机对照试验");
  assert.deepEqual(result.limitations, ["SAMPLE_SIZE_SMALL"]);
  assert.equal(result.dataSources, "PubMed, Cochrane Library");
  assert.equal(result.researchSubjects, "HUMAN");
  assert.equal(result.finishedProductRef, null);
});

test("TASK-018: normalizeScientificEvidence 默认值处理", () => {
  const input = makeInput({
    sourceType: null,
    studyConditions: null,
    limitations: null,
    dataSources: null,
    researchSubjects: null,
    finishedProductRef: null,
  });
  
  const result = normalizeScientificEvidence(input, 0);
  assert.ok(result);
  assert.equal(result.sourceType, null);
  assert.equal(result.studyConditions, null);
  assert.equal(result.limitations, null);
  assert.equal(result.dataSources, null);
  assert.equal(result.researchSubjects, null);
  assert.equal(result.finishedProductRef, null);
});
