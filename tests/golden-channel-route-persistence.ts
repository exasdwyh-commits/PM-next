import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ChannelRuleRecordStatus,
  ChannelSpecRouteStatus,
  EvidenceNature,
  EvidenceVerifyStatus,
  OrgRole,
  ValidationStatus,
} from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import {
  createDevelopmentProduct,
  publishProductVersion,
} from "../src/modules/products/service";
import {
  assessAndSaveProductPotential,
  createChannelRuleProfile,
  evaluateAndSaveChannelRoute,
  listChannelRouteWorkspace,
  transitionChannelRouteStatus,
} from "../src/modules/product-development/channel-routes-service";
import type { PotentialDimensionInput } from "../src/modules/product-development/potential-assessment";

function dimensions(channelEvidenceId: string): PotentialDimensionInput[] {
  return [
    {
      key: "DEMAND",
      score: 82,
      evidenceState: "SUPPORTED",
      rationale: "需求信号明确，但不把渠道讨论冒充真实销量",
      sourceRefs: ["signal:private-demand"],
    },
    {
      key: "CHANNEL_FIT",
      score: 88,
      evidenceState: "VERIFIED",
      rationale: "同渠道真实验证 Evidence 已由负责人确认",
      sourceRefs: [channelEvidenceId],
    },
    {
      key: "UNIT_ECONOMICS",
      score: 84,
      evidenceState: "SUPPORTED",
      rationale: "路线经济性由确定性引擎计算",
      sourceRefs: ["calc:private-bundle"],
    },
    {
      key: "DIFFERENTIATION",
      score: 72,
      evidenceState: "ASSUMED",
      rationale: "差异化仍需消费者验证",
      sourceRefs: [],
    },
    {
      key: "REPEAT_PURCHASE",
      score: null,
      evidenceState: "UNKNOWN",
      rationale: "暂无复购数据",
      sourceRefs: [],
    },
    {
      key: "DELIVERY_FEASIBILITY",
      score: 86,
      evidenceState: "SUPPORTED",
      rationale: "现有供应与包装可交付",
      sourceRefs: ["supplier:confirmed"],
    },
    {
      key: "COMPANY_FIT",
      score: 90,
      evidenceState: "SUPPORTED",
      rationale: "符合当前产品线与渠道资源",
      sourceRefs: ["company-policy:portfolio"],
    },
  ];
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error("Explicit test database required");
  }
  await assertTestDatabaseSafety(prisma);

  const tag = randomUUID();
  const org = await prisma.organization.create({
    data: {
      name: "Golden Channel Route",
      code: "GOLD_ROUTE_" + tag,
    },
  });
  const admin = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: "gold-route-" + tag + "@hermes.test",
      name: "Golden Route Lead",
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
    console.log("▶ GCR1 create product + confirmed product version");
    const product = await createDevelopmentProduct(session, {
      name: "渠道路线黄金样品",
      coreIdea: "同一产品用不同渠道规格验证，不以单一总分替代渠道经济性",
      targetAudience: "35岁以上精准营养用户",
      coreSellingPoints: "半年周期方案 + 数据验证",
      targetChannels: "私域/会销、快手直播",
      priceExpectation: "299-499",
      targetCost: 18,
      formSpec: "多盒套餐",
    });

    const version = await publishProductVersion(session, product.product.id, {
      versionTag: "v2-route-golden",
      specs: {
        targetChannels: ["私域/会销", "快手直播"],
        bundleOptions: ["299/12盒", "499/24盒"],
      },
      targetCost: 18,
      currency: "CNY",
      isConfirmed: true,
    });
    assert.equal(version.isConfirmed, true);

    console.log("▶ GCR2 create confirmed private-sales rule and persist two independent routes");
    const privateRule = await createChannelRuleProfile(session, {
      channelKey: "private-sales",
      label: "私域/会销",
      version: "gold-v1",
      status: "CONFIRMED",
      sourceRefs: ["contract:private-sales:gold-v1"],
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
      effectiveFrom: "2020-01-01",
      effectiveUntil: "2099-12-31",
      constraints: ["多盒机制"],
    });
    assert.equal(privateRule.status, ChannelRuleRecordStatus.CONFIRMED);

    const route299v1 = await evaluateAndSaveChannelRoute(
      session,
      product.product.id,
      {
        productVersionId: version.id,
        channelRuleProfileId: privateRule.id,
        routeKey: "private-299-12",
        name: "私域 299 / 12盒",
        retailPrice: 299,
        bundleQuantity: 12,
        unitLabel: "盒",
        productCostPerUnit: 7.5,
        packagingCostPerOrder: 10,
        freightCostPerOrder: 8,
      }
    );
    const route499 = await evaluateAndSaveChannelRoute(
      session,
      product.product.id,
      {
        productVersionId: version.id,
        channelRuleProfileId: privateRule.id,
        routeKey: "private-499-24",
        name: "私域 499 / 24盒",
        retailPrice: 499,
        bundleQuantity: 24,
        unitLabel: "盒",
        productCostPerUnit: 7.5,
        packagingCostPerOrder: 10,
        freightCostPerOrder: 8,
      }
    );
    assert.equal(route299v1.status, ChannelSpecRouteStatus.VALIDATION_READY);
    assert.equal(route499.status, ChannelSpecRouteStatus.VALIDATION_READY);
    assert.notEqual(
      Number(route299v1.contributionMarginRate),
      Number(route499.contributionMarginRate),
      "两条规格路线必须保留独立经济性"
    );

    console.log("▶ GCR3 route revision supersedes previous route instead of overwriting it");
    const route299v2 = await evaluateAndSaveChannelRoute(
      session,
      product.product.id,
      {
        productVersionId: version.id,
        channelRuleProfileId: privateRule.id,
        routeKey: "private-299-12",
        name: "私域 299 / 12盒",
        retailPrice: 299,
        bundleQuantity: 12,
        unitLabel: "盒",
        productCostPerUnit: 8,
        packagingCostPerOrder: 10,
        freightCostPerOrder: 8,
      }
    );
    assert.equal(route299v2.revision, 2);
    assert.equal(route299v2.supersedesId, route299v1.id);
    const oldRoute = await prisma.channelSpecRoute.findUniqueOrThrow({
      where: { id: route299v1.id },
    });
    assert.equal(oldRoute.status, ChannelSpecRouteStatus.SUPERSEDED);

    console.log("▶ GCR4 only same-channel verified market evidence can confirm a route");
    const privateEvidence = await prisma.evidence.create({
      data: {
        projectId: product.project.id,
        contentOrUri: "gold://private-sales/validation",
        source: "私域试销复盘",
        author: "Golden Route Lead",
        hash: "gold-private-" + tag,
        nature: EvidenceNature.REAL,
        verifyStatus: EvidenceVerifyStatus.VERIFIED,
        verifiedByUserId: admin.id,
        verifiedAt: new Date(),
        validationStatus: ValidationStatus.VERIFIED_BY_LEAD,
        validationSampleSize: "50 orders",
        validationTimeRange: "2026-09-01..2026-09-15",
        validationLimitations: "Golden fixture: only proves channel-scoped governance",
        productRef: product.product.name,
        channel: "私域/会销",
      },
    });

    const validatingPrivate = await transitionChannelRouteStatus(
      session,
      product.product.id,
      {
        routeId: route299v2.id,
        targetStatus: "VALIDATING",
      }
    );
    assert.equal(validatingPrivate.status, ChannelSpecRouteStatus.VALIDATING);

    const confirmedPrivate = await transitionChannelRouteStatus(
      session,
      product.product.id,
      {
        routeId: route299v2.id,
        targetStatus: "CONFIRMED",
      }
    );
    assert.equal(confirmedPrivate.status, ChannelSpecRouteStatus.CONFIRMED);

    const liveRule = await createChannelRuleProfile(session, {
      channelKey: "kuaishou-live",
      label: "快手直播",
      version: "gold-v1",
      status: "CONFIRMED",
      sourceRefs: ["contract:kuaishou:gold-v1"],
      minRetailPrice: 299,
      maxRetailPrice: 299,
      minBundleQuantity: 1,
      maxBundleQuantity: 1,
      allowedUnitLabels: ["盒"],
      commissionRate: 45,
      platformFeeRate: 3,
      marketingRate: 5,
      managementFeeRate: 1,
      returnRate: 6,
      returnHandlingFeeRate: 5,
      targetContributionMarginRate: 10,
      effectiveFrom: "2020-01-01",
      effectiveUntil: "2099-12-31",
      constraints: [],
    });
    const liveRoute = await evaluateAndSaveChannelRoute(
      session,
      product.product.id,
      {
        productVersionId: version.id,
        channelRuleProfileId: liveRule.id,
        routeKey: "kuaishou-299-1",
        name: "快手 299 / 单盒",
        retailPrice: 299,
        bundleQuantity: 1,
        unitLabel: "盒",
        productCostPerUnit: 18,
        packagingCostPerOrder: 8,
        freightCostPerOrder: 8,
      }
    );
    await transitionChannelRouteStatus(session, product.product.id, {
      routeId: liveRoute.id,
      targetStatus: "VALIDATING",
    });
    await assert.rejects(
      () =>
        transitionChannelRouteStatus(session, product.product.id, {
          routeId: liveRoute.id,
          targetStatus: "CONFIRMED",
        }),
      /与该渠道匹配/
    );

    console.log("▶ GCR5 persisted potential assessment keeps evidence provenance and history");
    const firstAssessment = await assessAndSaveProductPotential(
      session,
      product.product.id,
      {
        productVersionId: version.id,
        channelRouteId: route299v2.id,
        dimensions: dimensions(privateEvidence.id),
        gates: [
          {
            key: "finished-product-outcome",
            label: "成品长期结果",
            status: "UNKNOWN",
            reason: "当前仅有短期渠道验证，长期复购仍未知",
            sourceRefs: [],
          },
        ],
      }
    );
    assert.equal(firstAssessment.marketValidationVerified, true);
    assert.equal(firstAssessment.record.channelRouteId, route299v2.id);
    assert.equal(firstAssessment.assessment.verdict, "NEEDS_EVIDENCE");

    const secondDimensions = dimensions(privateEvidence.id).map((dimension) =>
      dimension.key === "DEMAND"
        ? { ...dimension, score: 85 }
        : dimension
    );
    const secondAssessment = await assessAndSaveProductPotential(
      session,
      product.product.id,
      {
        productVersionId: version.id,
        channelRouteId: route299v2.id,
        dimensions: secondDimensions,
        gates: [
          {
            key: "finished-product-outcome",
            label: "成品长期结果",
            status: "UNKNOWN",
            reason: "长期复购仍未知",
            sourceRefs: [],
          },
        ],
      }
    );
    assert.equal(secondAssessment.record.supersedesId, firstAssessment.record.id);

    await assert.rejects(
      () =>
        assessAndSaveProductPotential(session, product.product.id, {
          productVersionId: version.id,
          channelRouteId: liveRoute.id,
          dimensions: dimensions(privateEvidence.id),
          gates: [],
        }),
      /与该路线匹配的渠道 Evidence/
    );

    console.log("▶ GCR6 ASSUMED draft does not retire current confirmed rule; new confirmed rule does");
    const privateDraft = await createChannelRuleProfile(session, {
      channelKey: "private-sales",
      label: "私域/会销",
      version: "gold-draft-v2",
      status: "ASSUMED",
      sourceRefs: [],
      minRetailPrice: 299,
      maxRetailPrice: 599,
      minBundleQuantity: 12,
      maxBundleQuantity: 24,
      allowedUnitLabels: ["盒"],
      commissionRate: 36,
      platformFeeRate: 0,
      marketingRate: 5,
      managementFeeRate: 2,
      returnRate: 4,
      returnHandlingFeeRate: 5,
      targetContributionMarginRate: 10,
      constraints: ["待渠道确认新佣金"],
    });
    assert.equal(privateDraft.status, ChannelRuleRecordStatus.ASSUMED);

    const stillConfirmed = await prisma.channelRuleProfileRecord.findUniqueOrThrow({
      where: { id: privateRule.id },
    });
    assert.equal(stillConfirmed.status, ChannelRuleRecordStatus.CONFIRMED);

    const privateRuleV2 = await createChannelRuleProfile(session, {
      channelKey: "private-sales",
      label: "私域/会销",
      version: "gold-v2",
      status: "CONFIRMED",
      sourceRefs: ["contract:private-sales:gold-v2"],
      minRetailPrice: 299,
      maxRetailPrice: 599,
      minBundleQuantity: 12,
      maxBundleQuantity: 24,
      allowedUnitLabels: ["盒"],
      commissionRate: 36,
      platformFeeRate: 0,
      marketingRate: 5,
      managementFeeRate: 2,
      returnRate: 4,
      returnHandlingFeeRate: 5,
      targetContributionMarginRate: 10,
      effectiveFrom: "2020-01-01",
      effectiveUntil: "2099-12-31",
      constraints: ["新确认佣金"],
    });
    assert.equal(privateRuleV2.status, ChannelRuleRecordStatus.CONFIRMED);

    const [oldConfirmedAfter, oldDraftAfter] = await Promise.all([
      prisma.channelRuleProfileRecord.findUniqueOrThrow({
        where: { id: privateRule.id },
      }),
      prisma.channelRuleProfileRecord.findUniqueOrThrow({
        where: { id: privateDraft.id },
      }),
    ]);
    assert.equal(oldConfirmedAfter.status, ChannelRuleRecordStatus.SUPERSEDED);
    assert.equal(oldDraftAfter.status, ChannelRuleRecordStatus.SUPERSEDED);

    const workspace = await listChannelRouteWorkspace(
      session,
      product.product.id
    );
    const staleRoute = workspace.routes.find((route) => route.id === route299v2.id);
    assert.equal(staleRoute?.needsReevaluation, true);
    assert.ok(
      workspace.rules.some(
        (rule) =>
          rule.id === privateRuleV2.id &&
          rule.status === ChannelRuleRecordStatus.CONFIRMED
      )
    );

    console.log("\n✅ Golden channel-route persistence regression passed");
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
  }
}

main().catch(async (error) => {
  console.error("❌ Golden channel-route persistence regression failed:", error);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exitCode = 1;
});
