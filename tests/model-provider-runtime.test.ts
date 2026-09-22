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
