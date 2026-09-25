/**
 * 表驱动权限矩阵回归（PC-0 / TASK-004 · B8）
 *
 * 与前两套 HTTP 验收的分工：
 * - `acceptance-b01-http.ts`：场景化端到端越权旅程（含状态机与幂等）。
 * - `acceptance-product-center.test.ts`：产品级写路径与项目详情下发字段白名单。
 * - 本套：**穷举登记**。66 条路由 × 89 个方法全部过一遍，重点不是"某个场景对不对"，
 *   而是"有没有哪条路由没被登记"以及"未授权身份有没有拿到成功响应或产生跨租户写入"。
 *
 * 断言：
 *   ① 登记覆盖：文件系统里存在的路由/方法必须全部登记；已消失的登记项必须清理。
 *   ② 状态码：按矩阵逐格断言（精确码，或"不得成功"）。
 *   ③ 跨租户：跨组织身份只要拿到 2xx，响应体内不得出现他组织夹具标记。
 *   ④ 内部字段：任何响应都不得下发 fileKey / runnerPid / 内部关联 id 等实现细节。
 *   ⑤ 零写入：跨组织与匿名身份整轮跑完后，本组织相关表计数与既有行指纹均不得变化。
 *   ⑥ **反向回归**（场景 5/6，2026-09-16 新增）：证明两条曾被利用的路径已被关闭 ——
 *      org-admin 权限自举（D-003）、跨组织信号存在性泄漏（D-002）。
 *      反向测试的意义：修复若被回退，①②③④⑤ 可能仍然全绿（旧行为同样"没有越权写入"），
 *      只有反向断言会失败。
 *
 * 身份分四段执行，避免相互污染：
 *   A 段 anon + foreign（跨组织隔离是硬不变量）
 *   B 段 outsider（同组织非成员：只能断言"未改既有资源"）
 *   C 段 owner（有权身份门禁不得误拒）
 *   D 段 反向回归（需要前几段跑完、且会自建夹具，因此排最后）
 *
 * 运行：
 *   NODE_ENV=production DEV_MOCK_AUTH=false DATABASE_URL=<测试库> next start -p 3110
 *   BASE_URL=http://127.0.0.1:3110 tsx scripts/run-test.ts tests/acceptance-authz-matrix.test.ts
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { hashPassword } from "../src/modules/identity/session";
import {
  AUTHZ_MATRIX,
  CROSS_TENANT_MARKER,
  FORBIDDEN_INTERNAL_KEYS,
  type Identity,
  type Expectation,
  type RouteSpec,
} from "./authz-matrix";
import { DESKTOP_AGENT_CODE } from "../src/modules/desktop-runtime/contracts";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3110";
const RUN_TAG = `mx${Date.now()}`;
const PASSWORD = `Mx-${crypto.randomBytes(6).toString("hex")}!`;
const MARK = CROSS_TENANT_MARKER;
/**
 * 路由基线与「已登记路由/方法数」严格一致，任何新增路由都必须同步更新这里，
 * 否则 1.3 / 1.4 会红——这是刻意的：新 API 面不允许悄悄绕过授权矩阵。
 *
 * 2026-09-25：+1 路由（/api/projects/{id}/product-rnd），+2 方法（GET/POST）。
 * 2026-09-25（合并远端 main 后）：+3 路由（/api/desktop-runtime/tasks、
 *   .../tasks/{id}/claim、.../tasks/{id}/finish），+5 方法（desktop GET/POST + claim/finish POST，
 *   以及 /api/conversations/{id}/messages 新增的 GET）。
 */
const BASELINE_ROUTES = 66;
const BASELINE_METHODS = 89;

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

type Gate = Expectation | "NOT_DENIED";

function matches(status: number, exp: Gate): boolean {
  // NOT_DENIED = 门禁已开。判据必须同时排除两类：
  //   ① 拒绝（401/403/404）——门禁没开；
  //   ② **5xx**——路由崩了，它不是「通过门禁」。
  // 旧写法只排除 ①，于是 30 条路由上的「Prisma 校验异常 → 500」被当成绿灯放行，
  // 半张矩阵实际上分不清「200 正常」和「500 崩溃」。这一条是本次修复的核心。
  if (exp === "NOT_DENIED") return ![401, 403, 404].includes(status) && status < 500;
  if (exp === "NO_2XX") return status < 200 || status >= 300;
  return exp.includes(status);
}

function describe(exp: Gate): string {
  if (exp === "NOT_DENIED") return "门禁已开(非 401/403/404，且非 5xx)";
  if (exp === "NO_2XX") return "不得成功(非 2xx)";
  return exp.join("/");
}

const cookieJar = new Map<string, string>();

async function api(
  method: string,
  url: string,
  token?: string,
  body: unknown = undefined
): Promise<{ status: number; text: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    const jar = cookieJar.get(token);
    if (jar) headers.Cookie = jar;
  }
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const text = await res.text();
  return { status: res.status, text };
}

/**
 * 与 api() 同源的**裸体发送**变体：body 原样发出，不做 JSON.stringify。
 *
 * 为什么存在：D-011 探针要构造**非法 JSON 字节流**（如单个 `{`），而 api() 会把入参
 * 序列化 —— 传字符串 `"{"` 会被包成合法 JSON 字面量 `"{"`，根本触发不了引擎的解析失败。
 * 此函数复用同一套 Cookie/鉴权头与 BASE，只替换 body 的编码方式，不引入第二套 HTTP 客户端。
 */
