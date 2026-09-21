/**
 * 调用方错误 → 5xx 收口第二批 · 真实 HTTP 验收（D-015 / D-016 / D-017）
 *
 * 与既有服务级回归的区别：全部断言通过真实 HTTP 入口发起（生产模式 next start），
 * 不使用服务函数直调替代接口验收。
 *
 * 前置：
 *   NODE_ENV=production DEV_MOCK_AUTH=false DATABASE_URL=<测试库> npx next start -p 3110
 * 运行：
 *   bash scripts/acc-server.sh tests/acceptance-http-errors.ts
 *   （或 BASE_URL=http://127.0.0.1:3110 npm run test:http-errors）
 *
 * 本套覆盖「同一主题的三个尾巴」——都是「调用者发错了」被当成「服务端崩了」：
 *   D-015  Prisma **已知请求错误**全类未映射 → P2002/P2003/P2014 应为 409、P2025 应为 404
 *   D-016  `req.json().catch(() => ({}))` 把**畸形 JSON 静默当空 body**（其中证据核实是 fail-open）
 *   D-017  缺必填字段 → 原生 TypeError → 500（D-008 尾巴）
 *
 * 非破坏性：本套自建夹具（组织/用户/产品/项目/证据），只清理本套夹具。
 */

import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { hashPassword } from "../src/modules/identity/session";
import crypto from "crypto";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3110";
const RUN_TAG = `httperr${Date.now()}`;
const PASSWORD = `HttpErr-${crypto.randomBytes(6).toString("hex")}!`;

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

interface ApiResult {
  status: number;
  json: any;
  text: string;
  setCookie: string | null;
}

/** 标准 JSON 调用：body 会被 JSON.stringify（与 b01-http 的 api() 同源） */
async function api(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<ApiResult> {
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
  return { status: res.status, json, text, setCookie: res.headers.get("set-cookie") };
}

/**
 * 与 api() 同源的**裸体发送**变体：rawBody 原样发出，不做 JSON.stringify。
 *
 * 为什么存在：D-016 探针要构造**畸形 JSON 字节流**（如单个 `{`）与**非对象 JSON**
 * （`null` / `[]`），而 api() 会把入参序列化 —— 传字符串 `"{"` 会被包成合法 JSON
 * 字面量 `"{"`，根本触发不了引擎的解析失败。此函数复用同一套 Cookie/鉴权头与 BASE，
 * 只替换 body 的编码方式，不引入第二套 HTTP 客户端。
 */
async function apiRaw(
  method: string,
  path: string,
  opts: { token?: string; rawBody?: string; headers?: Record<string, string> } = {}
): Promise<ApiResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
    const jar = cookieJar.get(opts.token);
    if (jar) headers.Cookie = jar;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.rawBody,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json, text, setCookie: res.headers.get("set-cookie") };
}

async function login(email: string, password: string) {
  const res = await api("POST", "/api/auth/session", { body: { email, password } });
  const pair = res.setCookie?.split(";")[0];
  const token = pair && pair.includes("=") ? pair.slice(pair.indexOf("=") + 1) : undefined;
  if (token && pair) cookieJar.set(token, pair);
  return Object.assign(res, { token });
}

