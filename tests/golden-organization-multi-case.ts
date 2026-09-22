import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EvidenceVerifyStatus, OrgRole } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { bootstrapDefaultWorkforce } from "../src/modules/workforce/service";
import { bootstrapDefaultAutopilots } from "../src/modules/autopilot";
import { createManualSignal } from "../src/modules/signal/manual-signal";
import {
  createDevelopmentProduct,
  publishProductVersion,
} from "../src/modules/products/service";
import {
  evaluateChannelSpecCandidate,
  type ChannelRuleProfile,
} from "../src/modules/product-development/channel-spec";
import {
  assessProductPotential,
  type PotentialDimensionInput,
} from "../src/modules/product-development/potential-assessment";
import { freezePotentialPrediction } from "../src/modules/evaluation-harness/persistence";
import { generateChallengeReport } from "../src/modules/advisor/challenge";
import type { ScientificEvidenceInput } from "../src/modules/research/scientific-evidence";

function camelDimensions(): PotentialDimensionInput[] {
  return [
    {
      key: "DEMAND",
      score: 78,
      evidenceState: "SUPPORTED",
      rationale: "中老年营养和高性价比多盒套餐有明确渠道讨论，但尚未形成真实试销结果",
      sourceRefs: ["signal:camel-demand"],
    },
    {
      key: "CHANNEL_FIT",
      score: 88,
      evidenceState: "SUPPORTED",
      rationale: "299/12盒与499/24盒符合私域/会销多盒机制",
      sourceRefs: ["channel-rule:private-bundle:v1"],
    },
    {
      key: "UNIT_ECONOMICS",
      score: 82,
      evidenceState: "SUPPORTED",
      rationale: "在当前确认费用和单盒成本假设下两档规格均有正贡献",
      sourceRefs: ["calc:camel-bundles:v1"],
    },
    {
      key: "DIFFERENTIATION",
      score: 76,
      evidenceState: "ASSUMED",
      rationale: "骆驼奶蛋白+AOS组合具有表达差异，但消费者是否感知到差异尚待验证",
      sourceRefs: [],
    },
    {
      key: "REPEAT_PURCHASE",
      score: null,
      evidenceState: "UNKNOWN",
      rationale: "复购尚无真实数据",
      sourceRefs: [],
    },
    {
      key: "DELIVERY_FEASIBILITY",
      score: 86,
      evidenceState: "SUPPORTED",
      rationale: "12盒/24盒均可由现有包装和供应链交付",
      sourceRefs: ["supplier:camel:v1"],
    },
    {
      key: "COMPANY_FIT",
      score: 90,
      evidenceState: "VERIFIED",
      rationale: "符合银发营养和私域产品线方向",
      sourceRefs: ["company-policy:silver-nutrition"],
    },
  ];
}

function akkDimensions(): PotentialDimensionInput[] {
  return [
    {
      key: "DEMAND",
      score: 90,
      evidenceState: "SUPPORTED",
      rationale: "直播渠道对AKK与体重管理话题有高关注，但关注不等于合规可卖点",
      sourceRefs: ["signal:akk-live-demand"],
    },
    {
      key: "CHANNEL_FIT",
      score: 92,
      evidenceState: "SUPPORTED",
      rationale: "200-300价格带适合直播电商冲动决策与多次曝光",
      sourceRefs: ["channel-rule:live-akk:v1"],
    },
    {
      key: "UNIT_ECONOMICS",
      score: 84,
      evidenceState: "SUPPORTED",
      rationale: "299单盒规格在本轮确认费率下仍有正贡献空间",
      sourceRefs: ["calc:akk-299:v1"],
    },
    {
      key: "DIFFERENTIATION",
      score: 86,
      evidenceState: "SUPPORTED",
      rationale: "后生元而非活菌路线有清晰产品差异，但不能借此越过功效证据",
      sourceRefs: ["product-version:akk"],
    },
    {
      key: "REPEAT_PURCHASE",
      score: 68,
      evidenceState: "ASSUMED",
      rationale: "肠道健康存在周期消费逻辑，真实复购未验证",
      sourceRefs: [],
    },
    {
      key: "DELIVERY_FEASIBILITY",
      score: 90,
      evidenceState: "SUPPORTED",
      rationale: "常规盒装产品供应链可交付",
      sourceRefs: ["supplier:akk:v1"],
    },
    {
      key: "COMPANY_FIT",
      score: 88,
      evidenceState: "VERIFIED",
      rationale: "符合口服健康和直播渠道创新方向",
      sourceRefs: ["company-policy:live-health"],
    },
  ];
}

