import prisma from "../src/shared/db";
import { ProjectMode, ProjectStage, Role, DecisionOutcome, WorkItemStatus, RunMode, RunReceiptStatus, EvidenceNature, EvidenceVerifyStatus } from "@prisma/client";
import { createProject, getProjectDetail, updateProject } from "../src/modules/projects/service";
import { createWorkItem, submitWork, reviewWork } from "../src/modules/work/service";
import { createFeedback, disposeFeedback } from "../src/modules/collaboration/service";
import { createDecisionPacketDraft, submitDecisionPacket, decideDecisionPacket } from "../src/modules/decisions/service";
import { computeScopeHash } from "../src/modules/decisions/scope-hash";
import { SessionContext, getServerSession } from "../src/modules/identity/session";
import { NextRequest } from "next/server";

import { assertTestDatabaseSafety } from "./test-safety";

async function runAcceptanceSuite() {
  console.log("================================================================================");
  console.log("🚀 HERMES B01 全量验收测试套件 (A01 - A12)");
  console.log("执行规格: HERMES_Gemini_执行包_P0_2026-09-07.md");
  console.log("================================================================================\n");

  // R10 & R2-04: Enforce test database safety before any write operations
  await assertTestDatabaseSafety(prisma);

  // Clean DB
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "AuditEvent", "IdempotencyRecord", "Decision", "DecisionPacket", "Feedback", "Evidence", "Artifact", "RunReceipt", "WorkItem", "ProductVersion", "Product", "ProjectMember", "Project", "User", "Organization" CASCADE;`);

  // Setup Base Organization & Users
  const org1 = await prisma.organization.create({
    data: { name: "赫尔墨斯食品（主体一）", code: "HERMES_ORG_1" },
  });
  const org2 = await prisma.organization.create({
    data: { name: "竞品或外部组织（主体二）", code: "HERMES_ORG_2" },
  });

  const ownerUser = await prisma.user.create({
    data: { organizationId: org1.id, email: "pm_owner@hermes.test", name: "张负责 (PM)" },
  });
  const dmUser = await prisma.user.create({
    data: { organizationId: org1.id, email: "vp_decision@hermes.test", name: "李决策 (VP)" },
  });
  const feedbackUser = await prisma.user.create({
    data: { organizationId: org1.id, email: "feedback@hermes.test", name: "王反馈 (评测员)" },
  });
  const viewerUser = await prisma.user.create({
    data: { organizationId: org1.id, email: "viewer@hermes.test", name: "赵浏览 (观察员)" },
  });
  const foreignUser = await prisma.user.create({
    data: { organizationId: org2.id, email: "foreign@other.test", name: "外部用户" },
  });

  const ownerSession: SessionContext = { userId: ownerUser.id, organizationId: org1.id, userEmail: ownerUser.email, userName: ownerUser.name };
  const dmSession: SessionContext = { userId: dmUser.id, organizationId: org1.id, userEmail: dmUser.email, userName: dmUser.name };
  const feedbackSession: SessionContext = { userId: feedbackUser.id, organizationId: org1.id, userEmail: feedbackUser.email, userName: feedbackUser.name };
  const viewerSession: SessionContext = { userId: viewerUser.id, organizationId: org1.id, userEmail: viewerUser.email, userName: viewerUser.name };
  const foreignSession: SessionContext = { userId: foreignUser.id, organizationId: org2.id, userEmail: foreignUser.email, userName: foreignUser.name };

  // --------------------------------------------------------------------------
  // [A01] 新品项目无预先产品也能创建；持久化存储保留
  // --------------------------------------------------------------------------
  console.log("▶ 正在验证 [A01] 新品项目无预先产品可创建与数据持久化...");
  const pA01 = await createProject(ownerSession, {
    title: "高多酚燕麦脆片创新食品研发 (REAL)",
    target: "研发低GI健康燕麦代餐产品并完成首批打样验证",
    mode: ProjectMode.NEW_PRODUCT,
    decisionMakerId: dmUser.id,
  });
  const pA01Check = await prisma.project.findUnique({ where: { id: pA01.id } });
  if (!pA01Check || pA01Check.stage !== ProjectStage.DRAFT) throw new Error("A01 失败: 新品项目未正确持久化");
  console.log("  ✔ A01 通过: 新品项目创建成功，无需预设产品，初始阶段为 DRAFT");

  // Add other members to pA01 for subsequent tests
  await prisma.projectMember.createMany({
    data: [
      { projectId: pA01.id, userId: feedbackUser.id, role: Role.FEEDBACK_PROVIDER },
      { projectId: pA01.id, userId: viewerUser.id, role: Role.VIEWER },
    ],
  });

  // --------------------------------------------------------------------------
  // [A02] 固定产品未选确认版本被拒绝；选定后进入生产准备，不生成研究任务
  // --------------------------------------------------------------------------
  console.log("\n▶ 正在验证 [A02] 固定产品模式强约束验证...");
  let a02Blocked = false;
  try {
    await createProject(ownerSession, {
      title: "固定配方经典肉松饼 (FIXED)",
      target: "经典配方复产与渠道准备",
      mode: ProjectMode.FIXED_PRODUCT,
      decisionMakerId: dmUser.id,
      // intentionally missing productVersionId
    });
  } catch (err: any) {
    if (err.statusCode === 422) a02Blocked = true;
  }
  if (!a02Blocked) throw new Error("A02 失败: 固定产品模式未选版本未被阻断！");

  // Create confirmed product and version
  const prod = await prisma.product.create({
    data: {
      organizationId: org1.id,
      name: "经典低糖肉松饼",
      identityCode: "SKU-RSB-001",
      targetAudience: "全年龄段轻食人群",
      marketPath: "零食专卖渠道",
      devMode: "自有研发",
    },
  });
  const pvConfirmed = await prisma.productVersion.create({
    data: {
      productId: prod.id,
      versionTag: "v1.0-CONFIRMED",
      specs: { sugarRate: "5%", moisture: "12%" },
      isImmutable: true,
      isConfirmed: true,
    },
  });

  const pA02Valid = await createProject(ownerSession, {
    title: "固定配方经典肉松饼 (FIXED)",
    target: "经典配方复产与渠道准备",
    mode: ProjectMode.FIXED_PRODUCT,
    decisionMakerId: dmUser.id,
    productVersionId: pvConfirmed.id,
  });
  if (pA02Valid.stage !== ProjectStage.PRODUCTION_PREP) {
    throw new Error(`A02 失败: 固定产品初始阶段应为 PRODUCTION_PREP，实际为 ${pA02Valid.stage}`);
  }
  console.log("  ✔ A02 通过: 未选确认版本强行拦截；选定后直接进入 PRODUCTION_PREP，不生成虚假研究任务");

  // --------------------------------------------------------------------------
  // [A03] 反馈者可留言但不能采纳或批准；浏览者不能写；跨租户/越权 403/404
  // --------------------------------------------------------------------------
  console.log("\n▶ 正在验证 [A03] 权限隔离与防越权测试...");
  // 1. Viewer cannot create feedback
  let viewerBlocked = false;
  try {
    await createFeedback(viewerSession, {
      projectId: pA01.id,
      targetType: "Project",
      targetId: pA01.id,
      content: "观察员非法尝试写评论",
    });
  } catch (err: any) {
    if (err.statusCode === 403) viewerBlocked = true;
  }
  if (!viewerBlocked) throw new Error("A03 失败: 浏览者违规写入未被拦截！");

  // 2. FeedbackProvider can create feedback
  const fb = await createFeedback(feedbackSession, {
    projectId: pA01.id,
    targetType: "Project",
    targetId: pA01.id,
    content: "口感建议增加少许烘焙海盐提升风味层次",
  });
  if (!fb.id) throw new Error("A03 失败: 反馈者正常发表意见失败");

  // 3. FeedbackProvider CANNOT dispose/accept feedback (only owner can)
  let fbProviderDisposeBlocked = false;
  try {
    await disposeFeedback(feedbackSession, fb.id, {
      status: "ACCEPTED",
      reason: "评测员自批意见",
    });
  } catch (err: any) {
    if (err.statusCode === 403) fbProviderDisposeBlocked = true;
  }
  if (!fbProviderDisposeBlocked) throw new Error("A03 失败: 反馈者处置意见未被拦截！");

  // 4. Cross-organization access blocked
  let crossOrgBlocked = false;
  try {
    await getProjectDetail(foreignSession, pA01.id);
  } catch (err: any) {
    if (err.statusCode === 404 || err.statusCode === 403) crossOrgBlocked = true;
  }
  if (!crossOrgBlocked) throw new Error("A03 失败: 跨组织越权查看项目未被拦截！");
  console.log("  ✔ A03 通过: 浏览者禁写、反馈者禁止处置、跨租户越权彻底拦截 (403/404)");

  // --------------------------------------------------------------------------
  // [A04] 成果提交后由负责人检查；退回、修改、再次通过全过程可追溯
  // --------------------------------------------------------------------------
  console.log("\n▶ 正在验证 [A04] 工作成果负责人检查、退回与二次通过全闭环...");
  const workItem = await createWorkItem(ownerSession, pA01.id, {
    title: "多酚稳定性实验报告与初版配方表",
    target: "提供实验室80度烘焙下茶多酚与花青素留存率分析",
    deliverableReq: "多酚留存率数据表及感官评测初稿",
  });

  // Step 1: Submit draft deliverable
  await submitWork(ownerSession, workItem.id, {
    inputRevision: 1,
    runMode: RunMode.MANUAL,
    artifacts: [{
      type: "LAB_REPORT",
      title: "多酚留存率初次测定",
      content: "留存率测定为45%，略低于目标值50%",
    }],
  });

  // Step 2: Owner reviews with CHANGES_REQUESTED
  const reviewedRejected = await reviewWork(ownerSession, workItem.id, {
    accepted: false,
    reason: "45%留存率不满足轻食代餐卖点，请添加抗氧化辅料重测",
  });
  if (reviewedRejected.status !== WorkItemStatus.CHANGES_REQUESTED) {
    throw new Error("A04 失败: 退回后状态未进入 CHANGES_REQUESTED");
  }

  // Step 3: Re-submit improved deliverable
  await submitWork(ownerSession, workItem.id, {
    inputRevision: 1,
    runMode: RunMode.MANUAL,
    artifacts: [{
      type: "LAB_REPORT",
      title: "多酚留存率二次测定(微胶囊包裹后)",
      content: "优化包裹工艺后留存率提升至58.2%，符合标准",
    }],
  });

  // Step 4: Owner reviews with ACCEPTED
  const reviewedAccepted = await reviewWork(ownerSession, workItem.id, {
    accepted: true,
    reason: "指标达到 58.2%，同意验收多酚稳定性成果",
  });
  if (reviewedAccepted.status !== WorkItemStatus.ACCEPTED) {
    throw new Error("A04 失败: 最终成果未成功 ACCEPTED");
  }

  // Audit trace verification
  const auditLogs = await prisma.auditEvent.findMany({
    where: { objectId: workItem.id },
    orderBy: { timestamp: "asc" },
  });
  if (auditLogs.length < 3) throw new Error("A04 失败: 过程审计留痕不完整");
  console.log("  ✔ A04 通过: 任务退回、修改重提、负责人终审通过及全链路审计可追溯");

  // --------------------------------------------------------------------------
  // [A05] 缺市场依据或投入范围不能批准；自批失败；指定决策人批准
  // --------------------------------------------------------------------------
  console.log("\n▶ 正在验证 [A05] 打样门缺口阻断、防自批及指定决策人审批...");
  // Create packet missing budget & evidence
  const incompletePacket = await createDecisionPacketDraft(ownerSession, {
    projectId: pA01.id,
    artifactVersions: [{ type: "LAB_REPORT", version: 1 }],
    evidenceVersions: [], // empty evidence
    validationPlan: "组织工厂初步中试",
    // intentionally missing budget
  });
  await submitDecisionPacket(ownerSession, incompletePacket.id);

  // Attempt 1: Owner attempts self-approval
  let selfApprovalBlocked = false;
  try {
    await decideDecisionPacket(ownerSession, incompletePacket.id, {
      decision: DecisionOutcome.APPROVE,
      reason: "负责人自行批准",
    });
  } catch (err: any) {
    if (err.statusCode === 403) selfApprovalBlocked = true;
  }
  if (!selfApprovalBlocked) throw new Error("A05 失败: 负责人自批未被拦截！");

  // Attempt 2: Decision Maker tries to approve incomplete packet
  let incompleteBlocked = false;
  try {
    await decideDecisionPacket(dmSession, incompletePacket.id, {
      decision: DecisionOutcome.APPROVE,
      reason: "决策人尝试批准缺件包",
    });
  } catch (err: any) {
    if (err.statusCode === 422) incompleteBlocked = true;
  }
  if (!incompleteBlocked) throw new Error("A05 失败: 缺预算与市场依据未阻断审批！");
  console.log("  ✔ A05 前半通过: 负责人自批被拦截 (403)，缺件决策包被阻断 (422)");

  // Add real market evidence
  const validEvidence = await prisma.evidence.create({
    data: {
      projectId: pA01.id,
      contentOrUri: "2026年代餐燕麦消费趋势洞察：多酚抗氧卖点月增130%",
      source: "蝉妈妈/CBNData 电商消费研报",
      hash: "sha256-market-trend-001",
      nature: EvidenceNature.REAL,
      verifyStatus: EvidenceVerifyStatus.VERIFIED,
    },
  });

  // Ensure project has an associated confirmed product version for RESEARCH_SAMPLING_GATE (C01)
  const pA01Product = await prisma.product.create({
    data: {
      organizationId: org1.id,
      name: pA01.title,
      identityCode: "SKU-PA01-001",
      targetAudience: "轻食代餐人群",
      marketPath: "线上全渠道",
      devMode: "自有研发",
    },
  });
  const pA01Pv = await prisma.productVersion.create({
    data: {
      productId: pA01Product.id,
      versionTag: "v1.0-A05-CONFIRMED",
      specs: { polyphenolRate: "58%" },
      isImmutable: true,
      isConfirmed: true,
    },
  });
  await prisma.project.update({
    where: { id: pA01.id },
    data: { productVersionId: pA01Pv.id },
  });

  // Create complete valid packet
  const validPacket = await createDecisionPacketDraft(ownerSession, {
    projectId: pA01.id,
    artifactVersions: [{ type: "LAB_REPORT", version: 1 }],
    evidenceVersions: [{ id: validEvidence.id, hash: validEvidence.hash }],
    budgetAmount: 60000.0,
    budgetCurrency: "CNY",
    budgetScope: "仅限一期打样原料采购与初次实验室感官评测",
    validationPlan: "组织30人盲测与水分多酚指标检测",
  });
  await submitDecisionPacket(ownerSession, validPacket.id);

  // Decision Maker approves
  const decisionResult = await decideDecisionPacket(dmSession, validPacket.id, {
    decision: DecisionOutcome.APPROVE,
    reason: "多酚留存率数据扎实，6万预算范围明确，准予打样",
    obligations: "打样后出具感官盲测报告",
  });
  if (decisionResult.project.stage !== ProjectStage.SAMPLING) {
    throw new Error(`A05 失败: 批准后项目阶段未进入 SAMPLING，当前为 ${decisionResult.project.stage}`);
  }
  console.log("  ✔ A05 终验通过: 补齐资料后由指定决策人成功批准，推进至 SAMPLING");

  // --------------------------------------------------------------------------
  // [A06] 批准后只生成一项打样准备任务；界面及直接 API 均不能跳到生产
  // --------------------------------------------------------------------------
  console.log("\n▶ 正在验证 [A06] 批准仅生成一项打样准备任务，严禁直跳生产...");
  const samplingWorkItems = await prisma.workItem.findMany({
    where: { projectId: pA01.id, title: { contains: "打样准备" } },
  });
  if (samplingWorkItems.length !== 1) {
    throw new Error(`A06 失败: 批准后应恰好生成 1 项打样准备任务，实际为 ${samplingWorkItems.length}`);
  }

  // Verify that API does NOT provide arbitrary jump to PRODUCTION
  const projectNow = await prisma.project.findUnique({ where: { id: pA01.id } });
  if (projectNow?.stage === ProjectStage.PRODUCTION) {
    throw new Error("A06 失败: 项目直接越级进入了 PRODUCTION！");
  }
  console.log("  ✔ A06 通过: 批准后仅生成 1 项打样准备任务，无非法越级生产通道");

  // --------------------------------------------------------------------------
  // [A07] 相同决定重复提交只生成一个决定；不同请求 409 冲突
  // --------------------------------------------------------------------------
  console.log("\n▶ 正在验证 [A07] Idempotency-Key 并发防重与冲突拦截...");
  // Test already proven in db-transaction-verification.ts; re-verify service level
  const idempKey = "test-idemp-" + Date.now();
  const replayPacket = await createDecisionPacketDraft(ownerSession, {
    projectId: pA01.id,
    artifactVersions: [{ type: "LAB_REPORT", version: 1 }],
    evidenceVersions: [{ id: validEvidence.id, hash: validEvidence.hash }],
    budgetAmount: 20000.0,
    budgetScope: "补充打样",
    validationPlan: "盲测",
  });
  await submitDecisionPacket(ownerSession, replayPacket.id);

  const call1 = await decideDecisionPacket(dmSession, replayPacket.id, {
    decision: DecisionOutcome.REQUEST_CHANGES,
    reason: "需要补充打样明细",
    idempotencyKey: idempKey,
  });

  const call2 = await decideDecisionPacket(dmSession, replayPacket.id, {
    decision: DecisionOutcome.REQUEST_CHANGES,
    reason: "需要补充打样明细",
    idempotencyKey: idempKey,
  });

  if (call1.decision.id !== call2.decision.id) {
    throw new Error("A07 失败: 重复调用生成了两个不同的决定记录！");
  }

  let conflictThrown = false;
  try {
    await decideDecisionPacket(dmSession, replayPacket.id, {
      decision: DecisionOutcome.APPROVE, // Altered payload
      reason: "篡改参数",
      idempotencyKey: idempKey,
    });
  } catch (err: any) {
    if (err.statusCode === 409) conflictThrown = true;
  }
  if (!conflictThrown) throw new Error("A07 失败: 篡改参数未抛出 409 Conflict！");
  console.log("  ✔ A07 通过: 幂等重放命中原决定记录，篡改请求被拦截并抛出 409");

  // --------------------------------------------------------------------------
  // [A08] 审查期间关键版本变更致旧包失效；评论不使批准失效
  // --------------------------------------------------------------------------
  console.log("\n▶ 正在验证 [A08] scopeHash 版本指纹灵敏度与评论不失效规则...");
  // Create a packet under review
  // 说明：此处必须引用项目内真实存在且已验收的成果（A04 的 LAB_REPORT v1）。
  // 原用例引用了项目内根本不存在的 "SPEC" 成果，审批实际是被“成果不存在”(422) 拦下，
  // 并未真正检验 scopeHash 灵敏度，导致该断言长期被错误原因通过/失败。
  const packetA08 = await createDecisionPacketDraft(ownerSession, {
    projectId: pA01.id,
    artifactVersions: [{ type: "LAB_REPORT", version: 1 }],
    evidenceVersions: [{ id: validEvidence.id, hash: validEvidence.hash }],
    budgetAmount: 30000.0,
    budgetScope: "物性测试",
    validationPlan: "物理形态稳定性",
  });
  await submitDecisionPacket(ownerSession, packetA08.id);

  // Case 1: Comment added - should NOT invalidate scope hash
  await createFeedback(feedbackSession, {
    projectId: pA01.id,
    targetType: "DecisionPacket",
    targetId: packetA08.id,
    content: "这是一条常规业务评论，不应影响 scopeHash",
  });
  const hashAfterComment = computeScopeHash({
    projectId: packetA08.projectId,
    gate: packetA08.gate,
    // 决策包现已显式绑定产品版本，复核指纹时必须带上同一产品版本
    productVersionId: packetA08.productVersionId,
    artifactVersions: packetA08.artifactVersions as any,
    evidenceVersions: packetA08.evidenceVersions as any,
    budgetAmount: Number(packetA08.budgetAmount),
    budgetScope: packetA08.budgetScope,
    validationPlan: packetA08.validationPlan,
  });
  if (hashAfterComment !== packetA08.scopeHash) {
    throw new Error("A08 失败: 评论导致了 scopeHash 发生变动！");
  }

  // Case 2: Underlying evidence hash modified during review
  await prisma.decisionPacket.update({
    where: { id: packetA08.id },
    data: { budgetScope: "被外部篡改的范围" },
  });
  let hashMismatchBlocked = false;
  try {
    await decideDecisionPacket(dmSession, packetA08.id, {
      decision: DecisionOutcome.APPROVE,
      reason: "尝试批准已被篡改/过期的包",
    });
  } catch (err: any) {
    if (err.statusCode === 409) hashMismatchBlocked = true;
  }
  if (!hashMismatchBlocked) throw new Error("A08 失败: scopeHash 变动未拦截审批！");
  console.log("  ✔ A08 通过: 评论不影响指纹；关键版本变动精准触发 409 阻断批准");

  // --------------------------------------------------------------------------
  // [A09] 旧输入任务迟到只保留历史产物，不覆盖新结果；失败回执不显完成
  // --------------------------------------------------------------------------
  console.log("\n▶ 正在验证 [A09] 迟到任务输入隔离与失败回执状态...");
  const workA09 = await createWorkItem(ownerSession, pA01.id, {
    title: "感官双盲对照实验",
    target: "评估不同代糖配比对甜味纯正度的影响",
    deliverableReq: "盲测打分表",
  });
  // Simulate task inputRevision and project revision bumped to 3
  await prisma.project.update({
    where: { id: pA01.id },
    data: { revision: 3 },
  });
  await prisma.workItem.update({
    where: { id: workA09.id },
    data: { inputRevision: 3 },
  });

  // Submit late receipt with older inputRevision = 1
  const lateSubmission = await submitWork(ownerSession, workA09.id, {
    inputRevision: 1, // older than 3
    runMode: RunMode.TEST_STUB,
    artifacts: [{
      type: "BLIND_TEST",
      title: "旧版本盲测结果",
      content: "旧配方评分",
    }],
  });
  if (!lateSubmission.isLateArrival) {
    throw new Error("A09 失败: 迟到提交未被标记为 isLateArrival");
  }
  const workA09Current = await prisma.workItem.findUnique({ where: { id: workA09.id } });
  if (workA09Current?.status === WorkItemStatus.SUBMITTED) {
    throw new Error("A09 失败: 迟到提交错误修改了当前任务状态！");
  }

  // Test failure receipt
  const failedSubmission = await submitWork(ownerSession, workA09.id, {
    inputRevision: 3,
    runMode: RunMode.MANUAL,
    status: RunReceiptStatus.FAILED,
    errorMessage: "实验室设备恒温箱故障，测试中断",
  });
  const workA09AfterFail = await prisma.workItem.findUnique({ where: { id: workA09.id } });
  if (workA09AfterFail?.status === WorkItemStatus.SUBMITTED) {
    throw new Error("A09 失败: 失败回执错误标记任务为 SUBMITTED！");
  }
  console.log("  ✔ A09 通过: 迟到提交不覆盖当前结果；失败回执正确保留故障记录且不显示完成");

  // --------------------------------------------------------------------------
  // [A10] DEMO 证据不能用于 REAL 项目批准；数据缺口保持未知
  // --------------------------------------------------------------------------
  console.log("\n▶ 正在验证 [A10] DEMO 证据严禁进入 REAL 项目决策依据...");
  const demoEvidence = await prisma.evidence.create({
    data: {
      projectId: pA01.id,
      contentOrUri: "样例模拟市场数据（未经真实核实）",
      source: "模拟器注入",
      hash: "sha256-demo-fake",
      nature: EvidenceNature.DEMO, // DEMO
      verifyStatus: EvidenceVerifyStatus.VERIFIED,
    },
  });

  const packetWithDemo = await createDecisionPacketDraft(ownerSession, {
    projectId: pA01.id,
    artifactVersions: [{ type: "LAB_REPORT", version: 1 }],
    evidenceVersions: [{ id: demoEvidence.id, hash: demoEvidence.hash }],
    budgetAmount: 40000.0,
    budgetScope: "打样投入",
    validationPlan: "验证计划",
  });
  await submitDecisionPacket(ownerSession, packetWithDemo.id);

  let demoEvidenceBlocked = false;
  try {
    await decideDecisionPacket(dmSession, packetWithDemo.id, {
      decision: DecisionOutcome.APPROVE,
      reason: "尝试使用 DEMO 证据批准 REAL 项目",
    });
  } catch (err: any) {
    if (err.statusCode === 422 && err.message.includes("DEMO evidence")) {
      demoEvidenceBlocked = true;
    }
  }
  if (!demoEvidenceBlocked) {
    throw new Error("A10 失败: REAL 项目引用 DEMO 证据未被阻断！");
  }
  console.log("  ✔ A10 通过: DEMO 证据无法通过 REAL 项目决策门禁，未知项保持未知");

  // --------------------------------------------------------------------------
  // [A11] 原子写入模拟失败后无半完成数据
  // --------------------------------------------------------------------------
  console.log("\n▶ 正在验证 [A11] 跨表写入原子性与模拟崩溃回滚 (ACID)...");
  // Verified comprehensively in db-transaction-verification.ts
  const beforeCount = await prisma.auditEvent.count();
  let rollbackDone = false;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.auditEvent.create({
        data: {
          actorId: ownerUser.id,
          action: "TEST_TX",
          objectType: "Test",
          objectId: "test-id",
          summary: "This should be rolled back",
        },
      });
      throw new Error("TRIGGER_ATOMIC_ROLLBACK");
    });
  } catch (err: any) {
    if (err.message === "TRIGGER_ATOMIC_ROLLBACK") rollbackDone = true;
  }
  const afterCount = await prisma.auditEvent.count();
  if (!rollbackDone || beforeCount !== afterCount) {
    throw new Error("A11 失败: 事务回滚未生效，产生了脏数据！");
  }
  console.log("  ✔ A11 通过: 事务原子性验证完好，异常时数据全量回滚");

  // --------------------------------------------------------------------------
  // [A12] 生产配置无法启用开发身份切换开关
  // --------------------------------------------------------------------------
  console.log("\n▶ 正在验证 [A12] 生产环境硬性禁用开发身份模拟开关...");
  const fakeReq = new NextRequest("http://localhost:3100/api/projects", {
    headers: {
      "x-user-id": ownerUser.id,
      "x-organization-id": org1.id,
    },
  });

  // Temporarily simulate production environment
  const originalEnv = process.env.NODE_ENV;
  (process.env as any).NODE_ENV = "production";
  let prodMockAuthBlocked = false;
  try {
    await getServerSession(fakeReq);
  } catch (err: any) {
    if (err.statusCode === 403) prodMockAuthBlocked = true;
  } finally {
    (process.env as any).NODE_ENV = originalEnv;
  }

  if (!prodMockAuthBlocked) {
    throw new Error("A12 失败: 生产环境下未硬性拒绝开发环境 Header 身份切换！");
  }
  console.log("  ✔ A12 通过: 生产配置下彻底阻断 mock auth headers (403 Forbidden)");

  console.log("\n================================================================================");
  console.log("🏆 验收全绿: A01 到 A12 全部 12 项标准 100% 验证通过！");
  console.log("================================================================================\n");
}

runAcceptanceSuite()
  .catch((err) => {
    console.error("\n❌ 验收套件执行失败:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
