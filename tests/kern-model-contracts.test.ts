/**
 * KX-66 L1 · 模型接入契约测试（离线、可重复、不花钱）
 * ====================================================
 * 在 127.0.0.1 起一个 OpenAI 兼容的 mock 端点，按 model id 返回各家真实遇到过的异常形态，
 * 走真实 HTTP → provider-runtime → ModelGateway，锁定：
 *   - 错误分类（ModelFailureKind）
 *   - 是否允许 fallback 到策略内下一个候选
 *   - 冷却（429 / 401 立即冷却）
 *   - 只剩一个候选时的 429：按 Retry-After / 退避在同一模型上有限重试（KX-66 实测免费档每分钟约 10 次）
 *   - 请求契约（路径、模型名、max_tokens、鉴权头）与密钥不回显
 *   - 非 Kern 原生工具调用格式（MiMo XML）能被 parseToolCall 识别
 * 不连数据库，不读 .env。
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createOpenAICompatibleProviderPlugin, parseRetryAfterMs } from "../src/modules/model-gateway/provider-runtime";
import { ModelGateway, ModelGatewayExecutionError } from "../src/modules/model-gateway/gateway";
import {
  InMemoryModelHealthStore,
  ModelProviderError,
  classifyModelProviderFailure,
} from "../src/modules/model-gateway/health";
import { ModelRegistry } from "../src/modules/model-gateway/registry";
import type { ModelFailurePolicy, ModelPolicy, ModelProfile } from "../src/modules/model-gateway/types";
import { parseToolCall } from "../src/modules/supervisor/tools";

type Hit = { path: string; model: string; maxTokens: unknown; auth: string };
const hits: Hit[] = [];
let server: http.Server;
let base = "";

function reply(res: http.ServerResponse, status: number, body: unknown, type = "application/json") {
  res.writeHead(status, { "content-type": type });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function completion(content: unknown, extra: Record<string, unknown> = {}) {
  return {
    model: extra.model ?? "mock-resolved",
    choices: [{ message: { role: "assistant", content, ...(extra.message as object | undefined) } }],
    usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
  };
}

const MIMO_XML =
  "我先查一下知识库。\n<tool_call>\n<function=knowledge_search>\n<parameter=query>助眠 原料</parameter>\n<parameter=limit>3</parameter>\n</function>\n</tool_call>";

function rateLimited(res: http.ServerResponse, retryAfter: string) {
  res.writeHead(429, { "content-type": "application/json", "retry-after": retryAfter });
  res.end(JSON.stringify({ error: { message: "您已达到免费用户的 API 速率限制" } }));
}
let rateLimitThenOkCalls = 0;

/** model id → 行为。命名即场景，便于在失败信息里直接看出是哪种形态。 */
const BEHAVIORS: Record<string, (res: http.ServerResponse) => void> = {
  ok: (res) => reply(res, 200, completion("正常回答")),
  "reasoning-empty": (res) =>
    reply(res, 200, completion("", { message: { reasoning_content: "思考了很久……" } })),
  "null-content": (res) => reply(res, 200, completion(null)),
  "mimo-xml": (res) => reply(res, 200, completion(MIMO_XML)),
  "rate-limit": (res) => reply(res, 429, { error: { message: "rate limited" } }),
  "rate-limit-then-ok": (res) => {
    rateLimitThenOkCalls += 1;
    if (rateLimitThenOkCalls <= 2) return rateLimited(res, "0");
    reply(res, 200, completion("限流后恢复"));
  },
  "rate-limit-always": (res) => rateLimited(res, "0"),
  "rate-limit-long": (res) => rateLimited(res, "120"),
  "server-500": (res) => reply(res, 500, "upstream exploded", "text/plain"),
  "bad-gateway-html": (res) => reply(res, 200, "<html><body>502 Bad Gateway</body></html>", "text/html"),
  auth: (res) => reply(res, 401, { error: { message: "invalid key Bearer sk-live-SHOULD-NOT-LEAK" } }),
  "content-policy": (res) => reply(res, 400, { error: { code: "content_policy_violation" } }),
  "bad-request": (res) => reply(res, 400, { error: { message: "unknown field" } }),
  oversize: (res) => reply(res, 200, completion("长".repeat(50_001))),
  slow: (res) => {
    setTimeout(() => {
      if (!res.writableEnded) reply(res, 200, completion("太慢了"));
    }, 1_500);
  },
};

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        /* 非法请求体按空处理 */
      }
      const model = String(body.model ?? "");
      hits.push({ path: req.url ?? "", model, maxTokens: body.max_tokens, auth: String(req.headers.authorization ?? "") });
      const behave = BEHAVIORS[model];
      if (!behave) return reply(res, 404, { error: `no behavior for ${model}` });
      behave(res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  process.env.MODEL_PROVIDER_KX66A_BASE_URL = `${base}/a/v1/`;
  process.env.MODEL_PROVIDER_KX66A_API_KEY = "sk-test-primary-secret";
  process.env.MODEL_PROVIDER_KX66A_TIMEOUT_MS = "400";
  process.env.MODEL_PROVIDER_KX66A_MAX_TOKENS = "777";
  process.env.MODEL_PROVIDER_KX66B_BASE_URL = `${base}/b/v1`;
  process.env.MODEL_PROVIDER_KX66B_TIMEOUT_MS = "2000";
});

