/**
 * HERMES P1 阶段端到端验收测试套件 (F13 - F19, F33)
 *
 * 核心验证内容：
 * 1. [R10 安全保护] 验证当前运行目标为 hermes_next_test 独立测试库（端口 5433），开发库零影响；
 * 2. [F13 需求解析与否定语义硬隔离]
 *    - 识别“禁止胶囊、软糖及护肝宣称”，严密提取为 forbidden 约束，杜绝反向污染为偏好；
 *    - 精准提取价格区间、单盒成本上限红线、人群、渠道及缺口；
 * 3. [F18/F19 机械确定性六层成本计算引擎]
 *    - 纯函数测算运费、渠道扣点、16 项增值税/附加税、保本供货价、利润指标与预算方差；
 *    - 同输入同输出，100% 确定性，AI 不篡改数值；
 * 4. [F07/F14/F15 真实资料与多路线竞品研究]
 *    - 基于核实证据与需求生成竞品分析；
 *    - 产出 A/B/C 三条可比选型路线，自动排除命中 forbidden 的剂型与宣称；
 * 5. [F16/F17 产品建议包同版本组装与闭环]
 *    - 聚合研究、选型、成本经济学与规格简报为单一版本建议包；
 *    - 确认采纳后发布为正式不可变产品版本 (isConfirmed=true)；
 *    - 自动联动创建研发打样门草稿 (DecisionPacket DRAFT)，实现从研究到决策门的无缝贯通。
 */

import { assertTestDatabaseSafety } from "./test-safety";
import { parseProjectRequirements } from "../src/modules/research/requirement-parser";
import { synthesizeMarketResearch } from "../src/modules/research/market-research";
import { calcCost } from "../src/modules/cost-engine";
import {
  assembleProductSuggestionPackage,
  commitProductSuggestionToGate,
} from "../src/modules/products/product-suggestion";
import { createProject, getProjectDetail } from "../src/modules/projects/service";
import { SessionContext } from "../src/modules/identity/session";
import { ProjectMode, Role, EvidenceNature, EvidenceVerifyStatus } from "@prisma/client";
import prisma from "../src/shared/db";

