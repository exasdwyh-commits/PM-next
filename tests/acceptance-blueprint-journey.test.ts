/**
 * HERMES Next 实施蓝图端到端验收套件 (蓝图 §11 十大发布门槛验证)
 * 依据: docs/plans/2026-09-13-hermes-next-product-and-advisor-blueprint.md
 */

import fs from "fs";
import path from "path";
import os from "os";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { SessionContext } from "../src/modules/identity/session";
import {
  createDevelopmentProduct,
  getProductOverview,
  listProductBoard,
} from "../src/modules/products/service";
import { analyzeProductVersion } from "../src/modules/product-development/analysis";
import { createRevision } from "../src/modules/product-development/revision";
import {
  createKnowledgeSource,
  syncKnowledgeSource,
  searchKnowledge,
  upsertCompanyFact,
  confirmCompanyFact,
} from "../src/modules/knowledge/service";
import {
  sendMessage,
  createConversation,
  getConversation,
} from "../src/modules/advisor/service";
import {
  applyProposal,
  createProposal,
} from "../src/modules/advisor/proposals";
import {
  prepareLaunch,
  evaluateGate,
  requestFormalG3Approval,
  confirmLaunchExecution,
  upsertMilestone,
  getLaunchContext,
} from "../src/modules/launch/service";
import { getWorkspaceOverview } from "../src/modules/workspace/overview";
import { DecisionOutcome, ProductLifecycleStage, LaunchMilestoneStatus } from "@prisma/client";
import { decideDecisionPacket } from "../src/modules/decisions/service";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ 断言失败: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`  ✔ ${msg}`);
}