const privateBundleRule: ChannelRuleProfile = {
  key: "PRIVATE_BUNDLE_CAMEL",
  label: "私域多盒营养套餐规则",
  version: "2026-09-22-v1",
  status: "CONFIRMED",
  sourceRefs: ["channel-rule:private-bundle:v1"],
  minRetailPrice: 299,
  maxRetailPrice: 499,
  minBundleQuantity: 12,
  maxBundleQuantity: 24,
  allowedUnitLabels: ["盒"],
  commissionRate: 35,
  platformFeeRate: 0,
  marketingRate: 5,
  managementFeeRate: 2,
  returnRate: 4,
  returnHandlingFeeRate: 5,
  targetContributionMarginRate: 10,
  constraints: ["主推多盒机制，避免单盒低客单破坏渠道利润"],
};

const liveRule: ChannelRuleProfile = {
  key: "LIVE_AKK_200_300",
  label: "直播电商AKK价格规则",
  version: "2026-09-22-v1",
  status: "CONFIRMED",
  sourceRefs: ["channel-rule:live-akk:v1"],
  minRetailPrice: 200,
  maxRetailPrice: 300,
  minBundleQuantity: 1,
  maxBundleQuantity: 1,
  allowedUnitLabels: ["盒"],
  commissionRate: 45,
  platformFeeRate: 3,
  marketingRate: 5,
  managementFeeRate: 1,
  returnRate: 6,
  returnHandlingFeeRate: 5,
  targetContributionMarginRate: 15,
  constraints: ["直播口播不得使用减肥、燃脂等疾病/强功效表达"],
};

const akkEvidence: ScientificEvidenceInput = {
  ingredient: "AKK 后生元",
  aliases: ["Akkermansia", "AKK"],
  claim: "支持肠道屏障与代谢健康研究方向",
  evidenceLevel: "B",
  humanRCTCount: 1,
  sampleSizeTotal: 80,
  doseRange: "按原料规格与成品方案确认",
  mechanism: "肠道屏障与代谢相关机制",
  applicablePopulation: "成年人",
  marketingSay: "支持肠道健康",
  marketingNever: "减肥、瘦身、燃脂",
  confidence: 75,
  lastReviewed: "2026-09-22",
  status: "CONFIRMED",
  sourceType: "RAW_MATERIAL_STUDY",
  researchSubjects: "HUMAN",
};

