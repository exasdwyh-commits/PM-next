import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import {
  AgentTaskStatus,
  EvidenceNature,
  EvidenceVerifyStatus,
  OrgRole,
  Role,
} from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import {
  bootstrapDefaultWorkforce,
  delegateAgentTask,
  finishAgentTask,
  resolveReturnedChildReview,
  startAgentTask,
} from "../src/modules/workforce/service";
import { bootstrapDefaultAutopilots } from "../src/modules/autopilot";
import { createManualSignal } from "../src/modules/signal/manual-signal";
import {
  createDevelopmentProduct,
  publishProductVersion,
} from "../src/modules/products/service";
import { POST as verifyEvidencePost } from "../src/app/api/evidences/[id]/verify/route";
import {
  evaluateChannelSpecCandidate,
  type ChannelRuleProfile,
} from "../src/modules/product-development/channel-spec";
import {
  assessProductPotential,
  type PotentialDimensionInput,
} from "../src/modules/product-development/potential-assessment";
import {
  freezePotentialPrediction,
  getExperienceOverview,
} from "../src/modules/evaluation-harness/persistence";
import { generateChallengeReport } from "../src/modules/advisor/challenge";
import type { ScientificEvidenceInput } from "../src/modules/research/scientific-evidence";
import { getWorkforceActivityBrief } from "../src/modules/workforce/activity-brief";

function strongButMixedEvidenceDimensions(): PotentialDimensionInput[] {
  return [
    {
      key: "DEMAND",
      score: 88,
      evidenceState: "SUPPORTED",
      rationale: "私域渠道已有高客单抗衰咨询与成交意向，但仍需正式试销验证",
      sourceRefs: ["signal:private-aging-demand"],
    },
    {
      key: "CHANNEL_FIT",
      score: 84,
      evidenceState: "SUPPORTED",
      rationale: "半年套餐适合私域解释式销售，渠道规则已取得本轮确认资料",
      sourceRefs: ["channel-rule:private-sales:v1"],
    },
    {
      key: "UNIT_ECONOMICS",
      score: 86,
      evidenceState: "SUPPORTED",
      rationale: "1999 套餐在本轮确认费率与成本假设下有正贡献空间",
      sourceRefs: ["calc:akg-1999-186:v1"],
    },
    {
      key: "DIFFERENTIATION",
      score: 82,
      evidenceState: "SUPPORTED",
      rationale: "AKG + 生物年龄检测形成服务差异，但功效关联不得视为已验证",
      sourceRefs: ["product-version:v2"],
    },
    {
      key: "REPEAT_PURCHASE",
      score: 72,
      evidenceState: "ASSUMED",
      rationale: "半年周期有持续服务逻辑，真实复购尚未观察",
      sourceRefs: [],
    },
    {
      key: "DELIVERY_FEASIBILITY",
      score: 90,
      evidenceState: "SUPPORTED",
      rationale: "186 条规格在现有供应链可交付",
      sourceRefs: ["supplier:akg-strip:v1"],
    },
    {
      key: "COMPANY_FIT",
      score: 92,
      evidenceState: "VERIFIED",
      rationale: "符合公司私域精准营养与长期数据服务方向",
      sourceRefs: ["company-policy:precision-nutrition"],
    },
  ];
}

const privateSalesRule: ChannelRuleProfile = {
  key: "PRIVATE_SALES_1999_TEST",
  label: "私域高客单测试规则",
  version: "2026-09-22-v1",
  status: "CONFIRMED",
  sourceRefs: ["channel-rule:private-sales:v1"],
  minRetailPrice: 999,
  maxRetailPrice: 2999,
  minBundleQuantity: 180,
  maxBundleQuantity: 200,
  allowedUnitLabels: ["条"],
  commissionRate: 50,
  platformFeeRate: 0,
  marketingRate: 5,
  managementFeeRate: 0,
  returnRate: 5,
  returnHandlingFeeRate: 5,
  targetContributionMarginRate: 15,
  constraints: ["半年套餐必须能说明检测、履约与退款边界"],
};

