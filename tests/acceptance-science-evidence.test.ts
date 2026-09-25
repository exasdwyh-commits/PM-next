/**
 * 科学证据引擎与顾问挑战验收（Evidence Intelligence / Challenge My Thesis）
 *
 * 目的：为「科学证据分级 → 证伪式挑战报告 → 对话内持久化」建立可回归的授权与行为证据。
 * 全部断言走**真实 HTTP 入口**（生产模式 next start），覆盖：
 *   1. 知识库同步：Obsidian 原料卡 frontmatter 入库并可按路径检索
 *   2. 挑战 API：证据分级、触发规则、营销红线识别
 *   3. 顾问对话：CHALLENGE_THESIS 意图识别 + 报告持久化到 Message.citations
 *   4. 组织隔离：跨组织用户读不到他组织的证据卡
 *
 * 前置（同 acceptance-product-center.test.ts）：
 *   NODE_ENV=production DEV_MOCK_AUTH=false DATABASE_URL=<测试库> npx next start -p 3110
 * 运行：
 *   BASE_URL=http://127.0.0.1:3110 ./node_modules/.bin/tsx scripts/run-test.ts tests/acceptance-science-evidence.test.ts
 *
 * 夹具自建、自清理，只清理本套创建的记录，不做无范围清库。
 */

import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { hashPassword } from "../src/modules/identity/session";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3110";
const RUN_TAG = `se${Date.now()}`;
const PASSWORD = `Se-Accept-${crypto.randomBytes(6).toString("hex")}!`;

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
  opts: { token?: string; body?: unknown } = {}
): Promise<{ status: number; json: any; setCookie: string | null }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
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
  const pair = res.setCookie?.split(";")[0];
  const token = pair && pair.includes("=") ? pair.slice(pair.indexOf("=") + 1) : undefined;
  if (token && pair) cookieJar.set(token, pair);
  return Object.assign(res, { token });
}

/** 合成原料卡：高证据等级（B）与低证据等级（D）各一张，含明确营销红线 */
function writeFixtureVault(dir: string) {
  fs.mkdirSync(path.join(dir, "30-science", "ingredients"), { recursive: true });

  fs.writeFileSync(
    path.join(dir, "30-science", "ingredients", "FIRM.md"),
    `---
ingredient: FIRM
claim: 支持肌肉健康
evidence_level: B
human_rct: 3
sample_size: 400
dose: 3 g/day
mechanism: mTOR
marketing_say: 辅助减少肌肉流失
marketing_never: 增肌神器
confidence: 70
last_reviewed: 2026-09-19
status: CONFIRMED
---

# FIRM（合成证据卡·证据充分）

## 机制
合成夹具，仅用于验收。
`,
    "utf8"
  );

  fs.writeFileSync(
    path.join(dir, "30-science", "ingredients", "WEAK.md"),
    `---
ingredient: WEAK
claim: 改善代谢
evidence_level: D
human_rct: 0
sample_size: 0
mechanism: 未明
marketing_say: 待定
marketing_never: 逆龄
confidence: 20
last_reviewed: 2026-09-19
status: DRAFT
---

# WEAK（合成证据卡·证据不足）

## 机制
合成夹具，仅用于验收。
`,
    "utf8"
  );
}

