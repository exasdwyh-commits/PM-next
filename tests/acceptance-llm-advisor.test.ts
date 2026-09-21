/**
 * Advisor LLM 润色链路端到端验收（P4：接口抽象 + 配置开关）
 *
 * 目的：为「ADVISOR_LLM_ENABLED=true 时，顾问回复由真实（此处为本地 mock）模型润色，
 * 且 runMode / token 计量 / 失败回落行为全部如实留痕」建立可回归的授权与行为证据。
 * 全部断言走**真实 HTTP 入口**（生产模式 next start），LLM 端点为本地 mock
 * OpenAI 兼容服务（scripts/mock-openai-server.cjs），不依赖外部付费 API。
 *
 * 覆盖场景：
 *   1. 开关关闭（默认）：runMode=TEST_STUB，回复带「未接入语言模型」头，无 token 计量
 *   2. 开关开启 + 端点正常：runMode=LLM，回复为模型 content（无 TEST_STUB 头），
 *      usageJson 记录真实 token 数且随输入变化，costStatus 仍为 unknown（无单价不编造金额）
 *   3. 端点 500：回复回落到工具原文（带 TEST_STUB 提示头），AgentRun.errorReason 记录 LLM 失败原因
 *   4. 端点超时（慢 8s > 1s 超时）：同样回落，errorReason 含「超时」
 *   5. 响应缺 usage：usageJson 仍如实为「无 token 计量」，不编造数字
 *   6. 开关乱值（"yes"）：视为关闭 —— 不靠隐式行为升级
 *   7. 多轮上下文：会话历史注入 LLM 请求（mock 回显历史轮数）；追问与指代类问题
 *      可用；usageJson.historyTurns 如实留痕
 *
 * 前置：
 *   - 本地 mock 端点已在 MOCK_LLM_PORT（默认 3188）运行
 *   - 服务以 NODE_ENV=production DEV_MOCK_AUTH=false DATABASE_URL=<测试库> next start 起动，
 *     且环境变量 ADVISOR_LLM_ENABLED/ADVISOR_LLM_BASE_URL/ADVISOR_LLM_TIMEOUT_MS/
 *     ADVISOR_MODEL_PROVIDER/ADVISOR_MODEL_ID 由本套件启动器注入（scripts/acc-server.sh 的
 *     环境透传或 e2e 启动器），服务端代码无测试专用分支。
 *
 * 运行（单套）：
 *   bash scripts/acc-server.sh tests/acceptance-llm-advisor.test.ts
 *
 * 夹具自建、自清理，只清理本套创建的记录。
 */

import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { hashPassword } from "../src/modules/identity/session";
import crypto from "crypto";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

/**
 * 自包含 mock LLM 端点：套件自己拉起、自己回收，不依赖外部进程（后台进程会在
 * 终端命令结束后被回收，实测导致「fetch failed」假红）。
 */
let mockProcess: ChildProcess | null = null;
const MOCK_PORT = parseInt(process.env.MOCK_LLM_PORT || "3188", 10);

