/**
 * 门禁边界 HTTP 验收（TASK-003c · TEST-004 / TEST-005）
 *
 * 与 `tests/regression-gate-boundaries.test.ts` 的分工（**有意拆分，偏离计划**）：
 *   - `regression-gate-boundaries.test.ts`：**纯逻辑**（不需服务、不需 DB），锁住
 *     `assertGateImplemented()` 与 `checkOrRecordIdempotency()` 的单元语义，随时可跑。
 *   - 本文件：**真实 HTTP**（生产模式 `next start`），锁住「未实现门型在 HTTP 入口 fail-closed
 *     且**零写入**」「跨组织不因新增断言泄露存在性」「幂等重放 / 跨命令 409 / 并发批准仅一方成功」。
 * 拆分原因：把 HTTP 依赖塞进纯逻辑测试会破坏后者的可跑性（无服务即可跑）。
 *
 * 运行（经既有启动器，自带端口占用与服务器归属校验）：
 *   bash scripts/acc-server.sh --port 3182 3183 tests/acceptance-gate-boundaries.test.ts
 *
 * 夹具自建自清理，仅清理本套组织，不做无范围清库；全部为带 RUN_TAG 的合成夹具。
 */

import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { hashPassword } from "../src/modules/identity/session";
import { computeRequestHash } from "../src/shared/idempotency";
import { computeScopeHash } from "../src/modules/decisions/scope-hash";
import crypto from "crypto";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3182";
const RUN_TAG = `gb${Date.now()}`;
const PASSWORD = `Gb-Accept-${crypto.randomBytes(6).toString("hex")}!`;
const G1 = "RESEARCH_SAMPLING_GATE";
const G2 = "PRODUCTION_GATE";
const DECIDE_SCOPE = "DECIDE_DECISION_PACKET";

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