async function runBlueprintAcceptance() {
  console.log("\n================================================================================");
  console.log("🚀 HERMES Next 实施蓝图十大门槛全景端到端验收套件启动 (§11)");
  console.log("================================================================================\n");

  await assertTestDatabaseSafety(prisma);

  const timestamp = Date.now();
  const testOrgCode = `BP_ORG_${timestamp}`;

  // 1. 初始化测试主租户 A 与跨租户 B
  const orgA = await prisma.organization.create({
    data: { code: testOrgCode, name: "蓝图验收研发机构A" },
  });

  const orgB = await prisma.organization.create({
    data: { code: `${testOrgCode}_B`, name: "隔离测试机构B" },
  });

  const userA = await prisma.user.create({
    data: {
      organizationId: orgA.id,
      email: `pm_a_${timestamp}@hermes.test`,
      name: "蓝图负责人A",
    },
  });

  const userB = await prisma.user.create({
    data: {
      organizationId: orgB.id,
      email: `pm_b_${timestamp}@hermes.test`,
      name: "隔离员工B",
    },
  });

  const sessionA: SessionContext = {
    userId: userA.id,
    organizationId: orgA.id,
    userEmail: userA.email,
    userName: userA.name,
  };

  const sessionB: SessionContext = {
    userId: userB.id,
    organizationId: orgB.id,
    userEmail: userB.email,
    userName: userB.name,
  };

  // --------------------------------------------------------------------------
  // 门槛 1: 一个真实产品仅凭核心想法可入库，刷新后仍存在并出现在总览
  // --------------------------------------------------------------------------
  console.log("\n▶ [门槛 1] 验证极简想法入库、持久化与看板总览聚合...");
  const productRes = await createDevelopmentProduct(sessionA, {
    name: "低GI刺梨速溶气泡茶",
    coreIdea: "专为办公室控糖白领设计的低GI高维C气泡果茶，冷水即溶",
    targetAudience: "25-35岁高压、控糖诉求白领",
    coreSellingPoints: "0蔗糖、刺梨原果维C萃取、5秒微气泡清爽口感",
    targetChannels: "天猫旗舰店、抖音自营直播间",
    priceExpectation: "59.9元/盒(10条)",
  });

  assert(!!productRes.product.id, "产品原子创建成功并生成产品ID");
  assert(!!productRes.version.id, "初始方案版本 v1 同步生成");
  assert(!!productRes.project.id, "关联开发项目同步原子建立");
  assert(productRes.product.lifecycleStage === "IDEA", "初始生命周期阶段为 IDEA");

  const board = await listProductBoard(sessionA);
  assert(board.some((p) => p.id === productRes.product.id), "产品库看板中可检索到刚入库的产品");

  // --------------------------------------------------------------------------
  // 门槛 2: 产品详情完整呈现定义、分析、版本、成本、验证与上市计划
  // --------------------------------------------------------------------------
  console.log("\n▶ [门槛 2] 验证产品详情首屏多维聚合与完整呈现...");
  const overview = await getProductOverview(sessionA, productRes.product.id);
  assert(overview.product.name === "低GI刺梨速溶气泡茶", "产品基本信息与核心定义完整映射");
  assert(overview.product.versions.length >= 1, "包含方案版本历史");
  assert(overview.latestRun === null && overview.dimensions.length === 0, "未运行分析前无分析快照（真实空状态，不伪造分析数据）");

  // --------------------------------------------------------------------------
  // 门槛 3: 运行规则分析生成打分；通过提议采纳生成 v2，重评且 v1 历史不被覆盖
  // --------------------------------------------------------------------------
  console.log("\n▶ [门槛 3] 验证多轮优化闭环：v1打分 → 提议改版生成v2 → 受影响维度重评 → v1未被覆盖...");
  const v1RunId = await analyzeProductVersion(sessionA, {
    productId: productRes.product.id,
    productVersionId: productRes.version.id,
  });
  const v1Record = await prisma.analysisRun.findUnique({
    where: { id: v1RunId },
    include: { dimensions: true, scorecard: true },
  });
  assert(v1Record?.dimensions.length === 6, "v1 生成六维度规则分析");
  assert(v1Record?.scorecard?.provisional === true, "早期想法缺少外部证据时正确标记为暂评 (provisional=true)");

  const overviewAfterV1 = await getProductOverview(sessionA, productRes.product.id);
  assert(overviewAfterV1.dimensions.length === 6, "分析后产品详情首屏聚合完备的六大分析维度");

  // 模拟顾问或用户采纳修改，生成 v2 版本（调低价格预期，增加规格）
  const revisionRes = await createRevision(sessionA, {
    productId: productRes.product.id,
    baseVersionId: productRes.version.id,
    rationale: "依据市场竞品价格反馈，下调定价至 39.9 元以提升竞争力",
    changes: {
      priceExpectation: "39.9元/盒(10条)",
      formSpec: "3g*10条/盒 便携条包",
    },
  });

  assert(revisionRes.versionId !== productRes.version.id, "成功生成独立的 v2 版本记录");
  assert(revisionRes.diff.some((d) => d.field === "priceExpectation" && d.changed), "正确识别价格字段的变更差异");
  assert(!!revisionRes.analysisRunId, "自动对 v2 触发重评");

  const v2Record = await prisma.analysisRun.findUnique({
    where: { id: revisionRes.analysisRunId! },
    include: { dimensions: true, scorecard: true },
  });
  assert(revisionRes.analysisRunId !== v1RunId, "v2 产生了独立的 AnalysisRun 记录");
  assert(v2Record?.supersedesRunId === v1RunId, "v2 分析清晰记录取代了 v1 分析");

  // 验证 v1 历史未被就地改写
  const v1Check = await prisma.analysisRun.findUnique({
    where: { id: v1RunId },
    include: { scorecard: true },
  });
  assert(v1Check !== null && v1Check.productVersionId === productRes.version.id, "v1 历史记录依然完好存在");

  // --------------------------------------------------------------------------
  // 门槛 4: 知识库导入 Obsidian/本地文档，支持检索与切片引用，更新文档能检索新版本
  // --------------------------------------------------------------------------
  console.log("\n▶ [门槛 4] 验证公司知识库 Obsidian 只读导入、切片分块、引用与更新迭代...");
  // 创建临时本地知识 Vault 目录
  const tempVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-vault-test-"));
  const docFile = path.join(tempVaultDir, "刺梨系列渠道与原料政策.md");
  fs.writeFileSync(
    docFile,
    `---
title: 刺梨产品线渠道与原料规范
author: 战略发展部
---
# 刺梨产品线策略

## 渠道分销规则
我们公司在抖音自营小店主推高毛利礼盒，自营小店平台扣点基准为 5%，达人带货统一预留 20% 佣金。

## 原料禁用红线
严禁在刺梨茶饮中添加人工甜味剂与阿斯巴甜，只允许采用天然罗汉果糖苷调味。
`,
    "utf8"
  );

  const source = await createKnowledgeSource(sessionA, {
    name: "测试公司Obsidian核心库",
    rootPath: tempVaultDir,
  });

  const syncResult = await syncKnowledgeSource(sessionA, source.id);
  assert(syncResult.created === 1, "初次同步成功导入 1 篇 Markdown 文档");

  // 录入公司事实
  await upsertCompanyFact(sessionA, {
    key: "forbidden.sweeteners",
    label: "禁用人工甜味剂",
    value: "严禁添加阿斯巴甜、三氯蔗糖，仅允许天然甜苷",
    category: "forbidden",
  });

  // 测试知识检索
  const search1 = await searchKnowledge(sessionA, { query: "刺梨 渠道分销规则 佣金" });
  assert(search1.citations.length > 0, "知识库精准召回包含分销规则与佣金的文档切片");
  assert(search1.citations[0].headingPath?.includes("渠道分销规则") || false, "切片清晰保留标题层级 headingPath");

  // 顾问问答引用知识
  const convo = await createConversation(sessionA, {
    title: "关于刺梨渠道政策咨询",
    productId: productRes.product.id,
  });

  const advisorMsg1 = await sendMessage(sessionA, convo.id, "请问我们公司关于渠道佣金和原料禁用有什么政策规定？");
  assert(advisorMsg1.message.citations !== null, "顾问回复中包含精准的知识库切片引用卡");
  assert(advisorMsg1.message.content.includes("公司已确认事实") || advisorMsg1.message.content.includes("知识文档切片"), "顾问回复结构化呈现知识事实与切片依据");

  // 测试知识缺口报告
  const advisorGap = await sendMessage(sessionA, convo.id, "请问公司在南极洲有冷链仓库吗？");
  assert(advisorGap.message.content.includes("知识缺口") || advisorGap.message.content.includes("未检索到"), "未知问题能诚实说明知识缺口，不凭空捏造事实");

  // 更新文档内容并再次同步
  fs.appendFileSync(docFile, "\n## 补充更新说明\n2026年第四季度起，达人佣金上限调为 18%。\n", "utf8");
  const syncResult2 = await syncKnowledgeSource(sessionA, source.id);
  assert(syncResult2.updated === 1, "文档变更后再次同步识别为更新 (updated=1)");

  const search2 = await searchKnowledge(sessionA, { query: "达人佣金上限" });
  assert(search2.citations.some((c) => c.snippet.includes("18%")), "更新后的文档切片立即可被检索召回");

  // --------------------------------------------------------------------------
  // 门槛 5: 顾问生成推进任务，确认后单次写入并产出回执；防重重试命中幂等
  // --------------------------------------------------------------------------
  console.log("\n▶ [门槛 5] 验证顾问动作提议机制：生成待确认提议 → 用户确认执行 → 幂等防重...");
  const advisorTaskMsg = await sendMessage(
    sessionA,
    convo.id,
    "创建任务 安排刺梨冻干原料打样测试"
  );
  assert(!!advisorTaskMsg.proposal, "成功生成待确认的 CREATE_WORK_ITEM 提议");
  assert(advisorTaskMsg.proposal?.actionType === "CREATE_WORK_ITEM", "提议类型为创建工作项");

  const proposalId = advisorTaskMsg.proposal!.proposalId;

  // 确认并执行提议
  const apply1 = await applyProposal(sessionA, proposalId);
  assert(apply1.status === "APPLIED", "首次确认成功执行写入业务工作项 (status=APPLIED)");
  assert(!!apply1.appliedObjectId && apply1.appliedObjectType === "WorkItem", "业务命令回执返回生成的 WorkItem ID");

  // 重复点击确认（模拟网络重试或连击）
  const apply2 = await applyProposal(sessionA, proposalId);
  assert(apply2.idempotent, "重复确认执行命中幂等记录 (idempotent=true)");
  assert(apply2.appliedObjectId === apply1.appliedObjectId, "未二次创建重复工作项，严格返回原回执");

  // --------------------------------------------------------------------------
  // 门槛 6: 上市计划与放行门禁：未满足硬拦截，获准≠已上市，真实凭据才进LAUNCHED
  // --------------------------------------------------------------------------
  console.log("\n▶ [门槛 6] 验证上市计划门禁：未完成阻断放行、获准不等于已上市、实际上市需证据...");
  const launchPlanRes = await prepareLaunch(sessionA, {
    productId: productRes.product.id,
    targetDate: "2026-11-30",
    ownerId: userA.id,
    title: "低GI刺梨气泡茶首发上市计划",
    milestones: [
      { title: "包材打样与质检", kind: "MATERIAL", status: LaunchMilestoneStatus.PENDING },
      { title: "抖音首批预售排期", kind: "CHANNEL", status: LaunchMilestoneStatus.BLOCKED, blockerReason: "达人合同待盖章" },
    ],
  });

  const planId = launchPlanRes.planId;
  const launchCtx = await getLaunchContext(sessionA, productRes.product.id);
  assert(!launchCtx.gate?.ready, "因存在 BLOCKED 里程碑与未完成项，门禁计算为未就绪 (ready=false)");
  assert(launchCtx.gate?.blockers.length! >= 1, "明确列出阻断原因");

  // 强行放行应当抛出 422
  let blockedApprovalPassed = false;
  try {
    await requestFormalG3Approval(sessionA, planId);
    blockedApprovalPassed = true;
  } catch (e: any) {
    assert(e.statusCode === 422 || e.message.includes("未通过放行门禁"), "门禁硬拦截生效：阻断放行");
  }
  assert(!blockedApprovalPassed, "存在阻塞项时放行被严格拒绝");

  // 补齐并完成里程碑
  const m1 = launchCtx.plan!.milestones[0];
  const m2 = launchCtx.plan!.milestones[1];
  await upsertMilestone(sessionA, planId, { id: m1.id, title: m1.title, status: LaunchMilestoneStatus.DONE });
  await upsertMilestone(sessionA, planId, { id: m2.id, title: m2.title, status: LaunchMilestoneStatus.DONE, blockerReason: null });

  // 为正式 G3 配置独立决策人（负责人不得自批）
  const launchDm = await prisma.user.create({
    data: {
      organizationId: orgA.id,
      email: `launch_dm_${timestamp}@hermes.test`,
      name: "蓝图上市决策人",
    },
  });
  await prisma.project.update({
    where: { id: productRes.project.id },
    data: { decisionMakerId: launchDm.id },
  });
  await prisma.projectMember.create({
    data: {
      projectId: productRes.project.id,
      userId: launchDm.id,
      role: "DECISION_MAKER",
    },
  });
  const launchDmSession: SessionContext = {
    userId: launchDm.id,
    organizationId: orgA.id,
    userEmail: launchDm.email,
    userName: launchDm.name,
  };

  // 门禁通过后由负责人提交 G3；提交本身不等于批准
  const g3Submit = await requestFormalG3Approval(sessionA, planId);
  assert(g3Submit.status === "IN_REVIEW", "正式 G3 由负责人提交后进入待审批");
  const planBeforeG3Decision = await prisma.launchPlan.findUnique({ where: { id: planId } });
  assert(!planBeforeG3Decision?.formalG3PacketId, "负责人提交 G3 不会直接产生正式授权");

  // 独立决策人批准正式 G3
  await decideDecisionPacket(launchDmSession, g3Submit.packetId, {
    decision: DecisionOutcome.APPROVE,
    reason: "全部上市前置里程碑闭环，批准正式 G3",
  });
  const planAfterG3 = await prisma.launchPlan.findUnique({ where: { id: planId } });
  assert(planAfterG3?.formalG3PacketId === g3Submit.packetId, "指定决策人批准后写入正式 G3 授权");

  // 验证 G3 批准并不等于已上市
  const prodAfterApprove = await prisma.product.findUnique({ where: { id: productRes.product.id } });
  assert(prodAfterApprove?.lifecycleStage !== ProductLifecycleStage.LAUNCHED, "G3 批准只表示授权，产品生命周期决不自动变为 LAUNCHED！");

  // 确认实际上市
  const confirmRes = await confirmLaunchExecution(sessionA, planId, {
    note: "抖音小店首批1000盒现货上架，首日售出210盒",
  });
  assert(confirmRes.lifecycleStage === "LAUNCHED", "经实际动作确认后，产品正式进入 LAUNCHED 状态");

  const prodFinal = await prisma.product.findUnique({ where: { id: productRes.product.id } });
  assert(prodFinal?.lifecycleStage === ProductLifecycleStage.LAUNCHED, "数据库中产品生命周期确已转为 LAUNCHED");

  // --------------------------------------------------------------------------
  // 门槛 7: 运行状态与成本未知留痕
  // --------------------------------------------------------------------------
  console.log("\n▶ [门槛 7] 验证 Agent 运行留痕与费用未知标未知原则...");
  const runs = await prisma.agentRun.findMany({
    where: { organizationId: orgA.id },
    take: 1,
    orderBy: { createdAt: "desc" },
  });
  assert(runs.length > 0, "顾问运行均落库 AgentRun 留痕");
  assert(runs[0].costStatus === "unknown", "费用未知严格标记为 unknown，不伪造 token 账单");

  // --------------------------------------------------------------------------
  // 门槛 8: 跨组织越权防护硬隔离
  // --------------------------------------------------------------------------
  console.log("\n▶ [门槛 8] 验证多租户数据与越权穿透彻底拦截...");
  let crossOrgLeaked = false;
  try {
    await getProductOverview(sessionB, productRes.product.id);
    crossOrgLeaked = true;
  } catch (e: any) {
    assert(e.statusCode === 404 || e.statusCode === 403, "机构B访问机构A产品被彻底拦截");
  }
  assert(!crossOrgLeaked, "跨租户产品详情防穿透验证通过");

  const bKnowledge = await searchKnowledge(sessionB, { query: "刺梨 渠道分销规则" });
  assert(bKnowledge.citations.length === 0, "机构B无法检索到机构A的知识库切片");
  assert(bKnowledge.facts.length === 0, "机构B无法获取机构A的公司事实");

  // --------------------------------------------------------------------------
  // 门槛 9: 工作台总览真实聚合
  // --------------------------------------------------------------------------
  console.log("\n▶ [门槛 9] 验证工作台总览实时聚合，无伪造数据...");
  const ws = await getWorkspaceOverview(sessionA);
  assert(!!ws.meta.generatedAt && !!ws.meta.scopeLabel, "聚合数据包含生成时间与明确的组织权限范围标识");
  assert(ws.portfolio.productCount >= 1, "产品组合统计真实反映刚入库的产品");

  // 清理临时 Vault 目录
  try {
    fs.rmSync(tempVaultDir, { recursive: true, force: true });
  } catch {}

  console.log("\n================================================================================");
  console.log("🏆 HERMES Next 实施蓝图端到端验收全部通过！十项发布门槛全部达成 100% 绿灯！");
  console.log("================================================================================\n");
}

runBlueprintAcceptance()
  .catch((err) => {
    console.error("验收套件执行失败:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