after(async () => {
  for (const k of Object.keys(process.env)) if (k.startsWith("MODEL_PROVIDER_KX66")) delete process.env[k];
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function profile(id: string, provider: string, modelId: string): ModelProfile {
  return {
    id,
    provider,
    modelId,
    displayName: id,
    capabilities: ["TEXT"],
    locality: "CLOUD",
    health: "HEALTHY",
    enabled: true,
    qualityTier: "FAST",
    latencyTier: "FAST",
    costTier: "FREE",
  };
}

/** 主候选 primary（kx66a，行为由 modelId 决定）+ 兜底 backup（kx66b，永远 ok）。 */
function setup(primaryModel: string) {
  const registry = new ModelRegistry();
  registry.registerProfile(profile("primary", "kx66a", primaryModel));
  registry.registerProfile(profile("backup", "kx66b", "ok"));
  registry.registerProvider(createOpenAICompatibleProviderPlugin("kx66a"));
  registry.registerProvider(createOpenAICompatibleProviderPlugin("kx66b"));
  const store = new InMemoryModelHealthStore();
  const gateway = new ModelGateway(registry, store);
  const policy: ModelPolicy = {
    id: "kx66-policy",
    version: "1",
    taskClass: "SUMMARIZATION",
    candidates: [
      { profileId: "primary", priority: 10 },
      { profileId: "backup", priority: 20 },
    ],
    requiredCapabilities: ["TEXT"],
    cloudAllowed: true,
  };
  const run = () =>
    gateway.execute(policy, { taskClass: "SUMMARIZATION", messages: [{ role: "user", content: "总结一下" }] });
  return { gateway, store, policy, run };
}

async function primaryError(model: string): Promise<ModelProviderError> {
  const plugin = createOpenAICompatibleProviderPlugin("kx66a");
  try {
    await plugin.execute(profile("primary", "kx66a", model), {
      taskClass: "SUMMARIZATION",
      messages: [{ role: "user", content: "x" }],
    });
  } catch (e) {
    assert.ok(e instanceof ModelProviderError, `期望 ModelProviderError，实际 ${String(e)}`);
    return e;
  }
  throw new Error(`${model} 本应失败`);
}

test("MC1 请求契约：/chat/completions、模型名、max_tokens、鉴权头；无 key 时不带鉴权头", async () => {
  hits.length = 0;
  const { run } = setup("ok");
  const r = await run();
  assert.equal(r.text, "正常回答");
  assert.equal(r.profileId, "primary");
  assert.equal(r.resolvedModelId, "mock-resolved");
  assert.deepEqual(r.usage, { inputTokens: 12, outputTokens: 5, totalTokens: 17 });
  assert.equal(hits[0].path, "/a/v1/chat/completions");
  assert.equal(hits[0].model, "ok");
  assert.equal(hits[0].maxTokens, 777);
  assert.equal(hits[0].auth, "Bearer sk-test-primary-secret");

  const plugin = createOpenAICompatibleProviderPlugin("kx66b");
  await plugin.execute(profile("backup", "kx66b", "ok"), { taskClass: "SUMMARIZATION", messages: [] });
  assert.equal(hits.at(-1)?.auth, "", "未配置 API key 时不应发送 Authorization");
});

test("MC2 推理模型空 content / null content → TRANSIENT，允许 fallback 并由兜底候选完成", async () => {
  for (const model of ["reasoning-empty", "null-content"]) {
    assert.equal((await primaryError(model)).kind, "TRANSIENT", model);
    const r = await setup(model).run();
    assert.equal(r.profileId, "backup", model);
    assert.equal(r.attempts.length, 2);
    assert.equal(r.attempts[0].failureKind, "TRANSIENT");
    assert.equal(r.attempts[0].fallbackAllowed, true);
  }
});

test("MC3 MiMo 原生 XML 工具调用：原文透传，parseToolCall 识别为 knowledge_search", async () => {
  const r = await setup("mimo-xml").run();
  assert.equal(r.profileId, "primary");
  const call = parseToolCall(r.text);
  assert.deepEqual(call, { tool: "knowledge_search", input: { query: "助眠 原料", limit: 3 } });
});

test("MC4 429 → RATE_LIMIT：fallback，且主候选立即进入冷却，下一次直接跳过", async () => {
  const e = await primaryError("rate-limit");
  assert.equal(e.kind, "RATE_LIMIT");
  assert.equal(e.status, 429);

  const { run, store } = setup("rate-limit");
  const first = await run();
  assert.equal(first.profileId, "backup");
  assert.ok((await store.get("primary"))?.cooldownUntilMs, "429 应立即冷却");

  hits.length = 0;
  const second = await run();
  assert.equal(second.profileId, "backup");
  assert.equal(second.attempts.length, 1, "冷却中的候选不应再被调用");
  assert.ok(second.routingSkips.some((s) => s.profileId === "primary" && s.reason.includes("冷却")));
  assert.ok(hits.every((h) => h.model !== "rate-limit"));
});

test("MC5 5xx / 200 但非 JSON（网关 HTML 页）/ 超时 → 可 fallback", async () => {
  const cases: [string, string][] = [
    ["server-500", "SERVICE_UNAVAILABLE"],
    ["bad-gateway-html", "TRANSIENT"],
    ["slow", "TIMEOUT"],
  ];
  for (const [model, kind] of cases) {
    assert.equal((await primaryError(model)).kind, kind, model);
    const r = await setup(model).run();
    assert.equal(r.profileId, "backup", model);
    assert.equal(r.attempts[0].failureKind, kind);
  }
});

test("MC6 401 → AUTH：可 fallback，冷却按鉴权失败的长冷却（≥15 分钟），错误信息不回显密钥", async () => {
  const e = await primaryError("auth");
  assert.equal(e.kind, "AUTH");
  assert.ok(!e.message.includes("sk-live-SHOULD-NOT-LEAK"), e.message);
  assert.ok(e.message.includes("[REDACTED]"));

  const { run, store } = setup("auth");
  const r = await run();
  assert.equal(r.profileId, "backup");
  const snap = await store.get("primary");
  assert.ok(snap?.cooldownUntilMs && snap.cooldownUntilMs - Date.now() > 14 * 60_000);
});

test("MC7 内容安全 / 请求契约错误 / 超长输出 → 禁止 fallback，兜底候选不被调用", async () => {
  const cases: [string, string][] = [
    ["content-policy", "CONTENT_POLICY"],
    ["bad-request", "BAD_REQUEST"],
    ["oversize", "BAD_REQUEST"],
  ];
  for (const [model, kind] of cases) {
    hits.length = 0;
    await assert.rejects(setup(model).run(), (err: unknown) => {
      assert.ok(err instanceof ModelGatewayExecutionError, model);
      assert.equal(err.attempts.length, 1, model);
      assert.equal(err.attempts[0].failureKind, kind, model);
      assert.equal(err.attempts[0].fallbackAllowed, false, model);
      return true;
    });
    assert.ok(hits.every((h) => !h.path.startsWith("/b/")), `${model} 不应 fallback 到兜底候选`);
  }
});

test("MC8 策略内全部失败：抛 ModelGatewayExecutionError，保留每次尝试的分类", async () => {
  const registry = new ModelRegistry();
  registry.registerProfile(profile("p1", "kx66a", "server-500"));
  registry.registerProfile(profile("p2", "kx66a", "reasoning-empty"));
  registry.registerProvider(createOpenAICompatibleProviderPlugin("kx66a"));
  const gateway = new ModelGateway(registry, new InMemoryModelHealthStore());
  await assert.rejects(
    gateway.execute(
      {
        id: "all-fail",
        version: "1",
        taskClass: "SUMMARIZATION",
        candidates: [
          { profileId: "p1", priority: 1 },
          { profileId: "p2", priority: 2 },
        ],
        requiredCapabilities: ["TEXT"],
        cloudAllowed: true,
      },
      { taskClass: "SUMMARIZATION", messages: [{ role: "user", content: "x" }] }
    ),
    (err: unknown) => {
      assert.ok(err instanceof ModelGatewayExecutionError);
      assert.deepEqual(
        err.attempts.map((a) => a.failureKind),
        ["SERVICE_UNAVAILABLE", "TRANSIENT"]
      );
      return true;
    }
  );
});

/** 只有一个候选（free 模式的真实形态）；sleep 注入为记录器，不真的等待。 */
function single(modelId: string, failurePolicy?: ModelFailurePolicy) {
  const registry = new ModelRegistry();
  registry.registerProfile(profile("only", "kx66a", modelId));
  registry.registerProvider(createOpenAICompatibleProviderPlugin("kx66a"));
  const store = new InMemoryModelHealthStore();
  const sleeps: number[] = [];
  const gateway = new ModelGateway(registry, store, Date.now, async (ms) => {
    sleeps.push(ms);
  });
  const policy: ModelPolicy = {
    id: "kx66-single",
    version: "1",
    taskClass: "SUMMARIZATION",
    candidates: [{ profileId: "only", priority: 10 }],
    requiredCapabilities: ["TEXT"],
    cloudAllowed: true,
    failurePolicy,
  };
  const run = () =>
    gateway.execute(policy, { taskClass: "SUMMARIZATION", messages: [{ role: "user", content: "总结一下" }] });
  return { store, sleeps, run };
}

test("MC9 只剩一个候选时 429：按 Retry-After 在同一模型上重试，恢复后成功且不进入冷却", async () => {
  rateLimitThenOkCalls = 0;
  const { store, sleeps, run } = single("rate-limit-then-ok");
  const result = await run();
  assert.equal(result.text, "限流后恢复");
  assert.deepEqual(result.attempts.map((a) => [a.failureKind ?? "OK", a.retryDelayMs]), [
    ["RATE_LIMIT", 0],
    ["RATE_LIMIT", 0],
    ["OK", undefined],
  ]);
  assert.deepEqual(sleeps, [0, 0]);
  assert.equal((await store.get("only"))?.cooldownUntilMs ?? null, null);
});

test("MC10 只剩一个候选且一直 429：重试次数用完才冷却并失败", async () => {
  const { store, sleeps, run } = single("rate-limit-always");
  await assert.rejects(run(), (err: unknown) => {
    assert.ok(err instanceof ModelGatewayExecutionError);
    assert.deepEqual(err.attempts.map((a) => a.failureKind), ["RATE_LIMIT", "RATE_LIMIT", "RATE_LIMIT"]);
    assert.equal(err.attempts[2].retryDelayMs, undefined, "最后一次不再重试");
    return true;
  });
  assert.equal(sleeps.length, 2);
  assert.ok((await store.get("only"))?.cooldownUntilMs, "重试用完后进入冷却");
});

test("MC11 Retry-After 超出等待预算（120s > 20s）：不重试，直接冷却失败", async () => {
  const { store, sleeps, run } = single("rate-limit-long");
  await assert.rejects(run(), (err: unknown) => {
    assert.ok(err instanceof ModelGatewayExecutionError);
    assert.equal(err.attempts.length, 1);
    return true;
  });
  assert.deepEqual(sleeps, []);
  assert.ok((await store.get("only"))?.cooldownUntilMs);
});

test("MC12 没有 Retry-After：指数退避 5s → 10s（受 20s 预算约束）；rateLimitRetries=0 时不重试", async () => {
  const a = single("rate-limit");
  await assert.rejects(a.run(), ModelGatewayExecutionError);
  assert.deepEqual(a.sleeps, [5_000, 10_000]);

  const b = single("rate-limit", {
    failureThreshold: 2,
    cooldownMs: 60_000,
    rateLimitCooldownMs: 10_000,
    rateLimitRetries: 0,
  });
  await assert.rejects(b.run(), (err: unknown) => {
    assert.ok(err instanceof ModelGatewayExecutionError);
    assert.equal(err.attempts.length, 1);
    return true;
  });
  assert.deepEqual(b.sleeps, []);
  const snap = await b.store.get("only");
  assert.ok(snap?.cooldownUntilMs && snap.cooldownUntilMs - Date.now() <= 10_000, "按策略的 10s 冷却");
});

test("MC13 Retry-After 解析：秒数 / HTTP 日期 / 非法值", () => {
  assert.equal(parseRetryAfterMs("3"), 3_000);
  assert.equal(parseRetryAfterMs("0.5"), 500);
  assert.equal(parseRetryAfterMs(new Date(10_000).toUTCString(), 4_000), 6_000);
  assert.equal(parseRetryAfterMs("soon"), undefined);
  assert.equal(parseRetryAfterMs(null), undefined);
});

function clocked(failurePolicy?: ModelFailurePolicy) {
  let clock = 1_000_000;
  const registry = new ModelRegistry();
  registry.registerProfile(profile("only", "kx66a", "ok"));
  registry.registerProvider(createOpenAICompatibleProviderPlugin("kx66a"));
  const store = new InMemoryModelHealthStore(() => clock);
  const sleeps: number[] = [];
  const gateway = new ModelGateway(registry, store, () => clock, async (ms) => {
    sleeps.push(ms);
    clock += ms;
  });
  const policy: ModelPolicy = {
    id: "kx66-clocked",
    version: "1",
    taskClass: "SUMMARIZATION",
    candidates: [{ profileId: "only", priority: 10 }],
    requiredCapabilities: ["TEXT"],
    cloudAllowed: true,
    failurePolicy,
  };
  const run = () =>
    gateway.execute(policy, { taskClass: "SUMMARIZATION", messages: [{ role: "user", content: "总结一下" }] });
  const coolDown = (kind: "RATE_LIMIT" | "AUTH", ms: number) =>
    store.recordFailure("only", classifyModelProviderFailure(new ModelProviderError("x", kind, 429)), {
      failureThreshold: 2,
      cooldownMs: ms,
      rateLimitCooldownMs: ms,
      authCooldownMs: ms,
    });
  return { run, sleeps, coolDown };
}

test("MC14 并发请求撞上别人的 429 冷却：冷却在等待预算内结束就等一等再走，而不是立即失败", async () => {
  const c = clocked();
  await c.coolDown("RATE_LIMIT", 3_000);
  const result = await c.run();
  assert.equal(result.text, "正常回答");
  assert.equal(c.sleeps.length, 1);
  assert.ok(c.sleeps[0] >= 3_000 && c.sleeps[0] <= 3_100, `等待 ${c.sleeps[0]}ms`);
});

test("MC15 不等的情况：冷却超出预算（默认 60s）/ 鉴权冷却 / rateLimitRetries=0", async () => {
  const long = clocked();
  await long.coolDown("RATE_LIMIT", 60_000);
  await assert.rejects(long.run(), ModelGatewayExecutionError);
  assert.deepEqual(long.sleeps, []);

  const auth = clocked();
  await auth.coolDown("AUTH", 3_000);
  await assert.rejects(auth.run(), ModelGatewayExecutionError);
  assert.deepEqual(auth.sleeps, []);

  const off = clocked({ failureThreshold: 2, cooldownMs: 60_000, rateLimitRetries: 0 });
  await off.coolDown("RATE_LIMIT", 3_000);
  await assert.rejects(off.run(), ModelGatewayExecutionError);
  assert.deepEqual(off.sleeps, []);
});
