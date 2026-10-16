/**
 * Evidence → Product Potential 端到端集成测试（P0-1 / P0-2 / P0-4）
 *
 * 与 `tests/potential-compiler.test.ts` 的分工：
 * - 单元测试守编译器的纯逻辑；
 * - 本文件守**真实链路**：数据库里的 Evidence / EvidenceClaim → 编译器 → 落库
 *   PotentialAssessmentRecord，以及「编译器判定」与「落库前校验器判定」不打架。
 *
 * 需要真实测试库（TEST_DATABASE_URL），与 golden-organization 系列同一套环境。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
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
  assessAndSaveProductPotentialFromEvidence,
  createChannelRuleProfile,
  evaluateAndSaveChannelRoute,
} from "../src/modules/product-development/channel-routes-service";

type ClaimSeed = {
  fieldKey: string;
  kind: "FACT" | "INFERENCE" | "ASSUMPTION";
  value: string;
};

/** 一份「资料充足」的事实级证据集：覆盖 7 个维度的全部必需事实。 */
const COMPLETE_FACTS: ClaimSeed[] = [
  { fieldKey: "salesVolume", kind: "FACT", value: "月销 12000 件" },
  { fieldKey: "price", kind: "FACT", value: "299" },
  { fieldKey: "targetAudience", kind: "FACT", value: "30-45 岁女性 约 2000 万" },
  { fieldKey: "painPoint", kind: "FACT", value: "差评集中在冲泡结块" },
  { fieldKey: "channel", kind: "FACT", value: "私域/会销 199-599 元价格带" },
  { fieldKey: "channelCommission", kind: "FACT", value: "佣金 35%" },
  { fieldKey: "channelPriceBand", kind: "FACT", value: "299-499" },
  { fieldKey: "channelFeedback", kind: "FACT", value: "首场试销 3 万元" },
  { fieldKey: "costQuote", kind: "FACT", value: "60" },
  { fieldKey: "channelFee", kind: "FACT", value: "佣金 35% 平台 0%" },
  { fieldKey: "packagingFreight", kind: "FACT", value: "包材 10 元 运费 8 元" },
  { fieldKey: "formulaOrTech", kind: "FACT", value: "后生元路线" },
  { fieldKey: "competitorComparison", kind: "FACT", value: "竞品为活菌制剂" },
  { fieldKey: "ipOrPatent", kind: "FACT", value: "独家原料授权 2026-2031" },
  { fieldKey: "consumerPerception", kind: "FACT", value: "试销反馈可感知差异" },
  { fieldKey: "consumptionCycle", kind: "FACT", value: "30 条/盒 每日 1 条" },
  { fieldKey: "repurchaseData", kind: "FACT", value: "私域复购率 38%" },
  { fieldKey: "userFeedback", kind: "FACT", value: "口碑正向" },
  { fieldKey: "subscriptionSignal", kind: "FACT", value: "已有订阅方案" },
  { fieldKey: "supplierConfirmation", kind: "FACT", value: "工厂确认可交付" },
  { fieldKey: "dosageForm", kind: "FACT", value: "粉剂" },
  { fieldKey: "leadTime", kind: "FACT", value: "45 天" },
  { fieldKey: "compliancePackaging", kind: "FACT", value: "包装稿已过审" },
  { fieldKey: "companyPolicy", kind: "FACT", value: "公司品类规划包含" },
  { fieldKey: "existingCapability", kind: "FACT", value: "已有研发与供应链团队" },
  { fieldKey: "channelOwnership", kind: "FACT", value: "私域 20 万用户" },
  { fieldKey: "brandPortfolio", kind: "FACT", value: "与现有品牌定位一致" },
];