async function main() {
  await assertTestDatabaseSafety(prisma);

  console.log("=".repeat(80));
  console.log("🧪 调用方错误 → 5xx 收口第二批 · 真实 HTTP 验收（D-015 / D-016 / D-017）");
  console.log(`    BASE_URL=${BASE}`);
  console.log("=".repeat(80) + "\n");

  // ---------- 夹具：组织 + 负责人（密码登录） ----------
  const org = await prisma.organization.create({
    data: { code: `${RUN_TAG}_ORG`, name: "调用方错误验收机构（合成夹具）" },
  });
  const owner = await prisma.user.create({
    data: {
      email: `${RUN_TAG}-owner@hermes.test`,
      name: "调用方错误验收负责人",
      organizationId: org.id,
      passwordHash: hashPassword(PASSWORD),
    },
  });

  const ownerLogin = await login(owner.email, PASSWORD);
  ok(ownerLogin.status === 200 && !!ownerLogin.token, `0.1 负责人密码登录成功（HTTP ${ownerLogin.status}）`);
  const TOKEN = ownerLogin.token as string;

  const created = { productIds: [] as string[], evidenceIds: [] as string[] };

  // ==========================================================================
  // 甲、D-015：Prisma 已知请求错误 → 409 / 404（此前一律 500）
  // ==========================================================================
  console.log("\n▶ 甲、D-015：唯一约束冲突不得冒成 5xx");

  const idA = `${RUN_TAG}-PROD-A`;
  const productABody = {
    name: `${RUN_TAG} 产品A`,
    identityCode: idA,
    targetAudience: "验收人群",
    marketPath: "DOMESTIC",
    devMode: "SELF_DEVELOPED",
  };

  // 甲1：建产品 A（正常路径，201）
  const prodA = await api("POST", "/api/products", { token: TOKEN, body: productABody });
  ok(prodA.status === 201, `甲1 建产品 A（HTTP ${prodA.status}，期望 201）`);
  if (prodA.json?.id) created.productIds.push(prodA.json.id);

  // 甲2：【核心】同一 identityCode 再发一次 → 409（修复前 500）
  const dup1 = await api("POST", "/api/products", { token: TOKEN, body: productABody });
  ok(dup1.status === 409, `甲2 【核心】重复 identityCode → HTTP ${dup1.status}（期望 409；修复前 500）`);
  ok(dup1.json?.code === "CONFLICT", `甲2b 冲突响应 code === "CONFLICT"（实测 ${JSON.stringify(dup1.json?.code)}）`);

  // 甲3：再发一次 → 仍 409（排除偶发）
  const dup2 = await api("POST", "/api/products", { token: TOKEN, body: productABody });
  ok(dup2.status === 409, `甲3 再发一次仍 → HTTP ${dup2.status}（期望 409，排除偶发）`);

  // 甲4：换新 identityCode → 201（证明没误伤正常路径）
  const fresh = await api("POST", "/api/products", {
    token: TOKEN,
    body: { ...productABody, identityCode: `${RUN_TAG}-PROD-A2` },
  });
  ok(fresh.status === 201, `甲4 换新 identityCode → HTTP ${fresh.status}（期望 201，证明正常路径未受影响）`);
  if (fresh.json?.id) created.productIds.push(fresh.json.id);

  // 甲5：产品 B 走「入库」以带上初始版本 v1（并自建项目，使 owner 具备产品写权限）
  const ingest = await api("POST", "/api/products/ingest", {
    token: TOKEN,
    body: {
      name: `${RUN_TAG} 产品B`,
      coreIdea: "验收夹具：用于触发产品版本唯一键冲突",
      targetAudience: "验收人群",
      coreSellingPoints: "验收卖点",
      targetChannels: "抖音",
    },
  });
  ok(ingest.status === 201, `甲5 产品 B 入库成功（HTTP ${ingest.status}，期望 201）`);
  const productBId = ingest.json?.productId as string;
  const projectBId = ingest.json?.projectId as string;
  if (productBId) created.productIds.push(productBId);

  // 甲5b：【核心】对同一产品重复用 versionTag "v1"（v1 已由入库创建）→ 409（修复前 500）
  const dupVersion = await api("POST", `/api/products/${productBId}/versions`, {
    token: TOKEN,
    body: { versionTag: "v1", specs: {} },
  });
  ok(
    dupVersion.status === 409,
    `甲5b 【核心】重复 versionTag v1 → HTTP ${dupVersion.status}（期望 409；修复前 500）`
  );

  // 甲6：换 v9 → 201（正常路径不受影响）
  const newVersion = await api("POST", `/api/products/${productBId}/versions`, {
    token: TOKEN,
    body: { versionTag: "v9", specs: {} },
  });
  ok(newVersion.status === 201, `甲6 换新 versionTag v9 → HTTP ${newVersion.status}（期望 201）`);

  // 甲7：409 响应体不得下发内部细节（生产环境消毒）
  const leakProbe = `${dup1.text} ${dupVersion.text}`;
  console.log(`     甲7 实测 409 响应体片段：${dup1.text.slice(0, 160)}`);
  ok(!/prisma:error/i.test(leakProbe), "甲7a 409 响应体不含 prisma:error");
  ok(!/P2002/.test(leakProbe), "甲7b 409 响应体不含 Prisma code P2002");
  ok(!/schema\.prisma|\/Users\//.test(leakProbe), "甲7c 409 响应体不含服务器绝对路径/内部文件线索");

  // ==========================================================================
  // 乙、D-016：畸形 JSON 不得把「驳回」静默翻成「通过」（fail-open 反向回归）
  // ==========================================================================
  console.log("\n▶ 乙、D-016：证据核实的畸形 body 不得静默降级（fail-open 反向回归）");

  // 乙8：录入证据夹具（默认 verifyStatus = UNVERIFIED）
  const evCreate = await api("POST", `/api/projects/${projectBId}/evidences`, {
    token: TOKEN,
    body: {
      contentOrUri: "验收夹具：竞品价格证据（合成）",
      source: "HTTP_ERRORS_FIXTURE",
      nature: "DEMO",
    },
  });
  ok(evCreate.status === 201, `乙8 录入证据成功（HTTP ${evCreate.status}，期望 201）`);
  const evidenceId = evCreate.json?.id as string;
  if (evidenceId) created.evidenceIds.push(evidenceId);

  // 明确置为 UNVERIFIED（EvidenceVerifyStatus 只有 UNVERIFIED/VERIFIED/REJECTED，无 PENDING）
  await prisma.evidence.update({ where: { id: evidenceId }, data: { verifyStatus: "UNVERIFIED" } });

  const auditBefore = await prisma.auditEvent.count({
    where: { action: "EVIDENCE_VERIFIED", objectId: evidenceId },
  });

  // 乙9：【核心】畸形 JSON "{" → 400（修复前 200：被静默当空 body → 通过）
  const malformed = await apiRaw("POST", `/api/evidences/${evidenceId}/verify`, { token: TOKEN, rawBody: "{" });
  ok(malformed.status === 400, `乙9 【核心】证据核实发畸形 JSON → HTTP ${malformed.status}（期望 400；修复前 200）`);

  // 乙10：【核心】回读断言未被改成 VERIFIED（「驳回意图」没有被反转成「通过」）
  const afterMalformed = await prisma.evidence.findUnique({
    where: { id: evidenceId },
    select: { verifyStatus: true },
  });
  ok(
    afterMalformed?.verifyStatus === "UNVERIFIED",
    `乙10 【核心】畸形 body 未改动证据状态（实测 ${afterMalformed?.verifyStatus}，期望 UNVERIFIED）`
  );

  // 乙11：不得新增 AuditEvent(action: EVIDENCE_VERIFIED)
  const auditAfterMalformed = await prisma.auditEvent.count({
    where: { action: "EVIDENCE_VERIFIED", objectId: evidenceId },
  });
  ok(
    auditAfterMalformed - auditBefore === 0,
    `乙11 畸形 body 未新增 EVIDENCE_VERIFIED 审计事件（${auditBefore} → ${auditAfterMalformed}）`
  );

  // 乙12：合法 {"status":"REJECTED"} → 200 且回读 REJECTED（合法路径仍工作）
  const rejected = await api("POST", `/api/evidences/${evidenceId}/verify`, {
    token: TOKEN,
    body: { status: "REJECTED" },
  });
  ok(
    rejected.status === 200 && rejected.json?.verifyStatus === "REJECTED",
    `乙12 合法 {status:"REJECTED"} → HTTP ${rejected.status} / ${rejected.json?.verifyStatus}（期望 200 / REJECTED）`
  );
  // 恢复为 UNVERIFIED，使第 9/10 条可重复
  await prisma.evidence.update({ where: { id: evidenceId }, data: { verifyStatus: "UNVERIFIED" } });

  // 乙13：非对象 JSON（null / []）→ 422（修复前 null 触发 TypeError → 500）
  const nullBody = await apiRaw("POST", `/api/evidences/${evidenceId}/verify`, { token: TOKEN, rawBody: "null" });
  ok(nullBody.status === 422, `乙13a body 字面量 null → HTTP ${nullBody.status}（期望 422；修复前 500）`);
  const arrBody = await apiRaw("POST", `/api/evidences/${evidenceId}/verify`, { token: TOKEN, rawBody: "[]" });
  ok(arrBody.status === 422, `乙13b body 字面量 [] → HTTP ${arrBody.status}（期望 422）`);

  // 乙14：「不带 body」是合法调用 → 200（证明 D-016 修复没误伤无 body 用法）
  const noBody = await apiRaw("POST", `/api/evidences/${evidenceId}/verify`, { token: TOKEN, rawBody: undefined });
  ok(noBody.status === 200, `乙14 不带 body 的合法调用 → HTTP ${noBody.status}（期望 200，证明无 body 未被误伤）`);

  // ==========================================================================
  // 丙、D-017：缺必填字段 → 422（不得冒成原生 TypeError → 500）
  // ==========================================================================
  console.log("\n▶ 丙、D-017：缺必填字段不得冒成 5xx");

  const missingFields = await api("POST", "/api/products", {
    token: TOKEN,
    body: { name: `${RUN_TAG} 缺字段产品`, identityCode: `${RUN_TAG}-MISSING` },
  });
  ok(
    missingFields.status === 422,
    `丙15 【核心】缺 targetAudience/marketPath/devMode → HTTP ${missingFields.status}（期望 422；修复前 500）`
  );
  ok(
    JSON.stringify(missingFields.json ?? {}).includes("targetAudience"),
    `丙15b 错误体点名缺失字段 targetAudience（实测：${missingFields.text.slice(0, 160)}）`
  );

  // ==========================================================================
  // 丁、D-018：决策包缺范围字段不得冒成 5xx
  // ==========================================================================
  console.log("\n▶ 丁、D-018：决策包范围字段缺失/错类型不得冒成 5xx");

  const packetUrl = `/api/projects/${projectBId}/decision-packets`;

  // 丁1：【核心】body {} → 422（修复前 500：computeScopeHash 对 undefined 展开）
  const d018Empty = await api("POST", packetUrl, { token: TOKEN, body: {} });
  ok(d018Empty.status === 422, `丁1 【核心】决策包 body {} → HTTP ${d018Empty.status}（期望 422；修复前 500）`);
  // 丁2：错误体点名两个缺失字段
  const d018Text = JSON.stringify(d018Empty.json ?? {});
  ok(
    d018Text.includes("artifactVersions") && d018Text.includes("evidenceVersions"),
    `丁2 错误体点名 artifactVersions 与 evidenceVersions（实测：${d018Empty.text.slice(0, 180)}）`
  );
  // 丁3：只给 artifactVersions（缺 evidenceVersions）→ 422 且点名 evidenceVersions
  const d018Partial = await api("POST", packetUrl, { token: TOKEN, body: { artifactVersions: [] } });
  ok(d018Partial.status === 422, `丁3 只给 artifactVersions → HTTP ${d018Partial.status}（期望 422）`);
  ok(
    JSON.stringify(d018Partial.json ?? {}).includes("evidenceVersions"),
    `丁3b 错误体点名 evidenceVersions（实测：${d018Partial.text.slice(0, 180)}）`
  );
  // 丁5：错类型（有值但不是数组）→ 422（证明用 Array.isArray 而非真值判断）
  const d018WrongType = await api("POST", packetUrl, {
    token: TOKEN,
    body: { artifactVersions: "not-an-array", evidenceVersions: [] },
  });
  ok(
    d018WrongType.status === 422,
    `丁5 artifactVersions 传字符串 → HTTP ${d018WrongType.status}（期望 422，证 Array.isArray）`
  );
  // 丁4：【反例，防过度收紧】完整合法 body → 201
  // 实测最小集：artifactVersions[]、evidenceVersions[]、validationPlan 为必填；
  // budgetAmount/budgetScope/requiredChecks 非必需，但补上以贴近真实打样门草稿（gate 默认 RESEARCH_SAMPLING_GATE）。
  const d018Valid = await api("POST", packetUrl, {
    token: TOKEN,
    body: {
      artifactVersions: [],
      evidenceVersions: [],
      budgetAmount: 1000,
      budgetScope: "打样",
      validationPlan: "第三方检测与感官盲测",
      requiredChecks: {},
    },
  });
  ok(
    d018Valid.status === 201,
    `丁4 【反例】完整合法 body → HTTP ${d018Valid.status}（期望 201，证明正常路径未被误伤）`
  );

  // ==========================================================================
  // 戊、D-001 特征化断言（诚实锁住已知取舍，**不是**「正确行为」的锁）
  // ==========================================================================
  console.log("\n▶ 戊、D-001 特征化：跨组织复用 identityCode 的 409 只泄露「该码被占」");

  const foreignOrg = await prisma.organization.create({
    data: { code: `${RUN_TAG}_FOREIGN`, name: "调用方错误验收·跨组织对照机构（合成夹具）" },
  });
  const foreignUser = await prisma.user.create({
    data: {
      email: `${RUN_TAG}-foreign@hermes.test`,
      name: "跨组织对照用户",
      organizationId: foreignOrg.id,
      passwordHash: hashPassword(PASSWORD),
    },
  });
  const foreignLogin = await login(foreignUser.email, PASSWORD);
  ok(foreignLogin.status === 200 && !!foreignLogin.token, `戊0 跨组织用户登录成功（HTTP ${foreignLogin.status}）`);
  const FOREIGN = foreignLogin.token as string;

  const productAId = prodA.json?.id as string;
  const crossBody = {
    name: "跨组织复用码产品",
    identityCode: idA, // 组织 A 已占用的码
    targetAudience: "人群",
    marketPath: "DOMESTIC",
    devMode: "SELF_DEVELOPED",
  };
  const crossOrg = await api("POST", "/api/products", { token: FOREIGN, body: crossBody });
  ok(
    crossOrg.status === 201,
    `戊1 【D-001 修复】跨组织复用组织 A 的 identityCode → HTTP ${crossOrg.status}（期望 201：唯一性已收敛到组织内）`
  );
  const crossProductId = crossOrg.json?.id as string;
  if (crossProductId) created.productIds.push(crossProductId);

  const crossText = crossOrg.text;
  ok(
    !crossText.includes(org.id) && !crossText.includes(org.name) && !crossText.includes(productAId),
    `戊2 【D-001 修复】201 响应不含组织 A 的标识与产品 id（不泄露「谁占了这个码」）（响应片段：${crossText.slice(0, 180)}）`
  );

  // 戊3：**同一组织内**复用同码仍必须 409 —— 证明约束只是收敛到组织范围，并未被取消
  const crossDup = await api("POST", "/api/products", { token: FOREIGN, body: crossBody });
  ok(
    crossDup.status === 409,
    `戊3 【D-001 修复】同一组织内重复 identityCode → HTTP ${crossDup.status}（期望 409，约束仍在组织内生效）`
  );

  // 戊4：DB 级证据 —— 两个组织各持一条同码产品，分属不同组织
  const sharedRows = await prisma.product.findMany({
    where: { identityCode: idA },
    select: { id: true, organizationId: true },
  });
  const sharedOrgs = new Set(sharedRows.map((r) => r.organizationId));
  ok(
    sharedRows.length === 2 && sharedOrgs.size === 2,
    `戊4 【D-001 修复】同码产品在两个组织各存一条（实际 ${sharedRows.length} 条 / ${sharedOrgs.size} 个组织，期望 2 / 2）`
  );
  ok(
    !!crossProductId && !sharedRows.some((r) => r.organizationId === org.id && r.id === crossProductId),
    "戊5 两条记录 id 不同：跨组织的同码产品未覆盖组织 A 的原产品"
  );

  console.log(
    "   戊段说明（D-001 修复后行为，非特征化）：Product.identityCode 唯一性已由「全局唯一」收敛为" +
      " `@@unique([organizationId, identityCode])`（TASK-008 + 迁移 20260920235500）。" +
      "同组织同码 → 409（甲2 / 戊3）；跨组织同码 → 201（戊1）；响应不含「被谁占」的信息（戊2）。"
  );

  // ==========================================================================
  // 己、非破坏性自证 + 清理
  // ==========================================================================
  console.log("\n▶ 己、清理本套自建夹具");
  const cleanup = async () => {
    let removed: Record<string, number> = {};
    removed.auditEvent = (
      await prisma.auditEvent.deleteMany({
        where: {
          OR: [
            { objectId: { in: [...created.productIds, ...created.evidenceIds] } },
            { actorId: owner.id },
            // 戊段跨组织夹具（D-001 修复后跨组织建产品会成功 → 留下该用户的审计行）
            { actorId: foreignUser.id },
          ],
        },
      })
    ).count;
    removed.evidence = (
      await prisma.evidence.deleteMany({ where: { project: { organizationId: org.id } } })
    ).count;
    removed.projectMember = (
      await prisma.projectMember.deleteMany({ where: { project: { organizationId: org.id } } })
    ).count;
    removed.project = (await prisma.project.deleteMany({ where: { organizationId: org.id } })).count;
    removed.productVersion = (
      await prisma.productVersion.deleteMany({ where: { product: { organizationId: org.id } } })
    ).count;
    removed.product = (await prisma.product.deleteMany({ where: { organizationId: org.id } })).count;
    removed.session = (await prisma.session.deleteMany({ where: { user: { organizationId: org.id } } })).count;
    removed.user = (await prisma.user.deleteMany({ where: { organizationId: org.id } })).count;
    removed.organization = (await prisma.organization.deleteMany({ where: { id: org.id } })).count;
    // 跨组织对照夹具（戊段自建）
    removed.session += (
      await prisma.session.deleteMany({ where: { user: { organizationId: foreignOrg.id } } })
    ).count;
    removed.user += (await prisma.user.deleteMany({ where: { organizationId: foreignOrg.id } })).count;
    removed.organization += (await prisma.organization.deleteMany({ where: { id: foreignOrg.id } })).count;
    removed = Object.fromEntries(Object.entries(removed).filter(([, n]) => n > 0));
    console.log(`   清理结果（仅 RUN_TAG=${RUN_TAG} 前缀）：${JSON.stringify(removed)}`);
  };

  console.log("\n" + "=".repeat(80));
  if (failures.length === 0) {
    console.log(`🏆 调用方错误 HTTP 验收全绿：${passed} 项断言全部通过`);
  } else {
    console.log(`❌ 调用方错误 HTTP 验收失败：${failures.length} 项未通过（通过 ${passed} 项）`);
    failures.forEach((f) => console.log(`   - ${f}`));
    process.exitCode = 1;
  }
  console.log("=".repeat(80) + "\n");

  await cleanup().catch((e) => console.error("清理失败:", e));
}

main()
  .catch((error) => {
    console.error("\n❌ 调用方错误 HTTP 验收异常终止:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