async function main() {
  await assertTestDatabaseSafety(prisma);

  console.log("=".repeat(80));
  console.log("🧪 科学证据引擎与顾问挑战验收（Evidence Intelligence / Challenge）");
  console.log(`    BASE_URL=${BASE}`);
  console.log("=".repeat(80) + "\n");

  // ---------- 夹具 ----------
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), `${RUN_TAG}-vault-`));
  writeFixtureVault(vaultDir);

  const orgA = await prisma.organization.create({
    data: { code: `${RUN_TAG}_A`, name: "科学证据验收机构 A（合成夹具）" },
  });
  const orgB = await prisma.organization.create({
    data: { code: `${RUN_TAG}_B`, name: "科学证据验收机构 B（合成夹具）" },
  });

  const mkUser = (email: string, name: string, organizationId: string) =>
    prisma.user.create({
      data: { email, name, organizationId, passwordHash: hashPassword(PASSWORD) },
    });

  const ownerA = await mkUser(`${RUN_TAG}-owner@hermes.test`, "科学证据负责人 A", orgA.id);
  const foreignB = await mkUser(`${RUN_TAG}-foreign@hermes.test`, "跨组织用户 B", orgB.id);

  // 知识源维护（含同步）是公司级能力：必须持有 OrganizationMember.role = ORG_ADMIN
  const ownerMembership = await prisma.organizationMember.create({
    data: { organizationId: orgA.id, userId: ownerA.id, role: "ORG_ADMIN" },
  });

  const product = await prisma.product.create({
    data: {
      organizationId: orgA.id,
      name: `${RUN_TAG} 合成功效产品`,
      identityCode: `${RUN_TAG}-ID`,
      targetAudience: "验收夹具人群",
      marketPath: "DOMESTIC",
      devMode: "SELF_DEVELOPED",
      ownerId: ownerA.id,
    },
  });
  const project = await prisma.project.create({
    data: {
      organizationId: orgA.id,
      productId: product.id,
      title: `${RUN_TAG} 合成验收项目`,
      target: "验收夹具目标",
      ownerId: ownerA.id,
      members: { create: [{ userId: ownerA.id, role: "OWNER" }] },
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      organizationId: orgA.id,
      ownerId: ownerA.id,
      kind: "PRODUCT",
      title: `${RUN_TAG} 挑战会话`,
      productId: product.id,
    },
  });

  const ownerLogin = await login(ownerA.email, PASSWORD);
  ok(ownerLogin.status === 200 && !!ownerLogin.token, `0.1 负责人登录成功（HTTP ${ownerLogin.status}）`);

  // ---------- 1. 知识库同步：Obsidian 原料卡入库 ----------
  console.log("▶ 场景 1：知识库同步与原料卡 frontmatter 入库");

  const source = await prisma.knowledgeSource.create({
    data: {
      organizationId: orgA.id,
      name: `${RUN_TAG} 合成 vault`,
      rootPath: vaultDir,
      kind: "OBSIDIAN_VAULT",
      createdById: ownerA.id,
    },
  });

  const syncRes = await api("POST", `/api/knowledge/sources/${source.id}/sync`, { token: ownerLogin.token });
  const synced = syncRes.json?.result;
  ok(syncRes.status === 200, `1.1 知识源同步成功（HTTP ${syncRes.status}）`);
  ok(synced?.created === 2, `1.2 同步创建 2 张原料卡（实际 ${synced?.created}）`);
  ok(synced?.failed === 0, `1.3 同步无失败（实际 ${synced?.failed}）`);

  const ingredientDocs = await prisma.knowledgeDocument.findMany({
    where: { sourceId: source.id, relativePath: { startsWith: "30-science/ingredients/" } },
    select: { relativePath: true, frontmatter: true },
  });
  ok(ingredientDocs.length === 2, `1.4 库内可取到 2 张原料卡（实际 ${ingredientDocs.length}）`);

  const firmFm = ingredientDocs.find((d) => d.relativePath.endsWith("FIRM.md"))?.frontmatter as any;
  ok(firmFm?.evidence_level === "B", `1.5 证据等级正确入库（实际 ${firmFm?.evidence_level}）`);
  ok(firmFm?.marketing_never === "增肌神器", `1.6 营销红线正确入库（实际 ${firmFm?.marketing_never}）`);

  // ---------- 2. 挑战 API：证据分级与触发规则 ----------
  console.log("▶ 场景 2：挑战报告的证据分级与触发规则");

  const ingredients = [
    {
      ingredient: "FIRM",
      claim: "支持肌肉健康",
      evidenceLevel: "B",
      humanRCTCount: 3,
      sampleSizeTotal: 400,
      doseRange: "3 g/day",
      mechanism: "mTOR",
      marketingSay: "辅助减少肌肉流失",
      marketingNever: "增肌神器",
      confidence: 70,
      lastReviewed: "2026-09-19",
      status: "CONFIRMED",
    },
    {
      ingredient: "WEAK",
      claim: "改善代谢",
      evidenceLevel: "D",
      humanRCTCount: 0,
      sampleSizeTotal: 0,
      mechanism: "未明",
      marketingSay: "待定",
      marketingNever: "逆龄",
      confidence: 20,
      lastReviewed: "2026-09-19",
      status: "DRAFT",
    },
  ];
