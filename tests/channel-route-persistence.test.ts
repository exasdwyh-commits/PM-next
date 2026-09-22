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
import {
  buildChannelHardGates,
  deriveMarketValidationVerified,
  isChannelRuleEffectiveAt,
  planChannelRuleSupersession,
  validatePotentialDimensionEvidence,
} from "../src/modules/product-development/channel-routes-service";

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


test("channel route: route-specific validation cannot borrow verified evidence from another channel", () => {
  const evidence = [
    {
      nature: "REAL",
      verifyStatus: "VERIFIED",
      validationStatus: "VERIFIED_BY_LEAD",
      channel: "快手直播",
    },
  ];

  assert.equal(
    deriveMarketValidationVerified({
      evidence,
      routeChannel: { channelKey: "private-sales", label: "私域" },
    }),
    false
  );
  assert.equal(
    deriveMarketValidationVerified({
      evidence,
      routeChannel: { channelKey: "kuaishou", label: "快手直播" },
    }),
    true
  );
});

test("channel route: channel aliases can be explicitly listed without broad substring matching", () => {
  const evidence = [
    {
      nature: "REAL",
      verifyStatus: "VERIFIED",
      validationStatus: "VERIFIED_BY_LEAD",
      channel: "抖音、快手直播",
    },
  ];
  assert.equal(
    deriveMarketValidationVerified({
      evidence,
      routeChannel: { channelKey: "kuaishou", label: "快手直播" },
    }),
    true
  );
  assert.equal(
    deriveMarketValidationVerified({
      evidence,
      routeChannel: { channelKey: "private-sales", label: "私域" },
    }),
    false
  );
});

test("channel rule: ASSUMED draft replaces only prior draft and keeps current confirmed rule alive", () => {
  const plan = planChannelRuleSupersession({
    nextStatus: "ASSUMED",
    activeRules: [
      { id: "confirmed-v1", status: ChannelRuleRecordStatus.CONFIRMED },
      { id: "draft-v2", status: ChannelRuleRecordStatus.ASSUMED },
    ],
  });

  assert.equal(plan.supersedesId, "draft-v2");
  assert.deepEqual(plan.supersededIds, ["draft-v2"]);
});

test("channel rule: new CONFIRMED version retires both previous confirmed rule and open draft", () => {
  const plan = planChannelRuleSupersession({
    nextStatus: "CONFIRMED",
    activeRules: [
      { id: "draft-v2", status: ChannelRuleRecordStatus.ASSUMED },
      { id: "confirmed-v1", status: ChannelRuleRecordStatus.CONFIRMED },
    ],
  });

  assert.equal(plan.supersedesId, "confirmed-v1");
  assert.deepEqual(new Set(plan.supersededIds), new Set(["draft-v2", "confirmed-v1"]));
});

test("channel route: confirmed but expired rule is not validation-ready evidence", () => {
  const now = new Date("2026-09-22T12:00:00Z");
  assert.equal(
    isChannelRuleEffectiveAt(
      { effectiveUntil: new Date("2026-09-21T23:59:59Z") },
      now
    ),
    false
  );

  const gates = buildChannelHardGates({
    route: {
      feasible: true,
      ruleStatusSnapshot: ChannelRuleRecordStatus.CONFIRMED,
      ruleVersionSnapshot: "expired-v1",
    },
    currentRuleStatus: ChannelRuleRecordStatus.CONFIRMED,
    currentRuleEffective: false,
  });

  const confidence = gates.find(
    (gate) => gate.key === "CHANNEL_RULE_CONFIDENCE"
  );
  assert.equal(confidence?.status, "UNKNOWN");
  assert.match(confidence?.reason || "", /生效窗口/);
});


test("channel route: VERIFIED dimension must point to a verified REAL Evidence id/hash", () => {
  const dimension: PotentialDimensionInput = {
    key: "DEMAND",
    score: 88,
    evidenceState: "VERIFIED",
    rationale: "verified demand",
    sourceRefs: ["made-up-ref"],
  };

  assert.throws(
    () =>
      validatePotentialDimensionEvidence([dimension], [
        {
          id: "evidence-1",
          hash: "hash-1",
          nature: "REAL",
          verifyStatus: "VERIFIED",
        },
      ]),
    /至少一个 sourceRef 必须对应/
  );

  assert.doesNotThrow(() =>
    validatePotentialDimensionEvidence(
      [{ ...dimension, sourceRefs: ["evidence-1"] }],
      [
        {
          id: "evidence-1",
          hash: "hash-1",
          nature: "REAL",
          verifyStatus: "VERIFIED",
        },
      ]
    )
  );
});

test("channel route: SUPPORTED dimension cannot be saved without any source reference", () => {
  const dimension: PotentialDimensionInput = {
    key: "DIFFERENTIATION",
    score: 70,
    evidenceState: "SUPPORTED",
    rationale: "supported but not fully verified",
    sourceRefs: [],
  };

  assert.throws(
    () => validatePotentialDimensionEvidence([dimension], []),
    /必须提供 sourceRefs/
  );
});


test("channel route: route-level CHANNEL_FIT VERIFIED cannot cite verified evidence from another channel", () => {
  const dimension: PotentialDimensionInput = {
    key: "CHANNEL_FIT",
    score: 92,
    evidenceState: "VERIFIED",
    rationale: "channel fit",
    sourceRefs: ["evidence-private"],
  };

  assert.throws(
    () =>
      validatePotentialDimensionEvidence(
        [dimension],
        [
          {
            id: "evidence-private",
            hash: "hash-private",
            nature: "REAL",
            verifyStatus: "VERIFIED",
            channel: "私域",
          },
        ],
        { channelKey: "kuaishou", label: "快手直播" }
      ),
    /与该路线匹配的渠道 Evidence/
  );

  assert.doesNotThrow(() =>
    validatePotentialDimensionEvidence(
      [{ ...dimension, sourceRefs: ["evidence-kuaishou"] }],
      [
        {
          id: "evidence-kuaishou",
          hash: "hash-kuaishou",
          nature: "REAL",
          verifyStatus: "VERIFIED",
          channel: "快手直播",
        },
      ],
      { channelKey: "kuaishou", label: "快手直播" }
    )
  );
});
