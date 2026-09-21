/**
 * 产品中心验收 · 安全与版本案例（PC-0 / TASK-004）
 *
 * 目的：为「模型将接触的读取与写入路径」建立可回归的授权证据。
 * 覆盖对象是产品级门禁 `requireProductRole`（Phase 3A · B4）与产品版本的不可变/版本指纹语义。
 *
 * 与既有服务级回归的区别：本套全部断言走**真实 HTTP 入口**（生产模式 next start），
 * 不使用服务函数直调替代接口验收 —— 权限收口不能只靠隐藏按钮。
 *
 * 前置（与 acceptance-b01-http.ts 相同的独立测试环境）：
 *   NODE_ENV=production DEV_MOCK_AUTH=false DATABASE_URL=<测试库> npx next start -p 3110
 * 运行：
 *   BASE_URL=http://127.0.0.1:3110 ./node_modules/.bin/tsx scripts/run-test.ts tests/acceptance-product-center.test.ts
 *
 * 夹具自建、自清理，且只清理本套创建的记录，不做无范围清库。
 * 本套不写入任何真实业务数据；全部为带 RUN_TAG 的合成夹具。
 */

import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { hashPassword } from "../src/modules/identity/session";
import crypto from "crypto";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3110";
const RUN_TAG = `pc${Date.now()}`;
const PASSWORD = `Pc-Accept-${crypto.randomBytes(6).toString("hex")}!`;

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
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers || {}),
  };
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

/**
 * 登录并取出会话令牌。
 *
 * 注：Phase 3A · B6 之后登录响应体**不再**回传 token（只走 httpOnly Cookie）。
 * 本套作为非浏览器客户端，从 Set-Cookie 中取出真实令牌，既作 Cookie 罐的键，也作 Bearer。
 */
async function login(email: string, password: string) {
  const res = await api("POST", "/api/auth/session", { body: { email, password } });
  const pair = res.setCookie?.split(";")[0];
  const token = pair && pair.includes("=") ? pair.slice(pair.indexOf("=") + 1) : undefined;
  if (token && pair) cookieJar.set(token, pair);
  return Object.assign(res, { token });
}

