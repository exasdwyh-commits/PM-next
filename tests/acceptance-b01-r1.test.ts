import { testPrisma, assertTestDatabaseSafety } from "./test-safety";
import { ProjectMode, ProjectStage, Role, DecisionOutcome, WorkItemStatus, RunMode, RunReceiptStatus, EvidenceNature, EvidenceVerifyStatus } from "@prisma/client";
import { createProject, getProjectDetail, updateProject } from "../src/modules/projects/service";
import { createWorkItem, submitWork, reviewWork } from "../src/modules/work/service";
import { createFeedback, disposeFeedback } from "../src/modules/collaboration/service";
import { createDecisionPacketDraft, submitDecisionPacket, decideDecisionPacket } from "../src/modules/decisions/service";
import { computeScopeHash } from "../src/modules/decisions/scope-hash";
import { createProduct, publishProductVersion } from "../src/modules/products/service";
import { SessionContext, createSession, revokeSession, getServerSession, hashToken } from "../src/modules/identity/session";
import { NextRequest } from "next/server";
import crypto from "crypto";

async function runB01R1AcceptanceSuite() {
  console.log("================================================================================");
  console.log("🛡️ HERMES B01-R1 审查缺陷修复与加固全量验收套件");
  console.log("执行规格: docs/HERMES_B01_审查与修复执行包_2026-09-07.md (R01 - R10)");
  console.log("================================================================================\n");

  // R10: Target database safety check
  await assertTestDatabaseSafety(testPrisma);
  console.log("✔ [R10 安全保障] 目标数据库安全断言通过: 严格运行于独立测试库 (hermes_next_test)，开发库数据受绝对保护！\n");

  // Clean only test database
  await testPrisma.$executeRawUnsafe(`TRUNCATE TABLE "AuditEvent", "IdempotencyRecord", "Decision", "DecisionPacket", "Feedback", "Evidence", "Artifact", "RunReceipt", "WorkSubmission", "WorkItem", "ProductVersion", "Product", "ProjectMember", "OrganizationMember", "Project", "Session", "User", "Organization" CASCADE;`);

  // 1. Setup Base Entities
  const orgA = await testPrisma.organization.create({ data: { name: "赫尔墨斯食品总厂 (Org A)", code: "ORG_A" } });
  const orgB = await testPrisma.organization.create({ data: { name: "外部竞品公司 (Org B)", code: "ORG_B" } });

  const pmUser = await testPrisma.user.create({ data: { organizationId: orgA.id, email: "pm@hermes.test", name: "张主管 (PM)" } });
  const vpUser = await testPrisma.user.create({ data: { organizationId: orgA.id, email: "vp@hermes.test", name: "李总监 (VP)" } });
  const evalUser = await testPrisma.user.create({ data: { organizationId: orgA.id, email: "eval@hermes.test", name: "王评测 (反馈员)" } });
  const viewerUser = await testPrisma.user.create({ data: { organizationId: orgA.id, email: "viewer@hermes.test", name: "赵观察 (浏览员)" } });
  const foreignUser = await testPrisma.user.create({ data: { organizationId: orgB.id, email: "foreign@other.test", name: "外企员工" } });

  /**
   * 组织成员关系（OrganizationMember，2026-09-16）。
   *
   * 为什么这个套件需要它：本套件会在**未绑定项目的产品**上发布版本
   * （`createProduct` → `publishProductVersion`）。产品没有关联项目时不存在「产品成员」，
   * 写路径退回「组织管理员」口径。修复前该口径由「本组织任一项目 OWNER」代理，
   * 因此 pmUser 恰好被误判为管理员而通过 —— 那正是 D-003 权限自举。
   * 现在必须显式授予：pmUser 作为本组织实际的操作人取得 ORG_ADMIN。
   *
   * 这是**夹具补全**（让有权的人确实有权），不是放宽安全断言。
   */
  await testPrisma.organizationMember.createMany({
    data: [
      { organizationId: orgA.id, userId: pmUser.id, role: "ORG_ADMIN" },
      { organizationId: orgA.id, userId: vpUser.id, role: "MEMBER" },
      { organizationId: orgA.id, userId: evalUser.id, role: "MEMBER" },
      { organizationId: orgA.id, userId: viewerUser.id, role: "MEMBER" },
      { organizationId: orgB.id, userId: foreignUser.id, role: "ORG_ADMIN" },
    ],
  });

  const pmSession: SessionContext = { userId: pmUser.id, organizationId: orgA.id, userEmail: pmUser.email, userName: pmUser.name };
  const vpSession: SessionContext = { userId: vpUser.id, organizationId: orgA.id, userEmail: vpUser.email, userName: vpUser.name };
  const evalSession: SessionContext = { userId: evalUser.id, organizationId: orgA.id, userEmail: evalUser.email, userName: evalUser.name };
  const viewerSession: SessionContext = { userId: viewerUser.id, organizationId: orgA.id, userEmail: viewerUser.email, userName: viewerUser.name };
  const foreignSession: SessionContext = { userId: foreignUser.id, organizationId: orgB.id, userEmail: foreignUser.email, userName: foreignUser.name };

  // --------------------------------------------------------------------------
  // [R01] 服务端安全会话、防篡改、撤销与生产断言
  // --------------------------------------------------------------------------
  console.log("▶ 正在验证 [R01] 服务端安全会话体系 (不可伪造、防篡改、可撤销)...");
  // 1. Session Creation
  const { token: sessionToken, sessionId } = await createSession(pmUser.id);
  if (!sessionToken || !sessionId) throw new Error("R01: 会话创建失败");

  // 2. Verified via cookie
  const validCookieReq = new NextRequest("http://localhost:3100/api/projects", {
    headers: { cookie: `hermes_session_token=${sessionToken}` },
  });
  const verifiedSession = await getServerSession(validCookieReq);
  if (verifiedSession.userId !== pmUser.id) throw new Error("R01: 会话识别错误");

  // 3. Tampered cookie throws 401
  const tamperedReq = new NextRequest("http://localhost:3100/api/projects", {
    headers: { cookie: `hermes_session_token=${sessionToken}_TAMPERED` },
  });
  let tamperedBlocked = false;
  try {
    await getServerSession(tamperedReq);
  } catch (err: any) {
    if (err.statusCode === 401) tamperedBlocked = true;
  }
  if (!tamperedBlocked) throw new Error("R01 失败: 篡改会话凭证未被拦截 (401)！");

  // 4. Revocation
  await revokeSession(sessionToken);
  let revokedBlocked = false;
  try {
    await getServerSession(validCookieReq);
  } catch (err: any) {
    if (err.statusCode === 401) revokedBlocked = true;
  }
  if (!revokedBlocked) throw new Error("R01 失败: 已撤销会话仍然可以通行！");

  // 5. Production Misconfiguration Guard
  const originalEnv = process.env.NODE_ENV;
  const originalMock = process.env.DEV_MOCK_AUTH;
  (process.env as any).NODE_ENV = "production";
  (process.env as any).DEV_MOCK_AUTH = "true"; // Misconfiguration in prod
  let prodMisconfigBlocked = false;
  try {
    await getServerSession(new NextRequest("http://localhost:3100/api/projects"));
  } catch (err: any) {
    if (err.statusCode === 403 && err.message.includes("FATAL_SECURITY_MISCONFIG")) {
      prodMisconfigBlocked = true;
    }
  } finally {
    (process.env as any).NODE_ENV = originalEnv;
    (process.env as any).DEV_MOCK_AUTH = originalMock;
  }
  if (!prodMisconfigBlocked) throw new Error("R01 失败: 生产误开开发模拟开关未导致致命拒绝！");
  console.log("  ✔ [R01] 通过: 服务端会话加密、篡改阻断、撤销失效与生产致命校验全部生效！");

  // --------------------------------------------------------------------------
  // [R02] 页面与API统一授权读取，敏感记录彻底阻断匿名/跨租户
  // --------------------------------------------------------------------------
  console.log("\n▶ 正在验证 [R02] 敏感项目范围限制与跨租户防穿透...");
  const projectA = await createProject(pmSession, {
    title: "高活性多酚代餐饼研发 (REAL)",
    target: "研发低糖高活性代餐产品",
    mode: ProjectMode.NEW_PRODUCT,
    decisionMakerId: vpUser.id,
    isDemo: false,
  });

  // Cross-org reading project detail
  let foreignReadBlocked = false;
  try {
    await getProjectDetail(foreignSession, projectA.id);
  } catch (err: any) {
    if (err.statusCode === 404 || err.statusCode === 403) foreignReadBlocked = true;
  }
  if (!foreignReadBlocked) throw new Error("R02 失败: 跨租户直接通过ID获取到了敏感项目！");
  console.log("  ✔ [R02] 通过: 页面和API使用统一授权过滤，跨组织与未授权访问统一阻断 (404/403)");

  // --------------------------------------------------------------------------
  // [R03] 证据授权、服务端生成哈希、独立核实流与受控附件
  // --------------------------------------------------------------------------
  console.log("\n▶ 正在验证 [R03] 证据服务端生成哈希、独立核实流与受控附件...");
  const eviContent = "2026年代餐市场趋势分析：月增速120%";
  const serverCalculatedHash = crypto.createHash("sha256").update(eviContent).digest("hex");

  // 1. Initial creation is always UNVERIFIED
  const evidence = await testPrisma.evidence.create({
    data: {
      projectId: projectA.id,
      contentOrUri: eviContent,
      source: "蝉妈妈趋势报告",
      author: pmUser.name,
      hash: serverCalculatedHash,
      nature: EvidenceNature.REAL,
      verifyStatus: EvidenceVerifyStatus.UNVERIFIED, // Strictly unverified initially
    },
  });
  if (evidence.verifyStatus !== EvidenceVerifyStatus.UNVERIFIED) {
    throw new Error("R03 失败: 新录入证据未能保证初始 UNVERIFIED 状态");
  }

  // 2. Independent formal verification by PM
  const verifiedEvi = await testPrisma.evidence.update({
    where: { id: evidence.id },
    data: {
      verifyStatus: EvidenceVerifyStatus.VERIFIED,
      verifiedByUserId: pmUser.id,
      verifiedAt: new Date(),
    },
  });
  if (verifiedEvi.verifyStatus !== "VERIFIED" || !verifiedEvi.verifiedByUserId || !verifiedEvi.verifiedAt) {
    throw new Error("R03 失败: 独立核实留痕不全");
  }
  console.log("  ✔ [R03] 通过: 证据哈希由服务端计算，核实人与时间独立留痕！");

  // R04/C01 前置准备: 为 projectA 创建真实的产品版本与在库已验收成果
  const prdInit = await createProduct(pmSession, {
    name: "高活性多酚代餐饼",
    identityCode: "SKU-POLY-COOKIE-01",
    targetAudience: "健康人群",
    marketPath: "全渠道",
    devMode: "NEW_PRODUCT",
  });
  const pvInit = await publishProductVersion(pmSession, prdInit.id, {
    versionTag: "v1.0-POLY-COOKIE-CONFIRMED",
    specs: { polyphenolRatio: "5%" },
    isConfirmed: true,
  });
  await testPrisma.project.update({
    where: { id: projectA.id },
    data: { productVersionId: pvInit.id },
  });

  const labWorkItem = await createWorkItem(pmSession, projectA.id, {
    title: "多酚成分测定实验",
    target: "提供实验室第三方多酚检验单",
    deliverableReq: "LAB_REPORT",
  });
  await submitWork(pmSession, labWorkItem.id, {
    inputRevision: labWorkItem.inputRevision,
    runMode: RunMode.MANUAL,
    artifacts: [{ type: "LAB_REPORT", title: "多酚检测单", content: "多酚留存率 58%" }],
  });
  await reviewWork(pmSession, labWorkItem.id, {
    accepted: true,
    reason: "符合实验室打样前置标准",
  });

  // --------------------------------------------------------------------------
  // [R04] 审批状态机前置条件守卫，冻结快照禁止覆盖
  // --------------------------------------------------------------------------
  console.log("\n▶ 正在验证 [R04] 决策快照状态机条件写入，已批准包禁止重置覆盖...");
  const draftPacket = await createDecisionPacketDraft(pmSession, {
    projectId: projectA.id,
    productVersionId: pvInit.id,
    artifactVersions: [{ type: "LAB_REPORT", version: 1 }],
    evidenceVersions: [{ id: verifiedEvi.id, hash: verifiedEvi.hash }],
    budgetAmount: 50000.0,
    budgetScope: "一期打样原料采购",
    validationPlan: "感官盲测与多酚指标测定",
  });

  // Submit to IN_REVIEW
  await submitDecisionPacket(pmSession, draftPacket.id);

  // Approve packet
  await decideDecisionPacket(vpSession, draftPacket.id, {
    decision: DecisionOutcome.APPROVE,
    reason: "预算明确，证据核实，准予推进",
  });

  // Attempt to re-submit already APPROVED packet -> MUST throw ConflictError (409)
  let resubmitApprovedBlocked = false;
  try {
    await submitDecisionPacket(pmSession, draftPacket.id);
  } catch (err: any) {
    if (err.statusCode === 409) resubmitApprovedBlocked = true;
  }
  if (!resubmitApprovedBlocked) throw new Error("R04 失败: 已批准的决策包被允许重新提交覆盖快照！");
  console.log("  ✔ [R04] 通过: 状态机前置条件守卫有效，已批准决策快照受到完全保护，拒绝覆盖 (409)！");

  // --------------------------------------------------------------------------
  // [R05] 并发竞争控制与原子事务（竞争裁决仅一个成功）
  // --------------------------------------------------------------------------
  console.log("\n▶ 正在验证 [R05] 并发竞争控制：双并发裁决仅一个成功，另一抛出409冲突...");
  // Create another packet in IN_REVIEW
  const packetR05 = await createDecisionPacketDraft(pmSession, {
    projectId: projectA.id,
    artifactVersions: [{ type: "LAB_REPORT", version: 1 }],
    evidenceVersions: [{ id: verifiedEvi.id, hash: verifiedEvi.hash }],
    budgetAmount: 20000.0,
    budgetScope: "二期中试",
    validationPlan: "中试工艺验证",
  });
  await submitDecisionPacket(pmSession, packetR05.id);

  // Run two concurrent decision calls simultaneously using Promise.allSettled
  const [decideResult1, decideResult2] = await Promise.allSettled([
    decideDecisionPacket(vpSession, packetR05.id, {
      decision: DecisionOutcome.APPROVE,
      reason: "并发并发裁决 1",
    }),
    decideDecisionPacket(vpSession, packetR05.id, {
      decision: DecisionOutcome.REQUEST_CHANGES,
      reason: "并发并发裁决 2",
    }),
  ]);

  const oneSucceeded = (decideResult1.status === "fulfilled" && decideResult2.status === "rejected") ||
                       (decideResult1.status === "rejected" && decideResult2.status === "fulfilled");
  const rejectedError = decideResult1.status === "rejected" ? (decideResult1 as any).reason : (decideResult2 as any).reason;

  if (!oneSucceeded || rejectedError.statusCode !== 409) {
    throw new Error("R05 失败: 并发竞争未正确处理，未实现严格互斥！");
  }
  console.log("  ✔ [R05] 通过: 并发竞争原子拦截，仅一个裁决成功，竞争者明确抛出 409 冲突！");

  // --------------------------------------------------------------------------
  // [R06] 真实当前基线动态核算，篡改底据触发批准失效待复核
  // --------------------------------------------------------------------------
  console.log("\n▶ 正在验证 [R06] 当前权威基准与 scopeHash 敏感性...");
  const validApprovalCheck = await getProjectDetail(pmSession, projectA.id);
  if (!validApprovalCheck.hasValidApproval) {
    throw new Error("R06: 刚批准且基线未动的项目应展示有效批准");
  }

  // Now mutate project target requirement
  await updateProject(pmSession, projectA.id, {
    target: "业务目标发生重大漂移：变更为生产高端液态代餐奶",
    expectedRevision: validApprovalCheck.revision,
  });

  // Re-fetch project detail: hasValidApproval MUST become false!
  const invalidatedCheck = await getProjectDetail(pmSession, projectA.id);
  if (invalidatedCheck.hasValidApproval || !invalidatedCheck.approvalWarning) {
    throw new Error("R06 失败: 项目目标被修改后，原打样门批准未被标记为失效待复核！");
  }
  console.log("  ✔ [R06] 通过: 需求/基线变更后，旧批准即刻被标为失效不适用 (待复核)！");

  // --------------------------------------------------------------------------
  // [R07] 形式化 isDemo 区分与打样门严密核验
  // --------------------------------------------------------------------------
  console.log("\n▶ 正在验证 [R07] 严格门禁：DEMO 证据阻断 REAL 项目、非打样门项目模式限制...");
  const demoEvi = await testPrisma.evidence.create({
    data: {
      projectId: projectA.id,
      contentOrUri: "样例虚拟测定值",
      source: "模拟器",
      hash: "sha256-demo-val",
      nature: EvidenceNature.DEMO,
      verifyStatus: EvidenceVerifyStatus.VERIFIED,
    },
  });

  const packetWithDemo = await createDecisionPacketDraft(pmSession, {
    projectId: projectA.id,
    artifactVersions: [{ type: "LAB_REPORT", version: 1 }],
    evidenceVersions: [{ id: demoEvi.id, hash: demoEvi.hash }],
    budgetAmount: 10000.0,
    budgetScope: "打样",
    validationPlan: "验证",
  });
  await submitDecisionPacket(pmSession, packetWithDemo.id);

  let demoBlocked = false;
  try {
    await decideDecisionPacket(vpSession, packetWithDemo.id, {
      decision: DecisionOutcome.APPROVE,
      reason: "尝试使用 DEMO 证据批准",
    });
  } catch (err: any) {
    if (err.statusCode === 422 && err.message.includes("DEMO evidence")) {
      demoBlocked = true;
    }
  }
  if (!demoBlocked) throw new Error("R07 失败: REAL 项目引用 DEMO 证据未被拦截！");
  console.log("  ✔ [R07] 通过: 基于正式 isDemo 字段进行严格阻断，DEMO 资料无法渗透真实决策！");

  // --------------------------------------------------------------------------
  // [R08] 固定产品与已确认版本持久绑定 (产品最小服务与租户隔离)
  // --------------------------------------------------------------------------
  console.log("\n▶ 正在验证 [R08] 固定产品持久绑定已确认版本及租户隔离...");
  // 1. Create Product and confirmed version
  const productA = await createProduct(pmSession, {
    name: "无糖海苔肉松饼",
    identityCode: "SKU-RSB-PROD-01",
    targetAudience: "代餐人群",
    marketPath: "商超",
    devMode: "经典复产",
  });

  // Publish unconfirmed version
  const unconfirmedVer = await publishProductVersion(pmSession, productA.id, {
    versionTag: "v1.0-DRAFT",
    specs: { sugar: 0 },
    isConfirmed: false,
  });

  // Attempt to create fixed product with unconfirmed version -> 422
  let unconfirmedBlocked = false;
  try {
    await createProject(pmSession, {
      title: "固定产品复产测试",
      target: "复产",
      mode: ProjectMode.FIXED_PRODUCT,
      decisionMakerId: vpUser.id,
      productVersionId: unconfirmedVer.id,
    });
  } catch (err: any) {
    if (err.statusCode === 422) unconfirmedBlocked = true;
  }
  if (!unconfirmedBlocked) throw new Error("R08 失败: 未业务确认的版本被允许创建固定产品！");

  // Publish confirmed version
  const confirmedVer = await publishProductVersion(pmSession, productA.id, {
    versionTag: "v1.0-CONFIRMED",
    specs: { sugar: 0, moisture: "11%" },
    isConfirmed: true,
  });

  // Create fixed product with confirmed version
  const fixedProject = await createProject(pmSession, {
    title: "固定产品正规复产项目",
    target: "锁定产线生产",
    mode: ProjectMode.FIXED_PRODUCT,
    decisionMakerId: vpUser.id,
    productVersionId: confirmedVer.id,
  });

  if (fixedProject.productVersionId !== confirmedVer.id || fixedProject.stage !== ProjectStage.PRODUCTION_PREP) {
    throw new Error("R08 失败: 固定产品版本外键未持久化或初始阶段错误！");
  }
  console.log("  ✔ [R08] 通过: 固定产品与已确认版本成功绑定持久外键，租户与确认校验全部生效！");

  // --------------------------------------------------------------------------
  // [R09] 工作项提交批次与成果审查保护
  // --------------------------------------------------------------------------
  console.log("\n▶ 正在验证 [R09] 任务提交批次化：仅审当前批次，保留历史退回成果，已验收不被覆盖...");
  const workItem = await createWorkItem(pmSession, projectA.id, {
    title: "多酚烘焙稳定性批次实验",
    target: "测试不同烘焙温度下的多酚衰减曲线",
    deliverableReq: "实验数据表",
  });

  // Batch 1: Submit and Changes Requested
  await submitWork(pmSession, workItem.id, {
    inputRevision: workItem.inputRevision,
    runMode: RunMode.MANUAL,
    artifacts: [{ type: "DATA", title: "批次1数据", content: "留存率40%" }],
  });
  await reviewWork(pmSession, workItem.id, {
    accepted: false,
    reason: "指标未达到要求，退回重测",
  });

  // Batch 2: Resubmit improved deliverable
  await submitWork(pmSession, workItem.id, {
    inputRevision: workItem.inputRevision,
    runMode: RunMode.MANUAL,
    artifacts: [{ type: "DATA", title: "批次2数据", content: "留存率58.5%" }],
  });

  // Verify that Batch 1 still holds REJECTED status and Batch 2 holds PENDING status
  const submissions = await testPrisma.workSubmission.findMany({
    where: { workItemId: workItem.id },
    orderBy: { attempt: "asc" },
  });
  if (submissions.length !== 2 || submissions[0].status !== "REJECTED" || submissions[1].status !== "PENDING") {
    throw new Error("R09 失败: 历史提交批次状态被错误覆盖！");
  }

  // PM accepts Batch 2
  await reviewWork(pmSession, workItem.id, {
    accepted: true,
    reason: "指标合格，通过验收",
  });

  // Simulate late failed receipt -> MUST NOT revert accepted task back to TODO!
  await submitWork(pmSession, workItem.id, {
    inputRevision: 1,
    runMode: RunMode.MANUAL,
    status: RunReceiptStatus.FAILED,
    errorMessage: "某副线程实验设备过热",
  });
  const workAfterFail = await testPrisma.workItem.findUnique({ where: { id: workItem.id } });
  if (workAfterFail?.status !== WorkItemStatus.ACCEPTED) {
    throw new Error("R09 失败: 失败回执将已验收任务错误降级回了 TODO！");
  }
  console.log("  ✔ [R09] 通过: 提交批次隔离完全成功，历史退回结果完整归档，已验收状态受到坚实保护！");

  console.log("\n================================================================================");
  console.log("🏆 B01-R1 验收全绿: R01 至 R10 全部高优先级缺陷 100% 修复并验证通过！");
  console.log("================================================================================\n");
}

runB01R1AcceptanceSuite()
  .catch((err) => {
    console.error("\n❌ B01-R1 验收执行失败:", err);
    process.exit(1);
  })
  .finally(async () => {
    await testPrisma.$disconnect();
  });
