import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDimensionReliabilityLesson,
  evaluatePredictionAgainstOutcome,
  runProductPotentialHarnessCase,
  summarizeBacktests,
  type BacktestRecord,
} from "../src/modules/evaluation-harness";

const identity = {
  organizationId: "org-1",
  productId: "product-1",
  productVersionId: "v1",
  productVersionFingerprint: "pv-hash-1",
  channelRouteId: "route-live",
  channelRouteFingerprint: "route-hash-1",
  assessmentRuleVersion: "potential-v2",
  evaluatedAt: "2026-09-22T00:00:00.000Z",
};

test("Harness：高诊断分也不能穿透 FAIL gate", () => {
  const result = runProductPotentialHarnessCase({
    id: "H-POT-001",
    title: "高分但渠道规格失败",
    input: {
      dimensions: [
        { key: "DEMAND", score: 95, evidenceState: "VERIFIED", rationale: "真实需求", sourceRefs: ["e1"] },
        { key: "CHANNEL_FIT", score: 92, evidenceState: "SUPPORTED", rationale: "渠道反馈", sourceRefs: ["e2"] },
        { key: "UNIT_ECONOMICS", score: 90, evidenceState: "SUPPORTED", rationale: "估算", sourceRefs: ["e3"] },
        { key: "DIFFERENTIATION", score: 88, evidenceState: "SUPPORTED", rationale: "差异", sourceRefs: ["e4"] },
        { key: "REPEAT_PURCHASE", score: 80, evidenceState: "ASSUMED", rationale: "假设", sourceRefs: [] },
        { key: "DELIVERY_FEASIBILITY", score: 90, evidenceState: "VERIFIED", rationale: "工厂确认", sourceRefs: ["e5"] },
        { key: "COMPANY_FIT", score: 90, evidenceState: "VERIFIED", rationale: "资源匹配", sourceRefs: ["e6"] },
      ],
      gates: [
        {
          key: "channel-economics",
          label: "渠道经济性",
          status: "FAIL",
          reason: "扣除渠道费用后负贡献",
          sourceRefs: ["calc:1"],
        },
      ],
      marketValidationVerified: true,
    },
    expected: {
      allowedVerdicts: ["BLOCKED"],
      forbiddenVerdicts: ["VALIDATE", "PRIORITIZE_FOR_VALIDATION"],
      requiredBlockerKeys: ["channel-economics"],
      minDiagnosticIndex: 80,
      forbidProceedWhenAnyGateFails: true,
    },
  });

  assert.equal(result.passed, true);
  assert.equal(result.criticalFailures, 0);
});

test("Harness：预测与结果必须锁定同一产品版本和渠道路线指纹", () => {
  const record: BacktestRecord = {
    prediction: {
      identity,
      verdict: "VALIDATE",
      diagnosticIndex: 78,
      coverageRatio: 0.9,
      verifiedCoverageRatio: 0.6,
      dimensions: [],
    },
    outcome: {
      identity: {
        ...identity,
        productVersionFingerprint: "pv-hash-2",
      },
      outcome: "SUCCESS",
      evidenceRefs: ["sales-report:1"],
      verifiedByUserId: "user-1",
      verifiedAt: "2026-10-22T00:00:00.000Z",
    },
  };

  const result = evaluatePredictionAgainstOutcome(record);
  assert.equal(result.comparable, false);
  assert.equal(result.alignment, "IDENTITY_MISMATCH");
});

test("Harness：未经证据与人工确认的经营结果不能成为学习标签", () => {
  const result = evaluatePredictionAgainstOutcome({
    prediction: {
      identity,
      verdict: "VALIDATE",
      diagnosticIndex: 80,
      coverageRatio: 0.9,
      verifiedCoverageRatio: 0.7,
      dimensions: [],
    },
    outcome: {
      identity,
      outcome: "FAILURE",
      evidenceRefs: [],
      verifiedByUserId: null,
      verifiedAt: null,
    },
  });

  assert.equal(result.alignment, "UNVERIFIED_OUTCOME");
  assert.equal(result.comparable, false);
});

test("Harness：能够区分 false positive / false negative / abstention", () => {
  const make = (
    verdict: BacktestRecord["prediction"]["verdict"],
    outcome: BacktestRecord["outcome"]["outcome"]
  ): BacktestRecord => ({
    prediction: {
      identity,
      verdict,
      diagnosticIndex: 70,
      coverageRatio: 0.8,
      verifiedCoverageRatio: 0.5,
      dimensions: [],
    },
    outcome: {
      identity,
      outcome,
      evidenceRefs: ["verified:1"],
      verifiedByUserId: "lead-1",
      verifiedAt: "2026-10-22T00:00:00.000Z",
    },
  });

  const summary = summarizeBacktests([
    make("VALIDATE", "SUCCESS"),
    make("VALIDATE", "FAILURE"),
    make("DEPRIORITIZE", "SUCCESS"),
    make("DEPRIORITIZE", "FAILURE"),
    make("NEEDS_EVIDENCE", "SUCCESS"),
  ]);

  assert.equal(summary.aligned, 2);
  assert.equal(summary.falsePositive, 1);
  assert.equal(summary.falseNegative, 1);
  assert.equal(summary.abstained, 1);
});

test("经验迭代：样本不足时只能形成候选，不得进入可复核状态", () => {
  const lesson = buildDimensionReliabilityLesson({
    observations: [
      {
        segmentKey: "kuaishou-health",
        dimensionKey: "CHANNEL_FIT",
        score: 90,
        outcome: "SUCCESS",
        evidenceRefs: ["o1"],
      },
      {
        segmentKey: "kuaishou-health",
        dimensionKey: "CHANNEL_FIT",
        score: 50,
        outcome: "FAILURE",
        evidenceRefs: ["o2"],
      },
    ],
    segmentKey: "kuaishou-health",
    dimensionKey: "CHANNEL_FIT",
    minSampleSize: 20,
  });

  assert.equal(lesson.status, "CANDIDATE");
  assert.equal(lesson.readyForReview, false);
  assert.ok(lesson.limitations.some((item) => item.includes("样本量")));
});

test("经验迭代：达到样本量且有明显区分度时也只是 readyForReview，不自动改权重", () => {
  const observations = Array.from({ length: 20 }, (_, index) => ({
    segmentKey: "kuaishou-health",
    dimensionKey: "CHANNEL_FIT" as const,
    score: index < 10 ? 88 : 48,
    outcome: (index < 10 ? "SUCCESS" : "FAILURE") as "SUCCESS" | "FAILURE",
    evidenceRefs: [`outcome-${index}`],
  }));

  const lesson = buildDimensionReliabilityLesson({
    observations,
    segmentKey: "kuaishou-health",
    dimensionKey: "CHANNEL_FIT",
    minSampleSize: 20,
    minMeanGap: 10,
  });

  assert.equal(lesson.readyForReview, true);
  assert.equal(lesson.status, "CANDIDATE");
  assert.ok(lesson.statement.includes("成功样本均分"));
});