async function apiRaw(
  method: string,
  url: string,
  token: string,
  rawBody?: string
): Promise<{ status: number; text: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  headers.Authorization = `Bearer ${token}`;
  const jar = cookieJar.get(token);
  if (jar) headers.Cookie = jar;
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers,
    body: rawBody,
    redirect: "manual",
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function login(email: string, password: string) {
  const res = await fetch(`${BASE}/api/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  await res.text();
  const pair = res.headers.get("set-cookie")?.split(";")[0];
  const token = pair && pair.includes("=") ? pair.slice(pair.indexOf("=") + 1) : undefined;
  if (token && pair) cookieJar.set(token, pair);
  return { status: res.status, token };
}

/** 从文件系统推导实际存在的 (路由模板, 方法) */
function discoverRoutes(): Map<string, Set<string>> {
  const appDir = path.join(process.cwd(), "src", "app");
  const found = new Map<string, Set<string>>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === "route.ts") {
        const template =
          "/" +
          path
            .relative(appDir, dir)
            .split(path.sep)
            .join("/")
            .replace(/\[([^\]]+)\]/g, "{$1}");
        const src = fs.readFileSync(full, "utf8");
        const methods = new Set<string>();
        for (const m of ["GET", "POST", "PATCH", "PUT", "DELETE"]) {
          if (new RegExp(`export\\s+async\\s+function\\s+${m}\\b`).test(src)) methods.add(m);
        }
        found.set(template, methods);
      }
    }
  };
  walk(path.join(appDir, "api"));
  return found;
}

async function main() {
  await assertTestDatabaseSafety(prisma);

  console.log("=".repeat(80));
  console.log("🧪 表驱动权限矩阵回归（PC-0 / TASK-004 · B8）");
  console.log(`    BASE_URL=${BASE}  登记条目=${AUTHZ_MATRIX.length}`);
  console.log("=".repeat(80) + "\n");

  // ---------- ① 登记覆盖 ----------
  console.log("▶ 场景 1：登记覆盖（新增路由未登记即判失败）");
  const discovered = discoverRoutes();
  const discoveredKeys = new Set<string>();
  for (const [template, methods] of discovered) {
    for (const m of methods) discoveredKeys.add(`${template} ${m}`);
  }
  const registeredKeys = new Set(AUTHZ_MATRIX.map((r) => `${r.path} ${r.method}`));

  const unregistered = [...discoveredKeys].filter((k) => !registeredKeys.has(k));
  const stale = [...registeredKeys].filter((k) => !discoveredKeys.has(k));
  ok(unregistered.length === 0, `1.1 实际路由/方法均已登记（未登记：${unregistered.join("、") || "无"}）`);
  ok(stale.length === 0, `1.2 登记项均对应实际路由（过期项：${stale.join("、") || "无"}）`);
  ok(discovered.size === BASELINE_ROUTES, `1.3 路由总数与基线一致（实际 ${discovered.size} / 基线 ${BASELINE_ROUTES}）`);
  ok(
    discoveredKeys.size === BASELINE_METHODS,
    `1.4 路由×方法总数与基线一致（实际 ${discoveredKeys.size} / 基线 ${BASELINE_METHODS}）`
  );
  if (unregistered.length || stale.length) {
    console.log("\n⚠️ 登记表与实际路由不一致，后续状态码断言仍会执行，但请先补齐登记。\n");
  }

  // ---------- 夹具 ----------
  const orgA = await prisma.organization.create({ data: { code: `${RUN_TAG}_A`, name: `${MARK} 矩阵机构 A` } });
  const orgB = await prisma.organization.create({ data: { code: `${RUN_TAG}_B`, name: "矩阵机构 B" } });
  const mkUser = (email: string, name: string, organizationId: string) =>
    prisma.user.create({ data: { email, name, organizationId, passwordHash: hashPassword(PASSWORD) } });

  const ownerA = await mkUser(`${RUN_TAG}-owner@hermes.test`, `${MARK} 负责人`, orgA.id);
  const viewerA = await mkUser(`${RUN_TAG}-viewer@hermes.test`, `${MARK} 只读成员`, orgA.id);
  const outsiderA = await mkUser(`${RUN_TAG}-outsider@hermes.test`, `${MARK} 组织内非成员`, orgA.id);
  const foreignB = await mkUser(`${RUN_TAG}-foreign@hermes.test`, "跨组织用户 B", orgB.id);

  /**
   * 组织成员关系（OrganizationMember）——公司级角色，与项目角色分离。
   *
   * 分配是有意的，用来一次性覆盖三种情形：
   *   - ownerA   → ORG_ADMIN：知识源/公司事实门禁应放行（ownerGate 断言依赖它）
   *   - viewerA  → MEMBER：组织成员但不是管理员
   *   - outsiderA→ **不建记录**：验证「无成员记录 = 非管理员」，
   *                即组织级判定**不回退**到项目角色（回退 = 自举漏洞）
   *   - foreignB → 不建记录（跨组织一律不通过）
   */
  await prisma.organizationMember.createMany({
    data: [
      { organizationId: orgA.id, userId: ownerA.id, role: "ORG_ADMIN" },
      { organizationId: orgA.id, userId: viewerA.id, role: "MEMBER" },
    ],
  });

  const productA = await prisma.product.create({
    data: {
      organizationId: orgA.id,
      name: `${MARK} 产品`,
      identityCode: `${RUN_TAG}-ID`,
      targetAudience: "矩阵人群",
      marketPath: "DOMESTIC",
      devMode: "SELF_DEVELOPED",
      ownerId: ownerA.id,
    },
  });
  const versionA = await prisma.productVersion.create({
    data: { productId: productA.id, versionTag: "v1", specs: { netWeight: "30 条" } },
  });
  const projectA = await prisma.project.create({
    data: {
      organizationId: orgA.id,
      productId: productA.id,
      productVersionId: versionA.id,
      title: `${MARK} 项目`,
      target: "矩阵目标",
      ownerId: ownerA.id,
      members: { create: [{ userId: ownerA.id, role: "OWNER" }, { userId: viewerA.id, role: "VIEWER" }] },
    },
  });
  const workItemA = await prisma.workItem.create({
    data: { projectId: projectA.id, title: `${MARK} 工作项`, target: "矩阵目标", deliverableReq: "矩阵交付要求" },
  });
  await prisma.workSubmission.create({
    data: { workItemId: workItemA.id, attempt: 1, inputRevision: 1, submittedById: ownerA.id, status: "PENDING" },
  });
  const packetA = await prisma.decisionPacket.create({
    data: {
      projectId: projectA.id,
      validationPlan: "矩阵验证计划",
      scopeHash: `${RUN_TAG}-hash`,
      artifactVersions: [],
      evidenceVersions: [],
      requiredChecks: [],
      budgetAmount: 1000,
      budgetScope: "打样",
      // 初始 DRAFT：owner 才有「提交冻结」可走（提交后才进入 IN_REVIEW 供裁决）
      status: "DRAFT",
    },
  });
  const evidenceA = await prisma.evidence.create({
    data: {
      projectId: projectA.id,
      contentOrUri: `${MARK} 证据`,
      source: "MATRIX_FIXTURE",
      hash: `${RUN_TAG}-evhash`,
      fileKey: `${RUN_TAG}-attachment.txt`,
      mimeType: "text/plain",
      originalFilename: "matrix.txt",
    },
  });
  const feedbackA = await prisma.feedback.create({
    data: { projectId: projectA.id, targetType: "PROJECT", targetId: projectA.id, authorId: viewerA.id, content: `${MARK} 反馈` },
  });
  const runA = await prisma.researchRun.create({
    data: {
      projectId: projectA.id,
      question: `${MARK} 研究问题`,
      inputRevision: 1,
      scopeSnapshotJson: {},
      createdById: ownerA.id,
    },
  });
  const convA = await prisma.conversation.create({
    data: { organizationId: orgA.id, ownerId: ownerA.id, title: `${MARK} 会话` },
  });
  const propA = await prisma.actionProposal.create({
    data: {
      organizationId: orgA.id,
      conversationId: convA.id,
      actionType: "CREATE_WORK_ITEM",
      payloadJson: {},
      proposedById: ownerA.id,
    },
  });
  const sourceA = await prisma.signalSource.create({
    data: { organizationId: orgA.id, key: `${RUN_TAG}-src`, name: "矩阵来源", mode: "manual" },
  });
  await prisma.signalItem.create({
    data: { organizationId: orgA.id, sourceKey: sourceA.key, sourceName: `${MARK} 来源`, title: `${MARK} 信号`, hash: `${RUN_TAG}-sighash` },
  });
  const ksA = await prisma.knowledgeSource.create({
    data: { organizationId: orgA.id, name: `${MARK} 知识源`, rootPath: "/tmp/matrix-vault", createdById: ownerA.id },
  });
  await prisma.knowledgeDocument.create({
    data: { sourceId: ksA.id, organizationId: orgA.id, relativePath: "a.md", title: `${MARK} 文档`, contentHash: `${RUN_TAG}-dhash` },
  });
  const planA = await prisma.launchPlan.create({
    data: { organizationId: orgA.id, productId: productA.id, projectId: projectA.id, title: `${MARK} 上市计划`, ownerId: ownerA.id },
  });
  // 顾问交互运行夹具：同组织可读、仅发起人可取消
  const agentRunA = await prisma.agentRun.create({
    data: {
      organizationId: orgA.id,
      userId: ownerA.id,
      goal: `${MARK} 交互运行`,
      status: "QUEUED",
    },
  });
  // 数字员工 + 任务夹具：OWNER_ONLY，证明非 owner 不可 invoke（404）
  const agentA = await prisma.agent.create({
    data: {
      organizationId: orgA.id,
      code: `${RUN_TAG}-agent`,
      name: `${MARK} 数字员工`,
      roleKey: "pm",
      accessMode: "OWNER_ONLY",
      ownerId: ownerA.id,
      status: "ACTIVE",
    },
  });
  const agentTaskA = await prisma.agentTask.create({
    data: {
      organizationId: orgA.id,
      agentId: agentA.id,
      goal: `${MARK} 数字员工任务`,
      status: "QUEUED",
      availableAt: new Date(0),
    },
  });

  /**
   * 本机执行（Desktop Runtime）夹具。
   *
   * 为什么自建桌面操作员而**不靠路由自举**：入队路由在找不到 Desktop Operator 时会调
   * `bootstrapDefaultWorkforce`，而它要求 `OrganizationMember.role = ORG_ADMIN` ——
   * 矩阵里只有 ownerA 满足。若靠自举，viewer/outsider 的读数就会随「owner 是否已经跑过」
   * 漂移。夹具先把这个 agent 建出来，读数就与执行顺序无关了。
   * （cross-org 身份仍无 agent，因此入队对他稳定是 409，见 authz-matrix.ts 的说明。）
   */
  const desktopAgentA = await prisma.agent.create({
    data: {
      organizationId: orgA.id,
      code: DESKTOP_AGENT_CODE,
      name: `${MARK} 桌面操作员`,
      roleKey: "DESKTOP_OPERATOR",
      accessMode: "ORGANIZATION",
      ownerId: ownerA.id,
      status: "ACTIVE",
      maxConcurrentTasks: 1,
    },
  });
  const desktopTaskA = await prisma.agentTask.create({
    data: {
      organizationId: orgA.id,
      agentId: desktopAgentA.id,
      createdByUserId: ownerA.id,
      goal: "读取剪贴板",
      status: "QUEUED",
      availableAt: new Date(0),
      contextSnapshot: {
        executionTarget: "DESKTOP",
        desktopAction: { tool: "clipboard.read" },
        requestedByUserId: ownerA.id,
        requestedAt: new Date(0).toISOString(),
      },
    },
  });

  const uploadDir = path.join(process.cwd(), ".uploads");
  await fs.promises.mkdir(uploadDir, { recursive: true });
  await fs.promises.writeFile(path.join(uploadDir, `${RUN_TAG}-attachment.txt`), "matrix");

  /**
   * 路由占位符按真实参数名映射到夹具。
   * 注：Next 路由把参数一律命名为 id/planId/runId，语义要靠路径前缀区分。
   */
  const RESOLVERS: Array<[RegExp, string]> = [
    [/^\/api\/agent-runs\//, agentRunA.id],
    [/^\/api\/attachments\//, evidenceA.id],
    [/^\/api\/conversations\//, convA.id],
    [/^\/api\/decision-packets\//, packetA.id],
    [/^\/api\/evidences\//, evidenceA.id],
    [/^\/api\/feedback\//, feedbackA.id],
    [/^\/api\/knowledge\/sources\//, ksA.id],
    [/^\/api\/launch\/plans\//, planA.id],
    [/^\/api\/products\//, productA.id],
    [/^\/api\/projects\//, projectA.id],
    [/^\/api\/proposals\//, propA.id],
    [/^\/api\/research-runs\//, runA.id],
    [/^\/api\/work-items\//, workItemA.id],
    [/^\/api\/workforce\/tasks\//, agentTaskA.id],
    [/^\/api\/desktop-runtime\/tasks\//, desktopTaskA.id],
  ];
  const expand = (template: string): string => {
    if (!template.includes("{")) return template;
    const hit = RESOLVERS.find(([re]) => re.test(template));
    if (!hit) throw new Error(`无法解析路由占位符：${template}`);
    return template.replace(/\{\w+\}/g, hit[1]);
  };

  /**
   * 请求用的 URL：在展开后的路径上追加 RouteSpec.query（若有）。
   * 为什么不让 query 直接写进 path：场景 1.1/1.2 会拿 path 与文件系统实际路由比对，
   * 带查询串会被判成「登记项与实际路由不符」。query 只影响请求，不影响登记。
   */
  const urlFor = (spec: RouteSpec): string =>
    spec.query ? `${expand(spec.path)}?${spec.query}` : expand(spec.path);

  const ownerLogin = await login(ownerA.email, PASSWORD);
  const viewerLogin = await login(viewerA.email, PASSWORD);
  const outsiderLogin = await login(outsiderA.email, PASSWORD);
  const foreignLogin = await login(foreignB.email, PASSWORD);
  if (!ownerLogin.token || !viewerLogin.token || !outsiderLogin.token || !foreignLogin.token) {
    throw new Error(
      `夹具登录失败 owner=${ownerLogin.status} viewer=${viewerLogin.status} outsider=${outsiderLogin.status} foreign=${foreignLogin.status}`
    );
  }
  const TOKEN: Record<Identity, string | undefined> = {
    anon: undefined,
    foreign: foreignLogin.token,
    outsider: outsiderLogin.token,
    viewer: viewerLogin.token,
    owner: ownerLogin.token,
  };

  /** 渲染 body 占位符：{{RUN_TAG}} / {{IDENTITY}}，用于避免多次运行撞唯一键 */
  const render = (body: unknown, id: Identity): unknown => {
    if (body === undefined) return undefined;
    const s = JSON.stringify(body)
      .replace(/\{\{RUN_TAG\}\}/g, RUN_TAG)
      .replace(/\{\{IDENTITY\}\}/g, id);
    return JSON.parse(s);
  };

  const counts = async () => ({
    product: await prisma.product.count({ where: { organizationId: orgA.id } }),
    project: await prisma.project.count({ where: { organizationId: orgA.id } }),
    workItem: await prisma.workItem.count({ where: { project: { organizationId: orgA.id } } }),
    evidence: await prisma.evidence.count({ where: { project: { organizationId: orgA.id } } }),
    feedback: await prisma.feedback.count({ where: { project: { organizationId: orgA.id } } }),
    decisionPacket: await prisma.decisionPacket.count({ where: { project: { organizationId: orgA.id } } }),
    decision: await prisma.decision.count({ where: { packet: { project: { organizationId: orgA.id } } } }),
    researchRun: await prisma.researchRun.count({ where: { project: { organizationId: orgA.id } } }),
    conversation: await prisma.conversation.count({ where: { organizationId: orgA.id } }),
    message: await prisma.message.count({ where: { conversation: { organizationId: orgA.id } } }),
    actionProposal: await prisma.actionProposal.count({ where: { organizationId: orgA.id } }),
    signalItem: await prisma.signalItem.count({ where: { organizationId: orgA.id } }),
    knowledgeSource: await prisma.knowledgeSource.count({ where: { organizationId: orgA.id } }),
    launchPlan: await prisma.launchPlan.count({ where: { organizationId: orgA.id } }),
    companyFact: await prisma.companyFact.count({ where: { organizationId: orgA.id } }),
    artifact: await prisma.artifact.count({ where: { workItem: { project: { organizationId: orgA.id } } } }),
    // 组织成员关系：跨组织/匿名身份若能新建成员行，等于可以给自己发组织级权限
    organizationMember: await prisma.organizationMember.count({ where: { organizationId: orgA.id } }),
  });

  /** 既有夹具行指纹：同组织非成员不得修改他人既有资源 */
  const fingerprint = async () =>
    JSON.stringify(
      await Promise.all([
        prisma.project.findUnique({ where: { id: projectA.id }, select: { revision: true, target: true, stage: true } }),
        prisma.workItem.findUnique({ where: { id: workItemA.id }, select: { status: true, title: true } }),
        prisma.decisionPacket.findUnique({ where: { id: packetA.id }, select: { status: true, budgetAmount: true } }),
        prisma.product.findUnique({ where: { id: productA.id }, select: { name: true } }),
        prisma.evidence.findUnique({ where: { id: evidenceA.id }, select: { verifyStatus: true, contentOrUri: true } }),
        prisma.feedback.findUnique({ where: { id: feedbackA.id }, select: { status: true, dispositionReason: true } }),
        prisma.conversation.findUnique({ where: { id: convA.id }, select: { title: true } }),
        prisma.actionProposal.findUnique({ where: { id: propA.id }, select: { status: true } }),
        prisma.knowledgeSource.findUnique({ where: { id: ksA.id }, select: { rootPath: true } }),
        prisma.launchPlan.findUnique({ where: { id: planA.id }, select: { status: true, approvedAt: true } }),
      ])
    );

  const phaseOf = (s: RouteSpec) => s.phase ?? (s.method === "GET" ? 1 : 2);
  // 登出放最后：DELETE /api/auth/session 会让该身份会话失效
  const ordered = [...AUTHZ_MATRIX].sort((a, b) => {
    const last = (r: RouteSpec) => (r.path === "/api/auth/session" && r.method === "DELETE" ? 99 : phaseOf(r));
    return last(a) - last(b);
  });

  const runFor = async (id: Identity, opts: { crossTenant: boolean; internalKeys: boolean }) => {
    for (const spec of ordered) {
      const url = urlFor(spec);
      const { status, text } = await api(spec.method, url, TOKEN[id], render(spec.body, id));
      const exp = (spec.expect as Record<string, Expectation>)[id];
      ok(matches(status, exp), `${spec.method} ${spec.path} · ${id} → HTTP ${status}（期望 ${describe(exp)}）`);

      if (opts.crossTenant && spec.crossTenant && status >= 200 && status < 300) {
        ok(!text.includes(MARK), `${spec.method} ${spec.path} · ${id} 响应不含他组织数据标记`);
      }
      if (opts.internalKeys) {
        const leaked = FORBIDDEN_INTERNAL_KEYS.filter((k) => text.includes(`"${k}"`));
        ok(
          leaked.length === 0,
          `${spec.method} ${spec.path} · ${id} 未下发内部实现字段（命中：${leaked.join("、") || "无"}）`
        );
      }
    }
  };

  /**
   * 夹具清理：必须无条件执行。
   *
   * 教训：曾按「逐个 id 点名」清理，漏掉了断言过程中由接口新建的记录
   * （例如 POST /api/projects 建的项目、产品分析产生的 AnalysisRun），
   * 残留数据在下一轮触发唯一键冲突，把真实缺陷伪装成"矩阵失败"。
   * 因此改为**按组织范围**整体清理：只要落在本次两个夹具组织内，一律清掉。
   */
  const cleanup = async () => {
    const orgIds = [orgA.id, orgB.id];
    const projectIds = (
      await prisma.project.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true } })
    ).map((p) => p.id);
    const userIds = (
      await prisma.user.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true } })
    ).map((u) => u.id);

    // 顺序按外键依赖：先删引用方，再删被引用方
    // AnalysisRun.productVersionId / LaunchPlan.projectId·productId / Project.ownerId
    // / AuditEvent.actorId / AgentRun.userId / AgentTask.agentId 均为 restrict，必须显式先删
    await prisma.analysisRun.deleteMany({ where: { productVersion: { product: { organizationId: { in: orgIds } } } } });
    await prisma.launchPlan.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.artifact.deleteMany({ where: { workItem: { projectId: { in: projectIds } } } });
    await prisma.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.productVersion.deleteMany({ where: { product: { organizationId: { in: orgIds } } } });
    await prisma.product.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.conversation.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.signalItem.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.signalSource.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.knowledgeDocument.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.knowledgeSource.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.agentDelegation.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.agentRun.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.agentTask.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.squadMember.deleteMany({ where: { squad: { organizationId: { in: orgIds } } } });
    await prisma.squad.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.agentSkill.deleteMany({ where: { agent: { organizationId: { in: orgIds } } } });
    await prisma.skill.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.agent.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await fs.promises.rm(path.join(uploadDir, `${RUN_TAG}-attachment.txt`), { force: true });
  };

  try {
  // ---------- A 段：匿名 + 跨组织（租户隔离是硬不变量） ----------
  console.log("\n▶ 场景 2：匿名与跨组织身份（租户隔离）");
  const beforeA = await counts();
  await runFor("anon", { crossTenant: false, internalKeys: true });
  await runFor("foreign", { crossTenant: true, internalKeys: true });
  const afterA = await counts();
  const changedA = Object.keys(beforeA).filter((k) => (beforeA as any)[k] !== (afterA as any)[k]);
  ok(
    changedA.length === 0,
    `2.1 匿名与跨组织身份未对本组织产生任何写入（变化表：${changedA
      .map((k) => `${k} ${(beforeA as any)[k]}→${(afterA as any)[k]}`)
      .join("、") || "无"}）`
  );

  // ---------- B 段：同组织非成员 ----------
  console.log("\n▶ 场景 3：同组织非成员（不得修改他人既有资源；读口径属待拍板策略）");
  const beforeFp = await fingerprint();
  await runFor("outsider", { crossTenant: false, internalKeys: true });
  const afterFp = await fingerprint();
  ok(beforeFp === afterFp, "3.1 同组织非成员未修改任何既有夹具资源（指纹一致）");

  // ---------- C 段：有权身份 ----------
  console.log("\n▶ 场景 4：有权身份门禁不得误拒");
  const serverErrors: Array<{ method: string; path: string; status: number }> = [];
  for (const spec of ordered) {
    const { status } = await api(spec.method, urlFor(spec), TOKEN.owner, render(spec.body, "owner"));
    if (status >= 500) serverErrors.push({ method: spec.method, path: spec.path, status });
    ok(matches(status, spec.ownerGate), `${spec.method} ${spec.path} · owner → HTTP ${status}（期望 ${describe(spec.ownerGate)}）`);
  }
  // 独立汇总 5xx。逐条断言依赖 ownerGate 的写法，这一条不依赖：
  // 只要「有权身份打自己组织的路由」出现任何一个 5xx，就必须红。
  // 这是 D-008 的回归护栏——防止将来又有人把门禁放宽到接受 500。
  ok(
    serverErrors.length === 0,
    `4.0 有权身份段无任何 5xx（实测 ${serverErrors.length} 个：${
      serverErrors.length === 0
        ? "无"
        : serverErrors.map((e) => `${e.method} ${e.path}→${e.status}`).join("、")
    }）`
  );

  // ---------- D 段：反向回归（本轮新增） ----------
  //
  // 前四场景证明「不该进的人进不来」。这一段反过来证明：
  // ① 一条**曾被利用过的自升权路径**已被真正关掉；
  // ② 一条**跨租户存在性泄漏**已被真正关掉。
  // 反向测试的价值在于：修复被回退时，前四场景可能仍然全绿（旧行为也是"没有越权写入"），
  // 只有这里会失败。
  console.log("\n▶ 场景 5：org-admin 权限自举回归（D-003）");
  {
    // 前几段的穷举遍历包含 `DELETE /api/auth/session`（会注销该身份的会话），
    // 因此反向回归段必须**重新登录**取得新会话，否则一切都会变成 401 假失败。
    const outsiderRe = await login(outsiderA.email, PASSWORD);
    ok(
      !!outsiderRe.token,
      `5.0 反向回归前重新登录 outsider（HTTP ${outsiderRe.status}）`
    );
    const OUT = outsiderRe.token!;

    // 前置：outsider 在修复前不是组织管理员（无 OrganizationMember 记录）
    const before = await api("GET", "/api/knowledge/sources", OUT);
    ok(before.status === 403, `5.1 无成员记录时知识源不可读（HTTP ${before.status}，期望 403）`);

    // 触发自举路径：自建项目 → 成为该项目 OWNER
    const created = await api("POST", "/api/projects", OUT, {
      title: `${RUN_TAG} 自举探测项目`,
      target: "验证建项目不再产生组织级权限",
      mode: "NEW_PRODUCT",
    });
    ok(created.status === 201, `5.2 组织成员可创建自己的项目（HTTP ${created.status}，期望 201）`);

    const newProject = await prisma.project.findFirst({
      where: { organizationId: orgA.id, title: `${RUN_TAG} 自举探测项目` },
      select: { id: true },
    });
    ok(!!newProject, "5.3 自建项目确实落库");

    const membership = newProject
      ? await prisma.projectMember.findUnique({
          where: { projectId_userId: { projectId: newProject.id, userId: outsiderA.id } },
          select: { role: true },
        })
      : null;
    ok(
      membership?.role === "OWNER",
      `5.4 调用者在自建项目内确实是 OWNER（实测 ${membership?.role ?? "无成员行"}）—— 这正是修复前的自举前提`
    );

    // 核心断言：成为项目 OWNER **不再**带来组织级能力
    const after = await api("GET", "/api/knowledge/sources", OUT);
    ok(
      after.status === 403,
      `5.5 【核心】建项目成为 OWNER 后仍无法读知识源配置（HTTP ${after.status}，期望 403）`
    );
    ok(
      !after.text.includes("rootPath"),
      "5.6 知识源响应体未泄露服务器根路径（响应本身即为 403，此处防回归）"
    );

    const factWrite = await api("POST", "/api/knowledge/facts", OUT, {
      fieldKey: `${RUN_TAG}.bootstrap`,
      label: "自举探测",
      value: "x",
    });
    ok(
      factWrite.status < 200 || factWrite.status >= 300,
      `5.7 【核心】建项目成为 OWNER 后仍不能写公司事实（HTTP ${factWrite.status}，期望非 2xx）`
    );

    const orgRole = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgA.id, userId: outsiderA.id } },
      select: { role: true },
    });
    ok(orgRole === null, `5.8 自建项目未产生 OrganizationMember 记录（实测 ${orgRole?.role ?? "无"}）`);

    // 反向对照：真正持有 ORG_ADMIN 的身份走同样的路径应当通过 ——
    // 否则本场景可能只是「所有人都被拒」，而不是「收紧了自举」。
    const adminRe = await login(ownerA.email, PASSWORD);
    const adminRead = await api("GET", "/api/knowledge/sources", adminRe.token);
    ok(adminRead.status === 200, `5.9 反向对照：ORG_ADMIN 身份可读知识源（HTTP ${adminRead.status}，期望 200）`);
  }

  console.log("\n▶ 场景 6：跨组织信号存在性不泄漏（D-002）");
  {
    // 同场景 5：这两条链路都会被前面的遍历注销会话，必须重新登录。
    const outsiderRe = await login(outsiderA.email, PASSWORD);
    const foreignRe = await login(foreignB.email, PASSWORD);
    ok(
      !!outsiderRe.token && !!foreignRe.token,
      `6.0 反向回归前重新登录（outsider=${outsiderRe.status} foreign=${foreignRe.status}）`
    );
    const OUT = outsiderRe.token!;
    const FOR = foreignRe.token!;

    // 同一标题、同一来源、两个组织各录一次。
    // 修复前：后者会命中全局 hash 唯一键并返回 422「该信号已属于其他组织」——
    // 等于告诉对方「另一家公司已经录入过这个信号」。
    const title = `${RUN_TAG} 跨组织同标题探测`;

    const inA = await api("POST", "/api/signals", OUT, { title });
    const inB = await api("POST", "/api/signals", FOR, { title });

    ok(inA.status === 201, `6.1 组织 A 录入同标题信号成功（HTTP ${inA.status}，期望 201）`);
    ok(inB.status === 201, `6.2 【核心】组织 B 录入**同一标题**信号同样成功（HTTP ${inB.status}，期望 201）`);
    ok(
      !inB.text.includes("已属于其他组织"),
      "6.3 响应中不再出现「该信号已属于其他组织」（存在性泄漏措辞已移除）"
    );
    ok(!inB.text.includes(orgA.id), "6.4 组织 B 的响应不含组织 A 的标识");

    const rows = await prisma.signalItem.findMany({
      where: { title, organizationId: { in: [orgA.id, orgB.id] } },
      select: { id: true, organizationId: true, hash: true },
    });
    ok(rows.length === 2, `6.5 两组织各自持有独立记录（实际 ${rows.length} 条，期望 2）`);
    const rowA = rows.find((r) => r.organizationId === orgA.id);
    const rowB = rows.find((r) => r.organizationId === orgB.id);
    ok(!!rowA && !!rowB, "6.6 两条记录分属 A / B 两个组织");
    ok(rowA?.hash === rowB?.hash, "6.7 指纹相同（指纹只描述内容，隔离由组织维度保证）");
    ok(rowA?.id !== rowB?.id, "6.8 记录 id 不同，互不覆盖");

    // A 看不到 B 的信号行
    const listA = await api("GET", "/api/signals", OUT);
    ok(listA.status === 200, `6.9 组织 A 可列自己的信号（HTTP ${listA.status}）`);
    ok(!!rowB && !listA.text.includes(rowB.id), "6.10 组织 A 的信号列表中不含组织 B 的记录 id");
  }

  // ---------- 场景 6b：跨组织产品编码存在性不泄漏（D-001 修复后回归） ----------
  console.log("\n▶ 场景 6b：跨组织产品编码存在性不泄漏（D-001 修复）");
  {
    // 同场景 5/6：前面的遍历会注销会话，必须重新登录。
    const outsiderRe2 = await login(outsiderA.email, PASSWORD);
    const foreignRe2 = await login(foreignB.email, PASSWORD);
    ok(
      !!outsiderRe2.token && !!foreignRe2.token,
      `6b.0 反向回归前重新登录（outsider=${outsiderRe2.status} foreign=${foreignRe2.status}）`
    );
    const OUT2 = outsiderRe2.token!;
    const FOR2 = foreignRe2.token!;

    const code = `${RUN_TAG}-SHARED-CODE`;
    const productBody = {
      name: `${RUN_TAG} 跨组织同码产品`,
      identityCode: code,
      targetAudience: "矩阵人群",
      marketPath: "DOMESTIC",
      devMode: "SELF_DEVELOPED",
    };

    // 修复前：`identityCode` 全局唯一，组织 B 复用组织 A 已占用的码会拿到 409 ——
    // 等于确定地回答「这个编码已被占用」（跨组织存在性 oracle）。
    const pA = await api("POST", "/api/products", OUT2, productBody);
    const pB = await api("POST", "/api/products", FOR2, productBody);
    ok(pA.status === 201, `6b.1 组织 A 录入编码 ${code}（HTTP ${pA.status}，期望 201）`);
    ok(pB.status === 201, `6b.2 【核心】组织 B 复用**同一编码**同样成功（HTTP ${pB.status}，期望 201）`);
    ok(!pB.text.includes(orgA.id), "6b.3 组织 B 的响应不含组织 A 的标识");
    ok(pB.text.includes(code), "6b.4 201 响应确认落库的正是同一编码（未被服务端改名规避冲突）");

    // 约束只是收敛到组织范围，并未被取消：同一组织内复用同码仍 409
    const sameOrg = await api("POST", "/api/products", OUT2, productBody);
    ok(sameOrg.status === 409, `6b.5 同组织内复用同一编码 → HTTP ${sameOrg.status}（期望 409）`);

    const rows = await prisma.product.findMany({
      where: { identityCode: code },
      select: { id: true, organizationId: true },
    });
    ok(rows.length === 2, `6b.6 两组织各自持有独立产品（实际 ${rows.length} 条，期望 2）`);
    const rowA = rows.find((r) => r.organizationId === orgA.id);
    const rowB = rows.find((r) => r.organizationId === orgB.id);
    ok(!!rowA && !!rowB && rowA.id !== rowB.id, "6b.7 两条记录分属 A / B 且 id 不同，互不覆盖");

    // A 看不到 B 的同码产品
    const productListA = await api("GET", "/api/products", OUT2);
    ok(productListA.status === 200, `6b.8 组织 A 可列自己的产品（HTTP ${productListA.status}）`);
    ok(!!rowB && !productListA.text.includes(rowB.id), "6b.9 组织 A 的产品列表中不含组织 B 的同码产品 id");
  }

  // ---------- E 段：缺必填字段的写请求必须回 4xx（D-008 反向回归） ----------
  //
  // 由来的三个 500（它们此前都被 C 段当成「门禁已开」放行）：
  //   POST /api/projects/{id}/attachments   → req.formData() 抛原生 TypeError
  //   POST /api/projects/{id}/feedback      → Feedback.targetId（必填列）缺失
  //   POST /api/work-items/{id}/submissions → RunReceipt.inputRevision（必填列）缺失
  // 共同点：**调用方发错了**被当成**服务端崩了**（500），而生产环境响应体还被消毒成
  // 通用文案，调用方无从知道自己少了哪个字段。
  //
  // 只在 C 段断言「无 5xx」不够 —— 那只在每次都给对 body 时成立。
  // 这一段**故意发错的 body**，证明错误以 4xx 返回、且能点名缺失字段。
  console.log("\n▶ 场景 7：缺必填字段的写请求必须回 4xx，不得冒成 5xx（D-008）");
  {
    // C 段遍历包含 DELETE /api/auth/session（会注销会话），此处必须重新登录。
    const ownerRe7 = await login(ownerA.email, PASSWORD);
    ok(!!ownerRe7.token, `7.0 反向回归前重新登录 owner（HTTP ${ownerRe7.status}）`);
    const OW7 = ownerRe7.token!;

    const badCases: Array<{ label: string; url: string; body: unknown; want: number; field?: string }> = [
      {
        label: "POST /api/projects/{id}/attachments（发 JSON，非 multipart）",
        url: expand("/api/projects/{id}/attachments"),
        body: { file: "not-a-multipart-body" },
        want: 415,
      },
      {
        label: "POST /api/projects/{id}/feedback（缺 targetId）",
        url: expand("/api/projects/{id}/feedback"),
        body: { content: "缺 targetId 的反馈探测", targetType: "PROJECT" },
        want: 422,
        field: "targetId",
      },
      {
        label: "POST /api/work-items/{id}/submissions（缺 inputRevision）",
        url: expand("/api/work-items/{id}/submissions"),
        body: {
          runMode: "MANUAL",
          artifacts: [{ type: "RESEARCH_REPORT", title: "缺输入基线", content: "{}" }],
        },
        want: 422,
        field: "inputRevision",
      },
    ];

    let n7 = 0;
    for (const c of badCases) {
      const r = await api("POST", c.url, OW7, c.body);
      n7 += 1;
      ok(r.status < 500, `7.${n7}a 【核心】${c.label} → HTTP ${r.status}（不得为 5xx）`);
      ok(r.status === c.want, `7.${n7}b ${c.label} → HTTP ${r.status}（期望 ${c.want}）`);
      if (c.field) {
        ok(r.text.includes(c.field), `7.${n7}c 错误载荷点名缺失字段 ${c.field}（非泛化的 500 文案）`);
      }
    }
  }

  // ---------- F 段：写路由「入参健壮性」全量回归（D-011 / D-012 / D-015 / D-016 / D-017） ----------
  //
  // 由来：`src/shared/api-handler.ts` 的 `handleApiError` 曾把**任何非 AppError** 一律
  // 映射成 500，于是「调用方发错了」被当成「服务端崩了」。历次收口都发生在这里：
  //   D-011  `await req.json()` 收到空 body / 非法 JSON → 原生 SyntaxError → 500
  //   D-012  缺必填字段 / 类型不符冒到 Prisma → PrismaClientValidationError → 500
  //   D-015  Prisma **已知请求错误**全类未映射（唯一键/外键冲突、关系约束、目标记录不存在）→ 500。
  //          本批把 P2002/P2003/P2014 → 409、P2025 → 404；其余 Prisma code（连接故障等）仍 500。
  //   D-016  14 处 `req.json().catch(() => ({}))` 把**畸形 JSON 静默当空 body** —— 其中证据核实
  //          会把「驳回」静默翻成「通过」（fail-open）。本批统一改用 `readJsonObjectBody`
  //          （没 body → {}；畸形 → 抛 → 400；非对象 → 422）。
  //   D-017  缺必填字段冒到**原生 TypeError**（如 `params.targetAudience.trim()`）→ 500。
  // 场景 7 只覆盖了少量已修路由（9 条断言），其余写路由从未被探测。本场景**自动枚举**
  // 所有「会解析 JSON body」的写路由，用畸形载荷各探一遍，把这个尾巴钉死，并守住 D-016 复发。
  //
  // 三种解析姿势 + 探针是否非破坏性（关系数据安全，必须严格遵守）：
  //   raw    —— `await req.json()`（无 `.catch`）：解析失败会**抛异常**，且发生在任何业务逻辑
  //             **之前**；两种载荷（非法 JSON / 空 body）都撞在入口抛错，走不到写入 → 两种都探。
  //   helper —— `readJsonObjectBody(req)`：畸形 JSON 抛 → 400，同样走不到写入；但**空 body 对它是
  //             合法请求**（被当作 `{}` 继续进入业务逻辑、可能产生写入，例如 `POST /api/conversations`
  //             空 body → 201 建会话），因此 **helper 路由绝不探空 body**（只探非法 JSON）。
  //   caught —— `await req.json().catch(() => ({}))`：自行吞掉解析异常、拿空 body 继续跑业务逻辑
  //             （实测会真的建数据、返回 2xx）—— 这是 D-016 的缺陷形态，**断言必须为 0 条**。
  console.log("\n▶ 场景 8：写路由入参健壮性 —— 畸形 JSON / 降级写法不得放行（D-011 / D-016）");
  {
    // 前几段遍历包含 DELETE /api/auth/session（会注销会话），此处必须重新登录。
    const ownerRe8 = await login(ownerA.email, PASSWORD);
    ok(!!ownerRe8.token, `8.0 反向回归前重新登录 owner（HTTP ${ownerRe8.status}）`);
    const OW8 = ownerRe8.token!;

    // (1) 自动枚举：矩阵里所有 method !== "GET" 的登记项（不硬编码路由清单）
    const writeSpecs = AUTHZ_MATRIX.filter((r) => r.method !== "GET");

    // (2) 逐 (路由模板, 方法) 读源码，判断**该方法**如何解析 JSON body，四态：
    //       helper —— `readJsonObjectBody(req)`（D-016 后的标准姿势）；畸形 JSON 抛 → 400，
    //                 但空 body 是**合法**请求 → 只探非法 JSON（探空 body 会真的写数据）。
    //       raw    —— `await req.json()`：解析失败会**抛异常**，且发生在任何业务逻辑之前；
    //                 这正是 D-011 影响面 → 两种载荷都探（「非破坏性」由此成立）。
    //       caught —— `await req.json().catch(() => ({}))`：自行吞掉解析异常，畸形 JSON 被
    //                 当作空 body 继续进入业务逻辑，**可能产生写入并返回 2xx**。这是 D-016 的
    //                 缺陷形态 → **断言必须为 0 条**（需要容忍空 body 请改用 readJsonObjectBody）。
    //       none   —— 该方法根本不读 body → 跳过。
    //     必须按方法切分函数体：同一 route.ts 常并存 GET/POST/DELETE，若只按整文件正则，
    //     会把「同文件另一个方法读了 body」误判成本方法读了 body
    //     （实测：`DELETE /api/auth/session` 不读 body，却因文件里的 POST 命中而误纳）。
    const routeJsonMode = (template: string, method: string): "raw" | "helper" | "caught" | "none" => {
      const file = path.join(
        process.cwd(),
        "src",
        "app",
        template.replace(/^\//, "").replace(/\{\w+\}/g, (m) => `[${m.slice(1, -1)}]`),
        "route.ts"
      );
      let src = "";
      try {
        src = fs.readFileSync(file, "utf8");
      } catch {
        return "none";
      }
      const head = new RegExp(`export\\s+async\\s+function\\s+${method}\\b`).exec(src);
      if (!head) return "none";
      const rest = src.slice(head.index);
      const next = /export\s+async\s+function\s+\w+/.exec(rest.slice(head[0].length));
      const fnBody = next ? rest.slice(0, head[0].length + next.index) : rest;
      // 顺序：helper（标准姿势）→ raw（裸解析）→ caught（静默降级=缺陷形态）
      if (/readJsonObjectBody\(/.test(fnBody)) return "helper";
      if (/await\s+req\.json\(\)(?!\s*\.catch)/.test(fnBody)) return "raw";
      if (/await\s+req\.json\(\)/.test(fnBody)) return "caught";
      return "none";
    };

    const probed: RouteSpec[] = [];
    const helperProbed: RouteSpec[] = [];
    const caught: string[] = [];
    const noBody: string[] = [];
    for (const spec of writeSpecs) {
      const mode = routeJsonMode(spec.path, spec.method);
      if (mode === "raw") probed.push(spec);
      else if (mode === "helper") helperProbed.push(spec);
      else if (mode === "caught") caught.push(`${spec.method} ${spec.path}`);
      else noBody.push(`${spec.method} ${spec.path}`);
    }
    console.log(
      `   写路由登记 ${writeSpecs.length} 条 → 裸解析(raw)探测 ${probed.length} 条；` +
        `helper(readJsonObjectBody)探测 ${helperProbed.length} 条；` +
        `自兜底(caught) ${caught.length} 条；未读 body ${noBody.length} 条`
    );
    console.log(`   未读 body 跳过 ${noBody.length} 条：${noBody.join("、") || "无"}`);
    console.log(
      `   helper 路由（只探非法 JSON，**不探空 body**，因空 body 对它们是合法写入请求）：` +
        `${helperProbed.map((s) => `${s.method} ${s.path}`).join("、") || "无"}`
    );

    // 【守卫】不得再有 req.json().catch(() => ({})) 静默降级写法 —— 防止 D-016 复发。
    ok(
      caught.length === 0,
      `8.0b 【核心】不得再有 req.json().catch(() => ({})) 静默降级写法（D-016）；` +
        `需要容忍空 body 请用 readJsonObjectBody。遗留 ${caught.length} 条：${caught.join("、") || "无"}`
    );

    // (3) 探针：raw 与 helper 都探「非法 JSON」；**只有 raw 探「空 body」**
    //     （helper 的空 body 是合法请求，会真的走进业务逻辑并产生写入 → 绝不探）。
    let invalid5xx = 0;
    let empty5xx = 0;
    const table: Array<{ route: string; mode: string; invalid: number; empty: string }> = [];
    let n8 = 0;
    const probeOne = async (spec: RouteSpec, mode: "raw" | "helper") => {
      const url = urlFor(spec);
      n8 += 1;
      // 非法 JSON：原样发单个 `{`（缺右括号，引擎必然解析失败）
      const invalid = await apiRaw(spec.method, url, OW8, "{");
      if (invalid.status >= 500) invalid5xx += 1;
      ok(
        invalid.status < 500,
        `8.${n8}a 【核心】${spec.method} ${spec.path} · 非法 JSON → HTTP ${invalid.status}（不得为 5xx）`
      );
      ok(
        invalid.status < 200 || invalid.status >= 300,
        `8.${n8}b 【核心】${spec.method} ${spec.path} · 非法 JSON 不得得到 2xx（实测 ${invalid.status}）`
      );

      let emptyLabel = "—(helper 不探)";
      if (mode === "raw") {
        // 空 body：不传 body（引擎抛 "Unexpected end of JSON input"）。仅 raw 可探：
        // 解析失败发生在业务逻辑之前，走不到写入，故非破坏性。
        const empty = await apiRaw(spec.method, url, OW8, undefined);
        if (empty.status >= 500) empty5xx += 1;
        emptyLabel = String(empty.status);
        ok(
          empty.status < 500,
          `8.${n8}c 【核心】${spec.method} ${spec.path} · 空 body → HTTP ${empty.status}（不得为 5xx）`
        );
      }
      table.push({ route: `${spec.method} ${spec.path}`, mode, invalid: invalid.status, empty: emptyLabel });
    };

    for (const spec of probed) await probeOne(spec, "raw");
    for (const spec of helperProbed) await probeOne(spec, "helper");

    console.log("   —— 探针对照表（mode / 非法JSON / 空body） ——");
    for (const row of table) {
      console.log(
        `      ${String(row.mode).padEnd(6)} ${String(row.invalid).padStart(3)} / ${String(row.empty).padStart(11)}  ${row.route}`
      );
    }
    console.log(
      `   —— 小结：非法 JSON 冒 5xx ${invalid5xx} 条；空 body 冒 5xx ${empty5xx} 条` +
        `（raw ${probed.length} + helper ${helperProbed.length} = ${table.length} 条探测；caught ${caught.length} 条） ——`
    );
  }

  // ---------- 汇总 ----------
  console.log("\n" + "=".repeat(80));
  if (failures.length === 0) {
    console.log(`🏆 权限矩阵回归全绿：${passed} 项断言全部通过`);
  } else {
    console.log(`❌ 权限矩阵回归失败 ${failures.length} 项 / 通过 ${passed} 项：`);
    failures.forEach((f) => console.log(`   - ${f}`));
  }
  console.log("=".repeat(80) + "\n");

  } finally {
    // ---------- 清理：无论断言是否抛错都必须执行 ----------
    await cleanup().catch((e) => console.error("清理失败:", e));
    console.log("🧹 已清理本套夹具");
  }

  await prisma.$disconnect();
  if (failures.length > 0) process.exitCode = 1;
}

main().catch(async (e) => {
  console.error("❌ 权限矩阵回归异常终止:", e?.message || e);
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