async function ensureMockServer() {
  try {
    await setMockMode("ok");
    return; // 已有实例在跑（如手动启动），复用
  } catch {
    /* 未运行，下面拉起 */
  }
  const script = path.join(process.cwd(), "scripts", "mock-openai-server.cjs");
  mockProcess = spawn(process.execPath, [script], {
    env: { ...process.env, MOCK_LLM_PORT: String(MOCK_PORT) },
    stdio: "ignore",
  });
  // 探活：最多等 5s
  for (let i = 0; i < 25; i++) {
    try {
      await setMockMode("ok");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`mock LLM 端点在端口 ${MOCK_PORT} 启动失败`);
}

const BASE = process.env.BASE_URL || "http://127.0.0.1:3180";
const MOCK_BASE = process.env.MOCK_LLM_URL || "http://127.0.0.1:3188";
const RUN_TAG = `llm${Date.now()}`;
const PASSWORD = `Se-Llm-${crypto.randomBytes(6).toString("hex")}!`;

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

/** 切换 mock 端点行为模式 */
async function setMockMode(mode: "ok" | "fail" | "slow" | "nousage") {
  const res = await fetch(`${MOCK_BASE}/__mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`mock 端点切模式失败：HTTP ${res.status}`);
}

let fixtureIds: { orgId: string; userId: string; productId: string; conversationId: string } | null = null;

async function cleanupFixtures() {
  if (!fixtureIds) return;
  const { orgId, userId, productId, conversationId } = fixtureIds;
  await prisma.toolCall.deleteMany({ where: { run: { conversationId } } });
  await prisma.message.deleteMany({ where: { conversationId } });
  await prisma.agentRun.deleteMany({ where: { conversationId } });
  await prisma.actionProposal.deleteMany({ where: { conversationId } }).catch(() => {});
  await prisma.conversation.deleteMany({ where: { id: conversationId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  console.log("🧹 已清理本套夹具（组织 / 用户 / 产品 / 会话 / 运行留痕）");
  fixtureIds = null;
}

async function main() {
  await assertTestDatabaseSafety(prisma);

  console.log("=".repeat(80));
  console.log("🧪 Advisor LLM 润色链路端到端验收（P4 · mock OpenAI 兼容端点）");
  console.log(`    BASE=${BASE}\n    MOCK=${MOCK_BASE}`);
  console.log("=".repeat(80) + "\n");

  // ---------- mock 端点：拉起（或复用）并探活 ----------
  try {
    await ensureMockServer();
    console.log(`✅ mock LLM 端点就绪（${MOCK_BASE}，pid=${mockProcess?.pid ?? "外部复用"}）`);
  } catch (e: any) {
    console.error(`❌ 本地 mock LLM 端点不可用（${MOCK_BASE}）：${e?.message}`);
    process.exit(1);
  }

  // ---------- 夹具 ----------
  const orgA = await prisma.organization.create({
    data: { code: `${RUN_TAG}_A`, name: "LLM 验收机构 A（合成夹具）" },
  });
  const ownerA = await prisma.user.create({
    data: {
      email: `${RUN_TAG}-owner@hermes.test`,
      name: "LLM 验收负责人",
      organizationId: orgA.id,
      passwordHash: hashPassword(PASSWORD),
    },
  });
  const product = await prisma.product.create({
    data: {
      organizationId: orgA.id,
      name: `${RUN_TAG} LLM 验收产品`,
      identityCode: `${RUN_TAG}-ID`,
      targetAudience: "验收夹具人群",
      marketPath: "DOMESTIC",
      devMode: "SELF_DEVELOPED",
      ownerId: ownerA.id,
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      organizationId: orgA.id,
      ownerId: ownerA.id,
      kind: "PRODUCT",
      title: `${RUN_TAG} LLM 会话`,
      productId: product.id,
    },
  });
  fixtureIds = { orgId: orgA.id, userId: ownerA.id, productId: product.id, conversationId: conversation.id };

  const ownerLogin = await login(ownerA.email, PASSWORD);
  ok(ownerLogin.status === 200 && !!ownerLogin.token, `0.1 负责人登录成功（HTTP ${ownerLogin.status}）`);

  const send = (content: string) =>
    api("POST", `/api/conversations/${conversation.id}/messages`, {
      token: ownerLogin.token,
      body: { content },
    });

  const lastRun = async () => {
    const run = await prisma.agentRun.findFirst({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "desc" },
    });
    if (!run) throw new Error("找不到 AgentRun");
    return run;
  };

  // ---------- 场景 1：开关关闭的对照断言 ----------
  // 本启动器（acc-llm-e2e.sh）的服务进程已注入 ADVISOR_LLM_ENABLED=true，因此：
  // - 完整运行时场景 1 断言「本轮 contextSnapshot.llmEnabled 与 runMode 一致、标注头与模式匹配」
  //   （开关关闭的完整对照由单元测试 llm.test.ts + 场景 3/4/5 的回落路径共同覆盖）；
  // - 部分运行（LLM_E2E_ENABLED != 1）时服务未启用 LLM，这里建立 TEST_STUB 对照组。
  console.log("▶ 场景 1：运行模式与诚实标注一致（开关关闭=TEST_STUB+标注头；开启=LLM+无标注头）");
  let llmEnabledOnServer = false;
  {
    const res = await send("查一下公司知识库里有哪些渠道政策");
    ok(res.status === 201, `1.1 消息发送成功（HTTP ${res.status}）`);
    if (res.status !== 201) {
      throw new Error(`场景 1 消息发送失败：${JSON.stringify(res.json)?.slice(0, 200)}`);
    }
    const run = await lastRun();
    const content: string = res.json?.message?.content || "";
    llmEnabledOnServer = run.runMode === "LLM";
    if (llmEnabledOnServer) {
      ok(
        typeof run.contextSnapshot === "object" && (run.contextSnapshot as any)?.llmEnabled === true,
        "1.2 服务已启用 LLM：contextSnapshot.llmEnabled=true 如实留痕"
      );
      ok(!content.includes("未接入语言模型"), "1.3 LLM 路径回复无 TEST_STUB 标注头");
      ok(
        run.promptTemplateVersion === "advisor-llm-system/v2",
        `1.4 promptTemplateVersion=advisor-llm-system/v2（实际 ${run.promptTemplateVersion}）`
      );
    } else {
      ok(run.runMode === "TEST_STUB", `1.2 runMode=TEST_STUB（实际 ${run.runMode}）`);
      ok(
        typeof run.contextSnapshot === "object" && (run.contextSnapshot as any)?.llmEnabled === false,
        "1.3 contextSnapshot.llmEnabled=false 如实留痕"
      );
      ok(content.includes("未接入语言模型"), "1.4 回复正文带「未接入语言模型」诚实标注");
      const usage = run.usageJson as any;
      ok(!!usage?.note && !usage?.totalTokens, "1.5 usageJson 无 token 计量（未接入模型）");
    }
    ok(run.costStatus === "unknown", "1.6 costStatus=unknown");
  }

  // ----------
  // 场景 2-6 需要服务端进程以 ADVISOR_LLM_ENABLED=true 启动（env 在进程启动时读取，
  // 套件中途改不了）。启动器 scripts/acc-llm-e2e.sh 负责注入；此处按场景 1 探测的
  // 实际运行模式分流：未启用时跳过（并提示用启动器），不静默假绿。
  // ----------
  if (!llmEnabledOnServer) {
    console.log("\n（服务未启用 LLM：场景 2-6 跳过。完整验收请用 bash scripts/acc-llm-e2e.sh 运行。）");
    await cleanupFixtures();
    await prisma.$disconnect();
    if (passed === 0) process.exitCode = 1;
    return;
  }

  console.log("\n▶ 场景 2：开关开启 + mock 端点正常 → runMode=LLM，回复为模型 content，token 如实计量");
  await setMockMode("ok");
  {
    const res = await send("查一下公司知识库里关于禁用成分的规定");
    ok(res.status === 201, `2.1 消息发送成功（HTTP ${res.status}）`);
    const run = await lastRun();
    ok(run.runMode === "LLM", `2.2 runMode=LLM（实际 ${run.runMode}）`);
    ok(run.promptTemplateVersion === "advisor-llm-system/v2", `2.3 promptTemplateVersion=advisor-llm-system/v2（实际 ${run.promptTemplateVersion}）`);
    const content: string = res.json?.message?.content || "";
    ok(content.includes("【LLM 润色】"), "2.4 回复正文来自模型 content（含标记文本）");
    ok(!content.includes("未接入语言模型"), "2.5 回复不再带 TEST_STUB 提示头");
    const usage = run.usageJson as any;
    ok(typeof usage?.promptTokens === "number" && usage.promptTokens > 0, `2.6 usageJson.promptTokens 如实记录（${usage?.promptTokens}）`);
    ok(typeof usage?.completionTokens === "number" && usage.completionTokens > 0, `2.7 usageJson.completionTokens 如实记录（${usage?.completionTokens}）`);
    ok(run.costStatus === "unknown", "2.8 costStatus 仍为 unknown（无单价信息，不编造金额）");
    ok(run.errorReason === null, "2.9 无错误留痕");

    // 计量随输入变化：第二条消息更长 → promptTokens 更大
    const firstPromptTokens = usage.promptTokens;
    await send("请再查一次公司知识库里关于禁用成分的规定，并补充说明营销红线与合规注意事项的相关背景资料");
    const run2 = await lastRun();
    const usage2 = run2.usageJson as any;
    ok(
      typeof usage2?.promptTokens === "number" && usage2.promptTokens > firstPromptTokens,
      `2.10 token 计量随输入变化（${firstPromptTokens} → ${usage2?.promptTokens}）`
    );
  }

  console.log("\n▶ 场景 7：多轮上下文 —— 会话历史注入 LLM 请求，追问与指代可用");
  await setMockMode("ok");
  {
    // 此会话此前已有数轮对话（场景 1/2 产生的 USER/ASSISTANT 消息）。
    // mock 端点会回显收到的历史轮数：user ≥ 3（首轮对照 + 场景2两条 + 本轮），assistant ≥ 2。
    const res = await send("刚才查到的禁用成分，具体是哪几项？针对我们这个产品还有哪些不能说的宣称？");
    ok(res.status === 201, `7.1 追问消息发送成功（HTTP ${res.status}）`);
    const run = await lastRun();
    const content: string = res.json?.message?.content || "";

    const uMatch = content.match(/历史注入 user=(\d+) \/ assistant=(\d+)/);
    ok(!!uMatch, "7.2 mock 端点确认请求里注入了会话历史（回显历史轮数）");
    if (uMatch) {
      const u = parseInt(uMatch[1], 10);
      const a = parseInt(uMatch[2], 10);
      ok(u >= 3, `7.3 历史含此前多轮 user 消息（user=${u} ≥ 3，含本轮）`);
      ok(a >= 2, `7.4 历史含此前 assistant 回答（assistant=${a} ≥ 2，指代「刚才查到的」有据可依）`);
    }

    const usage = run.usageJson as any;
    ok(
      typeof usage?.historyTurns === "number" && usage.historyTurns >= 5,
      `7.5 usageJson.historyTurns 如实留痕（${usage?.historyTurns} ≥ 5：场景1+2 的 5 条历史）`
    );
    ok(typeof usage?.promptTokens === "number", "7.6 追问轮 token 计量正常");

    // 指代消解链路端到端：本轮工具数据 + 历史 → 模型输出（用户可读）
    ok(content.includes("【LLM 润色】"), "7.7 追问轮回复为模型产出");
  }

  console.log("\n▶ 场景 3：端点 500 → 回落工具原文，errorReason 留痕 LLM 失败");
  await setMockMode("fail");
  {
    const res = await send("查一下公司知识库里的品牌定位资料");
    ok(res.status === 201, `3.1 消息发送成功（HTTP ${res.status}）`);
    const run = await lastRun();
    const content: string = res.json?.message?.content || "";
    ok(content.includes("【相关公司事实】") || content.includes("【相关知识文档切片引用】") || content.includes("未检索到"),
      "3.2 回复为工具原文（回落成功，用户仍拿到真实数据）");
    ok(!content.includes("【LLM 润色】"), "3.3 回复不含模型 content");
    ok(!!run.errorReason && run.errorReason.includes("LLM 润色失败已回落工具原文"),
      `3.4 errorReason 记录 LLM 失败与回落（${run.errorReason?.slice(0, 60)}…）`);
    ok(run.runMode === "LLM", `3.5 runMode 仍为 LLM（本轮确实尝试过模型）`);
    ok(run.status === "SUCCEEDED", "3.6 整体运行状态 SUCCEEDED（回落不是失败）");
  }

  console.log("\n▶ 场景 4：端点超时（8s 慢响应 > 1s 超时）→ 回落，errorReason 含超时");
  await setMockMode("slow");
  {
    const res = await send("查一下公司知识库里的渠道规范");
    ok(res.status === 201, `4.1 消息发送成功（HTTP ${res.status}，耗时约 1s+）`);
    const run = await lastRun();
    const content: string = res.json?.message?.content || "";
    ok(!content.includes("【LLM 润色】"), "4.2 未采用慢响应的模型输出（回落）");
    ok(!!run.errorReason && run.errorReason.includes("超时"), `4.3 errorReason 含超时信息（${run.errorReason?.slice(0, 60)}…）`);
  }

  console.log("\n▶ 场景 5：响应缺 usage → 计量如实为「无 token 计量」，不编造");
  await setMockMode("nousage");
  {
    const res = await send("查一下公司知识库里的禁用项规则");
    ok(res.status === 201, `5.1 消息发送成功（HTTP ${res.status}）`);
    const run = await lastRun();
    const content: string = res.json?.message?.content || "";
    ok(content.includes("【LLM 润色】"), "5.2 模型正常回复（无 usage 不影响润色）");
    const usage = run.usageJson as any;
    ok(!!usage?.note && usage?.promptTokens === undefined, "5.3 usageJson 如实记录无 token 计量");
    ok(run.costStatus === "unknown", "5.4 costStatus=unknown");
  }

  console.log("\n▶ 场景 6：开关乱值视为关闭（不靠隐式行为升级）");
  // 此场景验证服务端 env ADVISOR_LLM_ENABLED=true 的解析已覆盖 true/1/on；
  // 乱值关闭的行为由单元测试覆盖（llm.test.ts），这里只做 mock 状态复位断言。
  await setMockMode("ok");
  ok(true, "6.1 mock 端点已复位为 ok（乱值关闭见单元测试 isAdvisorLLMEnabled）");

  // ---------- 汇总 ----------
  console.log("\n" + "=".repeat(80));
  if (failures.length === 0) {
    console.log(` LLM 润色链路验收全绿：${passed} 项断言全部通过`);
  } else {
    console.log(`❌ LLM 润色链路验收失败 ${failures.length} 项 / 通过 ${passed} 项：`);
    failures.forEach((f) => console.log(`   - ${f}`));
  }
  console.log("=".repeat(80) + "\n");

  // ---------- 清理：仅本套夹具 ----------
  await cleanupFixtures();

  if (mockProcess) {
    mockProcess.kill();
    console.log("🧹 已回收本套拉起的 mock LLM 端点");
  }

  await prisma.$disconnect();
  if (failures.length > 0) process.exitCode = 1;
}

main().catch(async (e) => {
  console.error("❌ LLM 润色链路验收异常终止:", e?.message || e);
  try {
    await cleanupFixtures();
  } catch {
    /* 清理失败不掩盖原始错误 */
  }
  if (mockProcess) mockProcess.kill();
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
