import test from "node:test";
import assert from "node:assert/strict";
import {
  createOpenAICompatibleProviderPlugin,
  resolveOpenAICompatibleProviderRuntime,
} from "../src/modules/model-gateway/provider-runtime";
import { ModelProviderError } from "../src/modules/model-gateway/health";
import type { ModelProfile } from "../src/modules/model-gateway/types";

const profile: ModelProfile = {
  id: "agnes-test",
  provider: "agnes",
  modelId: "agnes-test-model",
  displayName: "Agnes Test",
  capabilities: ["TEXT"],
  locality: "CLOUD",
  health: "HEALTHY",
  enabled: true,
  qualityTier: "FAST",
  latencyTier: "FAST",
  costTier: "LOW",
  contextWindow: 32000,
};

function clearProviderEnv() {
  for (const key of [
    "MODEL_PROVIDER_AGNES_BASE_URL",
    "MODEL_PROVIDER_AGNES_API_KEY",
    "MODEL_PROVIDER_AGNES_TIMEOUT_MS",
    "MODEL_PROVIDER_AGNES_MAX_TOKENS",
    "MODEL_PROVIDER_AGNES_TEMPERATURE",
    "ADVISOR_MODEL_PROVIDER",
    "ADVISOR_LLM_BASE_URL",
    "ADVISOR_LLM_API_KEY",
  ]) {
    delete process.env[key];
  }
}

test("provider runtime: missing server config stays unavailable", () => {
  clearProviderEnv();
  assert.equal(resolveOpenAICompatibleProviderRuntime("agnes"), null);
});

test("provider runtime: deployment env resolves without exposing secret to DB", () => {
  clearProviderEnv();
  process.env.MODEL_PROVIDER_AGNES_BASE_URL = "http://127.0.0.1:9999/v1/";
  process.env.MODEL_PROVIDER_AGNES_API_KEY = "secret-test-key";
  process.env.MODEL_PROVIDER_AGNES_TIMEOUT_MS = "1500";
  process.env.MODEL_PROVIDER_AGNES_MAX_TOKENS = "321";

  const runtime = resolveOpenAICompatibleProviderRuntime("agnes");
  assert.ok(runtime);
  assert.equal(runtime?.baseUrl, "http://127.0.0.1:9999/v1");
  assert.equal(runtime?.apiKey, "secret-test-key");
  assert.equal(runtime?.timeoutMs, 1500);
  assert.equal(runtime?.maxTokens, 321);
  assert.equal(runtime?.source, "MODEL_PROVIDER_ENV");
  clearProviderEnv();
});

