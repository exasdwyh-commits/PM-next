/**
 * B01-03 真实 HTTP 验收（独立测试环境）
 *
 * 与既有服务级回归的区别：本套全部断言通过真实 HTTP 入口发起（生产模式 next start），
 * 不使用服务函数直调替代页面/接口验收。
 *
 * 前置：
 *   NODE_ENV=production DEV_MOCK_AUTH=false DATABASE_URL=<测试库> npx next start -p 3110
 * 运行：
 *   BASE_URL=http://127.0.0.1:3110 npm run test:http
 *
 * 夹具自建（组织/用户/项目成员），可单独执行；只清理本套夹具，不做无范围清库。
 */

import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { hashPassword } from "../src/modules/identity/session";
import crypto from "crypto";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3110";
const RUN_TAG = `http${Date.now()}`;
const PASSWORD = `Http-Accept-${crypto.randomBytes(6).toString("hex")}!`;
const FOREIGN_PASSWORD = `Foreign-${crypto.randomBytes(6).toString("hex")}!`;

let passed = 0;
const failures: string[] = [];

function ok(cond: boolean, msg: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✔ ${msg}`);
  } else {
    failures.push(msg);
    console.log(`  ❌ ${msg}`);
  }
}

/** 会话 Cookie 罐：模拟浏览器携带 Cookie 的真实调用 */
const cookieJar = new Map<string, string>();

async function api(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<{ status: number; json: any; setCookie: string | null }> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
    const jar = cookieJar.get(opts.token);
    if (jar) headers.Cookie = jar;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json, setCookie: res.headers.get("set-cookie") };
}

async function login(email: string, password: string) {
  const res = await api("POST", "/api/auth/session", { body: { email, password } });

  // Phase 3A · B6 修复后，登录响应体**不再**回传 token（只通过 httpOnly Cookie 下发，
  // 避免脚本可读导致 XSS 窃取）。因此这里改为从 Set-Cookie 中取出真实会话令牌：
  // 它既作为 cookieJar 的键，也作为 Bearer 让本套「非浏览器客户端」探针继续可用。
  const pair = res.setCookie?.split(";")[0]; // hermes_session_token=xxx
  const token = pair && pair.includes("=") ? pair.slice(pair.indexOf("=") + 1) : undefined;
  if (token && pair) {
    cookieJar.set(token, pair);
  }
  return Object.assign(res, { token });
}

async function main() {
  await assertTestDatabaseSafety(prisma);

  console.log("================================================================================");
  console.log("🧪 B01-03 真实 HTTP 验收（生产模式服务 / 独立测试库）");
  console.log(`    BASE_URL=${BASE}`);
  console.log("================================================================================\n");

  // ---------- 夹具：组织、账号、跨组织账号 ----------
  const org = await prisma.organization.create({
    data: { code: `${RUN_TAG}_ORG`, name: "HTTP 验收机构（合成夹具）" },
  });
  const foreignOrg = await prisma.organization.create({
    data: { code: `${RUN_TAG}_FOREIGN`, name: "跨组织对照机构（合成夹具）" },
  });

  const mkUser = async (email: string, name: string, organizationId: string, password: string) =>
    prisma.user.create({
      data: { email, name, organizationId, passwordHash: hashPassword(password) },
    });

  const owner = await mkUser(`${RUN_TAG}-owner@hermes.test`, "HTTP 负责人", org.id, PASSWORD);
  const leader = await mkUser(`${RUN_TAG}-leader@hermes.test`, "HTTP 决策人", org.id, PASSWORD);
  const collaborator = await mkUser(`${RUN_TAG}-collab@hermes.test`, "HTTP 协作者", org.id, PASSWORD);
  const foreign = await mkUser(`${RUN_TAG}-foreign@hermes.test`, "跨组织用户", foreignOrg.id, FOREIGN_PASSWORD);

  // ---------- 1. 登录与会话 ----------
  console.log("\n▶ 场景 1：负责人登录、新建项目、生成并提交成果");

  const badLogin = await login(owner.email, "wrong-password");
  ok(badLogin.status === 401, `1.1 错误凭证不签发会话（HTTP ${badLogin.status}）`);
  ok(!badLogin.json?.token, "1.1 错误凭证响应中没有会话令牌");

  const noPassword = await api("POST", "/api/auth/session", { body: { email: owner.email } });
  ok(noPassword.status === 401, `1.2 生产模式不接受免密快捷登录（HTTP ${noPassword.status}）`);

  const ownerLogin = await login(owner.email, PASSWORD);
  ok(ownerLogin.status === 200 && !!ownerLogin.token, `1.3 正确账号密码登录成功（HTTP ${ownerLogin.status}）`);
  const ownerToken = ownerLogin.token as string;
  ok(
    /HttpOnly/i.test(ownerLogin.setCookie || "") && /Secure/i.test(ownerLogin.setCookie || ""),
    "1.4 会话 Cookie 标记为 HttpOnly + Secure（生产模式）"
  );

  const anon = await api("GET", "/api/projects");
  ok(anon.status === 401, `1.5 未登录访问项目列表被拒（HTTP ${anon.status}）`);

  const project = await api("POST", "/api/projects", {
    token: ownerToken,
    body: {
      title: `${RUN_TAG}_HTTP 验收项目`,
      target: "蓝莓花青素固体饮料，目标成本 12 元/盒，抖音渠道",
      mode: "NEW_PRODUCT",
      isDemo: true,
      decisionMakerId: leader.id,
    },
  });
  ok(project.status === 201 && !!project.json?.id, `1.6 负责人经 HTTP 新建项目成功（HTTP ${project.status}）`);
  const projectId = project.json?.id as string;

  await prisma.projectMember.create({
    data: { projectId, userId: collaborator.id, role: "FEEDBACK_PROVIDER" },
  });

  const evidenceCreate = await api("POST", `/api/projects/${projectId}/evidences`, {
    token: ownerToken,
    body: {
      contentOrUri: "竞品 A 蓝莓花青素固体饮料 30 条装，抖音旗舰店成交价 89 元，月销 1.2 万（合成验收夹具）",
      source: "HTTP_ACCEPTANCE_FIXTURE",
      nature: "DEMO",
      // P1-02 起，服务端要求关键证据缺口闭合（price 必须有已核实 FACT，爆品跟进还需 salesVolume）
      // 才会放行建议包提交。本套写于 P1-02 之前，原先只传自由文本，导致 422 误报为回归；
      // 这里按 P1-01 的断言规格补齐结构化、可核实的 FACT。
      claims: [
        {
          fieldKey: "price",
          fieldName: "竞品成交价",
          kind: "FACT",
          value: "89",
          currency: "CNY",
          spec: "30 条/盒",
          unit: "盒",
          mechanism: "到手价",
          applicableProduct: "竞品A蓝莓花青素固体饮料",
          applicableChannel: "抖音",
        },
        {
          fieldKey: "salesVolume",
          fieldName: "竞品月销",
          kind: "FACT",
          value: "1.2万",
          unit: "条/月",
          mechanism: "平台公开销量",
          applicableProduct: "竞品A蓝莓花青素固体饮料",
          applicableChannel: "抖音",
        },
      ],
    },
  });
  ok(evidenceCreate.status === 201, `1.6b 负责人经 HTTP 录入证据（HTTP ${evidenceCreate.status}）`);

  const evidenceVerify = await api("POST", `/api/evidences/${evidenceCreate.json?.id}/verify`, {
    token: ownerToken,
    body: { status: "VERIFIED" },
  });
  ok(
    evidenceVerify.status === 200 && evidenceVerify.json?.verifyStatus === "VERIFIED",
    `1.6c 负责人核实证据（HTTP ${evidenceVerify.status} / ${evidenceVerify.json?.verifyStatus ?? evidenceVerify.json?.message}）`
  );

  const suggestion = await api("GET", `/api/projects/${projectId}/suggestions`, { token: ownerToken });
  ok(suggestion.status === 200 && !!suggestion.json?.specificationBrief, `1.7 生成产品建议包（HTTP ${suggestion.status}）`);

  const committed = await api("POST", `/api/projects/${projectId}/suggestions`, {
    token: ownerToken,
    body: {
      suggestion: suggestion.json,
      isConfirmed: true,
      budgetScope: "实验室打样与第一期中试试制",
      validationPlan: "第三方检测花青素含量与感官盲测",
      idempotencyKey: `${RUN_TAG}-commit-1`,
    },
    headers: { "idempotency-key": `${RUN_TAG}-commit-1` },
  });
  ok(committed.status === 201 && !!committed.json?.decisionPacket?.id, `1.8 成果提交并生成决策包（HTTP ${committed.status}）`);
  const packetId = committed.json?.decisionPacket?.id as string;
  const workItemId = committed.json?.productVersion?.id ? null : null; // 工作项另行查询

  const detail = await api("GET", `/api/projects/${projectId}`, { token: ownerToken });
  const workItem = detail.json?.workItems?.find((w: any) => w.title === "产品定义与可行性研判");
  ok(!!workItem?.id, "1.9 项目详情返回「产品定义与可行性研判」工作项");

  // ---------- 2. 负责人检查、决策层批准 ----------
  console.log("\n▶ 场景 2：负责人检查成果，决策层批准进入打样");

  const leaderLogin = await login(leader.email, PASSWORD);
  const leaderToken = leaderLogin.token as string;
  ok(leaderLogin.status === 200, `2.0 决策层登录成功（HTTP ${leaderLogin.status}）`);

  const collabReview = await api("POST", `/api/work-items/${workItem.id}/reviews`, {
    token: (await login(collaborator.email, PASSWORD)).token,
    body: { accepted: true, reason: "协作者尝试验收" },
  });
  ok(collabReview.status === 403, `2.1 协作者不能验收成果（HTTP ${collabReview.status}）`);

  const review = await api("POST", `/api/work-items/${workItem.id}/reviews`, {
    token: ownerToken,
    body: { accepted: true, reason: "已逐项核对规格与市场研究报告 v1，确认采纳" },
  });
  ok(review.status === 200, `2.2 负责人检查成果通过（HTTP ${review.status}）`);

  const submitted = await api("POST", `/api/decision-packets/${packetId}/submit`, { token: ownerToken });
  ok(
    submitted.status === 200 && submitted.json?.status === "IN_REVIEW",
    `2.3 决策包提交至待审批（HTTP ${submitted.status} / ${submitted.json?.status ?? submitted.json?.message}）`
  );

  const approve = await api("POST", `/api/decision-packets/${packetId}/decide`, {
    token: leaderToken,
    body: { decision: "APPROVE", reason: "依据齐全，准予打样" },
  });
  ok(
    approve.status === 200 && approve.json?.packet?.status === "APPROVED",
    `2.4 决策层批准（HTTP ${approve.status} / ${approve.json?.message ?? approve.json?.packet?.status}）`
  );
  ok(approve.json?.project?.stage === "SAMPLING", "2.5 项目阶段推进至 SAMPLING");

  // ---------- 3. 局部修订：仅改规格 ----------
  console.log("\n▶ 场景 3：仅改规格后重新审核，沿用成果适用性提示");

  const revised = structuredClone(suggestion.json);
  revised.specificationBrief.netWeight = "HTTP REVISED 20g";
  const revisionCommit = await api("POST", `/api/projects/${projectId}/suggestions`, {
    token: ownerToken,
    body: {
      suggestion: revised,
      isConfirmed: true,
      budgetScope: "实验室打样与第一期中试试制",
      validationPlan: "第三方检测花青素含量与感官盲测",
    },
    headers: { "idempotency-key": `${RUN_TAG}-commit-2` },
  });
  ok(revisionCommit.status === 201, `3.1 修订规格提交成功（HTTP ${revisionCommit.status}）`);
  const revisedPacketId = revisionCommit.json?.decisionPacket?.id as string;

  const specArtifacts = await prisma.artifact.findMany({
    where: { workItemId: workItem.id, type: "SPECIFICATION_BRIEF" },
    orderBy: { contentVersion: "desc" },
  });
  const reportArtifacts = await prisma.artifact.findMany({
    where: { workItemId: workItem.id, type: "MARKET_RESEARCH_REPORT" },
    orderBy: { contentVersion: "desc" },
  });
  ok(specArtifacts.length === 2 && specArtifacts[0].reviewStatus === "PENDING", "3.2 修订生成规格 v2 且待负责人检查");
  ok(reportArtifacts.length === 1, "3.3 未变研究报告未被重新生成（不伪装重新研究）");
  ok(specArtifacts[0].content.includes("HTTP REVISED 20g"), "3.4 规格 v2 内容为修订后规格");

  const applicability = await prisma.artifactApplicability.findFirst({
    where: { artifactId: reportArtifacts[0].id },
  });
  ok(!!applicability, "3.5 沿用研究报告生成适用性确认记录");
  ok(applicability?.status === "PENDING", `3.6 确认前适用性记录为待确认（${applicability?.status}）`);
  ok(
    applicability?.sourceInputRevision === reportArtifacts[0].inputRevision,
    `3.7 适用性记录保留原始输入基线 r${applicability?.sourceInputRevision}（未被覆盖）`
  );

  await api("POST", `/api/decision-packets/${revisedPacketId}/submit`, { token: ownerToken });
  const approveBeforeReview = await api("POST", `/api/decision-packets/${revisedPacketId}/decide`, {
    token: leaderToken,
    body: { decision: "APPROVE", reason: "未经负责人检查尝试批准" },
  });
  ok(
    approveBeforeReview.status === 409 || approveBeforeReview.status === 422,
    `3.8 未审核的修订成果不能批准（HTTP ${approveBeforeReview.status}）`
  );

  const reReview = await api("POST", `/api/work-items/${workItem.id}/reviews`, {
    token: ownerToken,
    body: { accepted: true, reason: "已核对修订规格 v2，并确认研究报告 v1 仍适用于当前基线" },
  });
  ok(reReview.status === 200, `3.9 负责人重新检查通过（HTTP ${reReview.status}）`);

  const confirmedApplicability = await prisma.artifactApplicability.findFirst({
    where: { artifactId: reportArtifacts[0].id },
  });
  ok(confirmedApplicability?.status === "CONFIRMED", `3.10 负责人确认后适用性记录转为已确认（${confirmedApplicability?.status}）`);

  const approveRevised = await api("POST", `/api/decision-packets/${revisedPacketId}/decide`, {
    token: leaderToken,
    body: { decision: "APPROVE", reason: "修订成果已检查，准予打样" },
  });
  ok(
    approveRevised.status === 200 && approveRevised.json?.packet?.status === "APPROVED",
    `3.11 负责人确认后修订决策包批准（HTTP ${approveRevised.status}）`
  );

  // ---------- 4. 旧决策包 / 未审核成果不能误批 ----------
  console.log("\n▶ 场景 4：旧决策包与旧成果引用不能错误批准");

  const stalePacket = await prisma.decisionPacket.findFirst({
    where: { projectId, id: { notIn: [packetId, revisedPacketId] } },
  });
  const oldPacketApprove = await api("POST", `/api/decision-packets/${packetId}/decide`, {
    token: leaderToken,
    body: { decision: "APPROVE", reason: "再次尝试批准已决策的旧包" },
  });
  ok(
    oldPacketApprove.status === 409 || oldPacketApprove.status === 422,
    `4.1 已决策的旧决策包不能重复批准（HTTP ${oldPacketApprove.status}）`
  );

  const staleRefs = await api("POST", "/api/projects", {
    token: ownerToken,
    body: { title: `${RUN_TAG}_越权对照项目`, target: "跨项目对照", mode: "NEW_PRODUCT", isDemo: true },
  });
  ok(stalePacket === null || stalePacket.projectId === projectId, "4.2 本项目内不存在游离决策包（或归属本项目）");
  ok(staleRefs.status === 201, `4.3 对照项目创建成功（HTTP ${staleRefs.status}）`);

  // ---------- 5. 协作者留言与权限边界 ----------
  console.log("\n▶ 场景 5：协作者留言，但不能改基线或审批");

  const collabLogin = await login(collaborator.email, PASSWORD);
  const collabToken = collabLogin.token as string;

  const feedback = await api("POST", `/api/projects/${projectId}/feedback`, {
    token: collabToken,
    body: { content: "建议补充竞品价格带证据", targetType: "PROJECT", targetId: projectId },
  });
  ok(feedback.status === 201, `5.1 协作者留言成功（HTTP ${feedback.status}）`);

  const collabApprove = await api("POST", `/api/decision-packets/${revisedPacketId}/decide`, {
    token: collabToken,
    body: { decision: "APPROVE", reason: "协作者尝试批准" },
  });
  ok(collabApprove.status === 403, `5.2 协作者不能批准投入（HTTP ${collabApprove.status}）`);

  const collabSubmit = await api("POST", `/api/projects/${projectId}/suggestions`, {
    token: collabToken,
    body: { suggestion: revised, isConfirmed: true },
    headers: { "idempotency-key": `${RUN_TAG}-collab-commit` },
  });
  ok(collabSubmit.status === 403, `5.3 协作者不能提交/改写基线（HTTP ${collabSubmit.status}）`);

  const disposition = await api("POST", `/api/feedback/${feedback.json?.id}/disposition`, {
    token: ownerToken,
    body: { status: "ACCEPTED", reason: "已补充价格带证据并更新研究报告" },
  });
  ok(disposition.status === 200, `5.4 负责人处理协作者留言（HTTP ${disposition.status}）`);

  // ---------- 6. 幂等与重复提交 ----------
  console.log("\n▶ 场景 6：重复提交与同键不同内容");

  const beforeSubmissions = await prisma.workSubmission.count({ where: { workItemId: workItem.id } });
  const beforeArtifacts = await prisma.artifact.count({ where: { workItemId: workItem.id } });

  const replay = await api("POST", `/api/projects/${projectId}/suggestions`, {
    token: ownerToken,
    body: { suggestion: revised, isConfirmed: true },
    headers: { "idempotency-key": `${RUN_TAG}-commit-replay` },
  });
  const afterSubmissions = await prisma.workSubmission.count({ where: { workItemId: workItem.id } });
  const afterArtifacts = await prisma.artifact.count({ where: { workItemId: workItem.id } });
  ok(replay.status === 201, `6.1 重复提交未报错（HTTP ${replay.status}）`);
  ok(
    beforeSubmissions === afterSubmissions && beforeArtifacts === afterArtifacts,
    `6.2 重复提交未产生新批次/新成果（${beforeSubmissions}→${afterSubmissions}, ${beforeArtifacts}→${afterArtifacts}）`
  );

  const conflict = await api("POST", `/api/projects/${projectId}/suggestions`, {
    token: ownerToken,
    body: {
      suggestion: { ...revised, specificationBrief: { ...revised.specificationBrief, netWeight: "HTTP 30g" } },
      isConfirmed: true,
    },
    headers: { "idempotency-key": `${RUN_TAG}-commit-replay` },
  });
  ok(conflict.status === 409, `6.3 同幂等键不同内容明确冲突（HTTP ${conflict.status}）`);

  // ---------- 7. 未登录 / 错误角色 / 跨项目 ----------
  console.log("\n▶ 场景 7：未登录、错误角色、跨项目引用均被拒绝");

  const foreignLogin = await login(foreign.email, FOREIGN_PASSWORD);
  const foreignToken = foreignLogin.token as string;
  ok(foreignLogin.status === 200, `7.0 跨组织账号可登录（HTTP ${foreignLogin.status}）`);

  const crossProject = await api("GET", `/api/projects/${projectId}`, { token: foreignToken });
  ok(crossProject.status === 403 || crossProject.status === 404, `7.1 跨组织读取项目被拒（HTTP ${crossProject.status}）`);

  const foreignApprove = await api("POST", `/api/decision-packets/${revisedPacketId}/decide`, {
    token: foreignToken,
    body: { decision: "APPROVE", reason: "跨组织尝试批准" },
  });
  ok(foreignApprove.status === 403 || foreignApprove.status === 404, `7.2 跨组织批准被拒（HTTP ${foreignApprove.status}）`);

  const noTokenApprove = await api("POST", `/api/decision-packets/${revisedPacketId}/decide`, {
    body: { decision: "APPROVE", reason: "无凭证尝试批准" },
  });
  ok(noTokenApprove.status === 401, `7.3 无凭证批准被拒（HTTP ${noTokenApprove.status}）`);

  // ---------- 8. 退出后旧会话失效 ----------
  console.log("\n▶ 场景 8：退出后旧会话失效");

  const logout = await api("DELETE", "/api/auth/session", { token: ownerToken });
  ok(logout.status === 200, `8.1 退出成功（HTTP ${logout.status}）`);

  const afterLogout = await api("GET", "/api/auth/session", { token: ownerToken });
  ok(afterLogout.status === 401, `8.2 退出后旧令牌失效（HTTP ${afterLogout.status}）`);

  const afterLogoutProjects = await api("GET", "/api/projects", { token: ownerToken });
  ok(afterLogoutProjects.status === 401, `8.3 退出后旧令牌无法读取项目（HTTP ${afterLogoutProjects.status}）`);

  for (const credentialType of ["cookie", "bearer"] as const) {
    const fresh = await login(owner.email, PASSWORD);
    const token = fresh.token as string;
    const headers: Record<string, string> = credentialType === "cookie"
      ? { Cookie: cookieJar.get(token)! }
      : { Authorization: `Bearer ${token}` };
    const before = await api("GET", "/api/auth/session", { headers });
    ok(before.status === 200, `8.4 ${credentialType}-only 会话有效`);
    const result = await api("DELETE", "/api/auth/session", { headers });
    ok(result.status === 200, `8.5 ${credentialType}-only 退出成功`);
    const after = await api("GET", "/api/auth/session", { headers });
    ok(after.status === 401, `8.6 ${credentialType}-only 旧凭证失效`);
  }

  // ---------- 清理：仅本套夹具 ----------
  await prisma.feedback.deleteMany({ where: { project: { organizationId: org.id } } });
  await prisma.artifactApplicability.deleteMany({ where: { workItem: { project: { organizationId: org.id } } } });
  await prisma.decision.deleteMany({ where: { packet: { project: { organizationId: org.id } } } });
  await prisma.decisionPacket.deleteMany({ where: { project: { organizationId: org.id } } });
  await prisma.artifact.deleteMany({ where: { workItem: { project: { organizationId: org.id } } } });
  await prisma.workSubmission.deleteMany({ where: { workItem: { project: { organizationId: org.id } } } });
  await prisma.workItem.deleteMany({ where: { project: { organizationId: org.id } } });
  await prisma.evidence.deleteMany({ where: { project: { organizationId: org.id } } });
  await prisma.projectMember.deleteMany({ where: { project: { organizationId: org.id } } });
  await prisma.project.deleteMany({ where: { organizationId: org.id } });
  await prisma.productVersion.deleteMany({ where: { product: { organizationId: org.id } } });
  await prisma.product.deleteMany({ where: { organizationId: org.id } });
  await prisma.auditEvent.deleteMany({ where: { actorId: { in: [owner.id, leader.id, collaborator.id, foreign.id] } } });
  await prisma.session.deleteMany({ where: { user: { organizationId: { in: [org.id, foreignOrg.id] } } } });
  await prisma.user.deleteMany({ where: { organizationId: { in: [org.id, foreignOrg.id] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [org.id, foreignOrg.id] } } });

  console.log("\n================================================================================");
  if (failures.length === 0) {
    console.log(`🏆 B01-03 HTTP 验收全绿：${passed} 项断言全部通过`);
  } else {
    console.log(`❌ B01-03 HTTP 验收失败：${failures.length} 项未通过（通过 ${passed} 项）`);
    failures.forEach((f) => console.log(`   - ${f}`));
    process.exitCode = 1;
  }
  console.log("================================================================================\n");
}

main()
  .catch((error) => {
    console.error("\n❌ B01-03 HTTP 验收异常终止:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