const akgEvidence: ScientificEvidenceInput = {
  ingredient: "Ca-AKG",
  aliases: ["AKG", "α-酮戊二酸"],
  claim: "支持健康老龄化相关代谢研究",
  evidenceLevel: "B",
  humanRCTCount: 1,
  sampleSizeTotal: 120,
  doseRange: "1 g/day",
  mechanism: "代谢与表观遗传相关机制仍需成品验证",
  applicablePopulation: "成年人",
  marketingSay: "支持健康老龄化研究方向",
  marketingNever: "减龄、逆龄、年轻3年",
  confidence: 70,
  lastReviewed: "2026-09-22",
  status: "CONFIRMED",
  sourceType: "RAW_MATERIAL_STUDY",
  researchSubjects: "HUMAN",
};

async function main() {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error("Explicit test database required");
  }
  await assertTestDatabaseSafety(prisma);
  process.env.DEV_MOCK_AUTH = "true";

  const tag = randomUUID();
  const org = await prisma.organization.create({
    data: { name: "Golden Org Loop", code: "GOLD_ORG_" + tag },
  });
  const admin = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: "gold-org-" + tag + "@hermes.test",
      name: "Golden Product Lead",
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
    const workforce = await bootstrapDefaultWorkforce(session);
    await bootstrapDefaultAutopilots(session);

    console.log("▶ GO1 real demand signal wakes Hermes PM but remains UNVERIFIED");
    const signal = await createManualSignal(session, {
      title: "私域用户持续询问可量化的抗衰与生物年龄管理方案",
      summary: "渠道反馈愿意为半年服务方案支付高客单，但效果承诺仍需证据与合规审查",
      category: "product-demand",
      productRef: "AKG 钙半年套餐",
      channel: "私域/会销",
      valueTier: "high",
      valueReason: "直接影响新品立项与规格设计，并已出现明确高客单购买意向",
    });
    assert.equal(signal.verifyStatus, EvidenceVerifyStatus.UNVERIFIED);

    const signalEvent = await prisma.businessEvent.findUniqueOrThrow({
      where: {
        organizationId_eventKey: {
          organizationId: org.id,
          eventKey: `signal:${signal.id}:captured`,
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
    assert.equal(signalEvent.autopilotReceipt?.agentTask?.agent.code, "hermes_pm");
    assert.equal(
      signalEvent.autopilotReceipt?.decisionRun?.decisionKey,
      "signal.should_wake_pm"
    );
    console.log("  ✔ market signal creates a PM task without upgrading the signal into verified evidence");

    console.log("▶ GO2 product intake preserves the real commercial constraints");
    const development = await createDevelopmentProduct(session, {
      name: "AKG 钙半年套餐",
      coreIdea:
        "面向35岁以上私域用户，用半年营养方案 + 生物年龄检测形成持续服务闭环",
      targetAudience: "35岁以上关注健康老龄化与生物年龄管理的人群",
      coreSellingPoints:
        "AKG 营养方案、半年持续服务、甲基化年龄检测前后对照；不把检测变化直接等同于产品减龄功效",
      targetChannels: "私域/会销",
      priceExpectation: "1999元/半年",
      targetCost: 150,
      formSpec: "186条/套，每日1条",
      forbiddenItems: "禁止宣称减龄、逆龄、年轻1-3年、无效退款式功效保证",
    });
    assert.equal(development.product.lifecycleStage, "IDEA");
    assert.equal(development.version.isConfirmed, false);
    console.log("  ✔ idea/product/project/version are created atomically; unknowns remain explicit");

    console.log("▶ GO3 published commercial route wakes Red Team");
    const v2 = await publishProductVersion(session, development.product.id, {
      versionTag: "v2-commercial",
      specs: {
        audience: "35+",
        channel: "私域/会销",
        retailPrice: 1999,
        bundleQuantity: 186,
        unitLabel: "条",
        dailyUse: "1条/日",
        service: "甲基化年龄检测前后对照",
        proposedClaim: "挑战减龄1-3年，无效退款",
      },
      targetCost: 150,
      currency: "CNY",
      unknowns: {
        finishedProductEfficacy: "成品对甲基化年龄变化的因果证据未验证",
        refundMechanism: "功效型退款承诺存在科学与合规风险",
      },
      isConfirmed: true,
    });

    const versionEvent = await prisma.businessEvent.findUniqueOrThrow({
      where: {
        organizationId_eventKey: {
          organizationId: org.id,
          eventKey: `product-version:${v2.id}:published`,
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
    assert.equal(versionEvent.autopilotReceipt?.agentTask?.agent.code, "red_team");
    assert.equal(
      versionEvent.autopilotReceipt?.decisionRun?.decisionKey,
      "product_version.should_red_team"
    );
    console.log("  ✔ immutable ProductVersion automatically produces a Red Team challenge task");

    console.log("▶ GO4 channel economics can pass while science/compliance gate still blocks");
    const economics = evaluateChannelSpecCandidate(
      {
        id: "akg-1999-186",
        retailPrice: 1999,
        bundleQuantity: 186,
        unitLabel: "条",
        productCostPerUnit: 0.5,
        packagingCostPerOrder: 20,
        freightCostPerOrder: 8,
      },
      privateSalesRule
    );
    assert.equal(economics.feasible, true);
    assert.ok(economics.contributionMarginRate >= 15);

    const challenge = generateChallengeReport({
      productName: "AKG 钙半年套餐",
      proposedClaim: "挑战减龄1-3年，无效退款",
      targetPrice: 1999,
      targetDuration: "6个月",
      ingredients: [akgEvidence],
      competitorCount: 1,
    });
    assert.equal(challenge.overallRisk, "CRITICAL");
    assert.equal(challenge.recommendation, "KILL");

    const blockedAssessment = assessProductPotential({
      dimensions: strongButMixedEvidenceDimensions(),
      gates: [
        {
          key: "channel-economics",
          label: "渠道规格经济性",
          status: economics.feasible ? "PASS" : "FAIL",
          reason: economics.feasible
            ? `贡献毛利率 ${economics.contributionMarginRate}% 达到目标`
            : economics.blockers.join("；"),
          sourceRefs: ["calc:akg-1999-186:v1"],
        },
        {
          key: "science-compliance",
          label: "科学证据与功效宣称",
          status: challenge.recommendation === "KILL" ? "FAIL" : "UNKNOWN",
          reason: challenge.topFailureReasons.join("；"),
          sourceRefs: ["challenge:akg-v2"],
        },
      ],
      marketValidationVerified: false,
    });
    assert.equal(blockedAssessment.verdict, "BLOCKED");
    assert.ok((blockedAssessment.diagnosticIndex ?? 0) > 75);

    const blockedPrediction = await freezePotentialPrediction(session, {
      productId: development.product.id,
      productVersionId: v2.id,
      dimensions: strongButMixedEvidenceDimensions(),
      gates: [
        {
          key: "channel-economics",
          label: "渠道规格经济性",
          status: "PASS",
          reason: `贡献毛利率 ${economics.contributionMarginRate}% 达到目标`,
          sourceRefs: ["calc:akg-1999-186:v1"],
        },
        {
          key: "science-compliance",
          label: "科学证据与功效宣称",
          status: "FAIL",
          reason: "原料级研究不能支持成品减龄1-3年与无效退款承诺",
          sourceRefs: ["challenge:akg-v2"],
        },
      ],
      marketValidationVerified: false,
      segmentKey: "private-sales-aging",
      channelRouteId: "private-1999-186",
      channelRouteSnapshot: {
        rule: privateSalesRule.key,
        ruleVersion: privateSalesRule.version,
        retailPrice: 1999,
        bundleQuantity: 186,
        contributionMarginRate: economics.contributionMarginRate,
      },
      evidenceFingerprint: "akg-v2-evidence-incomplete",
      modelPolicyKey: "strategic-frontier",
      promptVersion: "golden-org-loop/v1",
    });
    assert.equal(blockedPrediction.verdict, "BLOCKED");
    console.log("  ✔ high diagnostic score and healthy economics cannot average away a hard scientific gate");

    console.log("▶ GO5 verified REAL evidence wakes PM but does not auto-green the product");
    const evidence = await prisma.evidence.create({
      data: {
        projectId: development.project.id,
        contentOrUri: "internal://evidence/akg-human-study-review",
        source: "原料级人体研究与内部科学审查",
        hash: randomUUID().replaceAll("-", ""),
        nature: EvidenceNature.REAL,
        verifyStatus: EvidenceVerifyStatus.UNVERIFIED,
        validationStatus: "UNAPPLIED",
        productRef: "AKG 钙半年套餐",
        channel: "私域/会销",
      },
    });

    const req = new NextRequest(
      "http://localhost/api/evidences/" + evidence.id + "/verify",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": admin.id,
          "x-organization-id": org.id,
        },
        body: JSON.stringify({ status: "VERIFIED" }),
      }
    );
    const response = await verifyEvidencePost(req, {
      params: Promise.resolve({ id: evidence.id }),
    });
    assert.equal(response.status, 200);

    const evidenceEvent = await prisma.businessEvent.findUniqueOrThrow({
      where: {
        organizationId_eventKey: {
          organizationId: org.id,
          eventKey: `evidence:${evidence.id}:verified`,
        },
      },
      include: {
        autopilotReceipt: {
          include: {
            agentTask: { include: { agent: true } },
            decisionRun: true,
          },
        },
      },
    });
    assert.equal(evidenceEvent.autopilotReceipt?.agentTask?.agent.code, "hermes_pm");
    assert.equal(
      evidenceEvent.autopilotReceipt?.decisionRun?.decisionKey,
      "evidence.should_wake_pm"
    );
    console.log("  ✔ verified evidence causes re-evaluation, not an automatic product approval");

    console.log("▶ GO6 corrected v3 improves the gate from FAIL to UNKNOWN, not fake PASS");
    const v3 = await publishProductVersion(session, development.product.id, {
      versionTag: "v3-claim-corrected",
      specs: {
        audience: "35+",
        channel: "私域/会销",
        retailPrice: 1999,
        bundleQuantity: 186,
        unitLabel: "条",
        dailyUse: "1条/日",
        service: "甲基化年龄检测用于长期健康管理观察",
        proposedClaim: "支持健康老龄化相关营养管理",
      },
      targetCost: 150,
      currency: "CNY",
      unknowns: {
        methylationOutcome:
          "检测变化与成品干预的因果关系仍需真实产品验证，不对减龄幅度做承诺",
      },
      isConfirmed: true,
    });

    const improvedDimensions = strongButMixedEvidenceDimensions().map((item) =>
      item.key === "DIFFERENTIATION"
        ? {
            ...item,
            score: 78,
            rationale: "差异化保留，但不再依赖高风险减龄承诺",
            sourceRefs: ["product-version:v3"],
          }
        : item
    );

    const improvedAssessment = assessProductPotential({
      dimensions: improvedDimensions,
      gates: [
        {
          key: "channel-economics",
          label: "渠道规格经济性",
          status: "PASS",
          reason: "经济性仍满足目标贡献毛利",
          sourceRefs: ["calc:akg-1999-186:v1"],
        },
        {
          key: "science-compliance",
          label: "科学证据与功效宣称",
          status: "UNKNOWN",
          reason: "高风险减龄承诺已移除，但真实成品长期效果仍未完成验证",
          sourceRefs: [`evidence:${evidence.id}`, "product-version:v3"],
        },
      ],
      marketValidationVerified: false,
    });
    assert.equal(improvedAssessment.verdict, "NEEDS_EVIDENCE");
    assert.equal(improvedAssessment.blockers.length, 0);
    assert.equal(improvedAssessment.unknownGates.length, 1);

    const improvedPrediction = await freezePotentialPrediction(session, {
      productId: development.product.id,
      productVersionId: v3.id,
      dimensions: improvedDimensions,
      gates: [
        {
          key: "channel-economics",
          label: "渠道规格经济性",
          status: "PASS",
          reason: "经济性满足",
          sourceRefs: ["calc:akg-1999-186:v1"],
        },
        {
          key: "science-compliance",
          label: "科学证据与功效宣称",
          status: "UNKNOWN",
          reason: "成品长期效果待真实验证",
          sourceRefs: [`evidence:${evidence.id}`],
        },
      ],
      marketValidationVerified: false,
      segmentKey: "private-sales-aging",
      channelRouteId: "private-1999-186",
      channelRouteSnapshot: {
        rule: privateSalesRule.key,
        ruleVersion: privateSalesRule.version,
        retailPrice: 1999,
        bundleQuantity: 186,
        contributionMarginRate: economics.contributionMarginRate,
      },
      evidenceFingerprint: "akg-v3-one-verified-evidence",
      modelPolicyKey: "strategic-frontier",
      promptVersion: "golden-org-loop/v1",
    });
    assert.equal(improvedPrediction.verdict, "NEEDS_EVIDENCE");
    console.log("  ✔ fixing the dangerous claim improves the state but missing validation remains explicit");

    console.log("▶ GO7 PM delegates evidence interpretation and receives a readable child result");
    const pmTask = evidenceEvent.autopilotReceipt?.agentTask;
    assert.ok(pmTask);
    const research = await prisma.agent.findUniqueOrThrow({
      where: {
        organizationId_code: {
          organizationId: org.id,
          code: "research_agent",
        },
      },
    });

    const startedPm = await startAgentTask(session, pmTask!.id);
    const delegated = await delegateAgentTask(session, {
      parentTaskId: pmTask!.id,
      toAgentId: research.id,
      goal:
        "Review the verified AKG evidence and distinguish what it supports from what still requires finished-product validation.",
      reason:
        "Hermes PM needs a specialist evidence interpretation before changing the product decision.",
      sourceRunId: startedPm.run.id,
    });
    const startedResearch = await startAgentTask(session, delegated.childTask.id);
    const resultSummary =
      "The verified evidence supports an ingredient-level healthy-aging research direction, but it does not establish that the finished 1999 package reduces methylation age by 1-3 years. Keep the claim corrected and run finished-product validation before any efficacy promise.";
    const finishedResearch = await finishAgentTask(
      session,
      delegated.childTask.id,
      {
        runId: startedResearch.run.id,
        outcome: "SUCCEEDED",
        resultSummary,
      }
    );
    assert.equal(finishedResearch.run.outputSummary, resultSummary);

    const childReturn = await prisma.businessEvent.findUniqueOrThrow({
      where: {
        organizationId_eventKey: {
          organizationId: org.id,
          eventKey: `agent-task:${delegated.childTask.id}:terminal`,
        },
      },
      include: {
        autopilotReceipt: {
          include: {
            agentTask: { include: { agent: true } },
            decisionRun: true,
          },
        },
      },
    });
    assert.equal(childReturn.autopilotReceipt?.agentTask?.agent.code, "hermes_pm");
    assert.equal(
      childReturn.autopilotReceipt?.decisionRun?.decisionKey,
      "workforce.resume_parent"
    );

    const reviewTask = childReturn.autopilotReceipt?.agentTask;
    assert.ok(reviewTask);
    const reviewContext =
      reviewTask?.contextSnapshot &&
      typeof reviewTask.contextSnapshot === "object" &&
      !Array.isArray(reviewTask.contextSnapshot)
        ? (reviewTask.contextSnapshot as Record<string, any>)
        : {};
    assert.equal(reviewContext.state?.resultSummary, resultSummary);

    const closed = await resolveReturnedChildReview(session, reviewTask!.id, {
      action: "CLOSE_PARENT",
      reason:
        "Accept the research conclusion: keep v3 claim boundaries and move to real finished-product validation before any efficacy promise.",
    });
    assert.equal(closed.parentTask?.status, AgentTaskStatus.SUCCEEDED);
    console.log("  ✔ specialist work returns to the leader with an auditable summary and explicit closure decision");

    console.log("▶ GO8 Harness stores predictions but does not fabricate outcomes or learning");
    const experience = await getExperienceOverview(session);
    assert.equal(experience.predictionCount, 2);
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

    const activity = await getWorkforceActivityBrief(session);
    assert.ok(activity.eventCount >= 5);
    assert.ok(activity.triggeredCount >= 5);
    assert.equal(activity.returnReviewCount, 0);
    console.log("  ✔ no real validation outcome means no fake learning label; Harness waits for reality");

    console.log("\n✅ Golden organization product loop passed");
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
  console.error("❌ Golden organization product loop failed:", error);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exitCode = 1;
});
