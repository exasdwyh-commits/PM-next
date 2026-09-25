/**
 * 产品研发垂直切片 · 实时端到端冒烟（Live E2E Smoke）
 * ============================================================================
 *
 * 为什么单独存在这一套：既有的覆盖是**正交但不相交**的两半 ——
 *
 *   · `tests/worker-executor.ts`（W1–W9）：链路最深，但全部走「服务函数直调」，
 *     没有任何一步经过真实 HTTP 入口；
 *   · `tests/acceptance-*.test.ts`（product-center / authz-matrix / b01-http）：
 *     全部走真实 HTTP（生产模式 `next start`），但最深的业务链路只到
 *     「产品 / 版本 / 结构化成果」，**从未触达 Product R&D 编排**。
 *
 * 于是「brief → 分析 → 派单 → Worker 执行 → 独立 QA → 证据 → 回执 → 报告」
 * 这条完整链路**没有一个套件是端到端跑通过的**。本套就是补这一格：
 * 产品面全部走真实 HTTP，后台部分走各自真实的入口模块。
 *
 * ## 各部分由谁驱动，以及为什么
 *
 * | 环节 | 驱动方式 | 理由 |
 * | --- | --- | --- |
 * | 登录 / START / 状态 / 证据录入与核验 / SYNTHESIZE | **真实 HTTP** | 这些是产品面对外契约，必须经路由、鉴权、序列化 |
 * | Worker 四个 loop | `runPmWorker()` 库入口 | Worker 本就是**独立进程**，与 Web 服务不同生命周期；其进程级语义（单实例锁、常驻）已由 worker-executor W8 覆盖 |
 * | 独立 QA 完成 | `startAgentTask` / `finishAgentTask` | **QA 按设计不由 Worker 执行**（见 DESIGN 三章）；独立执行方是另一条身份，属外部主体 |
 *
 * 明确不覆盖（不要在本套里找）：
 *   · 真 LLM 的语义质量 —— 断言只看**结构与不变量**，不评判措辞；
 *   · 多进程 Worker 的并发抢单 —— 属 worker-executor W7/W8 的领地；
 *   · 浏览器渲染 —— 属 ui-b01-evidence / ui-feedback-layer / verify-executive-report-ui.mjs。
 *
 * 夹具自建自清，只清理本套创建的组织；不写入任何真实业务数据。
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import { AgentTaskStatus, OrgRole, ResearchRunStatus, Role } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { hashPassword } from "../src/modules/identity/session";
import { bootstrapDefaultWorkforce, finishAgentTask, startAgentTask } from "../src/modules/workforce/service";
import { runPmWorker } from "../src/modules/worker";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3180";
const RUN_TAG = `prde2e${Date.now()}`;
const PASSWORD = `Prd-E2e-${crypto.randomBytes(6).toString("hex")}!`;

const SPECIALIST_CODES = [
  "research_agent",
  "scientific_evidence_agent",
  "formulation_agent",
  "compliance_agent",
  "cost_bom_agent",
] as const;

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

/** 会话 Cookie 罐：模拟浏览器携带 Cookie 的真实调用（与 acceptance-product-center 同款）。 */
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

