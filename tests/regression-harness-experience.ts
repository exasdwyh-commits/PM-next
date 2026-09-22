import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  OrgRole,
  ProductValidationOutcomeStatus,
  Role,
} from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import {
  freezePotentialPrediction,
  getExperienceOverview,
  rebuildDimensionExperienceLesson,
  recordVerifiedProductOutcome,
  reviewExperienceLesson,
} from "../src/modules/evaluation-harness/persistence";
import {
  PRODUCT_POTENTIAL_WEIGHTS,
  type PotentialDimensionInput,
} from "../src/modules/product-development/potential-assessment";

function highDimensions(): PotentialDimensionInput[] {
  return [
    { key: "DEMAND", score: 92, evidenceState: "VERIFIED", rationale: "已核实需求", sourceRefs: ["e-demand"] },
    { key: "CHANNEL_FIT", score: 90, evidenceState: "VERIFIED", rationale: "渠道验证", sourceRefs: ["e-channel"] },
    { key: "UNIT_ECONOMICS", score: 86, evidenceState: "VERIFIED", rationale: "经济性验证", sourceRefs: ["e-econ"] },
    { key: "DIFFERENTIATION", score: 82, evidenceState: "VERIFIED", rationale: "差异化验证", sourceRefs: ["e-diff"] },
    { key: "REPEAT_PURCHASE", score: 78, evidenceState: "VERIFIED", rationale: "复购验证", sourceRefs: ["e-repeat"] },
    { key: "DELIVERY_FEASIBILITY", score: 90, evidenceState: "VERIFIED", rationale: "供应确认", sourceRefs: ["e-delivery"] },
    { key: "COMPANY_FIT", score: 88, evidenceState: "VERIFIED", rationale: "公司适配", sourceRefs: ["e-company"] },
  ];
}