async function main() {
  await assertTestDatabaseSafety(prisma);

  console.log("================================================================================");
  console.log("🧪 产品中心验收 · 安全与版本案例（PC-0 / TASK-004）");
  console.log(`    BASE_URL=${BASE}`);
  console.log("================================================================================\n");

  // ---------- 夹具：两个组织 + 四种身份 ----------
  const orgA = await prisma.organization.create({
    data: { code: `${RUN_TAG}_A`, name: "产品中心验收机构 A（合成夹具）" },
  });
  const orgB = await prisma.organization.create({
    data: { code: `${RUN_TAG}_B`, name: "产品中心验收机构 B（合成夹具）" },
  });

  const mkUser = (email: string, name: string, organizationId: string) =>
    prisma.user.create({
      data: { email, name, organizationId, passwordHash: hashPassword(PASSWORD) },
    });

  const ownerA = await mkUser(`${RUN_TAG}-owner@hermes.test`, "产品负责人 A", orgA.id);
  const viewerA = await mkUser(`${RUN_TAG}-viewer@hermes.test`, "只读成员 A", orgA.id);
  const outsiderA = await mkUser(`${RUN_TAG}-outsider@hermes.test`, "组织内非成员 A", orgA.id);
  const foreignB = await mkUser(`${RUN_TAG}-foreign@hermes.test`, "跨组织用户 B", orgB.id);

  // 产品 + 关联项目；ownerA 为 OWNER，viewerA 为 VIEWER，outsiderA 无成员关系
  const product = await prisma.product.create({
    data: {
      organizationId: orgA.id,
      name: `${RUN_TAG} 合成验收产品`,
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
      members: {
        create: [
          { userId: ownerA.id, role: "OWNER" },
          { userId: viewerA.id, role: "VIEWER" },
        ],
      },
    },
  });

  // TASK-009b 夹具：一个独立的项目（revision=1），供「结构化成果接线」场景使用。
  // 与上面验收项目共用同一组织/同一负责人，避免影响既有场景的断言与计数。
  const saProject = await prisma.project.create({
    data: {
      organizationId: orgA.id,
      title: `${RUN_TAG} 结构化成果项目`,
      target: "结构化成果接线验收",
      ownerId: ownerA.id,
      members: { create: [{ userId: ownerA.id, role: "OWNER" }] },
    },
  });
  const saWorkItem = await prisma.workItem.create({
    data: {
      projectId: saProject.id,
      title: `${RUN_TAG} 结构化成果工作项`,
      target: "结构化成果接线验收",
      deliverableReq: "结构化成果接线验收",
      inputRevision: 1,
      status: "TODO",
    },
  });
  const projectlessProduct = await prisma.product.create({
    data: {
      organizationId: orgA.id,
      name: `${RUN_TAG} 无项目遗留产品`,
      identityCode: `${RUN_TAG}-ORPHAN`,
      targetAudience: "验收夹具人群",
      marketPath: "DOMESTIC",
      devMode: "SELF_DEVELOPED",
    },
  });

  const versionBody = { versionTag: "v1", specs: { netWeight: "30 条/盒" } };

  // ---------- 1. 产品写路径：角色与组织边界 ----------
  console.log("▶ 场景 1：产品版本发布（写路径）的角色与组织边界");

  const ownerLogin = await login(ownerA.email, PASSWORD);
  ok(ownerLogin.status === 200 && !!ownerLogin.token, `1.0 负责人登录成功（HTTP ${ownerLogin.status}）`);

  const ownerPublish = await api("POST", `/api/products/${product.id}/versions`, {
    token: ownerLogin.token,
    body: versionBody,
  });
  ok(ownerPublish.status === 201, `1.1 产品 OWNER 发布版本成功（HTTP ${ownerPublish.status}）`);

  const viewerLogin = await login(viewerA.email, PASSWORD);
  const viewerPublish = await api("POST", `/api/products/${product.id}/versions`, {
    token: viewerLogin.token,
    body: { versionTag: "v-viewer", specs: {} },
  });
  ok(viewerPublish.status === 403, `1.2 VIEWER 发布版本被拒（HTTP ${viewerPublish.status}）`);

  const outsiderLogin = await login(outsiderA.email, PASSWORD);
  const outsiderPublish = await api("POST", `/api/products/${product.id}/versions`, {
    token: outsiderLogin.token,
    body: { versionTag: "v-outsider", specs: {} },
  });
  ok(outsiderPublish.status === 403, `1.3 组织内非成员发布版本被拒（HTTP ${outsiderPublish.status}）`);

  const foreignLogin = await login(foreignB.email, PASSWORD);
  const foreignPublish = await api("POST", `/api/products/${product.id}/versions`, {
    token: foreignLogin.token,
    body: { versionTag: "v-foreign", specs: {} },
  });
  ok(foreignPublish.status === 404, `1.4 跨组织发布版本被拒且不泄露存在性（HTTP ${foreignPublish.status}）`);

  const anonPublish = await api("POST", `/api/products/${product.id}/versions`, {
    body: versionBody,
  });
  ok(anonPublish.status === 401, `1.5 无凭证发布版本被拒（HTTP ${anonPublish.status}）`);

  const missingPublish = await api("POST", `/api/products/${crypto.randomUUID()}/versions`, {
    token: ownerLogin.token,
    body: versionBody,
  });
  ok(missingPublish.status === 404, `1.6 不存在的产品与跨组织同码（HTTP ${missingPublish.status}）`);

  // ---------- 2. 读路径与遗留产品 ----------
  console.log("\n▶ 场景 2：读路径与未绑定项目产品的当前语义");

  const viewerRead = await api("GET", `/api/products/${product.id}/revisions`, {
    token: viewerLogin.token,
  });
  ok(viewerRead.status === 200, `2.1 VIEWER 可读产品修订（读路径放行，HTTP ${viewerRead.status}）`);

  const outsiderRead = await api("GET", `/api/products/${product.id}/revisions`, {
    token: outsiderLogin.token,
  });
  // 政策变更，不是测试放宽（2026-09-16 用户拍板）：
  //   此前读路径要求「必须是该产品关联项目的成员」→ 403；
  //   现在 Hermes 定位为**内部产品中心**（非客户隔离型 SaaS），组织内成员可读本组织产品 → 200。
  //   写路径不变，仍按项目角色（见 1.x 与 3.x）。
  ok(
    outsiderRead.status === 200,
    `2.2 组织内成员可读本组织产品（读=组织内可读口径，HTTP ${outsiderRead.status}，期望 200）`
  );

  // 遗留产品（projectCount=0）：写路径退回「组织管理员」口径。
  // outsider 无 OrganizationMember 记录 → 不是组织管理员 → 必须被拒。
  // 注意这里同时验证了新语义：**建项目成为 OWNER 也不再是组织管理员**。
  const legacyPublish = await api("POST", `/api/products/${projectlessProduct.id}/versions`, {
    token: outsiderLogin.token,
    body: { versionTag: "v-legacy", specs: {} },
  });
  ok(
    legacyPublish.status === 403,
    `2.3 无项目遗留产品：无组织成员角色的成员被拒（HTTP ${legacyPublish.status}，期望 403）`
  );

  // ---------- 3. 版本不可变与版本指纹 ----------
  console.log("\n▶ 场景 3：产品版本的不可变与版本指纹");

  const versionId = ownerPublish.json?.id as string | undefined;
  ok(!!versionId, "3.1 发布的版本返回了 id");

  if (versionId) {
    const persisted = await prisma.productVersion.findUnique({ where: { id: versionId } });
    ok(persisted?.isImmutable === true, "3.2 产品版本落库即标记不可变（isImmutable）");
    ok(
      persisted?.isConfirmed === false,
      "3.3 发布不等于业务确认（isConfirmed 默认 false，批准与执行分离）"
    );
  }

  // 版本指纹随字段变化：同名版本标签但不同规格应可区分
  const v2 = await api("POST", `/api/products/${product.id}/versions`, {
    token: ownerLogin.token,
    body: { versionTag: "v2", specs: { netWeight: "60 条/盒" } },
  });
  ok(v2.status === 201, `3.4 不同规格可发布为新版本（HTTP ${v2.status}）`);

  // 项目当前绑定的产品版本；改动后旧引用应被 revision 一致性回归覆盖（见 test:revision）

  // ---------- 4. 项目详情下发字段白名单（B6 收尾） ----------
  console.log("\n▶ 场景 4：项目详情下发字段白名单与两套查询形状一致性");

  // 夹具：故意建立**真实存在**的关联行，否则下面的"未泄漏"断言会空跑。
  const workItem = await prisma.workItem.create({
    data: {
      projectId: project.id,
      title: `${RUN_TAG} 合成工作项`,
      target: "验收夹具交付目标",
      deliverableReq: "验收夹具交付要求",
      dependencies: [{ taskId: "fixture-dep" }],
    },
  });
  const artifact = await prisma.artifact.create({
    data: {
      workItemId: workItem.id,
      type: "RESEARCH_REPORT",
      title: `${RUN_TAG} 合成成果`,
      content: "验收夹具成果正文",
      producerType: "MANUAL",
      reviewStatus: "PENDING",
      evidenceRefs: [{ evidenceId: "internal-ref-should-not-leak" }],
    },
  });
  await prisma.runReceipt.create({
    data: {
      workItemId: workItem.id,
      attempt: 1,
      inputRevision: 1,
      runMode: "MANUAL",
      status: "SUCCESS",
      errorMessage: "夹具回执",
      artifactIds: ["internal-artifact-id-should-not-leak"],
    },
  });
  const submission = await prisma.workSubmission.create({
    data: { workItemId: workItem.id, attempt: 1, inputRevision: 1, submittedById: ownerA.id },
  });
  await prisma.artifactApplicability.create({
    data: {
      artifactId: artifact.id,
      submissionId: submission.id,
      workItemId: workItem.id,
      baselineRevision: 1,
      sourceInputRevision: 1,
      contentHash: "internal-content-hash-should-not-leak",
      status: "CONFIRMED",
      confirmedById: ownerA.id,
      confirmedAt: new Date(),
    },
  });
  await prisma.decisionPacket.create({
    data: {
      projectId: project.id,
      validationPlan: "夹具验证计划",
      scopeHash: "fixture-scope-hash",
      artifactVersions: [{ id: artifact.id, version: 1, secret: "internal-should-not-leak" }],
      evidenceVersions: [],
      requiredChecks: [{ key: "internal-required-check-should-not-leak" }],
      snapshot: { projectTarget: "internal-snapshot-should-not-leak" },
    },
  });
  const feedbackRow = await prisma.feedback.create({
    data: {
      projectId: project.id,
      targetType: "PROJECT",
      targetId: project.id,
      authorId: viewerA.id,
      content: "夹具反馈",
    },
  });

  const detail = await api("GET", `/api/projects/${project.id}`, { token: ownerLogin.token });
  ok(detail.status === 200, `4.1 负责人可读取项目详情（HTTP ${detail.status}）`);

  const bodyText = JSON.stringify(detail.json ?? {});

  // 4.2 内部关联 id 与原始 Json 不得下发（原 include 整行会带出这些）
  const forbidden = [
    "internal-should-not-leak",
    "internal-snapshot-should-not-leak",
    "internal-required-check-should-not-leak",
    "internal-ref-should-not-leak",
    "internal-artifact-id-should-not-leak",
    "internal-content-hash-should-not-leak",
    "submittedById",
    "reviewedById",
    "artifactIds",
    "evidenceRefs",
    "workItemId",
    '"snapshot"',
    "artifactVersions",
    "evidenceVersions",
    "requiredChecks",
    '"productVersion"',
  ];
  const leaked = forbidden.filter((k) => bodyText.includes(k));
  ok(
    leaked.length === 0,
    `4.2 响应不含内部关联 id / 原始 Json（命中：${leaked.join(" / ") || "无"}）`
  );

  // 4.3–4.9 客户端真正消费的字段必须仍在 —— 收窄不得误伤功能
  const wi = (detail.json?.workItems ?? []).find((w: any) => w.id === workItem.id);
  ok(!!wi && wi.title === `${RUN_TAG} 合成工作项`, "4.3 工作项仍在且标题可读（收窄未误伤）");
  ok(
    wi?.artifacts?.some((a: any) => a.content === "验收夹具成果正文"),
    "4.4 成果正文仍下发（页面直接渲染该字段）"
  );
  ok(wi?.receipts?.some((r: any) => r.errorMessage === "夹具回执"), "4.5 运行回执仍下发");
  ok(wi?.submissions?.[0]?.id === submission.id, "4.6 提交批次 id 仍下发（审核提示依赖 submissions[0]）");
  ok(
    wi?.applicabilities?.some(
      (ap: any) => ap.submissionId === submission.id && ap.artifact?.type === "RESEARCH_REPORT"
    ),
    "4.7 沿用成果适用性出现在 API 载荷中（修复 SSR 与客户端刷新的形状漂移）"
  );
  ok(
    wi?.applicabilities?.some((ap: any) => ap.confirmedBy?.name === "产品负责人 A"),
    "4.7b 沿用成果的确认人姓名仍下发（收窄不得把显示字段误删为内部 id）"
  );
  ok(
    !!detail.json?.feedbackItems?.some((f: any) => f.id === feedbackRow.id && f.author?.name),
    "4.8 反馈项与作者名仍下发"
  );
  ok(
    !!detail.json?.decisionPackets?.some((p: any) => p.scopeHash === "fixture-scope-hash"),
    "4.9 决策包指纹仍下发（批准有效性展示依赖）"
  );

  // 4.10–4.11 人员信息收窄
  ok(!bodyText.includes(ownerA.email), "4.10 项目详情不下发负责人邮箱");
  ok(!bodyText.includes('"members"'), "4.11 项目详情不下发成员关系（仅供服务端鉴权使用）");

  // 4.12–4.14 读取边界
  // 4.12 注：同组织非成员在**接口层**返回 403（ForbiddenError：在组织内但无该项目权限），
  // 而页面 SSR 走 notFound() 返回 404。两者都拒绝访问，差异仅在是否暴露"项目存在"。
  // 本断言记录接口层现状以防无声变更；是否与页面统一为 404 属产品策略决定，不在此擅自更改。
  const outsiderDetail = await api("GET", `/api/projects/${project.id}`, { token: outsiderLogin.token });
  ok(outsiderDetail.status === 403, `4.12 组织内非成员读项目详情被拒（HTTP ${outsiderDetail.status}）`);
  const foreignDetail = await api("GET", `/api/projects/${project.id}`, { token: foreignLogin.token });
  ok(foreignDetail.status === 404, `4.13 跨组织读项目详情 404 不泄露存在性（HTTP ${foreignDetail.status}）`);
  const anonDetail = await api("GET", `/api/projects/${project.id}`, {});
  ok(anonDetail.status === 401, `4.14 无凭证读项目详情被拒（HTTP ${anonDetail.status}）`);

  // 4.15–4.17 SSR 载荷：生产态不下发同组织成员名单，且首屏仍渲染业务内容
  const ssrRes = await fetch(`${BASE}/projects/${project.id}`, {
    headers: { Cookie: cookieJar.get(ownerLogin.token!) || "" },
  });
  const ssrHtml = await ssrRes.text();
  ok(ssrRes.status === 200, `4.15 负责人可打开项目详情页（HTTP ${ssrRes.status}）`);
  ok(
    !ssrHtml.includes(outsiderA.email) && !ssrHtml.includes(viewerA.email),
    "4.16 SSR 载荷不含同组织其他成员邮箱（mockAuth=false 不下发成员名单）"
  );
  ok(ssrHtml.includes("验收夹具成果正文"), "4.17 SSR 首屏已渲染成果正文（收窄后页面未空白）");

  // 4.18 记录"同组织非成员"在页面层与接口层的状态码差异（页面 notFound 404 / 接口 403）
  const outsiderSsr = await fetch(`${BASE}/projects/${project.id}`, {
    headers: { Cookie: cookieJar.get(outsiderLogin.token!) || "" },
  });
  ok(
    outsiderSsr.status === 404,
    `4.18 同组织非成员打开项目页得 404（页面 notFound 口径，HTTP ${outsiderSsr.status}）`
  );

  // 4.19 项目列表也必须按成员权限过滤，不能只按 organizationId 枚举同组织项目。
  const ownerProjectsPage = await fetch(`${BASE}/projects`, {
    headers: { Cookie: cookieJar.get(ownerLogin.token!) || "" },
  });
  const outsiderProjectsPage = await fetch(`${BASE}/projects`, {
    headers: { Cookie: cookieJar.get(outsiderLogin.token!) || "" },
  });
  const ownerProjectsHtml = await ownerProjectsPage.text();
  const outsiderProjectsHtml = await outsiderProjectsPage.text();
  ok(ownerProjectsPage.status === 200, `4.19a 项目成员可打开项目列表（HTTP ${ownerProjectsPage.status}）`);
  ok(
    ownerProjectsHtml.includes(`${RUN_TAG} 合成验收项目`),
    "4.19b 项目成员可看到自己的项目"
  );
  ok(
    outsiderProjectsPage.status === 200 && !outsiderProjectsHtml.includes(`${RUN_TAG} 合成验收项目`),
    "4.19c 同组织非成员看不到他人的项目元数据"
  );

  // ---------- 5. 结构化成果接线（TASK-009b，走真实 HTTP 提交入口） ----------
  console.log("\n▶ 场景 5：结构化成果接线（坏 JSON / 未知版本 / 版本不一致 / 零写入 / 追加保存 / AI 不自 ACCEPTED）");
  {
    const submitSa = async (art: unknown) =>
      api("POST", `/api/work-items/${saWorkItem.id}/submissions`, {
        token: ownerLogin.token,
        body: { inputRevision: 1, runMode: "MANUAL", artifacts: art === null ? [] : [art] },
      });
    const countArtifacts = () => prisma.artifact.count({ where: { workItemId: saWorkItem.id } });

    const validCost = {
      engineVersion: "v1",
      scenarioName: "基础情景",
      currency: "CNY",
      unit: "盒",
      expenseBase: "出厂口径",
      result: 12.5,
    };

    // 5.1 登记类型 + 合法 JSON → 201；列/内容版本、指纹、未确认、默认审核状态同时断言
    const good = await submitSa({ type: "COST_SCENARIO", title: "成本情景", content: JSON.stringify(validCost) });
    ok(good.status === 200, `5.1 结构化成果提交成功（HTTP ${good.status}，期望 200）`);
    const goodRow = await prisma.artifact.findFirst({ where: { workItemId: saWorkItem.id, type: "COST_SCENARIO" } });
    ok(!!goodRow, "5.2 成果已落库");
    const goodParsed = goodRow ? JSON.parse(goodRow.content) : null;
    ok(
      !!goodRow &&
        goodRow.schemaVersion === "1.0" &&
        goodParsed?.schemaVersion === "1.0" &&
        goodParsed?.organizationId === orgA.id &&
        goodParsed?.projectId === saProject.id &&
        /^[0-9a-f]{64}$/.test(String(goodParsed?.inputFingerprint)) &&
        goodParsed?.confirmedBy === null &&
        goodRow.reviewStatus === "PENDING",
      "5.3 信封与审核状态正确（列=内容版本、服务端归属、指纹 64 位、未确认即 null、默认 PENDING）"
    );

    // 5.4 同 workItem+type 再提交 → 追加为第 2 版，不覆盖旧版本
    const again = await submitSa({ type: "COST_SCENARIO", title: "成本情景·调整", content: JSON.stringify(validCost) });
    ok(again.status === 200, `5.4 再次提交同类型成果（HTTP ${again.status}）`);
    const versions = await prisma.artifact.findMany({
      where: { workItemId: saWorkItem.id, type: "COST_SCENARIO" },
      select: { contentVersion: true },
      orderBy: { contentVersion: "asc" },
    });
    ok(
      versions.map((v) => v.contentVersion).join(",") === "1,2",
      `5.5 新内容追加保存（contentVersion 序列=${versions.map((v) => v.contentVersion).join(",")}，期望 1,2）`
    );

    // 5.6 坏 JSON → 422，且零写入（不冒 500、不落半成品）
    const beforeBadJson = await countArtifacts();
    const badJson = await submitSa({ type: "COST_SCENARIO", title: "坏 JSON", content: "{not json" });
    ok(badJson.status === 422, `5.6 坏 JSON 被拒绝（HTTP ${badJson.status}，期望 422）`);
    ok((await countArtifacts()) === beforeBadJson, "5.6b 坏 JSON 未写入任何成果");

    // 5.7 未知版本 → 422，零写入
    const beforeUnknown = await countArtifacts();
    const unknownVersion = await submitSa({
      type: "COST_SCENARIO",
      title: "未知版本",
      content: JSON.stringify({ ...validCost, schemaVersion: "9.9" }),
    });
    ok(unknownVersion.status === 422, `5.7 未知版本被拒绝（HTTP ${unknownVersion.status}，期望 422）`);
    ok((await countArtifacts()) === beforeUnknown, "5.7b 未知版本未写入任何成果");

    // 5.8 列参数与内容顶层版本不一致 → 422，零写入
    const beforeMismatch = await countArtifacts();
    const mismatch = await submitSa({
      type: "COST_SCENARIO",
      title: "版本不一致",
      content: JSON.stringify(validCost),
      schemaVersion: "2.0",
    });
    ok(mismatch.status === 422, `5.8 列与内容版本不一致被拒绝（HTTP ${mismatch.status}，期望 422）`);
    ok((await countArtifacts()) === beforeMismatch, "5.8b 版本不一致未写入任何成果");

    // 5.9 AI/测试桩内容不能自带 ACCEPTED：TEST_STUB 提交的结构化成果默认仍是 PENDING
    const stubbed = await api("POST", `/api/work-items/${saWorkItem.id}/submissions`, {
      token: ownerLogin.token,
      body: { inputRevision: 1, runMode: "TEST_STUB", artifacts: [{ type: "COST_SCENARIO", title: "AI 草稿", content: JSON.stringify(validCost) }] },
    });
    ok(stubbed.status === 200, `5.9 TEST_STUB 提交成功（HTTP ${stubbed.status}）`);
    const aiRow = await prisma.artifact.findFirst({
      where: { workItemId: saWorkItem.id, type: "COST_SCENARIO", title: "AI 草稿" },
    });
    ok(
      !!aiRow && aiRow.reviewStatus === "PENDING" && aiRow.producerType === "TEST_STUB",
      "5.10 AI 内容不自带 ACCEPTED（reviewStatus=PENDING；正式 ACCEPTED 只由审核链写）"
    );

    // 5.11 服务端信封不可被请求体覆盖（organizationId / projectId / confirmedBy）
    const spoof = await submitSa({
      type: "COST_SCENARIO",
      title: "信封伪造",
      content: JSON.stringify({
        ...validCost,
        organizationId: orgB.id,
        projectId: "other-project",
        confirmedBy: "某专家",
      }),
    });
    ok(spoof.status === 200, `5.11 带伪造信封的提交仍走服务端推导（HTTP ${spoof.status}）`);
    const spoofRow = await prisma.artifact.findFirst({
      where: { workItemId: saWorkItem.id, type: "COST_SCENARIO", title: "信封伪造" },
    });
    const spoofParsed = spoofRow ? JSON.parse(spoofRow.content) : null;
    ok(
      !!spoofParsed &&
        spoofParsed.organizationId === orgA.id &&
        spoofParsed.projectId === saProject.id &&
        spoofParsed.confirmedBy === null,
      "5.12 服务端信封未被请求体覆盖（归属=本组织/本项目，未确认）"
    );
  }

  // ---------- 汇总 ----------
  console.log("\n" + "=".repeat(80));
  if (failures.length === 0) {
    console.log(`🏆 产品中心验收全绿：${passed} 项断言全部通过`);
  } else {
    console.log(`❌ 产品中心验收失败 ${failures.length} 项 / 通过 ${passed} 项：`);
    failures.forEach((f) => console.log(`   - ${f}`));
  }
  console.log("=".repeat(80) + "\n");

  // ---------- 清理：仅本套夹具 ----------
  // 注：Artifact.workItem 为 onDelete: SetNull，删工作项不会带走成果，须显式清理，避免残留。
  await prisma.artifact.deleteMany({ where: { workItemId: workItem.id } });
  // TASK-009b 夹具清理（结构化成果 + 工作项 + 成员 + 项目）
  await prisma.artifact.deleteMany({ where: { workItemId: saWorkItem.id } });
  await prisma.workItem.deleteMany({ where: { id: saWorkItem.id } });
  await prisma.projectMember.deleteMany({ where: { projectId: saProject.id } });
  await prisma.project.deleteMany({ where: { id: saProject.id } });
  await prisma.projectMember.deleteMany({ where: { projectId: project.id } });
  await prisma.project.deleteMany({ where: { id: project.id } });
  await prisma.productVersion.deleteMany({ where: { productId: product.id } });
  await prisma.productVersion.deleteMany({ where: { productId: projectlessProduct.id } });
  await prisma.product.deleteMany({ where: { id: { in: [product.id, projectlessProduct.id] } } });
  await prisma.user.deleteMany({
    where: { id: { in: [ownerA.id, viewerA.id, outsiderA.id, foreignB.id] } },
  });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  console.log("🧹 已清理本套夹具（组织 / 用户 / 产品 / 版本 / 项目）");

  await prisma.$disconnect();
  if (failures.length > 0) process.exitCode = 1;
}

main().catch(async (e) => {
  console.error("❌ 产品中心验收异常终止:", e?.message || e);
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