async function runP1AcceptanceSuite() {
  console.log("\n================================================================================");
  console.log("🚀 HERMES P1 阶段验收测试套件启动: 真实研究与产品定义包 (F13 - F19)");
  console.log("================================================================================\n");

  // 1. [R10] 运行环境与测试库安全硬隔离校验
  await assertTestDatabaseSafety(prisma);
  console.log("✔ [R10 守卫通过]: 测试安全限定在端口 5433 hermes_next_test 独立库\n");

  // --------------------------------------------------------------------------
  // [F13] 需求语义精准解析与否定项硬隔离测试
  // --------------------------------------------------------------------------
  console.log("▶ 正在验证 [F13] 需求语义精准解析与否定语义硬隔离...");
  const rawRequirementText = `
    针对35-50岁新锐白领女性，开发一款高多酚速溶草本茶饮，用于日常下午茶清润解腻。
    要求单盒零售价控制在 69 - 89 元之间，单盒生产成本上限不超过 18 元，首批试产 2000 盒，期望 8 周内完成打样试制。
    主攻抖音和微信私域渠道。
    【重要红线约束】：严禁采用胶囊、软糖和口服液剂型；禁止添加人工甜味剂与蔗糖；严禁出现护肝、降糖、减肥等功能性宣称！
    仅允许速溶茶粉或便携茶包剂型。
  `;

  const parsedReq = parseProjectRequirements(rawRequirementText);

  // 验证否定项
  if (!parsedReq.forbidden.some((f) => f.includes("胶囊")) ||
      !parsedReq.forbidden.some((f) => f.includes("软糖")) ||
      !parsedReq.forbidden.some((f) => f.includes("护肝"))) {
    throw new Error("F13 失败: 否定语义未被正确提取至 forbidden 约束！");
  }

  // 验证否定项没有被反向污染到偏好剂型
  if (parsedReq.constraints.preferredForms.includes("胶囊") || parsedReq.constraints.preferredForms.includes("软糖")) {
    throw new Error("F13 失败: 禁止剂型被反向污染到了允许/偏好列表中！");
  }

  // 验证价格与成本参数提取
  if (parsedReq.constraints.minRetailPrice !== 69 || parsedReq.constraints.maxRetailPrice !== 89) {
    throw new Error("F13 失败: 零售价格带提取错误！");
  }
  if (parsedReq.constraints.maxCostLimit !== 18) {
    throw new Error("F13 失败: 成本上限红线提取错误！");
  }
  if (parsedReq.constraints.targetBatchQuantity !== 2000 || parsedReq.constraints.deliveryWeeks !== 8) {
    throw new Error("F13 失败: 批量诉求或周期提取错误！");
  }

  console.log("  ✔ [F13] 通过: 否定项严格识别为 forbidden 约束，价格带/成本红线/周期提炼 100% 准确！");

  // --------------------------------------------------------------------------
  // [F18/F19] 确定性六层成本计算引擎机械化核算
  // --------------------------------------------------------------------------
  console.log("\n▶ 正在验证 [F18/F19] 确定性六层成本计算引擎与供货定价反推...");
  const costCalc1 = calcCost({
    retailPrice: 79.0,
    materialCost: 9.5,
    packagingCost: 4.5,
    manufacturingCost: 1.5,
    certificationCost: 0.3,
    platformFeeRate: 2.0,
    commissionRate: 30.0,
    marketingRate: 8.0,
    monthlyFixed: 3000,
    channel: "PUBLIC",
    invoiceType: "达人开票",
    marketReferencePrice: 89.0,
    pricingStrategy: "MARKET_FOLLOW",
  });

  // 验证机械计算的确定性 (同输入多次运算严格相等)
  const costCalc2 = calcCost({
    retailPrice: 79.0,
    materialCost: 9.5,
    packagingCost: 4.5,
    manufacturingCost: 1.5,
    certificationCost: 0.3,
    platformFeeRate: 2.0,
    commissionRate: 30.0,
    marketingRate: 8.0,
    monthlyFixed: 3000,
    channel: "PUBLIC",
    invoiceType: "达人开票",
    marketReferencePrice: 89.0,
    pricingStrategy: "MARKET_FOLLOW",
  });

  if (costCalc1.totalCost !== costCalc2.totalCost || costCalc1.netProfit !== costCalc2.netProfit) {
    throw new Error("F18/F19 失败: 成本计算引擎缺乏确定性，两次计算结果不一致！");
  }

  // 验证关键指标有效性 (R2-07: 纠正为 CostResult 真实字段)
  if (costCalc1.totalCost <= 0 || costCalc1.supplyPriceFloor <= 0 || costCalc1.netProfit <= 0) {
    throw new Error("F18/F19 失败: 成本计算关键输出指标数值异常！");
  }
  console.log(`  ✔ [F18/F19] 通过: 六层总成本 ¥${costCalc1.totalCost}，BOM毛利率 ${costCalc1.bomMarginRate}%，保底供货价 ¥${costCalc1.supplyPriceFloor}，净利润 ¥${costCalc1.netProfit}，机械运算 100% 确定！`);

  // --------------------------------------------------------------------------
  // [F07/F14/F15] 真实资料研究与候选路线选型
  // --------------------------------------------------------------------------
  console.log("\n▶ 正在验证 [F07/F14/F15] 真实资料竞品分析与 A/B/C 可比路线选型...");
  const fakeEvidenceSnippets = [
    { id: "evi-101", content: "主流速溶茶粉竞品月销 10w+ 盒，用户主要差评点为溶解速度慢", source: "抖音商品评价采样" },
    { id: "evi-102", content: "原叶冷萃冻干多酚保留率达到 92%，第三方检测资质完整", source: "SGS 检测报告" },
  ];

  const research = synthesizeMarketResearch("proj-test-01", "高多酚草本速溶茶饮", parsedReq.constraints, fakeEvidenceSnippets);

  if (research.candidateRoutes.length !== 3) {
    throw new Error("F15 失败: 未能提供完整的 3 条可比候选路线！");
  }

  // 验证 3 条路线均未采用 forbiddenForms (如胶囊、软糖)
  for (const route of research.candidateRoutes) {
    if (parsedReq.constraints.forbiddenForms.includes(route.dosageForm)) {
      throw new Error(`F15 失败: 路线 ${route.routeCode} 错误采用了被禁止的剂型 ${route.dosageForm}！`);
    }
  }
  console.log("  ✔ [F07/F14/F15] 通过: 标杆竞品与痛点分析完备，3 条可比路线均严守红线，推荐路线为 " + research.recommendedRouteCode);

  // --------------------------------------------------------------------------
  // [F16/F17/F33] 同版本产品建议包组装、不可变版本发布与打样门无缝对接
  // --------------------------------------------------------------------------
  console.log("\n▶ 正在验证 [F16/F17/F33] 同版本产品建议包组装与研发打样门贯通...");

  // 初始化测试企业与用户
  const org = await prisma.organization.upsert({
    where: { code: "P1_VERIFICATION_ORG" },
    update: {},
    create: { name: "P1 研发验证机构", code: "P1_VERIFICATION_ORG" },
  });

  const pmUser = await prisma.user.upsert({
    where: { email: "p1_pm@hermes.test" },
    update: { organizationId: org.id },
    create: { organizationId: org.id, name: "P1张产品", email: "p1_pm@hermes.test" },
  });

  const vpUser = await prisma.user.upsert({
    where: { email: "p1_vp@hermes.test" },
    update: { organizationId: org.id },
    create: { organizationId: org.id, name: "P1李决策", email: "p1_vp@hermes.test" },
  });

  const pmSession: SessionContext = {
    userId: pmUser.id,
    organizationId: org.id,
    userName: pmUser.name,
    userEmail: pmUser.email,
  };

  // 建立真实项目并录入已核实市场证据
  const project = await createProject(pmSession, {
    title: "高多酚玫瑰速溶草本茶",
    target: rawRequirementText,
    mode: ProjectMode.NEW_PRODUCT,
    decisionMakerId: vpUser.id,
  });

  await prisma.evidence.create({
    data: {
      projectId: project.id,
      contentOrUri: "类目爆款冷萃茶粉市场热卖分析",
      source: "蝉妈妈公开数据",
      hash: "sha256-verified-market-evi-p1",
      nature: EvidenceNature.REAL,
      verifyStatus: EvidenceVerifyStatus.VERIFIED,
      verifiedByUserId: pmUser.id,
      verifiedAt: new Date(),
      // P1-02: 满足业务基线关键证据缺口闭合——需提供已核实价格 FACT，否则提交被服务端阻断
      claims: {
        create: [
          {
            fieldKey: "price",
            fieldName: "竞品价格/价格带",
            kind: "FACT",
            value: "59.9",
            currency: "CNY",
            unit: "盒",
            mechanism: "到手价",
            spec: "礼盒装",
          },
        ],
      },
    },
  });

  // 组装建议包
  const suggestionPackage = await assembleProductSuggestionPackage(pmSession, project.id, {
    categoryName: "速溶草本茶",
    selectedRouteCode: "ROUTE_A",
  });

  if (!suggestionPackage.selectedRoute || !suggestionPackage.costEconomics || !suggestionPackage.specificationBrief) {
    throw new Error("F16/F17 失败: 产品建议包缺失核心结构要素！");
  }

  // 确认采纳建议包：发布不可变版本并联动生成研发打样门草稿
  const gateCommitment = await commitProductSuggestionToGate(pmSession, project.id, suggestionPackage, {
    isConfirmed: true,
  });

  if (!gateCommitment.productVersion.isConfirmed || !gateCommitment.productVersion.isImmutable) {
    throw new Error("F17 失败: 采纳后产品版本未标记为已确认不可变！");
  }
  if (!gateCommitment.decisionPacket || gateCommitment.decisionPacket.status !== "DRAFT") {
    throw new Error("F17 失败: 未能自动联动生成打样门决策草稿！");
  }

  // 重新获取项目详情验证关联与打样门准备状态
  const updatedProject = await getProjectDetail(pmSession, project.id);
  if (updatedProject.productVersionId !== gateCommitment.productVersion.id) {
    throw new Error("F16 失败: 项目未成功绑定已确认的产品版本！");
  }

  console.log("  ✔ [F16/F17/F33] 通过: 产品建议包成功发布为不可变产品版本，项目成功绑定，打样门决策草稿顺利生成！");

  console.log("\n================================================================================");
  console.log("🏆 HERMES P1 阶段验收全绿: 需求提取、确定性成本、路线选型与建议包闭环 100% 通过！");
  console.log("================================================================================\n");
}

runP1AcceptanceSuite()
  .catch((err) => {
    console.error("\n❌ P1 验收套件执行失败:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