async function assertRedTeamWake(
  organizationId: string,
  versionId: string
) {
  const event = await prisma.businessEvent.findUniqueOrThrow({
    where: {
      organizationId_eventKey: {
        organizationId,
        eventKey: `product-version:${versionId}:published`,
      },
    },
    include: {
      autopilotReceipt: {
        include: {
          decisionRun: true,
          agentTask: { include: { agent: true } },
        },
      },
    },
  });
  assert.equal(event.autopilotReceipt?.agentTask?.agent.code, "red_team");
  assert.equal(
    event.autopilotReceipt?.decisionRun?.decisionKey,
    "product_version.should_red_team"
  );
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error("Explicit test database required");
  }
  await assertTestDatabaseSafety(prisma);
  process.env.DEV_MOCK_AUTH = "true";

  const tag = randomUUID();
  const org = await prisma.organization.create({
    data: { name: "Golden Org Multi Case", code: "GOLD_MULTI_" + tag },
  });
  const admin = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: "gold-multi-" + tag + "@hermes.test",
      name: "Golden Multi Product Lead",
    },
  });
  await prisma.organizationMember.create({
    data: {
      organizationId: org.id,
      userId: admin.id,
      role: OrgRole.ORG_ADMIN,
    },
  });

  const session = {
    userId: admin.id,
    organizationId: org.id,
    userEmail: admin.email,
    userName: admin.name,
  };

  try {
    await bootstrapDefaultWorkforce(session);
    await bootstrapDefaultAutopilots(session);

    console.log("▶ GM1 Camel milk + AOS: high-value channel signal wakes PM without becoming evidence");
    const camelSignal = await createManualSignal(session, {
      title: "私域渠道希望中老年营养产品采用299/12盒与499/24盒双档机制",
      summary:
        "渠道认为多盒更容易形成性价比认知，但消费者对AOS组合价值和复购尚无真实验证",
      category: "channel-demand",
      productRef: "骆驼奶蛋白粉+AOS",
      channel: "私域/会销",
      valueTier: "high",
      valueReason: "直接决定规格、成本与渠道毛利结构",
    });
    assert.equal(camelSignal.verifyStatus, EvidenceVerifyStatus.UNVERIFIED);

    const camelSignalEvent = await prisma.businessEvent.findUniqueOrThrow({
      where: {
        organizationId_eventKey: {
          organizationId: org.id,
          eventKey: `signal:${camelSignal.id}:captured`,
        },
      },
      include: {
        autopilotReceipt: {
          include: { agentTask: { include: { agent: true } } },
        },
      },
    });
    assert.equal(
      camelSignalEvent.autopilotReceipt?.agentTask?.agent.code,
      "hermes_pm"
    );

    console.log("▶ GM2 Camel milk + AOS: both commercial tiers are evaluated independently");
    const camel = await createDevelopmentProduct(session, {
      name: "骆驼奶蛋白粉+AOS",
      coreIdea:
        "面向中老年私域用户，以骆驼奶蛋白+AOS形成营养与饮用舒适度方向的多盒套餐",
      targetAudience: "中老年及银发族",
      coreSellingPoints:
        "骆驼奶蛋白营养+AOS组合；不在缺证据时承诺具体肠道功效",
      targetChannels: "私域/会销",
      priceExpectation: "299元12盒；499元24盒",
      targetCost: 18,
      formSpec: "25g/袋，7袋/盒；12盒与24盒套餐",
      forbiddenItems: "禁止添加蔗糖；禁止无证据疾病治疗与确定性肠道功效宣称",
    });

    const camelVersion = await publishProductVersion(
      session,
      camel.product.id,
      {
        versionTag: "v2-channel-bundles",
        specs: {
          audience: "中老年及银发族",
          channel: "私域/会销",
          offers: [
            { retailPrice: 299, bundleQuantity: 12, unitLabel: "盒" },
            { retailPrice: 499, bundleQuantity: 24, unitLabel: "盒" },
          ],
          forbiddenIngredients: ["蔗糖"],
          proposedClaim: "支持营养补充与饮用舒适度方向",
        },
        targetCost: 18,
        currency: "CNY",
        unknowns: {
          aosFinishedProductEvidence: "AOS组合成品体感和复购尚未验证",
          repeatPurchase: "多盒机制是否带来真实复购尚未验证",
        },
        isConfirmed: true,
      }
    );
    await assertRedTeamWake(org.id, camelVersion.id);

    const camel299 = evaluateChannelSpecCandidate(
      {
        id: "camel-299-12",
        retailPrice: 299,
        bundleQuantity: 12,
        unitLabel: "盒",
        productCostPerUnit: 7.5,
        packagingCostPerOrder: 10,
        freightCostPerOrder: 8,
      },
      privateBundleRule
    );
    const camel499 = evaluateChannelSpecCandidate(
      {
        id: "camel-499-24",
        retailPrice: 499,
        bundleQuantity: 24,
        unitLabel: "盒",
        productCostPerUnit: 7.5,
        packagingCostPerOrder: 10,
        freightCostPerOrder: 8,
      },
      privateBundleRule
    );
    assert.equal(camel299.feasible, true);
    assert.equal(camel499.feasible, true);
    assert.notEqual(
      camel299.contributionMarginRate,
      camel499.contributionMarginRate,
      "两档套餐必须独立算经济性，不能用一个总分替代"
    );

    const camelChallenge = generateChallengeReport({
      productName: "骆驼奶蛋白粉+AOS",
      proposedClaim: "支持老年人肠道健康与饮用舒适度",
      targetPrice: 499,
      ingredients: [],
      competitorCount: 0,
    });
    assert.equal(camelChallenge.recommendation, "PAUSE");

    const camelPotential = assessProductPotential({
      dimensions: camelDimensions(),
      gates: [
        {
          key: "channel-economics-299",
          label: "299/12盒渠道经济性",
          status: camel299.feasible ? "PASS" : "FAIL",
          reason: camel299.feasible
            ? `贡献毛利率 ${camel299.contributionMarginRate}%`
            : camel299.blockers.join("；"),
          sourceRefs: ["calc:camel-299-12:v1"],
        },
        {
          key: "channel-economics-499",
          label: "499/24盒渠道经济性",
          status: camel499.feasible ? "PASS" : "FAIL",
          reason: camel499.feasible
            ? `贡献毛利率 ${camel499.contributionMarginRate}%`
            : camel499.blockers.join("；"),
          sourceRefs: ["calc:camel-499-24:v1"],
        },
        {
          key: "science-evidence",
          label: "AOS组合成品证据",
          status: "UNKNOWN",
          reason: "当前没有匹配的成品/原料证据卡，不能凭配方逻辑补造功效依据",
          sourceRefs: [],
        },
      ],
      marketValidationVerified: false,
    });
    assert.equal(camelPotential.verdict, "NEEDS_EVIDENCE");
    assert.equal(camelPotential.blockers.length, 0);
    assert.equal(camelPotential.unknownGates.length, 1);

    const camelPrediction = await freezePotentialPrediction(session, {
      productId: camel.product.id,
      productVersionId: camelVersion.id,
      dimensions: camelDimensions(),
      gates: [
        {
          key: "channel-economics-299",
          label: "299/12盒渠道经济性",
          status: "PASS",
          reason: `贡献毛利率 ${camel299.contributionMarginRate}%`,
          sourceRefs: ["calc:camel-299-12:v1"],
        },
        {
          key: "channel-economics-499",
          label: "499/24盒渠道经济性",
          status: "PASS",
          reason: `贡献毛利率 ${camel499.contributionMarginRate}%`,
          sourceRefs: ["calc:camel-499-24:v1"],
        },
        {
          key: "science-evidence",
          label: "AOS组合成品证据",
          status: "UNKNOWN",
          reason: "证据尚未建立",
          sourceRefs: [],
        },
      ],
      marketValidationVerified: false,
      segmentKey: "private-silver-nutrition",
      channelRouteId: "camel-dual-bundle",
      channelRouteSnapshot: {
        rule: privateBundleRule.key,
        ruleVersion: privateBundleRule.version,
        offers: [
          {
            id: camel299.candidateId,
            margin: camel299.contributionMarginRate,
          },
          {
            id: camel499.candidateId,
            margin: camel499.contributionMarginRate,
          },
        ],
      },
      evidenceFingerprint: "camel-aos-evidence-missing",
      modelPolicyKey: "strategic-frontier",
      promptVersion: "golden-org-multi/v1",
    });
    assert.equal(camelPrediction.verdict, "NEEDS_EVIDENCE");
    console.log("  ✔ channel-valid multi-tier specs remain NEEDS_EVIDENCE when scientific support is missing");

    console.log("▶ GM3 AKK: live-commerce economics cannot average away a forbidden weight-loss claim");
    const akkSignal = await createManualSignal(session, {
      title: "直播渠道对AKK后生元和‘瘦子菌’话题关注快速上升",
      summary:
        "渠道希望做200-300元单盒产品，但减肥表达存在明显营销与科学风险",
      category: "live-commerce-demand",
      productRef: "AKK 后生元",
      channel: "快手/直播电商",
      valueTier: "high",
      valueReason: "影响直播新品立项、口播边界和规格设计",
    });
    assert.equal(akkSignal.verifyStatus, EvidenceVerifyStatus.UNVERIFIED);

    const akk = await createDevelopmentProduct(session, {
      name: "AKK 后生元直播装",
      coreIdea:
        "用后生元路线做直播渠道肠道健康产品，避免活菌稳定性问题和违规减肥表达",
      targetAudience: "关注肠道健康与代谢管理的成年人",
      coreSellingPoints:
        "AKK后生元、肠道健康研究方向；禁止把‘瘦子菌’直接等同减肥功效",
      targetChannels: "快手/直播电商",
      priceExpectation: "200-300元",
      targetCost: 18,
      formSpec: "单盒30日量",
      forbiddenItems: "禁止宣称减肥、瘦身、燃脂；不使用活菌益生菌",
    });

    const akkRiskVersion = await publishProductVersion(
      session,
      akk.product.id,
      {
        versionTag: "v2-live-risky-claim",
        specs: {
          channel: "快手/直播电商",
          retailPrice: 299,
          bundleQuantity: 1,
          unitLabel: "盒",
          form: "后生元",
          proposedClaim: "瘦子菌帮助减肥",
          forbiddenIngredients: ["活菌益生菌"],
        },
        targetCost: 18,
        currency: "CNY",
        unknowns: {
          finishedProductOutcome: "成品肠道体感和复购尚未验证",
        },
        isConfirmed: true,
      }
    );
    await assertRedTeamWake(org.id, akkRiskVersion.id);

    const akkEconomics = evaluateChannelSpecCandidate(
      {
        id: "akk-299-live",
        retailPrice: 299,
        bundleQuantity: 1,
        unitLabel: "盒",
        productCostPerUnit: 18,
        packagingCostPerOrder: 8,
        freightCostPerOrder: 8,
      },
      liveRule
    );
    assert.equal(akkEconomics.feasible, true);

    const riskyChallenge = generateChallengeReport({
      productName: "AKK 后生元直播装",
      proposedClaim: "瘦子菌帮助减肥",
      targetPrice: 299,
      ingredients: [akkEvidence],
      competitorCount: 2,
    });
    assert.notEqual(riskyChallenge.recommendation, "PROCEED");
    assert.ok(
      riskyChallenge.topFailureReasons.some((reason) =>
        reason.includes("营销红线")
      )
    );

    const riskyPotential = assessProductPotential({
      dimensions: akkDimensions(),
      gates: [
        {
          key: "channel-economics",
          label: "直播渠道经济性",
          status: "PASS",
          reason: `贡献毛利率 ${akkEconomics.contributionMarginRate}%`,
          sourceRefs: ["calc:akk-299:v1"],
        },
        {
          key: "marketing-redline",
          label: "减肥营销红线",
          status: "FAIL",
          reason: "原料证据卡明确禁止减肥、瘦身、燃脂表达",
          sourceRefs: ["challenge:akk-v2"],
        },
      ],
      marketValidationVerified: false,
    });
    assert.equal(riskyPotential.verdict, "BLOCKED");
    assert.ok((riskyPotential.diagnosticIndex ?? 0) >= 75);

    const riskyPrediction = await freezePotentialPrediction(session, {
      productId: akk.product.id,
      productVersionId: akkRiskVersion.id,
      dimensions: akkDimensions(),
      gates: [
        {
          key: "channel-economics",
          label: "直播渠道经济性",
          status: "PASS",
          reason: `贡献毛利率 ${akkEconomics.contributionMarginRate}%`,
          sourceRefs: ["calc:akk-299:v1"],
        },
        {
          key: "marketing-redline",
          label: "减肥营销红线",
          status: "FAIL",
          reason: "禁止用AKK‘瘦子菌’概念承诺减肥",
          sourceRefs: ["challenge:akk-v2"],
        },
      ],
      marketValidationVerified: false,
      segmentKey: "live-gut-health",
      channelRouteId: "akk-live-299",
      channelRouteSnapshot: {
        rule: liveRule.key,
        ruleVersion: liveRule.version,
        retailPrice: 299,
        contributionMarginRate: akkEconomics.contributionMarginRate,
      },
      evidenceFingerprint: "akk-v2-risky-claim",
      modelPolicyKey: "strategic-frontier",
      promptVersion: "golden-org-multi/v1",
    });
    assert.equal(riskyPrediction.verdict, "BLOCKED");
    console.log("  ✔ strong demand and healthy margin cannot rescue a hard marketing/science failure");

    console.log("▶ GM4 AKK corrected claim improves BLOCKED → NEEDS_EVIDENCE, never fake PASS");
    const akkCorrected = await publishProductVersion(
      session,
      akk.product.id,
      {
        versionTag: "v3-live-claim-corrected",
        specs: {
          channel: "快手/直播电商",
          retailPrice: 299,
          bundleQuantity: 1,
          unitLabel: "盒",
          form: "后生元",
          proposedClaim: "支持肠道健康",
          forbiddenClaims: ["减肥", "瘦身", "燃脂"],
          forbiddenIngredients: ["活菌益生菌"],
        },
        targetCost: 18,
        currency: "CNY",
        unknowns: {
          finishedProductOutcome:
            "高风险口播已移除，但成品肠道体感与复购仍需真实验证",
        },
        isConfirmed: true,
      }
    );
    await assertRedTeamWake(org.id, akkCorrected.id);

    const correctedPotential = assessProductPotential({
      dimensions: akkDimensions(),
      gates: [
        {
          key: "channel-economics",
          label: "直播渠道经济性",
          status: "PASS",
          reason: `贡献毛利率 ${akkEconomics.contributionMarginRate}%`,
          sourceRefs: ["calc:akk-299:v1"],
        },
        {
          key: "marketing-redline",
          label: "减肥营销红线",
          status: "PASS",
          reason: "减肥/瘦身/燃脂已明确进入 forbiddenClaims",
          sourceRefs: ["product-version:akk-v3"],
        },
        {
          key: "finished-product-validation",
          label: "成品验证",
          status: "UNKNOWN",
          reason: "真实体感、转化和复购结果尚未产生",
          sourceRefs: [],
        },
      ],
      marketValidationVerified: false,
    });
    assert.equal(correctedPotential.verdict, "NEEDS_EVIDENCE");
    assert.equal(correctedPotential.blockers.length, 0);
    assert.equal(correctedPotential.unknownGates.length, 1);

    const correctedPrediction = await freezePotentialPrediction(session, {
      productId: akk.product.id,
      productVersionId: akkCorrected.id,
      dimensions: akkDimensions(),
      gates: [
        {
          key: "channel-economics",
          label: "直播渠道经济性",
          status: "PASS",
          reason: "直播经济性满足",
          sourceRefs: ["calc:akk-299:v1"],
        },
        {
          key: "marketing-redline",
          label: "减肥营销红线",
          status: "PASS",
          reason: "高风险减肥口播已移除",
          sourceRefs: ["product-version:akk-v3"],
        },
        {
          key: "finished-product-validation",
          label: "成品验证",
          status: "UNKNOWN",
          reason: "需要真实直播转化、体感和复购验证",
          sourceRefs: [],
        },
      ],
      marketValidationVerified: false,
      segmentKey: "live-gut-health",
      channelRouteId: "akk-live-299",
      channelRouteSnapshot: {
        rule: liveRule.key,
        ruleVersion: liveRule.version,
        retailPrice: 299,
        contributionMarginRate: akkEconomics.contributionMarginRate,
      },
      evidenceFingerprint: "akk-v3-claim-corrected",
      modelPolicyKey: "strategic-frontier",
      promptVersion: "golden-org-multi/v1",
    });
    assert.equal(correctedPrediction.verdict, "NEEDS_EVIDENCE");

    assert.equal(
      await prisma.frozenPrediction.count({
        where: { organizationId: org.id },
      }),
      3
    );
    assert.equal(
      await prisma.productOutcome.count({
        where: { organizationId: org.id },
      }),
      0
    );
    assert.equal(
      await prisma.experienceLesson.count({
        where: { organizationId: org.id },
      }),
      0
    );
    console.log("  ✔ claim correction changes the gate state, but Harness still waits for real outcomes before learning");

    console.log("\n✅ Golden organization multi-case regression passed");
  } finally {
    const userIds = (
      await prisma.user.findMany({
        where: { organizationId: org.id },
        select: { id: true },
      })
    ).map((user) => user.id);
    await prisma.auditEvent.deleteMany({
      where: { actorId: { in: userIds } },
    });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.$disconnect();
    delete process.env.DEV_MOCK_AUTH;
  }
}

main().catch(async (error) => {
  console.error("❌ Golden organization multi-case regression failed:", error);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exitCode = 1;
});