function lowDimensions(): PotentialDimensionInput[] {
  return [
    { key: "DEMAND", score: 42, evidenceState: "VERIFIED", rationale: "需求弱", sourceRefs: ["e-demand-2"] },
    { key: "CHANNEL_FIT", score: 45, evidenceState: "VERIFIED", rationale: "渠道适配弱", sourceRefs: ["e-channel-2"] },
    { key: "UNIT_ECONOMICS", score: 40, evidenceState: "VERIFIED", rationale: "经济性弱", sourceRefs: ["e-econ-2"] },
    { key: "DIFFERENTIATION", score: 48, evidenceState: "VERIFIED", rationale: "差异化弱", sourceRefs: ["e-diff-2"] },
    { key: "REPEAT_PURCHASE", score: 45, evidenceState: "VERIFIED", rationale: "复购弱", sourceRefs: ["e-repeat-2"] },
    { key: "DELIVERY_FEASIBILITY", score: 50, evidenceState: "VERIFIED", rationale: "交付一般", sourceRefs: ["e-delivery-2"] },
    { key: "COMPANY_FIT", score: 50, evidenceState: "VERIFIED", rationale: "适配一般", sourceRefs: ["e-company-2"] },
  ];
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error("Explicit test database required");
  }
  await assertTestDatabaseSafety(prisma);

  const tag = randomUUID();
  const org = await prisma.organization.create({
    data: { name: "Experience Harness Test", code: "EXP_" + tag },
  });
  const otherOrg = await prisma.organization.create({
    data: { name: "Other Experience Test", code: "EXP_OTHER_" + tag },
  });

  const admin = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: "exp-admin-" + tag + "@hermes.test",
      name: "Experience Admin",
    },
  });
  const outsider = await prisma.user.create({
    data: {
      organizationId: otherOrg.id,
      email: "exp-outsider-" + tag + "@hermes.test",
      name: "Experience Outsider",
    },
  });

  await prisma.organizationMember.createMany({
    data: [
      { organizationId: org.id, userId: admin.id, role: OrgRole.ORG_ADMIN },
      { organizationId: otherOrg.id, userId: outsider.id, role: OrgRole.ORG_ADMIN },
    ],
  });

  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      name: "Harness Product",
      identityCode: "HARNESS-" + tag,
      targetAudience: "测试目标人群",
      marketPath: "快手直播",
      devMode: "NEW_PRODUCT",
      ownerId: admin.id,
    },
  });

  const version = await prisma.productVersion.create({
    data: {
      productId: product.id,
      versionTag: "v1",
      specs: {
        schemaVersion: "1.0",
        form: "powder",
        retailPrice: 299,
        bundleQuantity: 12,
      },
      targetCost: 72,
      currency: "CNY",
      isImmutable: true,
      isConfirmed: true,
    },
  });

  const project = await prisma.project.create({
    data: {
      organizationId: org.id,
      mode: "NEW_PRODUCT",
      title: "Harness product validation",
      target: "验证产品潜力经验闭环",
      stage: "RESEARCH",
      productId: product.id,
      productVersionId: version.id,
      ownerId: admin.id,
    },
  });
  await prisma.projectMember.create({
    data: { projectId: project.id, userId: admin.id, role: Role.OWNER },
  });

  const adminSession = {
    userId: admin.id,
    organizationId: org.id,
    userEmail: admin.email,
    userName: admin.name,
  };
  const outsiderSession = {
    userId: outsider.id,
    organizationId: otherOrg.id,
    userEmail: outsider.email,
    userName: outsider.name,
  };

  try {
    console.log("▶ E1 frozen prediction is recomputed and fingerprinted server-side");
    const strong = await freezePotentialPrediction(adminSession, {
      productId: product.id,
      productVersionId: version.id,
      dimensions: highDimensions(),
      gates: [],
      marketValidationVerified: true,
      segmentKey: "kuaishou-health",
      channelRouteId: "route-live-299-12",
      channelRouteSnapshot: {
        channel: "KUAISHOU_LIVE",
        retailPrice: 299,
        bundleQuantity: 12,
        commissionRate: 25,
      },
      evidenceFingerprint: "evidence-set-strong",
      modelPolicyKey: "strategic-frontier",
      modelProfileId: "gpt-frontier",
      promptVersion: "product-potential/1",
    });
    assert.equal(strong.verdict, "PRIORITIZE_FOR_VALIDATION");
    assert.match(strong.productVersionFingerprint, /^[a-f0-9]{64}$/);
    assert.match(strong.channelRouteFingerprint ?? "", /^[a-f0-9]{64}$/);
    assert.equal(strong.coverageRatio, 1);
    console.log("  ✔ server recomputes verdict and freezes product/channel fingerprints");

    console.log("▶ E2 verified outcomes are immutable per observation window");
    const d30 = await recordVerifiedProductOutcome(
      adminSession,
      strong.id,
      {
        observationKey: "D30",
        outcome: ProductValidationOutcomeStatus.SUCCESS,
        evidenceRefs: ["sales-report:d30", "channel-settlement:d30"],
        channelAccepted: true,
        launched: true,
        actualContributionMarginRate: 18.4,
        actualReturnRate: 0.04,
        repeatPurchaseRate: 0.12,
        observationDays: 30,
        notes: ["首月渠道验证通过"],
      }
    );
    assert.equal(d30.backtestAlignment, "ALIGNED_SUCCESS");

    await assert.rejects(
      recordVerifiedProductOutcome(adminSession, strong.id, {
        observationKey: "D30",
        outcome: ProductValidationOutcomeStatus.FAILURE,
        evidenceRefs: ["attempt-overwrite"],
      }),
      (error: any) => error?.statusCode === 409
    );

    const d90 = await recordVerifiedProductOutcome(
      adminSession,
      strong.id,
      {
        observationKey: "D90",
        outcome: ProductValidationOutcomeStatus.FAILURE,
        evidenceRefs: ["sales-report:d90", "refund-report:d90"],
        actualReturnRate: 0.2,
        repeatPurchaseRate: 0.03,
        observationDays: 90,
        notes: ["长期退款与复购未达到目标"],
      }
    );
    assert.equal(d90.backtestAlignment, "FALSE_POSITIVE");
    assert.notEqual(d30.id, d90.id);
    console.log("  ✔ D30 success and D90 failure coexist; history is never overwritten");

    console.log("▶ E3 unverified or cross-tenant outcomes fail closed");
    await assert.rejects(
      recordVerifiedProductOutcome(adminSession, strong.id, {
        observationKey: "D60",
        outcome: ProductValidationOutcomeStatus.SUCCESS,
        evidenceRefs: [],
      }),
      (error: any) => error?.statusCode === 422
    );
    await assert.rejects(
      recordVerifiedProductOutcome(outsiderSession, strong.id, {
        observationKey: "D60",
        outcome: ProductValidationOutcomeStatus.SUCCESS,
        evidenceRefs: ["foreign:1"],
      }),
      (error: any) => error?.statusCode === 404
    );
    console.log("  ✔ no evidence means no learning label; cross-org prediction is hidden");

    console.log("▶ E4 failure prediction supplies the comparison arm for experience learning");
    const weak = await freezePotentialPrediction(adminSession, {
      productId: product.id,
      productVersionId: version.id,
      dimensions: lowDimensions(),
      gates: [],
      marketValidationVerified: true,
      segmentKey: "kuaishou-health",
      channelRouteId: "route-live-299-12-weak",
      channelRouteSnapshot: {
        channel: "KUAISHOU_LIVE",
        retailPrice: 299,
        bundleQuantity: 12,
        commissionRate: 25,
        assumedHighCost: true,
      },
      evidenceFingerprint: "evidence-set-weak",
    });
    assert.equal(weak.verdict, "DEPRIORITIZE");

    const weakD30 = await recordVerifiedProductOutcome(
      adminSession,
      weak.id,
      {
        observationKey: "D30",
        outcome: ProductValidationOutcomeStatus.FAILURE,
        evidenceRefs: ["validation-report:weak-d30"],
        channelAccepted: false,
        launched: false,
        observationDays: 30,
      }
    );
    assert.equal(weakD30.backtestAlignment, "ALIGNED_FAILURE");
    console.log("  ✔ positive/negative arms are both stored with verified outcomes");

    console.log("▶ E5 experience remains a candidate until evidence thresholds and human review");
    const initialWeight = PRODUCT_POTENTIAL_WEIGHTS.CHANNEL_FIT;

    const insufficient = await rebuildDimensionExperienceLesson(
      adminSession,
      {
        segmentKey: "kuaishou-health",
        observationKey: "D30",
        dimensionKey: "CHANNEL_FIT",
      }
    );
    assert.equal(insufficient.readyForReview, false);
    assert.equal(insufficient.status, "CANDIDATE");

    await assert.rejects(
      reviewExperienceLesson(adminSession, insufficient.id, {
        decision: "APPROVE",
        reason: "too early",
      }),
      (error: any) => error?.statusCode === 422
    );

    const reviewable = await rebuildDimensionExperienceLesson(
      adminSession,
      {
        segmentKey: "kuaishou-health",
        observationKey: "D30",
        dimensionKey: "CHANNEL_FIT",
        minSampleSize: 2,
        minMeanGap: 10,
      }
    );
    assert.equal(reviewable.readyForReview, true);
    assert.equal(reviewable.status, "CANDIDATE");
    assert.ok(reviewable.sampleSize >= 2);

    const approved = await reviewExperienceLesson(
      adminSession,
      reviewable.id,
      {
        decision: "APPROVE",
        reason: "样本达到本轮测试门槛，仅批准为组织经验，不自动改生产规则",
      }
    );
    assert.equal(approved.status, "APPROVED");
    assert.equal(approved.proposedChange, null);
    assert.equal(PRODUCT_POTENTIAL_WEIGHTS.CHANNEL_FIT, initialWeight);
    console.log("  ✔ approval promotes experience knowledge only; production weights stay unchanged");

    console.log("▶ E6 experience overview exposes learning quality, not a fake accuracy score");
    const overview = await getExperienceOverview(adminSession);
    assert.equal(overview.predictionCount, 2);
    assert.equal(overview.backtests.ALIGNED_SUCCESS, 1);
    assert.equal(overview.backtests.ALIGNED_FAILURE, 1);
    assert.equal(overview.backtests.FALSE_POSITIVE, 1);
    assert.equal(overview.lessons.APPROVED, 1);
    assert.equal(overview.lessons.CANDIDATE, 1);

    const auditCount = await prisma.auditEvent.count({
      where: {
        actorId: admin.id,
        action: {
          in: [
            "POTENTIAL_PREDICTION_FROZEN",
            "PRODUCT_OUTCOME_VERIFIED",
            "EXPERIENCE_LESSON_REBUILT",
            "EXPERIENCE_LESSON_REVIEWED",
          ],
        },
      },
    });
    assert.ok(auditCount >= 8);
    console.log("  ✔ prediction/outcome/lesson transitions all leave audit evidence");

    console.log("\n✅ Harness experience persistence regression passed");
  } finally {
    const userIds = [admin.id, outsider.id];
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.organization.deleteMany({
      where: { id: { in: [org.id, otherOrg.id] } },
    });
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error("❌ Harness experience persistence regression failed:", error);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exitCode = 1;
});
