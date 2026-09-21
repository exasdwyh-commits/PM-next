/**
 * scientific-evidence — 单元测试
 *
 * 验证点：
 *   1. 证据等级计算（A/B/C/D 边界）
 *   2. 置信度上限校验（C 级不可超过 55%）
 *   3. 触发规则（强宣称词、高成本、Advisor 冲突、低置信度、高定价+强宣称）
 *   4. 冲突检测（剂量/证据等级/宣称方向）
 *   5. 缺口计算（无 RCT、无剂量、无机制、无营销边界）
 *
 * Run: node --import tsx --test src/modules/research/scientific-evidence.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeEvidenceLevel,
  maxConfidenceByLevel,
  normalizeScientificEvidence,
  shouldTriggerScientificReview,
  detectScientificConflicts,
  computeScientificGaps,
  type ScientificEvidenceInput,
} from "./scientific-evidence";

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

// ── 证据等级计算 ─────────────────────────────────────

describe("computeEvidenceLevel", () => {
  it("A 级：≥3 RCT + 样本≥300 + 多中心 + 独立重复", () => {
    assert.equal(
      computeEvidenceLevel({ humanRCTCount: 5, sampleSizeTotal: 500, hasMultiCenter: true, hasIndependentReplication: true }),
      "A"
    );
  });

  it("B 级：1-2 项 RCT，无多中心", () => {
    assert.equal(computeEvidenceLevel({ humanRCTCount: 2, sampleSizeTotal: 110 }), "B");
  });

  it("C 级：仅开放标签", () => {
    assert.equal(computeEvidenceLevel({ humanRCTCount: 1, sampleSizeTotal: 42, hasOpenLabelOnly: true }), "C");
  });

  it("D 级：无人体数据", () => {
    assert.equal(computeEvidenceLevel({ humanRCTCount: 0, sampleSizeTotal: 0 }), "D");
  });
});

describe("maxConfidenceByLevel", () => {
  it("A 级上限 95", () => assert.equal(maxConfidenceByLevel("A"), 95));
  it("D 级上限 30", () => assert.equal(maxConfidenceByLevel("D"), 30));
});

// ── 规范化校验 ───────────────────────────────────────

describe("normalizeScientificEvidence", () => {
  it("合法输入通过", () => {
    const result = normalizeScientificEvidence(makeInput(), 0);
    assert.ok(result);
    assert.equal(result.ingredient, "AKG");
    assert.equal(result.evidenceLevel, "B");
  });

  it("置信度超过等级上限时抛错", () => {
    assert.throws(
      () => normalizeScientificEvidence(makeInput({ evidenceLevel: "C", confidence: 80 }), 0),
      /置信度 80% 超过证据等级 C 的上限 55%/
    );
  });

  it("缺少营销边界时抛错", () => {
    assert.throws(() => normalizeScientificEvidence(makeInput({ marketingSay: "" }), 0), /必须填写「可以说」/);
    assert.throws(() => normalizeScientificEvidence(makeInput({ marketingNever: "" }), 0), /必须填写「禁止说」/);
  });
});

// ── 触发规则 ─────────────────────────────────────────

describe("shouldTriggerScientificReview", () => {
  it("强宣称词触发 HIGH", () => {
    const result = shouldTriggerScientificReview({ claim: "逆龄抗衰老", hasHealthClaim: true });
    assert.equal(result.shouldTrigger, true);
    assert.equal(result.riskLevel, "HIGH");
    assert.ok(result.reasons.some((r) => r.includes("逆龄")));
  });

  it("高成本原料触发 HIGH", () => {
    const result = shouldTriggerScientificReview({ claim: "补充剂", hasHealthClaim: false, ingredientCostPerUnit: 800 });
    assert.equal(result.shouldTrigger, true);
    assert.equal(result.riskLevel, "HIGH");
  });

  it("Advisor 冲突触发 CRITICAL", () => {
    const result = shouldTriggerScientificReview({ claim: "补充剂", hasHealthClaim: false, advisorVerdict: "CONFLICT" });
    assert.equal(result.riskLevel, "CRITICAL");
  });

  it("高定价+强宣称触发 CRITICAL", () => {
    const result = shouldTriggerScientificReview({ claim: "改善衰老", hasHealthClaim: true, productPrice: 1999 });
    assert.equal(result.riskLevel, "CRITICAL");
  });

  it("低置信度触发", () => {
    const result = shouldTriggerScientificReview({ claim: "补充剂", hasHealthClaim: false, evidenceConfidence: 50 });
    assert.equal(result.shouldTrigger, true);
    assert.ok(result.reasons.some((r) => r.includes("50%")));
  });

  it("无风险时不触发", () => {
    const result = shouldTriggerScientificReview({ claim: "普通食品", hasHealthClaim: false });
    assert.equal(result.shouldTrigger, false);
    assert.equal(result.riskLevel, "LOW");
  });
});

// ── 冲突检测 ─────────────────────────────────────────

describe("detectScientificConflicts", () => {
  it("同原料不同剂量触发冲突", () => {
    const cards = [makeInput({ doseRange: "1g/day" }), makeInput({ doseRange: "3g/day" })];
    const conflicts = detectScientificConflicts(cards);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].field, "dose");
  });

  it("同原料不同证据等级触发冲突", () => {
    const cards = [makeInput({ evidenceLevel: "B" }), makeInput({ evidenceLevel: "C" })];
    const conflicts = detectScientificConflicts(cards);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].field, "evidenceLevel");
  });

  it("不同原料不冲突", () => {
    const cards = [makeInput({ ingredient: "AKG" }), makeInput({ ingredient: "HMB" })];
    assert.equal(detectScientificConflicts(cards).length, 0);
  });
});

// ── 缺口计算 ─────────────────────────────────────────

describe("computeScientificGaps", () => {
  it("无人体 RCT 时记录缺口", () => {
    const gaps = computeScientificGaps(makeInput({ humanRCTCount: 0, evidenceLevel: "D" }));
    assert.ok(gaps.some((g) => g.field === "humanRCT"));
  });

  it("无剂量时记录缺口", () => {
    const gaps = computeScientificGaps(makeInput({ doseRange: null }));
    assert.ok(gaps.some((g) => g.field === "dose"));
  });

  it("完整卡无缺口", () => {
    const gaps = computeScientificGaps(makeInput());
    assert.equal(gaps.length, 0);
  });
});