async function createEvidence(params: {
  projectId: string;
  verifiedByUserId: string;
  tag: string;
  source: string;
  nature: EvidenceNature;
  verifyStatus: EvidenceVerifyStatus;
  validationStatus: ValidationStatus;
  channel: string | null;
  claims: ClaimSeed[];
}) {
  return prisma.evidence.create({
    data: {
      projectId: params.projectId,
      contentOrUri: `gold://${params.tag}`,
      source: params.source,
      author: "Integration Lead",
      hash: `${params.tag}-${randomUUID()}`,
      nature: params.nature,
      verifyStatus: params.verifyStatus,
      verifiedByUserId:
        params.verifyStatus === EvidenceVerifyStatus.VERIFIED
          ? params.verifiedByUserId
          : null,
      verifiedAt:
        params.verifyStatus === EvidenceVerifyStatus.VERIFIED
          ? new Date()
          : null,
      validationStatus: params.validationStatus,
      productRef: null,
      channel: params.channel,
      claims: {
        create: params.claims.map((claim, index) => ({
          fieldKey: claim.fieldKey,
          fieldName: claim.fieldKey,
          kind: claim.kind,
          value: claim.value,
          currency: "CNY",
          unit: claim.fieldKey === "price" ? "盒" : null,
          mechanism: claim.fieldKey === "price" ? "到手价" : null,
          selectionReason: `seed-${index}`,
        })),
      },
    },
    select: { id: true },
  });
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error("Explicit test database required");
  }
  await assertTestDatabaseSafety(prisma);

  const tag = randomUUID();
  const org = await prisma.organization.create({
    data: { name: "Potential Compiler Integration", code: "PC_INT_" + tag },
  });
  const admin = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: "pc-int-" + tag + "@hermes.test",
      name: "Integration Lead",
    },
  });
  await prisma.organizationMember.create({
    data: { organizationId: org.id, userId: admin.id, role: OrgRole.ORG_ADMIN },
  });

  const session = {
    userId: admin.id,
    organizationId: org.id,
    userEmail: admin.email,
    userName: admin.name,
  };

  try {
    // ---------------------------------------------------------------------
    console.log("▶ PC1 资料充足：证据自动编译成 7 维 VERIFIED 并落库");
    const rich = await createDevelopmentProduct(session, {
      name: "潜力编译样品·资料充足",
      coreIdea: "验证证据能否不经人手自动进入潜力评估",
      targetAudience: "30-45 岁女性",
      coreSellingPoints: "后生元路线 + 独家原料",
      targetChannels: "私域/会销",
      priceExpectation: "299-499",
      targetCost: 20,
      formSpec: "30 条/盒",
    });
    const richVersion = await publishProductVersion(
      session,
      rich.product.id,
      {
        versionTag: "v1-compiler-rich",
        specs: { targetChannels: ["私域/会销"] },
        targetCost: 20,
        currency: "CNY",
        isConfirmed: true,
      }
    );

    const richEvidence = await createEvidence({
      projectId: rich.project.id,
      verifiedByUserId: admin.id,
      tag: "rich-" + tag,
      source: "一手资料汇总（工厂报价 + 渠道规则 + 试销复盘）",
      nature: EvidenceNature.REAL,
      verifyStatus: EvidenceVerifyStatus.VERIFIED,
      validationStatus: ValidationStatus.VERIFIED_BY_LEAD,
      channel: "私域/会销",
      claims: COMPLETE_FACTS,
    });

    // 模板/演示数据混进来：它必须被防火墙挡住，不能污染任何维度。
    const templateEvidence = await createEvidence({
      projectId: rich.project.id,
      verifiedByUserId: admin.id,
      tag: "template-" + tag,
      source: "规则模板默认值",
      nature: EvidenceNature.DEMO,
      verifyStatus: EvidenceVerifyStatus.VERIFIED,
      validationStatus: ValidationStatus.UNAPPLIED,
      channel: "私域/会销",
      claims: [
        { fieldKey: "price", kind: "FACT", value: "199" },
        { fieldKey: "costQuote", kind: "FACT", value: "43.78" },
      ],
    });

    const richResult = await assessAndSaveProductPotentialFromEvidence(
      session,
      rich.product.id,
      { productVersionId: richVersion.id }
    );

    assert.equal(
      richResult.assessment.coverageRatio,
      1,
      "资料充足时覆盖率应为 1"
    );
    assert.equal(
      richResult.assessment.verifiedCoverageRatio,
      1,
      "全部事实级证据支撑时应为全验证覆盖"
    );
    assert.ok(
      ["VALIDATE", "PRIORITIZE_FOR_VALIDATION"].includes(
        richResult.assessment.verdict
      ),
      `资料充足应给出可推进结论，实际 ${richResult.assessment.verdict}`
    );

    // 可追溯性：每个维度的 sourceRefs 必须能解析到真实证据
    const realEvidenceIds = new Set([richEvidence.id]);
    for (const dimension of richResult.compiled.dimensions) {
      assert.equal(
        dimension.evidenceState,
        "VERIFIED",
        `${dimension.key} 应为 VERIFIED，实际 ${dimension.evidenceState}`
      );
      assert.ok(dimension.evidenceIds.length > 0, `${dimension.key} 缺 evidenceIds`);
      assert.ok(dimension.claimIds.length > 0, `${dimension.key} 缺 claimIds`);
      assert.equal(dimension.missingEvidence.length, 0);
      assert.ok(
        dimension.sourceRefs.every((ref) =>
          realEvidenceIds.has(ref.replace(/^evidence:/, ""))
        ),
        `${dimension.key} 的 sourceRefs 必须指向真实证据`
      );
    }

    // 防火墙：模板证据不得出现在任何维度的证据集合里
    for (const dimension of richResult.compiled.dimensions) {
      assert.ok(
        !dimension.evidenceIds.includes(templateEvidence.id),
        `${dimension.key} 混入了模板/演示证据`
      );
    }
    assert.ok(
      richResult.compiled.templateAssumptions.length > 0,
      "模板值必须被登记成假设而不是被丢弃"
    );
    assert.ok(
      richResult.compiled.templateAssumptions.every(
        (item) => item.displayText.includes("假设值")
      ),
      "模板值展示文案必须自带「假设」措辞"
    );
    // 模板给出的 199 不得顶替真实到手价 299 参与毛利计算
    const unitEconomics = richResult.compiled.dimensions.find(
      (dimension) => dimension.key === "UNIT_ECONOMICS"
    )!;
    assert.equal(unitEconomics.score, 90, "毛利应由真实报价 60 与真实价 299 算出");

    // 落库与审计
    const savedRecord = await prisma.potentialAssessmentRecord.findUniqueOrThrow({
      where: { id: richResult.record.id },
    });
    assert.equal(savedRecord.verdict, richResult.assessment.verdict);
    assert.equal(savedRecord.ruleVersion, "product-potential/v2");
    const audit = await prisma.auditEvent.findFirst({
      where: {
        actorId: admin.id,
        action: "PRODUCT_POTENTIAL_ASSESSED",
        objectId: richResult.record.id,
      },
    });
    assert.ok(audit, "落库必须留审计事件");
    assert.equal(
      (audit!.details as Record<string, unknown>).dimensionSource,
      "EVIDENCE_COMPILER",
      "审计要能区分维度是手填还是编译"
    );

    // 持续职责台账：没声明任何已接入数据源时，一条都不该是可派发的。
    assert.ok(richResult.duties.length > 0, "必须产出持续职责清单");
    assert.ok(
      richResult.duties.every((duty) => duty.actionable === false),
      "未声明数据源接入时不应有可自动派发的职责"
    );
    assert.equal(
      richResult.delta.hasEffectiveChange,
      true,
      "首次评估必须交付一次"
    );

    // ---------------------------------------------------------------------
    console.log("▶ PC2 只有模板与未核实资料：维度保持 UNKNOWN，并给出人工补证缺口");
    const thin = await createDevelopmentProduct(session, {
      name: "潜力编译样品·资料不足",
      coreIdea: "验证缺证据时不会用模板值顶替",
      targetAudience: "中老年",
      coreSellingPoints: "高钙",
      targetChannels: "私域",
      priceExpectation: "199",
      targetCost: 12,
      formSpec: "12 盒/组",
    });
    const thinVersion = await publishProductVersion(session, thin.product.id, {
      versionTag: "v1-compiler-thin",
      specs: { targetChannels: ["私域"] },
      targetCost: 12,
      currency: "CNY",
      isConfirmed: true,
    });

    await createEvidence({
      projectId: thin.project.id,
      verifiedByUserId: admin.id,
      tag: "thin-template-" + tag,
      source: "规则模板默认值",
      nature: EvidenceNature.DEMO,
      verifyStatus: EvidenceVerifyStatus.VERIFIED,
      validationStatus: ValidationStatus.UNAPPLIED,
      channel: "私域",
      claims: [
        { fieldKey: "price", kind: "FACT", value: "199" },
        { fieldKey: "salesVolume", kind: "FACT", value: "月销 10 万" },
      ],
    });
    await createEvidence({
      projectId: thin.project.id,
      verifiedByUserId: admin.id,
      tag: "thin-unverified-" + tag,
      source: "未核实的网络转载",
      nature: EvidenceNature.REAL,
      verifyStatus: EvidenceVerifyStatus.UNVERIFIED,
      validationStatus: ValidationStatus.UNAPPLIED,
      channel: "私域",
      claims: [{ fieldKey: "salesVolume", kind: "FACT", value: "疑似热销" }],
    });

    const thinResult = await assessAndSaveProductPotentialFromEvidence(
      session,
      thin.product.id,
      { productVersionId: thinVersion.id }
    );

    const thinUnit = thinResult.compiled.dimensions.find(
      (dimension) => dimension.key === "UNIT_ECONOMICS"
    )!;
    assert.equal(thinUnit.score, null, "没有工厂报价就不该有毛利分");
    assert.equal(thinUnit.evidenceState, "UNKNOWN");
    assert.equal(thinResult.assessment.verifiedCoverageRatio, 0);
    assert.equal(thinResult.assessment.verdict, "NEEDS_EVIDENCE");

    const costGap = thinResult.compiled.gaps.find((gap) =>
      gap.missingFact.includes("costQuote")
    );
    assert.ok(costGap, "必须给出工厂报价缺口");
    assert.equal(costGap!.requiresHumanInput, true);
    assert.equal(costGap!.canAutoResearch, false);

    const autoGap = thinResult.compiled.gaps.find((gap) =>
      gap.missingFact.includes("targetAudience")
    );
    assert.ok(autoGap, "必须给出可自动补证的缺口");
    assert.equal(autoGap!.canAutoResearch, true);

    // ---------------------------------------------------------------------
    console.log("▶ PC3 路线级渠道口径：跨渠道证据不得把 CHANNEL_FIT 推成 VERIFIED");
    const scoped = await createDevelopmentProduct(session, {
      name: "潜力编译样品·路线级渠道",
      coreIdea: "验证路线级 CHANNEL_FIT 只认同渠道证据",
      targetAudience: "30-45 岁女性",
      coreSellingPoints: "多盒机制",
      targetChannels: "私域/会销、快手直播",
      priceExpectation: "299-499",
      targetCost: 20,
      formSpec: "12 盒/组",
    });
    const scopedVersion = await publishProductVersion(
      session,
      scoped.product.id,
      {
        versionTag: "v1-compiler-scoped",
        specs: { targetChannels: ["私域/会销"] },
        targetCost: 20,
        currency: "CNY",
        isConfirmed: true,
      }
    );

    // 证据全部标注「快手直播」，但路线是「私域/会销」。
    await createEvidence({
      projectId: scoped.project.id,
      verifiedByUserId: admin.id,
      tag: "scoped-live-" + tag,
      source: "快手直播试销复盘",
      nature: EvidenceNature.REAL,
      verifyStatus: EvidenceVerifyStatus.VERIFIED,
      validationStatus: ValidationStatus.VERIFIED_BY_LEAD,
      channel: "快手直播",
      claims: COMPLETE_FACTS,
    });

    const rule = await createChannelRuleProfile(session, {
      channelKey: "private-sales",
      label: "私域/会销",
      version: "pc-int-v1",
      status: "CONFIRMED",
      sourceRefs: ["contract:private-sales:pc-int-v1"],
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
    const route = await evaluateAndSaveChannelRoute(
      session,
      scoped.product.id,
      {
        productVersionId: scopedVersion.id,
        channelRuleProfileId: rule.id,
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

    const scopedResult = await assessAndSaveProductPotentialFromEvidence(
      session,
      scoped.product.id,
      { productVersionId: scopedVersion.id, channelRouteId: route.id }
    );

    const channelFit = scopedResult.compiled.dimensions.find(
      (dimension) => dimension.key === "CHANNEL_FIT"
    )!;
    assert.notEqual(
      channelFit.evidenceState,
      "VERIFIED",
      "证据来自其他渠道时，路线级 CHANNEL_FIT 不得判为 VERIFIED"
    );
    // 其余维度不受渠道过滤影响，仍应由同一批证据支撑。
    const demand = scopedResult.compiled.dimensions.find(
      (dimension) => dimension.key === "DEMAND"
    )!;
    assert.equal(demand.evidenceState, "VERIFIED");

    // 编译器判定与落库前校验器判定必须一致：这条链路没有抛错本身就是断言。
    assert.ok(scopedResult.record.id, "路线级评估必须能落库");

    // ---------------------------------------------------------------------
    console.log("▶ PC4 没有有效变化时办公室待命；数据源接入后才派活");
    // 同一批证据再评估一次：维度、缺口、结论都没变 → 办公室应保持待命。
    const repeat = await assessAndSaveProductPotentialFromEvidence(
      session,
      scoped.product.id,
      { productVersionId: scopedVersion.id, channelRouteId: route.id }
    );
    assert.equal(
      repeat.delta.hasEffectiveChange,
      false,
      "证据没变时不应把办公室叫醒"
    );
    assert.ok(repeat.delta.reason.includes("待命"));

    // 声明接入电商与渠道规则通道：对应缺口才变成可派发，人工项仍然不可自动派发。
    const wired = await assessAndSaveProductPotentialFromEvidence(
      session,
      scoped.product.id,
      {
        productVersionId: scopedVersion.id,
        channelRouteId: route.id,
        availableSources: ["ecommerce", "channel_policy"],
      }
    );
    const autoDuty = wired.duties.find(
      (duty) => duty.sourceStatus === "AVAILABLE"
    );
    if (autoDuty) {
      assert.equal(autoDuty.actionable, true);
      assert.equal(autoDuty.requiresHumanInput, false);
    }
    assert.ok(
      wired.duties
        .filter((duty) => duty.requiresHumanInput)
        .every((duty) => duty.sourceStatus === "HUMAN_ONLY"),
      "需要人工提供的职责永远是 HUMAN_ONLY"
    );

    // 幂等：把上一轮全部职责键传回来，新增职责应当为空。
    const noNew = await assessAndSaveProductPotentialFromEvidence(
      session,
      scoped.product.id,
      {
        productVersionId: scopedVersion.id,
        channelRouteId: route.id,
        knownDutyKeys: wired.duties.map((duty) => duty.key),
      }
    );
    assert.equal(
      noNew.newDuties.length,
      0,
      "同一批缺口不得被重复派发"
    );

    console.log("\n✅ Potential compiler integration passed");
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
  console.error("❌ Potential compiler integration failed:", error);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exitCode = 1;
});