const cookieJar = new Map<string, string>();
async function api(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<{ status: number; json: any }> {
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
  return { status: res.status, json };
}

async function login(email: string, password: string) {
  const res = await fetch(`${BASE}/api/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = res.headers.get("set-cookie");
  const pair = setCookie?.split(";")[0];
  const token = pair && pair.includes("=") ? pair.slice(pair.indexOf("=") + 1) : undefined;
  if (token && pair) cookieJar.set(token, pair);
  return { status: res.status, token };
}

async function main() {
  await assertTestDatabaseSafety(prisma);

  console.log("=".repeat(80));
  console.log("🧪 门禁边界 HTTP 验收（TASK-003c · TEST-004/TEST-005）");
  console.log(`    BASE_URL=${BASE}  RUN_TAG=${RUN_TAG}`);
  console.log("=".repeat(80) + "\n");

  // ---------- 夹具 ----------
  const orgA = await prisma.organization.create({ data: { code: `${RUN_TAG}_A`, name: "门禁验收机构 A（合成）" } });
  const orgB = await prisma.organization.create({ data: { code: `${RUN_TAG}_B`, name: "门禁验收机构 B（合成）" } });

  const mkUser = (email: string, name: string, organizationId: string) =>
    prisma.user.create({ data: { email, name, organizationId, passwordHash: hashPassword(PASSWORD) } });

  const ownerA = await mkUser(`${RUN_TAG}-owner@hermes.test`, "负责人 A", orgA.id);
  const dmA = await mkUser(`${RUN_TAG}-dm@hermes.test`, "决策人 A", orgA.id);
  const fbA = await mkUser(`${RUN_TAG}-fb@hermes.test`, "协作者 A", orgA.id);
  const viewerA = await mkUser(`${RUN_TAG}-viewer@hermes.test`, "只读 A", orgA.id);
  const outsiderA = await mkUser(`${RUN_TAG}-outsider@hermes.test`, "同组织非成员 A", orgA.id);
  const foreignB = await mkUser(`${RUN_TAG}-foreign@hermes.test`, "跨组织 B", orgB.id);

  const product = await prisma.product.create({
    data: {
      organizationId: orgA.id,
      name: `${RUN_TAG} 合成产品`,
      identityCode: `${RUN_TAG}-ID`,
      targetAudience: "夹具人群",
      marketPath: "DOMESTIC",
      devMode: "SELF_DEVELOPED",
      ownerId: ownerA.id,
    },
  });
  const pv = await prisma.productVersion.create({
    data: { productId: product.id, versionTag: "v1", specs: { netWeight: "30 条/盒" }, isConfirmed: true },
  });
  const project = await prisma.project.create({
    data: {
      organizationId: orgA.id,
      productId: product.id,
      productVersionId: pv.id,
      mode: "NEW_PRODUCT",
      stage: "RESEARCH",
      title: `${RUN_TAG} 合成项目`,
      target: "夹具目标",
      ownerId: ownerA.id,
      decisionMakerId: dmA.id,
      members: {
        create: [
          { userId: ownerA.id, role: "OWNER" },
          { userId: dmA.id, role: "DECISION_MAKER" },
          { userId: fbA.id, role: "FEEDBACK_PROVIDER" },
          { userId: viewerA.id, role: "VIEWER" },
        ],
      },
    },
  });
  // 一条已核实真实证据 + 一条已验收成果（供可批准包使用）
  const evidence = await prisma.evidence.create({
    data: {
      projectId: project.id,
      contentOrUri: `${RUN_TAG} 合成市场依据`,
      source: "合成夹具来源",
      hash: `${RUN_TAG}-ev-hash`,
      nature: "REAL",
      verifyStatus: "VERIFIED",
    },
  });
  const workItem = await prisma.workItem.create({
    data: {
      projectId: project.id,
      title: `${RUN_TAG} 合成工作项`,
      target: "夹具目标",
      deliverableReq: "夹具交付要求",
    },
  });
  await prisma.artifact.create({
    data: {
      workItemId: workItem.id,
      organizationId: orgA.id,
      productVersionId: pv.id,
      type: "SPECIFICATION_BRIEF",
      title: `${RUN_TAG} 合成规格简报`,
      content: JSON.stringify({ schemaVersion: "1.0", items: [] }),
      contentVersion: 1,
      producerType: "MANUAL",
      reviewStatus: "ACCEPTED",
      inputRevision: project.revision,
    },
  });

  const currentArtifacts = [{ type: "SPECIFICATION_BRIEF", version: 1 }];
  const currentEvidences = [{ id: evidence.id, hash: evidence.hash }];

  /** 构造一个「可被 G1 批准」的决策包（DRAFT，scopeHash 与服务器重算一致）。 */
  async function makeApprovablePacket() {
    const budgetAmount = 50000;
    const budgetScope = "仅限一期打样原料采购";
    const validationPlan = "20 人双盲口感评测";
    const scopeHash = computeScopeHash({
      projectId: project.id,
      gate: G1,
      productVersionId: pv.id,
      artifactVersions: currentArtifacts,
      evidenceVersions: currentEvidences,
      budgetAmount,
      budgetCurrency: "CNY",
      budgetScope,
      validationPlan,
    });
    return prisma.decisionPacket.create({
      data: {
        projectId: project.id,
        gate: G1,
        productVersionId: pv.id,
        artifactVersions: [],
        evidenceVersions: currentEvidences,
        budgetAmount,
        budgetCurrency: "CNY",
        budgetScope,
        validationPlan,
        requiredChecks: { economicsFeasibilityPassed: true, keyEvidenceGapsFilled: true },
        scopeHash,
        status: "DRAFT",
      },
    });
  }

  const countWrites = async () => ({
    packets: await prisma.decisionPacket.count({ where: { projectId: project.id } }),
    decisions: await prisma.decision.count({ where: { packet: { projectId: project.id } } }),
    workItems: await prisma.workItem.count({ where: { projectId: project.id } }),
    stage: (await prisma.project.findUnique({ where: { id: project.id } }))!.stage,
  });

  const draftBody = (gate: string) => ({
    gate,
    artifactVersions: [],
    evidenceVersions: [],
    validationPlan: "夹具验证计划",
    budgetScope: "夹具预算范围",
    budgetAmount: 1000,
  });

  // ---------- 登录 ----------
  const ownerLogin = await login(ownerA.email, PASSWORD);
  const dmLogin = await login(dmA.email, PASSWORD);
  const fbLogin = await login(fbA.email, PASSWORD);
  const viewerLogin = await login(viewerA.email, PASSWORD);
  const outsiderLogin = await login(outsiderA.email, PASSWORD);
  const foreignLogin = await login(foreignB.email, PASSWORD);
  ok(
    ownerLogin.status === 200 && dmLogin.status === 200 && foreignLogin.status === 200,
    `0.0 身份登录（owner/dm/foreign 均 200）`
  );

  // ==========================================================================
  // ① 门禁 422 + 零写入
  // ==========================================================================
  console.log("\n▶ 场景 1：未实现门型（PRODUCTION_GATE）fail-closed 且零写入");

  // 1.1 draft gate=PRODUCTION_GATE → 422
  const before1 = await countWrites();
  const draftG2 = await api("POST", `/api/projects/${project.id}/decision-packets`, {
    token: ownerLogin.token,
    body: draftBody(G2),
  });
  const after1 = await countWrites();
  ok(draftG2.status === 422, `1.1 draft gate=PRODUCTION_GATE → 422（HTTP ${draftG2.status}）`);
  ok(
    after1.packets === before1.packets && after1.decisions === before1.decisions && after1.workItems === before1.workItems && after1.stage === before1.stage,
    `1.1b 零写入：packets/decisions/workItems/stage 均不变（${before1.packets}/${before1.decisions}/${before1.workItems}/${before1.stage}）`
  );

  // 1.2 控制组：draft gate=RESEARCH_SAMPLING_GATE → 201（断言不得误伤 G1）
  const draftG1 = await api("POST", `/api/projects/${project.id}/decision-packets`, {
    token: ownerLogin.token,
    body: draftBody(G1),
  });
  ok(draftG1.status === 201, `1.2 控制组 draft gate=RESEARCH_SAMPLING_GATE → 201（HTTP ${draftG1.status}）`);

  // 1.3 submit 一个已存在的 PRODUCTION_GATE 包 → 422 且状态不变
  const g2Draft = await prisma.decisionPacket.create({
    data: {
      projectId: project.id,
      gate: G2,
      artifactVersions: [],
      evidenceVersions: [],
      budgetAmount: 1000,
      budgetScope: "夹具",
      validationPlan: "夹具",
      requiredChecks: {},
      scopeHash: "g2-fixture",
      status: "DRAFT",
    },
  });
  const before3 = await countWrites();
  const submitG2 = await api("POST", `/api/decision-packets/${g2Draft.id}/submit`, { token: ownerLogin.token, body: {} });
  const g2AfterSubmit = await prisma.decisionPacket.findUnique({ where: { id: g2Draft.id } });
  const after3 = await countWrites();
  ok(submitG2.status === 422, `1.3 submit PRODUCTION_GATE 包 → 422（HTTP ${submitG2.status}）`);
  ok(g2AfterSubmit?.status === "DRAFT", `1.3b 包状态仍为 DRAFT（零写入，实际 ${g2AfterSubmit?.status}）`);
  ok(after3.decisions === before3.decisions && after3.workItems === before3.workItems && after3.stage === before3.stage, "1.3c 无 Decision / 无 WorkItem / 阶段不变");

  // 1.4 decide 一个 IN_REVIEW 的 PRODUCTION_GATE 包 → 422 且零写入
  const g2Review = await prisma.decisionPacket.create({
    data: {
      projectId: project.id,
      gate: G2,
      productVersionId: pv.id,
      artifactVersions: [],
      evidenceVersions: currentEvidences,
      budgetAmount: 1000,
      budgetCurrency: "CNY",
      budgetScope: "夹具",
      validationPlan: "夹具",
      requiredChecks: {},
      scopeHash: "g2-fixture-review",
      status: "IN_REVIEW",
    },
  });
  const before4 = await countWrites();
  const decideG2 = await api("POST", `/api/decision-packets/${g2Review.id}/decide`, {
    token: dmLogin.token,
    body: { decision: "APPROVE", reason: "夹具尝试批准 G2" },
  });
  const g2AfterDecide = await prisma.decisionPacket.findUnique({ where: { id: g2Review.id } });
  const after4 = await countWrites();
  ok(decideG2.status === 422, `1.4 decide PRODUCTION_GATE 包 → 422（HTTP ${decideG2.status}）`);
  ok(g2AfterDecide?.status === "IN_REVIEW", `1.4b 包状态仍为 IN_REVIEW（零写入，实际 ${g2AfterDecide?.status}）`);
  ok(after4.decisions === before4.decisions, "1.4c 无新增 Decision");
  ok(after4.workItems === before4.workItems, "1.4d 无新增 WorkItem（未派生打样任务）");
  ok(after4.stage === before4.stage, `1.4e 阶段未推进（实际 ${after4.stage}）`);

  // ==========================================================================
  // TEST-004 权限矩阵（门禁路径）
  // ==========================================================================
  console.log("\n▶ 场景 2：TEST-004 门禁路径权限矩阵 + 零写入");

  const matrix: Array<{ label: string; token?: string; expect: number }> = [
    { label: "匿名", token: undefined, expect: 401 },
    { label: "负责人(OWNER)", token: ownerLogin.token, expect: 422 },
    { label: "决策人(DECISION_MAKER)", token: dmLogin.token, expect: 403 },
    { label: "协作者(FEEDBACK_PROVIDER)", token: fbLogin.token, expect: 403 },
    { label: "只读(VIEWER)", token: viewerLogin.token, expect: 403 },
    { label: "同组织非成员", token: outsiderLogin.token, expect: 403 },
    { label: "跨组织", token: foreignLogin.token, expect: 403 }, // 见报告：requireProjectRole 对非成员（含跨组织）返回 403（既有行为）
  ];
  const beforeM = await countWrites();
  for (const m of matrix) {
    const r = await api("POST", `/api/projects/${project.id}/decision-packets`, {
      token: m.token,
      body: draftBody(G2),
    });
    ok(r.status === m.expect, `2.x draft[${m.label}] → ${m.expect}（HTTP ${r.status}）`);
    ok(r.status !== 422 || m.expect === 422, `2.x 红线：draft[${m.label}] 不得被新增断言变为 422（实际 ${r.status}）`);
  }
  const afterM = await countWrites();
  ok(
    afterM.packets === beforeM.packets && afterM.decisions === beforeM.decisions && afterM.workItems === beforeM.workItems && afterM.stage === beforeM.stage,
    "2.z 整个矩阵零写入（packets/decisions/workItems/stage 不变）"
  );

  // 红线：submit / decide 的跨组织必须 404（存在性/归属检查先于门禁断言）
  const rsgForCross = await makeApprovablePacket();
  const submitForeign = await api("POST", `/api/decision-packets/${rsgForCross.id}/submit`, { token: foreignLogin.token, body: {} });
  ok(submitForeign.status === 404, `2.3a 红线：submit 跨组织 → 404 不泄露存在性（HTTP ${submitForeign.status}）`);
  const decideForeign = await api("POST", `/api/decision-packets/${rsgForCross.id}/decide`, {
    token: foreignLogin.token,
    body: { decision: "APPROVE", reason: "跨组织尝试" },
  });
  ok(decideForeign.status === 404, `2.3b 红线：decide 跨组织 → 404 不泄露存在性（HTTP ${decideForeign.status}）`);

  // 2.4 封口断言（TASK-003d）：`createDecisionPacketDraft` 走 `requireProjectRole`，它**只查 membership、
  //     不查项目存在性**。故「不存在的 projectId」与「跨组织」应得到**同一个状态码**——若同码，
  //     则 403 不可用于区分「存在但非成员」与「不存在」，**不构成存在性 oracle**。
  //     不存在与跨组织同码 → 403 不可用于区分存在性。
  const nonexistentProjectId = crypto.randomUUID();
  const draftNonexistent = await api("POST", `/api/projects/${nonexistentProjectId}/decision-packets`, {
    token: ownerLogin.token,
    body: draftBody(G2),
  });
  const draftCrossOrg = await api("POST", `/api/projects/${project.id}/decision-packets`, {
    token: foreignLogin.token,
    body: draftBody(G2),
  });
  ok(
    draftNonexistent.status === 403,
    `2.4 封口：不存在 projectId → 403（HTTP ${draftNonexistent.status}，期望 403 而非 404）`
  );
  ok(
    draftNonexistent.status === draftCrossOrg.status,
    `2.4b 封口：不存在(${draftNonexistent.status}) 与 跨组织(${draftCrossOrg.status}) 同码 ⇒ 403 无存在性 oracle`
  );

  // ==========================================================================
  // TEST-005 一致性
  // ==========================================================================
  console.log("\n▶ 场景 3：TEST-005 幂等与并发一致性");

  // 3.1 真实批准 → 同键同请求重放（不产生第二条 Decision）
  const pktA = await makeApprovablePacket();
  const submitA = await api("POST", `/api/decision-packets/${pktA.id}/submit`, { token: ownerLogin.token, body: {} });
  ok(submitA.status === 200, `3.0 可批准包提交成功（HTTP ${submitA.status}）`);
  const keyReplay = `${RUN_TAG}-replay`;
  const decideBody = { decision: "APPROVE", reason: "夹具批准（重放测试）", idempotencyKey: keyReplay };
  const first = await api("POST", `/api/decision-packets/${pktA.id}/decide`, {
    token: dmLogin.token,
    body: decideBody,
    headers: { "idempotency-key": keyReplay },
  });
  ok(first.status === 200, `3.1 首次批准成功（HTTP ${first.status}）`);
  const replay = await api("POST", `/api/decision-packets/${pktA.id}/decide`, {
    token: dmLogin.token,
    body: decideBody,
    headers: { "idempotency-key": keyReplay },
  });
  ok(replay.status === 200, `3.2 同键同请求 → 重放 200（HTTP ${replay.status}）`);
  const decisionsA = await prisma.decision.count({ where: { packetId: pktA.id } });
  ok(decisionsA === 1, `3.2b 重放不产生第二条 Decision（实际 ${decisionsA}）`);

  // 3.3 同键不同命令 → 409（HTTP 级验证 ③ 修复）
  const pktB = await makeApprovablePacket();
  const keyScope = `${RUN_TAG}-scope`;
  const scopeBody = { decision: "APPROVE", reason: "跨命令夹具" };
  const expectedHash = computeRequestHash({
    packetId: pktB.id,
    decision: "APPROVE",
    reason: "跨命令夹具",
    obligations: undefined,
    idempotencyKey: keyScope,
  });
  await prisma.idempotencyRecord.create({
    data: {
      key: keyScope,
      actorId: dmA.id,
      commandScope: "SOME_OTHER_COMMAND",
      requestHash: expectedHash,
      responseStatus: 200,
      responseBody: { from: "OTHER_COMMAND" },
    },
  });
  const beforeScope = await countWrites();
  const scopeRes = await api("POST", `/api/decision-packets/${pktB.id}/decide`, {
    token: dmLogin.token,
    body: scopeBody,
    headers: { "idempotency-key": keyScope },
  });
  const afterScope = await countWrites();
  ok(scopeRes.status === 409, `3.3 同键不同命令 → 409（HTTP ${scopeRes.status}）`);
  ok(afterScope.decisions === beforeScope.decisions && afterScope.workItems === beforeScope.workItems, "3.3b 409 时零写入");

  // 3.4 并发批准：仅一方成功，无重复 Decision / WorkItem
  const pktC = await makeApprovablePacket();
  const submitC = await api("POST", `/api/decision-packets/${pktC.id}/submit`, { token: ownerLogin.token, body: {} });
  ok(submitC.status === 200, `3.4.0 并发用包提交成功（HTTP ${submitC.status}）`);
  const beforeC = await countWrites();
  const [c1, c2] = await Promise.all([
    api("POST", `/api/decision-packets/${pktC.id}/decide`, { token: dmLogin.token, body: { decision: "APPROVE", reason: "并发 A" } }),
    api("POST", `/api/decision-packets/${pktC.id}/decide`, { token: dmLogin.token, body: { decision: "APPROVE", reason: "并发 B" } }),
  ]);
  const statuses = [c1.status, c2.status].sort((a, b) => a - b);
  const successes = [c1.status, c2.status].filter((s) => s === 200).length;
  ok(successes === 1, `3.4.1 并发批准仅一方成功（状态 ${statuses.join("/")}，成功数 ${successes}）`);
  ok(statuses.includes(409), `3.4.2 另一方为 409（状态 ${statuses.join("/")}）`);
  const decisionsC = await prisma.decision.count({ where: { packetId: pktC.id } });
  const afterC = await countWrites();
  ok(decisionsC === 1, `3.4.3 无重复 Decision（实际 ${decisionsC}）`);
  ok(afterC.workItems - beforeC.workItems === 1, `3.4.4 无重复 WorkItem（新增 ${afterC.workItems - beforeC.workItems}）`);
  ok(afterC.stage === "SAMPLING", `3.4.5 G1 批准正确推进至 SAMPLING（实际 ${afterC.stage}）`);

  // ---------- 汇总 ----------
  console.log("\n" + "=".repeat(80));
  if (failures.length === 0) {
    console.log(`🏆 门禁边界 HTTP 验收全绿：${passed} 项断言全部通过`);
  } else {
    console.log(`❌ 门禁边界 HTTP 验收失败 ${failures.length} 项 / 通过 ${passed} 项：`);
    failures.forEach((f) => console.log(`   - ${f}`));
  }
  console.log("=".repeat(80) + "\n");

  // ---------- 清理：仅本套夹具 ----------
  const users = await prisma.user.findMany({ where: { organizationId: { in: [orgA.id, orgB.id] } }, select: { id: true } });
  const actorId = { in: users.map((u) => u.id) };
  await prisma.idempotencyRecord.deleteMany({ where: { actorId } });
  await prisma.auditEvent.deleteMany({ where: { actorId } });
  await prisma.decision.deleteMany({ where: { packet: { project: { organizationId: orgA.id } } } });
  await prisma.decisionPacket.deleteMany({ where: { project: { organizationId: orgA.id } } });
  await prisma.artifact.deleteMany({ where: { workItem: { project: { organizationId: orgA.id } } } });
  await prisma.workItem.deleteMany({ where: { project: { organizationId: orgA.id } } });
  await prisma.evidence.deleteMany({ where: { project: { organizationId: orgA.id } } });
  await prisma.projectMember.deleteMany({ where: { project: { organizationId: orgA.id } } });
  await prisma.project.deleteMany({ where: { organizationId: orgA.id } });
  await prisma.productVersion.deleteMany({ where: { product: { organizationId: orgA.id } } });
  await prisma.product.deleteMany({ where: { organizationId: orgA.id } });
  await prisma.user.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  console.log("🧹 已清理本套夹具");

  await prisma.$disconnect();
  if (failures.length > 0) process.exitCode = 1;
}

main().catch(async (e) => {
  console.error("❌ 门禁边界 HTTP 验收异常终止:", e?.message || e);
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
