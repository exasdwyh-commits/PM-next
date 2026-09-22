import test from "node:test";
import assert from "node:assert/strict";
import { ChannelRuleRecordStatus } from "@prisma/client";
import {
  evaluateChannelSpecCandidate,
  type ChannelRuleProfile,
} from "../src/modules/product-development/channel-spec";
import {
  assessProductPotential,
  type PotentialDimensionInput,
} from "../src/modules/product-development/potential-assessment";
import { buildChannelHardGates } from "../src/modules/product-development/channel-routes-service";

const confirmedRule: ChannelRuleProfile = {
  key: "private-sales",
  label: "私域",
  version: "2026-q3",
  status: "CONFIRMED",
  sourceRefs: ["channel-policy-2026-q3"],
  minRetailPrice: 199,
  maxRetailPrice: 699,
  minBundleQuantity: 1,
  maxBundleQuantity: 24,
  allowedUnitLabels: ["盒"],
  commissionRate: 35,
  platformFeeRate: 0,
  marketingRate: 5,
  managementFeeRate: 3,
  returnRate: 5,
  returnHandlingFeeRate: 10,
  targetContributionMarginRate: 12,
  constraints: [],
};

const strongDimensions: PotentialDimensionInput[] = [
  "DEMAND",
  "CHANNEL_FIT",
  "UNIT_ECONOMICS",
  "DIFFERENTIATION",
  "REPEAT_PURCHASE",
  "DELIVERY_FEASIBILITY",
  "COMPANY_FIT",
].map((key) => ({
  key: key as PotentialDimensionInput["key"],
  score: 90,
  evidenceState: "VERIFIED" as const,
  rationale: "verified fixture",
  sourceRefs: ["evidence-1"],
}));

test("channel route: deterministic economics produces reverse max unit cost", () => {
  const result = evaluateChannelSpecCandidate(
    {
      id: "route-299-12",
      retailPrice: 299,
      bundleQuantity: 12,
      unitLabel: "盒",
      productCostPerUnit: 8,
      packagingCostPerOrder: 8,
      freightCostPerOrder: 12,
    },
    confirmedRule
  );

  assert.equal(result.ruleStatus, "CONFIRMED");
  assert.equal(result.channelKey, "private-sales");
  assert.ok(Number.isFinite(result.channelTakeRate));
  assert.ok(result.requiredMaxProductCostPerUnit !== null);
  assert.ok((result.requiredMaxProductCostPerUnit ?? 0) > 0);
});

test("channel route: failed economics becomes a non-compensable hard gate", () => {
  const gates = buildChannelHardGates({
    route: {
      feasible: false,
      ruleStatusSnapshot: ChannelRuleRecordStatus.CONFIRMED,
      ruleVersionSnapshot: "2026-q3",
    },
    currentRuleStatus: ChannelRuleRecordStatus.CONFIRMED,
  });

  const assessment = assessProductPotential({
    dimensions: strongDimensions,
    gates,
    marketValidationVerified: true,
  });

  assert.equal(assessment.diagnosticIndex, 90);
  assert.equal(assessment.verdict, "BLOCKED");
  assert.ok(
    assessment.blockers.some((gate) => gate.key === "CHANNEL_ROUTE_ECONOMICS")
  );
});

test("channel route: assumed rule keeps verdict in NEEDS_EVIDENCE even when economics passes", () => {
  const gates = buildChannelHardGates({
    route: {
      feasible: true,
      ruleStatusSnapshot: ChannelRuleRecordStatus.ASSUMED,
      ruleVersionSnapshot: "draft-v1",
    },
    currentRuleStatus: ChannelRuleRecordStatus.ASSUMED,
  });

  const assessment = assessProductPotential({
    dimensions: strongDimensions,
    gates,
    marketValidationVerified: true,
  });

  assert.equal(assessment.verdict, "NEEDS_EVIDENCE");
  assert.ok(
    assessment.unknownGates.some(
      (gate) => gate.key === "CHANNEL_RULE_CONFIDENCE"
    )
  );
});

test("channel route: a once-confirmed rule becomes uncertain after supersession", () => {
  const gates = buildChannelHardGates({
    route: {
      feasible: true,
      ruleStatusSnapshot: ChannelRuleRecordStatus.CONFIRMED,
      ruleVersionSnapshot: "2026-q2",
    },
    currentRuleStatus: ChannelRuleRecordStatus.SUPERSEDED,
  });

  const confidence = gates.find(
    (gate) => gate.key === "CHANNEL_RULE_CONFIDENCE"
  );
  assert.equal(confidence?.status, "UNKNOWN");
  assert.match(confidence?.reason || "", /替代/);
});

test("channel route: confirmed current rule permits potential engine to proceed to validation verdict", () => {
  const gates = buildChannelHardGates({
    route: {
      feasible: true,
      ruleStatusSnapshot: ChannelRuleRecordStatus.CONFIRMED,
      ruleVersionSnapshot: "2026-q3",
    },
    currentRuleStatus: ChannelRuleRecordStatus.CONFIRMED,
  });

  const assessment = assessProductPotential({
    dimensions: strongDimensions,
    gates,
    marketValidationVerified: true,
  });

  assert.equal(assessment.blockers.length, 0);
  assert.equal(assessment.unknownGates.length, 0);
  assert.equal(assessment.verdict, "PRIORITIZE_FOR_VALIDATION");
});