test("provider runtime: OpenAI-compatible response maps usage and actual model id", async () => {
  clearProviderEnv();
  process.env.MODEL_PROVIDER_AGNES_BASE_URL = "http://model.test/v1";
  process.env.MODEL_PROVIDER_AGNES_API_KEY = "secret-test-key";

  const originalFetch = globalThis.fetch;
  let authorization = "";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    authorization = String((init?.headers as Record<string, string> | undefined)?.Authorization || "");
    return new Response(
      JSON.stringify({
        model: "agnes-resolved",
        choices: [{ message: { content: "runtime answer" } }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );
  }) as typeof fetch;

  try {
    const plugin = createOpenAICompatibleProviderPlugin("agnes");
    const result = await plugin.execute(profile, {
      taskClass: "SUMMARIZATION",
      messages: [{ role: "user", content: "summarize" }],
    });

    assert.equal(result.text, "runtime answer");
    assert.equal(result.modelId, "agnes-resolved");
    assert.deepEqual(result.usage, {
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
    });
    assert.equal(authorization, "Bearer secret-test-key");
  } finally {
    globalThis.fetch = originalFetch;
    clearProviderEnv();
  }
});

test("provider runtime: exact configured credentials are redacted from HTTP and network errors regardless of prefix", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "tp-fixture.key+special";
  try {
    for (const network of [false, true]) {
      globalThis.fetch = (async () => {
        if (network) throw new Error(`rejected token ${secret}`);
        return new Response(JSON.stringify({ error: `invalid token ${secret}` }), { status: 401 });
      }) as typeof fetch;
      const plugin = createOpenAICompatibleProviderPlugin("agnes", { runtime: { provider: "agnes", baseUrl: "http://model.test/v1", apiKey: secret, timeoutMs: 1000, maxTokens: 128, temperature: 0.2, source: "MODEL_PROVIDER_ENV" } });
      await assert.rejects(() => plugin.execute(profile, { taskClass: "SUMMARIZATION", messages: [] }), (error: unknown) => {
        assert.ok(error instanceof ModelProviderError);
        assert.ok(!error.message.includes(secret));
        assert.match(error.message, /REDACTED/);
        return true;
      });
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("provider runtime: 429 is classified as RATE_LIMIT for policy fallback", async () => {
  clearProviderEnv();
  process.env.MODEL_PROVIDER_AGNES_BASE_URL = "http://model.test/v1";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("rate limited", { status: 429 })) as typeof fetch;

  try {
    const plugin = createOpenAICompatibleProviderPlugin("agnes");
    await assert.rejects(
      () =>
        plugin.execute(profile, {
          taskClass: "QUICK_RESEARCH",
          messages: [{ role: "user", content: "research" }],
        }),
      (error: unknown) => {
        assert.ok(error instanceof ModelProviderError);
        assert.equal(error.kind, "RATE_LIMIT");
        assert.equal(error.status, 429);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
    clearProviderEnv();
  }
});

test("provider runtime: missing runtime fails closed as CONFIG", async () => {
  clearProviderEnv();
  const plugin = createOpenAICompatibleProviderPlugin("agnes");

  await assert.rejects(
    () =>
      plugin.execute(profile, {
        taskClass: "QUICK_RESEARCH",
        messages: [{ role: "user", content: "research" }],
      }),
    (error: unknown) => {
      assert.ok(error instanceof ModelProviderError);
      assert.equal(error.kind, "CONFIG");
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// C1：原生 function calling（provider 层）
// ---------------------------------------------------------------------------

test("provider runtime: native tools go on the wire in OpenAI schema form and tool_calls are parsed", async () => {
  clearProviderEnv();
  process.env.MODEL_PROVIDER_AGNES_BASE_URL = "http://model.test/v1";
  const originalFetch = globalThis.fetch;
  let body: Record<string, unknown> | null; // 无初始值：fetch 闭包内赋值，避免 CFA 收窄到 null
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        model: "agnes-resolved",
        choices: [{
          message: {
            content: "",
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "calculate", arguments: '{"expression":"199-68"}' } },
              { id: "call_2", type: "function", function: { name: "knowledge_search", arguments: '{"query":"竞品"}' } },
            ],
          },
          finish_reason: "tool_calls",
        }],
        usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const plugin = createOpenAICompatibleProviderPlugin("agnes");
    const result = await plugin.execute(profile, {
      taskClass: "ASSISTANT_DIALOGUE",
      messages: [{ role: "user", content: "算一下 199-68" }],
      tools: [
        { name: "calculate", description: "精确计算算式", parameters: { type: "object" } },
        { name: "knowledge_search", description: "检索知识库", parameters: { type: "object", required: ["query"] } },
      ],
    });

    assert.notEqual(body!, null, "fetch 应被调用");
    assert.deepEqual(body!.tools, [
      { type: "function", function: { name: "calculate", description: "精确计算算式", parameters: { type: "object" } } },
      { type: "function", function: { name: "knowledge_search", description: "检索知识库", parameters: { type: "object", required: ["query"] } } },
    ]);
    assert.equal(body!.tool_choice, "auto");
    assert.equal(result.text, "", "纯工具调用时 content 允许为空");
    assert.deepEqual(result.toolCalls, [
      { id: "call_1", name: "calculate", arguments: { expression: "199-68" } },
      { id: "call_2", name: "knowledge_search", arguments: { query: "竞品" } },
    ]);
    assert.deepEqual(result.usage, { inputTokens: 30, outputTokens: 12, totalTokens: 42 });
  } finally {
    globalThis.fetch = originalFetch;
    clearProviderEnv();
  }
});

test("provider runtime: 无 tools 时请求体与旧契约完全一致（文本协议回归护栏）", async () => {
  clearProviderEnv();
  process.env.MODEL_PROVIDER_AGNES_BASE_URL = "http://model.test/v1";
  const originalFetch = globalThis.fetch;
  let body: Record<string, unknown> | null; // 无初始值：fetch 闭包内赋值，避免 CFA 收窄到 null
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({ model: "agnes-resolved", choices: [{ message: { content: "普通回答" } }], usage: { total_tokens: 5 } }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const plugin = createOpenAICompatibleProviderPlugin("agnes");
    const result = await plugin.execute(profile, {
      taskClass: "SUMMARIZATION",
      messages: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }],
    });
    assert.notEqual(body!, null, "fetch 应被调用");
    assert.equal("tools" in body!, false, "不传 tools 时请求体不得出现 tools 字段");
    assert.equal("tool_choice" in body!, false);
    assert.deepEqual(body!.messages, [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ]);
    assert.equal(result.text, "普通回答");
    assert.equal(result.toolCalls, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    clearProviderEnv();
  }
});

test("provider runtime: 原生历史消息（assistant.tool_calls + tool 结果）按 OpenAI 形态下发", async () => {
  clearProviderEnv();
  process.env.MODEL_PROVIDER_AGNES_BASE_URL = "http://model.test/v1";
  const originalFetch = globalThis.fetch;
  let body: Record<string, unknown> | null; // 无初始值：fetch 闭包内赋值，避免 CFA 收窄到 null
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({ model: "m", choices: [{ message: { content: "结论" } }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const plugin = createOpenAICompatibleProviderPlugin("agnes");
    await plugin.execute(profile, {
      taskClass: "ASSISTANT_DIALOGUE",
      messages: [
        { role: "user", content: "算" },
        { role: "assistant", content: "", toolCalls: [{ id: "call_9", name: "calculate", arguments: '{"expression":"1+1"}' }] },
        { role: "tool", content: "1+1 = 2", toolCallId: "call_9" },
      ],
    });
    assert.deepEqual(body!.messages, [
      { role: "user", content: "算" },
      { role: "assistant", content: "", tool_calls: [{ id: "call_9", type: "function", function: { name: "calculate", arguments: '{"expression":"1+1"}' } }] },
      { role: "tool", content: "1+1 = 2", tool_call_id: "call_9" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    clearProviderEnv();
  }
});

test("provider runtime: 畸形 tool_calls arguments 得到 argumentError 而不是崩溃", async () => {
  clearProviderEnv();
  process.env.MODEL_PROVIDER_AGNES_BASE_URL = "http://model.test/v1";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        model: "m",
        choices: [{ message: { content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "calculate", arguments: "{broken json" } }] } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )
  ) as typeof fetch;

  try {
    const plugin = createOpenAICompatibleProviderPlugin("agnes");
    const result = await plugin.execute(profile, {
      taskClass: "ASSISTANT_DIALOGUE",
      messages: [{ role: "user", content: "x" }],
      tools: [{ name: "calculate", description: "d", parameters: { type: "object" } }],
    });
    assert.equal(result.toolCalls?.length, 1);
    assert.equal(result.toolCalls![0].name, "calculate");
    assert.deepEqual(result.toolCalls![0].arguments, {});
    assert.match(result.toolCalls![0].argumentError ?? "", /JSON/);
  } finally {
    globalThis.fetch = originalFetch;
    clearProviderEnv();
  }
});
