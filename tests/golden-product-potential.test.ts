import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateChannelSpecCandidate,
  rankFeasibleChannelSpecs,
  type ChannelRuleProfile,
} from "../src/modules/product-development/channel-spec";
import {
  assessProductPotential,
  type PotentialDimensionInput,
} from "../src/modules/product-development/potential-assessment";

const confirmedLiveRule: ChannelRuleProfile = {
  key: "LIVE_PRIVATE_TEST",
  label: "直播渠道测试规则",
  version: "2026-09-22",
  status: "CONFIRMED",
  sourceRefs: ["channel-rule:live-private:2026-09-22"],
  minRetailPrice: 199,
  maxRetailPrice: 599,
  minBundleQuantity: 6,
  maxBundleQuantity: 24,
  allowedUnitLabels: ["盒"],
  commissionRate: 25,
  platformFeeRate: 3,
  marketingRate: 8,
  managementFeeRate: 0,
  returnRate: 5,
  returnHandlingFeeRate: 5,
  targetContributionMarginRate: 15,
};

test("产品潜力 V2：硬门槛失败不能被高维度评分平均掉", () => {
  const dimensions: PotentialDimensionInput[] = [
    { key: "DEMAND", score: 92, evidenceState: "VERIFIED", rationale: "有真实销量", sourceRefs: ["e1"] },
    { key: "CHANNEL_FIT", score: 88, evidenceState: "SUPPORTED", rationale: "渠道反馈", sourceRefs: ["e2"] },
    { key: "UNIT_ECONOMICS", score: 90, evidenceState: "SUPPORTED", rationale: "历史报价", sourceRefs: ["e3"] },
    { key: "DIFFERENTIATION", score: 86, evidenceState: "SUPPORTED", rationale: "竞品差异", sourceRefs: ["e4"] },
    { key: "REPEAT_PURCHASE", score: 80, evidenceState: "ASSUMED", rationale: "待复购验证", sourceRefs: [] },
    { key: "DELIVERY_FEASIBILITY", score: 85, evidenceState: "VERIFIED", rationale: "工厂确认", sourceRefs: ["e5"] },
    { key: "COMPANY_FIT", score: 90, evidenceState: "VERIFIED", rationale: "公司能力匹配", sourceRefs: ["e6"] },
  ];

  const result = assessProductPotential({
    dimensions,
    gates: [
      {
        key: "channel-spec",
        label: "渠道规格经济性",
        status: "FAIL",
        reason: "目标佣金后为负贡献",
        sourceRefs: ["calc:1"],
      },
    ],
    marketValidationVerified: true,
  });

  assert.equal(result.verdict, "BLOCKED");
  assert.ok((result.diagnosticIndex ?? 0) > 80);
  assert.equal(result.blockers.length, 1);
});

test("产品潜力 V2：资料不足时保持 NEEDS_EVIDENCE，不把未知补成 0 分", () => {
  const result = assessProductPotential({
    dimensions: [
      { key: "DEMAND", score: 82, evidenceState: "SUPPORTED", rationale: "初步市场资料", sourceRefs: ["e1"] },
      { key: "CHANNEL_FIT", score: null, evidenceState: "UNKNOWN", rationale: "未确认渠道规则", sourceRefs: [] },
      { key: "UNIT_ECONOMICS", score: null, evidenceState: "UNKNOWN", rationale: "缺报价", sourceRefs: [] },
    ],
    gates: [
      {
        key: "channel-rule",
        label: "渠道规则确认",
        status: "UNKNOWN",
        reason: "尚未取得真实渠道规则",
        sourceRefs: [],
      },
    ],
    marketValidationVerified: false,
  });

  assert.equal(result.verdict, "NEEDS_EVIDENCE");
  assert.equal(result.confidenceBand, "LOW");
  assert.ok(result.coverageRatio < 0.7);
});

test("渠道规格引擎：299/12 盒在确认规则下满足目标贡献毛利时可作为候选", () => {
  const result = evaluateChannelSpecCandidate(
    {
      id: "299-12",
      retailPrice: 299,
      bundleQuantity: 12,
      unitLabel: "盒",
      productCostPerUnit: 6,
      packagingCostPerOrder: 6,
      freightCostPerOrder: 8,
    },
    confirmedLiveRule
  );

  assert.equal(result.feasible, true);
  assert.equal(result.blockers.length, 0);
  assert.ok(result.contributionMarginRate >= 15);
  assert.ok((result.requiredMaxProductCostPerUnit ?? 0) > 6);
});

test("渠道规格引擎：高成本路线必须阻断，不能靠需求评分放行", () => {
  const result = evaluateChannelSpecCandidate(
    {
      id: "299-12-expensive",
      retailPrice: 299,
      bundleQuantity: 12,
      unitLabel: "盒",
      productCostPerUnit: 13,
      packagingCostPerOrder: 15,
      freightCostPerOrder: 12,
    },
    confirmedLiveRule
  );

  assert.equal(result.feasible, false);
  assert.ok(result.blockers.some((item) => item.includes("贡献毛利率")));
});

test("渠道规格引擎：确认规则优先于假设规则，同可信状态下再比较贡献毛利", () => {
  const confirmed = evaluateChannelSpecCandidate(
    {
      id: "confirmed",
      retailPrice: 299,
      bundleQuantity: 12,
      unitLabel: "盒",
      productCostPerUnit: 6,
      packagingCostPerOrder: 6,
      freightCostPerOrder: 8,
    },
    confirmedLiveRule
  );

  const assumed = evaluateChannelSpecCandidate(
    {
      id: "assumed",
      retailPrice: 299,
      bundleQuantity: 12,
      unitLabel: "盒",
      productCostPerUnit: 4,
      packagingCostPerOrder: 4,
      freightCostPerOrder: 6,
    },
    { ...confirmedLiveRule, key: "ASSUMED_RULE", status: "ASSUMED", sourceRefs: [] }
  );

  const ranked = rankFeasibleChannelSpecs([assumed, confirmed]);
  assert.equal(ranked[0]?.candidateId, "confirmed");
});