// 2.1 高风险宣称：应判 CRITICAL / KILL
  const risky = await api("POST", "/api/advisor/challenge", {
    token: ownerLogin.token,
    body: {
      productName: `${RUN_TAG} 高危产品`,
      proposedClaim: "半年逆龄5岁",
      targetPrice: 2999,
      ingredients,
    },
  });
  ok(risky.status === 200, `2.1 挑战 API 可调用（HTTP ${risky.status}）`);
  ok(risky.json?.overallRisk === "CRITICAL", `2.2 高危宣称判为 CRITICAL（实际 ${risky.json?.overallRisk}）`);
  ok(risky.json?.recommendation === "KILL", `2.3 建议放弃（实际 ${risky.json?.recommendation}）`);
  ok(
    Array.isArray(risky.json?.topFailureReasons) && risky.json.topFailureReasons.length > 0,
    `2.4 输出失败原因（${risky.json?.topFailureReasons?.length} 条）`
  );
  ok(
    Array.isArray(risky.json?.vetoData) && risky.json.vetoData.length > 0,
    `2.5 输出一票否决数据（${risky.json?.vetoData?.length} 条）`
  );
  ok(
    typeof risky.json?.recommendedMVP === "string" && risky.json.recommendedMVP.length > 0,
    "2.6 输出建议 MVP"
  );

  // 2.7 保守宣称 + 证据充分：不应被判 KILL
  const benign = await api("POST", "/api/advisor/challenge", {
    token: ownerLogin.token,
    body: {
      productName: `${RUN_TAG} 稳健产品`,
      proposedClaim: "辅助减少肌肉流失",
      targetPrice: 199,
      ingredients: [ingredients[0]],
    },
  });
  ok(benign.status === 200, `2.7 稳健宣称挑战可调用（HTTP ${benign.status}）`);
  ok(benign.json?.recommendation !== "KILL", `2.8 证据充分不判 KILL（实际 ${benign.json?.recommendation}）`);
  ok(
    benign.json?.overallRisk !== "CRITICAL",
    `2.9 证据充分不判 CRITICAL（实际 ${benign.json?.overallRisk}）`
  );

  // 2.10 营销红线识别：宣称踩中 marketing_never
  const redline = await api("POST", "/api/advisor/challenge", {
    token: ownerLogin.token,
    body: {
      productName: `${RUN_TAG} 红线产品`,
      proposedClaim: "增肌神器",
      ingredients: [ingredients[0]],
    },
  });
  const redlineHit = (redline.json?.topFailureReasons || []).some((r: string) => r.includes("触碰营销红线"));
  ok(redlineHit, "2.10 宣称触碰营销红线时明确提示");

  const malformed = await api("POST", "/api/advisor/challenge", {
    token: ownerLogin.token,
    body: { productName: `${RUN_TAG} 非法载荷`, proposedClaim: "支持日常状态", ingredients: {} },
  });
  ok(malformed.status === 422, `2.10a 非数组 ingredients 返回 422（实际 ${malformed.status}）`);

  const noEvidence = await api("POST", "/api/advisor/challenge", {
    token: ownerLogin.token,
    body: { productName: `${RUN_TAG} 无证据产品`, proposedClaim: "支持日常状态", ingredients: [] },
  });
  ok(noEvidence.status === 200, `2.10b 无证据挑战仍返回报告（HTTP ${noEvidence.status}）`);
  ok(noEvidence.json?.recommendation === "PAUSE", `2.10c 无科学证据不得 PROCEED（实际 ${noEvidence.json?.recommendation}）`);

  // 2.11 D 级证据的缺口被如实记录（不补成事实）
  const gapHit =
    (risky.json?.scientificGaps || []).some((g: any) => g.ingredient === "WEAK" && g.field === "humanRCT");
  ok(gapHit, "2.11 D 级证据的人体 RCT 缺口被记录为未知");

  // ---------- 3. 顾问对话：意图识别与持久化 ----------
  console.log("▶ 场景 3：顾问对话内的挑战意图与报告持久化");

  const challengeMsg = await api("POST", `/api/conversations/${conversation.id}/messages`, {
    token: ownerLogin.token,
    body: { content: "挑战我的判断：这个产品假设哪里最脆弱？" },
  });
  ok(challengeMsg.status === 201, `3.1 挑战消息发送成功（HTTP ${challengeMsg.status}）`);

  const runs = await prisma.agentRun.findMany({
    where: { conversationId: conversation.id },
    include: { toolCalls: true },
  });
  const challengeToolCall = runs.flatMap((r) => r.toolCalls).find((tc) => tc.toolKey === "advisor.challenge");
  ok(!!challengeToolCall, "3.2 走了 advisor.challenge 白名单工具（非普通知识检索）");

  const messages = await prisma.message.findMany({
    where: { conversationId: conversation.id, role: "ASSISTANT" },
    orderBy: { createdAt: "desc" },
    take: 1,
  });
  const storedCitations = messages[0]?.citations as any[];
  const reportCitation = Array.isArray(storedCitations)
    ? storedCitations.find((c) => c.kind === "challenge-report")
    : null;
  ok(!!reportCitation, "3.3 挑战报告已持久化到 Message.citations");
  ok(
    !!reportCitation?.report?.overallRisk && !!reportCitation?.report?.recommendation,
    `3.4 持久化载荷含风险与建议（${reportCitation?.report?.overallRisk} / ${reportCitation?.report?.recommendation}）`
  );
  ok(reportCitation?.ref === product.id, `3.5 挑战报告 citation ref 使用真实 productId（${reportCitation?.ref}）`);
  ok(
    Array.isArray(reportCitation?.report?.topFailureReasons),
    "3.5 持久化载荷含失败原因数组"
  );

  // 3.6 报告如实说明证据范围（无匹配时明确告知，而非掩盖）
  const reportScope = reportCitation?.report?.evidenceScope;
  ok(
    !!reportScope && typeof reportScope.note === "string" && reportScope.note.length > 0,
    `3.6 报告如实说明证据范围（matched=${reportScope?.matched}）`
  );

  // ---------- 4. 组织隔离 ----------
  console.log("▶ 场景 4：跨组织隔离");

  const foreignLogin = await login(foreignB.email, PASSWORD);
  const foreignSources = await api("GET", "/api/knowledge/sources", { token: foreignLogin.token });
  // 非管理员读知识源列表被拒（403）；即便放行也绝不出现他组织来源。两种口径都算通过。
  const foreignSourceIds = (foreignSources.json?.sources || []).map((s: any) => s.id);
  ok(
    foreignSources.status === 403 || !foreignSourceIds.includes(source.id),
    `4.1 跨组织用户看不到他组织知识源（HTTP ${foreignSources.status}）`
  );

  const foreignDocs = await prisma.knowledgeDocument.findMany({
    where: { sourceId: source.id, organizationId: orgB.id },
  });
  ok(foreignDocs.length === 0, "4.2 B 组织名下无 A 组织证据卡");

  // ---------- 汇总 ----------
  console.log("\n" + "=".repeat(80));
  if (failures.length === 0) {
    console.log(` 科学证据引擎验收全绿：${passed} 项断言全部通过`);
  } else {
    console.log(`❌ 科学证据引擎验收失败 ${failures.length} 项 / 通过 ${passed} 项：`);
    failures.forEach((f) => console.log(`   - ${f}`));
  }
  console.log("=".repeat(80) + "\n");
  // ---------- 清理：仅本套夹具 ----------
  await prisma.knowledgeChunk.deleteMany({ where: { document: { sourceId: source.id } } });
  await prisma.knowledgeDocument.deleteMany({ where: { sourceId: source.id } });
  await prisma.knowledgeSyncRun.deleteMany({ where: { sourceId: source.id } });
  await prisma.knowledgeSource.deleteMany({ where: { id: source.id } });
  await prisma.toolCall.deleteMany({ where: { run: { conversationId: conversation.id } } });
  await prisma.message.deleteMany({ where: { conversationId: conversation.id } });
  await prisma.agentRun.deleteMany({ where: { conversationId: conversation.id } });
  await prisma.conversation.deleteMany({ where: { id: conversation.id } });
  await prisma.projectMember.deleteMany({ where: { projectId: project.id } });
  await prisma.project.deleteMany({ where: { id: project.id } });
  await prisma.product.deleteMany({ where: { id: product.id } });
  await prisma.organizationMember.deleteMany({ where: { id: ownerMembership.id } });
  // 夹具清理顺序：AuditEvent.actorId 是 User 的必填外键（AuditEvent_actorId_fkey），
  // 必须先清本套夹具产生的审计留痕，否则删用户时 FK 违约，整套会红在清理步骤上。
  await prisma.auditEvent.deleteMany({
    where: { actorId: { in: [ownerA.id, foreignB.id] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [ownerA.id, foreignB.id] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  console.log("🧹 已清理本套夹具（组织 / 用户 / 产品 / 项目 / 会话 / 知识源 / 临时 vault）");

  await prisma.$disconnect();
  if (failures.length > 0) process.exitCode = 1;
}

main().catch(async (e) => {
  console.error("❌ 科学证据引擎验收异常终止:", e?.message || e);
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