/**
 * 登录并取出会话令牌。Phase 3A·B6 之后登录响应体不再回传 token（只走 httpOnly Cookie），
 * 故从 Set-Cookie 中取出令牌：既作 Cookie 罐的键，也作 Bearer。
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

  console.log("=".repeat(80));
  console.log("🧪 产品研发垂直切片 · 实时端到端冒烟");
  console.log(`    BASE_URL=${BASE}`);
  console.log("=".repeat(80) + "\n");

  const org = await prisma.organization.create({
    data: { code: `${RUN_TAG}_A`, name: "产品研发 E2E 机构（合成夹具）" },
  });
  const otherOrg = await prisma.organization.create({
    data: { code: `${RUN_TAG}_B`, name: "产品研发 E2E 外机构（合成夹具）" },
  });

  const mkUser = (email: string, name: string, organizationId: string) =>
    prisma.user.create({
      data: { email, name, organizationId, passwordHash: hashPassword(PASSWORD) },
    });

  const owner = await mkUser(`${RUN_TAG}-owner@hermes.test`, "研发负责人", org.id);
  const viewer = await mkUser(`${RUN_TAG}-viewer@hermes.test`, "只读成员", org.id);
  const foreign = await mkUser(`${RUN_TAG}-foreign@hermes.test`, "跨组织用户", otherOrg.id);
  await prisma.organizationMember.create({
    data: { organizationId: org.id, userId: owner.id, role: OrgRole.ORG_ADMIN },
  });

  const project = await prisma.project.create({
    data: {
      organizationId: org.id,
      title: `${RUN_TAG} 餐前轻体饮研发`,
      target: "评估市场、配方、成本与法规是否具备打样条件",
      constraints: "不把模型意见当事实；关键合规与功效结论必须有证据",
      ownerId: owner.id,
      members: {
        create: [
          { userId: owner.id, role: Role.OWNER },
          { userId: viewer.id, role: Role.VIEWER },
        ],
      },
    },
  });

  // 数字员工编制是 START 的前置（缺 agent 会 bootstrapIncomplete）。
  // 这里用服务入口建立编制，属**夹具准备**，不是被测链路。
  await bootstrapDefaultWorkforce({
    userId: owner.id,
    organizationId: org.id,
    userEmail: owner.email,
    userName: owner.name,
  });

  const brief =
    "开发一个面向 25-45 岁女性的餐前轻体饮，重点评估市场、AOS/膳食纤维配方、成本与中国法规。";

  try {
    const ownerLogin = await login(owner.email, PASSWORD);
    ok(ownerLogin.status === 200 && !!ownerLogin.token, `0.0 负责人登录成功（HTTP ${ownerLogin.status}）`);
    const token = ownerLogin.token!;

    // ---------------------------------------------------------------- 1. HTTP 边界
    console.log("\n▶ 1 产品研发入口的 HTTP 边界（匿名 / 只读 / 跨组织 / 缺参）");

    const anonStart = await api("POST", `/api/projects/${project.id}/product-rnd`, {
      body: { action: "START", brief },
    });
    ok(anonStart.status === 401, `1.1 匿名 START 被拒（HTTP ${anonStart.status}）`);

    const viewerLogin = await login(viewer.email, PASSWORD);
    const viewerStart = await api("POST", `/api/projects/${project.id}/product-rnd`, {
      token: viewerLogin.token,
      body: { action: "START", brief },
    });
    ok(viewerStart.status === 403, `1.2 只读成员 START 被拒（HTTP ${viewerStart.status}）`);

    const foreignLogin = await login(foreign.email, PASSWORD);
    const foreignStart = await api("POST", `/api/projects/${project.id}/product-rnd`, {
      token: foreignLogin.token,
      body: { action: "START", brief },
    });
    ok(
      foreignStart.status === 403,
      `1.3 跨组织 START 被拒（HTTP ${foreignStart.status}，与 authz 矩阵基线一致）`
    );

    const missingParam = await api("GET", `/api/projects/${project.id}/product-rnd`, { token });
    ok(missingParam.status === 422, `1.4 GET 缺 workItemId 返回 422（HTTP ${missingParam.status}）`);

    const badAction = await api("POST", `/api/projects/${project.id}/product-rnd`, {
      token,
      body: { action: "NOT_A_REAL_ACTION" },
    });
    ok(badAction.status === 422, `1.5 未知 action 返回 422（HTTP ${badAction.status}）`);

    // ---------------------------------------------------------------- 2. HTTP START
    console.log("\n▶ 2 HTTP START：一次请求建立工作项 + 主任务 + 五路派单 + 研究运行");

    const started = await api("POST", `/api/projects/${project.id}/product-rnd`, {
      token,
      body: { action: "START", brief },
    });
    ok(started.status === 201, `2.1 START 返回 201（HTTP ${started.status}）`);
    const program = started.json ?? {};
    const workItemId: string = program.workItem?.id ?? "";
    const parentTaskId: string = program.parentTask?.id ?? "";
    ok(!!workItemId && !!parentTaskId, "2.2 响应带 workItem.id 与 parentTask.id");
    ok(program.workItem?.executorType === "DIGITAL_WORKER", `2.3 工作项执行人类型为数字员工（${program.workItem?.executorType}）`);
    ok(
      Array.isArray(program.specialistTasks) && program.specialistTasks.length === 5,
      `2.4 派单 5 路专家（实际 ${program.specialistTasks?.length}）`
    );
    ok(
      new Set((program.specialistTasks ?? []).map((row: any) => row.code)).size === 5 &&
        SPECIALIST_CODES.every((code) =>
          (program.specialistTasks ?? []).some((row: any) => row.code === code)
        ),
      "2.5 五路专家编码完整且互不重复"
    );
    ok(program.parentRun?.status === "RUNNING", `2.6 主任务已有运行回执（status=${program.parentRun?.status}）`);
    ok(!!program.researchRun?.id, "2.7 同步建立研究运行（ResearchRun）");

    const retried = await api("POST", `/api/projects/${project.id}/product-rnd`, {
      token,
      body: { action: "START", brief: `${brief}（同一次请求重试）` },
    });
    ok(retried.json?.reused === true, "2.8 重复 START 命中幂等复用（reused=true）");
    ok(retried.json?.workItem?.id === workItemId, "2.9 幂等复用同一工作项，不新建第二个");
    ok(
      (await prisma.workItem.count({
        where: {
          projectId: project.id,
          title: "产品研发综合评估",
          status: { in: ["TODO", "RUNNING", "SUBMITTED", "CHANGES_REQUESTED"] },
        },
      })) === 1,
      "2.10 活跃的「产品研发综合评估」工作项恰好 1 个"
    );

    // ---------------------------------------------------------------- 3. HTTP 状态查询
    console.log("\n▶ 3 HTTP 状态查询：负责人视图契约");

    const statusBefore = await api(
      "GET",
      `/api/projects/${project.id}/product-rnd?workItemId=${workItemId}`,
      { token }
    );
    ok(statusBefore.status === 200, `3.1 GET 状态返回 200（HTTP ${statusBefore.status}）`);
    ok(statusBefore.json?.parentTaskId === parentTaskId, "3.2 状态回传 parentTaskId");
    ok(
      Array.isArray(statusBefore.json?.tasks) && statusBefore.json.tasks.length === 5,
      `3.3 状态列出 5 路子任务（实际 ${statusBefore.json?.tasks?.length}）`
    );
    ok(statusBefore.json?.latestReport === null, "3.4 尚未 QA 时不得凭空给出报告（latestReport=null）");

    const crossTenant = await api(
      "GET",
      `/api/projects/${project.id}/product-rnd?workItemId=${workItemId}`,
      { token: foreignLogin.token }
    );
    ok(crossTenant.status === 403, `3.5 跨组织读取状态被拒（HTTP ${crossTenant.status}）`);

    // ---------------------------------------------------------------- 4. HTTP 证据录入与核验
    console.log("\n▶ 4 HTTP 证据：录入 + 负责人独立核验（为报告提供可追溯来源）");

    const evidenceRes = await api("POST", `/api/projects/${project.id}/evidences`, {
      token,
      body: {
        contentOrUri: "https://www.fda.gov/example-product-rnd-e2e",
        source: "FDA",
        author: "FDA",
        nature: "REAL",
        claims: [
          {
            fieldKey: "regulatoryExample",
            fieldName: "法规示例事实",
            kind: "FACT",
            value: "FDA approved product X on September 24 2026.",
          },
        ],
      },
    });
    ok(evidenceRes.status === 201, `4.1 负责人录入证据成功（HTTP ${evidenceRes.status}）`);
    const evidenceId: string = evidenceRes.json?.id ?? "";
    ok(!!evidenceId, "4.2 响应回传证据 id");
    ok(
      evidenceRes.json?.verifyStatus === "UNVERIFIED",
      `4.3 新建证据一律 UNVERIFIED，客户端不能自带 VERIFIED（实际 ${evidenceRes.json?.verifyStatus}）`
    );
    ok(
      (await prisma.evidenceClaim.count({ where: { evidenceId } })) === 1,
      "4.4 随证据落库 1 条结构化断言（claim）"
    );

    const viewerEvidence = await api("POST", `/api/projects/${project.id}/evidences`, {
      token: viewerLogin.token,
      body: { contentOrUri: "https://example.com/x", source: "self" },
    });
    ok(viewerEvidence.status === 403, `4.5 只读成员录入证据被拒（HTTP ${viewerEvidence.status}）`);

    const verifyRes = await api("POST", `/api/evidences/${evidenceId}/verify`, {
      token,
      body: { status: "VERIFIED" },
    });
    ok(verifyRes.status === 200, `4.6 负责人独立核验证据成功（HTTP ${verifyRes.status}）`);
    ok(
      verifyRes.json?.verifyStatus === "VERIFIED",
      `4.7 证据状态转为 VERIFIED（实际 ${verifyRes.json?.verifyStatus}）`
    );

    // ---------------------------------------------------------------- 5. Worker 真实推进
    console.log("\n▶ 5 Worker 单轮：研究自主发布 + 五路专家自动终结（含诚实 BLOCKED）");

    const workerSummary = await runPmWorker({
      once: true,
      ignoreLock: true,
      quiet: true,
      organizationId: org.id,
      executorBatch: 10,
    });
    ok(workerSummary.stoppedBy === "once", `5.1 Worker 单轮正常收尾（stoppedBy=${workerSummary.stoppedBy}）`);
    for (const loop of ["executor", "research", "reconcile", "event"] as const) {
      const result = workerSummary.results[loop];
      ok(!!result, `5.2 ${loop} loop 有结果对象`);
      ok((result?.errors ?? 0) === 0, `5.3 ${loop} loop 无错误（notes: ${result?.notes?.join("; ") || "无"}）`);
    }

    const research = await prisma.researchRun.findUniqueOrThrow({
      where: { id: program.researchRun.id },
      select: { status: true },
    });
    ok(
      research.status === ResearchRunStatus.PUBLISHED,
      `5.4 关掉浏览器后 ResearchRun 自主推进到 PUBLISHED（实际 ${research.status}）`
    );

    const specialists = await prisma.agentTask.findMany({
      where: { parentTaskId, agent: { code: { in: [...SPECIALIST_CODES] } } },
      include: {
        agent: { select: { code: true } },
        runs: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    ok(specialists.length === 5, `5.5 五路子任务仍在（实际 ${specialists.length}）`);
    const byCode = new Map(specialists.map((task) => [task.agent.code, task]));
    ok(
      specialists.every(
        (task) => task.status !== AgentTaskStatus.QUEUED && task.status !== AgentTaskStatus.RUNNING
      ),
      "5.6 没有子任务被留在 QUEUED/RUNNING（Worker 必须把它们推到终态）"
    );
    ok(
      byCode.get("research_agent")?.status === AgentTaskStatus.SUCCEEDED,
      `5.7 research_agent 成功（实际 ${byCode.get("research_agent")?.status}）`
    );
    // 关键不变量：执行器的判据是**项目里真实的证据**，不是任务的标签。
    // 本场景在第 4 步已通过 HTTP 录入并核验了 1 条证据，因此：
    //   · 科学证据 / 合规 两路拿到可分析输入 → 可评审（SUCCEEDED），而不是装作没数据；
    //   · 配方 / 成本 两路依旧没有任何真实输入 → 必须诚实 BLOCKED，不许编造数字。
    // 若哪天有人把这两个策略改成「无论如何都 BLOCKED」，本条会红 —— 那正是要拦的回归。
    ok(
      byCode.get("scientific_evidence_agent")?.status === AgentTaskStatus.SUCCEEDED,
      `5.8a 有证据时科学证据路可评审（实际 ${byCode.get("scientific_evidence_agent")?.status}）`
    );
    ok(
      byCode.get("compliance_agent")?.status === AgentTaskStatus.SUCCEEDED,
      `5.8b 有证据时合规路可评审（实际 ${byCode.get("compliance_agent")?.status}）`
    );
    ok(
      ["formulation_agent", "cost_bom_agent"].every(
        (code) => byCode.get(code)?.status === AgentTaskStatus.BLOCKED
      ),
      `5.8c 无真实数据的配方/成本两路诚实 BLOCKED（实际 ${["formulation_agent", "cost_bom_agent"]
        .map((code) => `${code}=${byCode.get(code)?.status}`)
        .join(" ")}）`
    );
    ok(
      specialists.every((task) => (task.runs[0]?.outputSummary ?? "").length > 0),
      "5.9 每个子任务都有 AgentRun 执行回执与摘要"
    );

    const gaps = await prisma.dataGap.findMany({
      where: { projectId: project.id },
      select: { fieldKey: true },
    });
    const gapKeys = new Set(gaps.map((row) => row.fieldKey));
    ok(
      ["formulation_constraints", "cost_basis", "regulatory_basis"].every((key) =>
        gapKeys.has(key)
      ),
      `5.10 缺数据如实落 DataGap（实际 ${[...gapKeys].join(", ")}）`
    );
    // 反向断言同样是回归锁：证据已存在时**不得**再报「项目内没有任何证据资料」。
    ok(
      !gapKeys.has("scientific_evidence"),
      "5.11 已录入证据时不得虚报「项目内没有任何证据资料」缺口"
    );
    // 这条缺口是系统**自己**发现的：claim 只有证据级 VERIFIED，没有 claim 级
    // SUPPORTED 来源核验，故证据链未闭合。它直接对应报告诚实性规则里的
    // 「结论缺少 SUPPORTED 来源验证」，是本套最值得锁的一条语义。
    ok(
      gapKeys.has("claim_evidence_closure"),
      "5.12 未获来源支撑的 claim 应如实登记 claim 证据闭合缺口"
    );
    ok(
      !gapKeys.has("evidence_claim_extraction"),
      "5.13 已抽取 claim 的证据不应被报成「尚未结构化」"
    );

    // ---------------------------------------------------------------- 6. QA 独立性与排队
    console.log("\n▶ 6 QA 独立性：Worker 不得执行 QA，但必须把槽位排上");

    const qaBefore = await prisma.agentTask.findMany({
      where: { parentTaskId, agent: { code: "qa_verifier" } },
      select: { id: true, status: true },
    });
    ok(qaBefore.length === 1, `6.1 专家终态后恰好排队 1 个 QA（实际 ${qaBefore.length}）`);
    ok(qaBefore[0]?.status === AgentTaskStatus.QUEUED, `6.2 QA 处于 QUEUED 等待独立执行方（实际 ${qaBefore[0]?.status}）`);

    const secondPass = await runPmWorker({
      once: true,
      ignoreLock: true,
      quiet: true,
      organizationId: org.id,
      executorBatch: 10,
    });
    ok((secondPass.results.executor?.acted ?? 0) === 0, "6.3 再跑一轮 executor 无新动作（幂等，且不碰 QA）");
    const qaAfter = await prisma.agentTask.findUniqueOrThrow({
      where: { id: qaBefore[0].id },
      select: { status: true },
    });
    ok(
      qaAfter.status === AgentTaskStatus.QUEUED,
      `6.4 Worker 未擅自执行 QA（仍为 ${qaAfter.status} —— 独立性由设计保证）`
    );
    ok(
      (await prisma.agentRun.count({ where: { agentTaskId: qaBefore[0].id } })) === 0,
      "6.5 QA 没有任何 Worker 产生的运行回执"
    );

    // ---------------------------------------------------------------- 7. 独立 QA 完成 → 报告自动合成
    console.log("\n▶ 7 独立 QA 完成 → 报告自动落盘");

    const qaStarted = await startAgentTask(
      { userId: owner.id, organizationId: org.id, userEmail: owner.email, userName: owner.name },
      qaBefore[0].id
    );
    await finishAgentTask(
      { userId: owner.id, organizationId: org.id, userEmail: owner.email, userName: owner.name },
      qaBefore[0].id,
      {
        runId: qaStarted.run.id,
        outcome: "SUCCEEDED",
        resultSummary: "独立 QA 完成：已核对证据、UNKNOWN、专业边界与来源独立性，报告可提交负责人审查。",
      }
    );

    const reportArtifacts = await prisma.artifact.findMany({
      where: { workItemId, type: "PRODUCT_RND_EXECUTIVE_REPORT" },
      orderBy: { contentVersion: "desc" },
    });
    ok(reportArtifacts.length >= 1, `7.1 QA 完成后报告自动落盘（实际 ${reportArtifacts.length} 份）`);
    const report = JSON.parse(reportArtifacts[0].content) as {
      verificationStatus: string;
      conclusions: Array<{ evidenceLevel: string }>;
      unknowns: string[];
      risks: string[];
      sourceRefs: unknown[];
      knowledgeDebtRefs: unknown[];
      advisoryNotes: Array<{ agentCode: string; summary: string | null }>;
    };
    ok(
      report.verificationStatus === "READY_FOR_HUMAN_REVIEW",
      `7.2 报告就绪待人工审查（实际 ${report.verificationStatus}）`
    );
    ok(report.sourceRefs.length >= 1, `7.3 报告绑定到真实来源（sourceRefs=${report.sourceRefs.length}）`);
    ok(
      report.advisoryNotes.some((note) => note.agentCode === "research_agent" && !!note.summary),
      "7.4 研究报告摘要进入报告（回执 → 报告的可追溯链）"
    );

    // ---------------------------------------------------------------- 8. HTTP 读回报告
    console.log("\n▶ 8 HTTP 读回负责人视图：报告必须可读且不得直出原始 JSON");

    const statusAfter = await api(
      "GET",
      `/api/projects/${project.id}/product-rnd?workItemId=${workItemId}`,
      { token }
    );
    ok(statusAfter.status === 200, `8.1 GET 状态 200（HTTP ${statusAfter.status}）`);
    const preview = statusAfter.json?.latestReport?.preview;
    ok(!!preview, "8.2 状态带裁剪后的报告预览（preview）");
    ok(
      preview?.verificationStatus === "READY_FOR_HUMAN_REVIEW",
      `8.3 预览同步报告状态（实际 ${preview?.verificationStatus}）`
    );
    ok(Array.isArray(preview?.unknowns) && preview.unknowns.length > 0, `8.4 预览含未闭合项 ${preview?.unknowns?.length} 条`);
    ok(Array.isArray(preview?.risks) && preview.risks.length > 0, `8.5 预览含风险项 ${preview?.risks?.length} 条`);
    ok(
      statusAfter.json?.latestReport?.content === undefined,
      "8.6 状态接口不回传原始 artifact.content（裁剪在服务端完成）"
    );

    // ---------------------------------------------------------------- 9. HTTP SYNTHESIZE 幂等
    console.log("\n▶ 9 HTTP SYNTHESIZE：幂等复用存档，不产生第二份报告");

    const synthesize = await api("POST", `/api/projects/${project.id}/product-rnd`, {
      token,
      body: { action: "SYNTHESIZE", workItemId, parentTaskId },
    });
    ok(synthesize.status === 201, `9.1 SYNTHESIZE 返回 201（HTTP ${synthesize.status}）`);
    ok(synthesize.json?.artifact?.type === "PRODUCT_RND_EXECUTIVE_REPORT", "9.2 返回的报告工件类型正确");
    ok(
      (await prisma.artifact.count({
        where: { workItemId, type: "PRODUCT_RND_EXECUTIVE_REPORT" },
      })) === 1,
      "9.3 报告工件仍为 1 份（结论性工件不可事后重复生成）"
    );

    // ---------------------------------------------------------------- 10. 诚实性与终态
    console.log("\n▶ 10 诚实性与终态：缺口必须写进未闭合项，不得呈现为健康报告");

    ok(
      report.unknowns.some((item) => item.includes("配方")),
      "10.1 未闭合项列出配方缺口"
    );
    ok(
      report.unknowns.some((item) => item.includes("成本")),
      "10.2 未闭合项列出成本缺口"
    );
    ok(
      report.unknowns.some((item) => item.includes("未绑定任何结构化证据")) === false,
      "10.3 本场景已绑定证据，零证据守卫**不应**误报"
    );
    ok(report.knowledgeDebtRefs.length === 0 || Array.isArray(report.knowledgeDebtRefs), "10.4 知识债字段存在且类型正确");
    ok(
      report.conclusions.every((claim) => typeof claim.evidenceLevel === "string"),
      "10.5 每条结论都带证据等级标注（UNKNOWN 也必须是显式等级）"
    );

    const finalWorkItem = await prisma.workItem.findUniqueOrThrow({
      where: { id: workItemId },
      select: { status: true },
    });
    ok(finalWorkItem.status === "SUBMITTED", `10.6 工作项进入待验收终态（实际 ${finalWorkItem.status}）`);
    const finalParent = await prisma.agentTask.findUniqueOrThrow({
      where: { id: parentTaskId },
      select: { status: true },
    });
    ok(finalParent.status === AgentTaskStatus.SUCCEEDED, `10.7 主任务终态为成功（实际 ${finalParent.status}）`);

    const auditCount = await prisma.auditEvent.count({ where: { actorId: owner.id } });
    ok(auditCount > 0, `10.8 全链路留下审计痕迹（本负责人 ${auditCount} 条）`);
  } finally {
    // 清理必须按 FK 安全顺序：AuditEvent.actorId 为 RESTRICT，须先清审计行再删用户。
    const orgUserIds = (
      await prisma.user
        .findMany({ where: { organizationId: org.id }, select: { id: true } })
        .catch(() => [] as Array<{ id: string }>)
    ).map((row) => row.id);
    await prisma.businessEvent.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.workSubmission
      .deleteMany({ where: { workItem: { project: { organizationId: org.id } } } })
      .catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: orgUserIds } } }).catch(() => {});
    await prisma.researchRun
      .deleteMany({ where: { createdById: { in: orgUserIds } } })
      .catch(() => {});
    await prisma.agentRun.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.analysisRun.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => {});
    await prisma.organization.delete({ where: { id: otherOrg.id } }).catch(() => {});
    console.log("\n🧹 已清理本套夹具（组织 / 用户 / 项目 / 工作项 / 运行回执）");
  }

  console.log("\n" + "=".repeat(80));
  if (failures.length === 0) {
    console.log(`🏆 产品研发实时端到端冒烟全绿：${passed} 项断言全部通过`);
  } else {
    console.log(`❌ 产品研发实时端到端冒烟失败 ${failures.length} 项 / 通过 ${passed} 项：`);
    failures.forEach((item) => console.log(`   - ${item}`));
  }
  console.log("=".repeat(80) + "\n");

  await prisma.$disconnect();
  if (failures.length > 0) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error("❌ 产品研发实时端到端冒烟异常终止:", error?.message || error);
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
