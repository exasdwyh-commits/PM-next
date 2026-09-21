/**
 * advisor/llm — 单元测试（P4 架构准备）
 *
 * 验证点：
 *   1. 开关默认关闭：未配置 ADVISOR_LLM_ENABLED 时工厂返回 null
 *   2. 显式开启但缺模型标识时抛配置错误
 *   3. OpenAI 兼容客户端：正常响应解析 + usage 计量
 *   4. 端点报错 / 响应缺字段时抛 AdvisorLLMError
 *
 * Run: node --import tsx --test src/modules/advisor/llm.test.ts
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  ADVISOR_LLM_HISTORY_MAX_CHARS,
  ADVISOR_LLM_SYSTEM_PROMPT,
  AdvisorLLMError,
  OpenAICompatibleClient,
  buildAdvisorLLMMessages,
  createAdvisorLLMClient,
  getAdvisorLLMConfig,
  isAdvisorLLMEnabled,
} from "./llm";

const ENV_KEYS = [
  "ADVISOR_LLM_ENABLED",
  "ADVISOR_MODEL_PROVIDER",
  "ADVISOR_MODEL_ID",
  "ADVISOR_LLM_BASE_URL",
  "ADVISOR_LLM_API_KEY",
  "ADVISOR_LLM_TIMEOUT_MS",
  "ADVISOR_LLM_MAX_TOKENS",
  "ADVISOR_LLM_TEMPERATURE",
];

function withEnv(values: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    if (values[k] === undefined) delete process.env[k];
    else process.env[k] = values[k];
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });
}

describe("isAdvisorLLMEnabled / createAdvisorLLMClient", () => {
  it("默认（未配置）关闭：不启用、工厂返回 null", async () => {
    await withEnv({ ADVISOR_LLM_ENABLED: undefined }, () => {
      assert.equal(isAdvisorLLMEnabled(), false);
      assert.equal(createAdvisorLLMClient(), null);
    });
  });

  it("配置为 false/1 之外乱值时仍关闭", async () => {
    await withEnv({ ADVISOR_LLM_ENABLED: "yes", ADVISOR_MODEL_PROVIDER: "openai", ADVISOR_MODEL_ID: "gpt-x" }, () => {
      assert.equal(isAdvisorLLMEnabled(), false);
    });
  });

  it("显式开启但缺模型标识时抛配置错误", async () => {
    await withEnv({ ADVISOR_LLM_ENABLED: "true", ADVISOR_MODEL_PROVIDER: undefined, ADVISOR_MODEL_ID: undefined }, () => {
      assert.throws(() => createAdvisorLLMClient(), AdvisorLLMError);
    });
  });

  it("显式开启且模型已配置时返回客户端", async () => {
    await withEnv(
      { ADVISOR_LLM_ENABLED: "true", ADVISOR_MODEL_PROVIDER: "deepseek", ADVISOR_MODEL_ID: "deepseek-chat" },
      () => {
        const client = createAdvisorLLMClient();
        assert.ok(client instanceof OpenAICompatibleClient);
      }
    );
  });

  it("配置读取：默认值与 API Key 透传", async () => {
    await withEnv(
      {
        ADVISOR_MODEL_PROVIDER: "openai",
        ADVISOR_MODEL_ID: "gpt-4o-mini",
        ADVISOR_LLM_BASE_URL: "https://example.com/v1/",
        ADVISOR_LLM_API_KEY: "sk-test",
      },
      () => {
        const cfg = getAdvisorLLMConfig();
        assert.equal(cfg.baseUrl, "https://example.com/v1"); // 末尾斜杠已去除
        assert.equal(cfg.modelId, "gpt-4o-mini");
        assert.equal(cfg.apiKey, "sk-test");
        assert.equal(cfg.timeoutMs, 30000);
        assert.equal(cfg.maxTokens, 1024);
      }
    );
  });
});

describe("OpenAICompatibleClient.chat", () => {
  const cfg = {
    provider: "openai-compatible",
    modelId: "test-model",
    baseUrl: "https://unit.test/v1",
    apiKey: "sk-unit",
    timeoutMs: 5000,
    maxTokens: 256,
    temperature: 0.1,
  };

  it("解析正常响应与 usage", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "好的，这是基于数据的解读。" } }],
          usage: { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165 },
          model: "test-model-actual",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as any;

    try {
      const client = new OpenAICompatibleClient(cfg);
      const result = await client.chat([
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ]);
      assert.equal(result.text, "好的，这是基于数据的解读。");
      assert.deepEqual(result.usage, { promptTokens: 120, completionTokens: 45, totalTokens: 165 });
      assert.equal(result.modelId, "test-model-actual");
      assert.equal(calls[0].url, "https://unit.test/v1/chat/completions");
      const body = JSON.parse(String(calls[0].init.body));
      assert.equal(body.model, "test-model");
      assert.equal(body.max_tokens, 256);
      assert.equal((calls[0].init.headers as any).Authorization, "Bearer sk-unit");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("端点返回 HTTP 500 时抛 AdvisorLLMError 并带状态码", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("boom", { status: 500 })) as any;
    try {
      const client = new OpenAICompatibleClient(cfg);
      await assert.rejects(
        client.chat([{ role: "user", content: "hi" }]),
        (e: any) => e instanceof AdvisorLLMError && e.status === 500
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("响应缺 usage 时 usage=null", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "x" } }] }),
        { status: 200 }
      )) as any;
    try {
      const client = new OpenAICompatibleClient(cfg);
      const result = await client.chat([{ role: "user", content: "hi" }]);
      assert.equal(result.usage, null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("响应缺 choices 时抛 AdvisorLLMError", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ object: "chat.completion" }), { status: 200 })) as any;
    try {
      const client = new OpenAICompatibleClient(cfg);
      await assert.rejects(client.chat([{ role: "user", content: "hi" }]), AdvisorLLMError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ── 多轮上下文组装（P4+：会话历史注入）──

describe("buildAdvisorLLMMessages", () => {
  const tail = (msgs: ReturnType<typeof buildAdvisorLLMMessages>) => msgs[msgs.length - 1];

  it("基础结构：system → 历史（时间顺序）→ 本轮 user（含工具数据）", () => {
    const msgs = buildAdvisorLLMMessages({
      history: [
        { role: "USER", content: "第一问" },
        { role: "ASSISTANT", content: "第一答" },
      ],
      currentQuery: "追问：那剂量呢？",
      toolKey: "knowledge.search",
      toolResultText: "【数据】AKG 剂量 1-3 g/day",
    });

    assert.equal(msgs[0].role, "system");
    assert.equal(msgs[0].content, ADVISOR_LLM_SYSTEM_PROMPT);
    assert.equal(msgs[1].role, "user");
    assert.equal(msgs[1].content, "第一问");
    assert.equal(msgs[2].role, "assistant");
    assert.equal(msgs[2].content, "第一答");
    assert.equal(msgs.length, 4);
    assert.equal(tail(msgs).role, "user");
    assert.ok(tail(msgs).content.includes("追问：那剂量呢？"));
    assert.ok(tail(msgs).content.includes("knowledge.search"));
    assert.ok(tail(msgs).content.includes("【数据】AKG 剂量 1-3 g/day"));
  });

  it("空历史时无历史轮、无截断提示", () => {
    const msgs = buildAdvisorLLMMessages({
      history: [],
      currentQuery: "hi",
      toolKey: "workspace.overview",
      toolResultText: "数据",
    });
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, "system");
    assert.equal(msgs[1].role, "user");
  });

  it("TOOL/SYSTEM 角色与空内容不进入历史", () => {
    const msgs = buildAdvisorLLMMessages({
      history: [
        { role: "TOOL", content: "工具原始输出不应重复注入" },
        { role: "SYSTEM", content: "系统消息不进入历史" },
        { role: "USER", content: "   " },
        { role: "USER", content: "有效提问" },
      ],
      currentQuery: "现在",
      toolKey: "t",
      toolResultText: "r",
    });
    const roles = msgs.map((m) => m.role as string);
    assert.ok(!roles.includes("tool"));
    assert.deepEqual(roles, ["system", "user", "user"]);
    assert.ok(msgs[1].content.includes("有效提问"));
  });

  it("超出字符预算时环形截断保留最近轮次并插入省略提示", () => {
    const long = "长".repeat(3000);
    const msgs = buildAdvisorLLMMessages({
      history: [
        { role: "USER", content: long }, // 3000 字
        { role: "ASSISTANT", content: long }, // 3000 字
        { role: "USER", content: long }, // 3000 字 → 超出 6000 预算，整条丢弃
        { role: "ASSISTANT", content: "最近的回答" },
        { role: "USER", content: "最近的提问" },
      ],
      currentQuery: "追问",
      toolKey: "t",
      toolResultText: "r",
      maxTurns: 10,
    });

    const contents = msgs.map((m) => m.content).join("\n");
    assert.ok(contents.includes("更早的会话历史因长度预算被省略"), "应含省略提示");
    assert.ok(contents.includes("最近的回答"));
    assert.ok(contents.includes("最近的提问"));
    // 预算 6000：两条短轮（10 字）+ 一条 3000 字长轮 = 3010 可保留；
    // 第二条长轮（6010 超预算）被整条丢弃 —— 长串只出现一次，绝不半截拼接。
    const longStr = "长".repeat(3000);
    let longCount = 0;
    let idx = contents.indexOf(longStr);
    while (idx !== -1) {
      longCount += 1;
      idx = contents.indexOf(longStr, idx + 1);
    }
    assert.equal(longCount, 1, `3000 字长轮应整条保留/丢弃（不截半），实际出现 ${longCount} 次`);
    // 历史轮数：3 条（短答、短问、一条长轮）→ 消息数 = system + 省略提示 + 3 历史 + 本轮 = 6
    assert.equal(msgs.length, 6);
  });

  it("超出轮数上限时只保留最近 N 轮", () => {
    const history = Array.from({ length: 8 }, (_, i) => ({
      role: i % 2 === 0 ? "USER" : "ASSISTANT",
      content: `第${i}轮`,
    }));
    const msgs = buildAdvisorLLMMessages({
      history,
      currentQuery: "现在",
      toolKey: "t",
      toolResultText: "r",
      maxTurns: 4,
    });
    // system + 截断提示 + 4 历史 + 本轮 user
    assert.equal(msgs.length, 7);
    const contents = msgs.map((m) => m.content).join("\n");
    assert.ok(contents.includes("第7轮"));
    assert.ok(!contents.includes("第2轮"));
    assert.ok(contents.includes("更早的会话历史因长度预算被省略"));
  });

  it("默认预算常量为合理值", () => {
    assert.equal(ADVISOR_LLM_HISTORY_MAX_CHARS, 6000);
  });
});

// ── TASK-013：AbortSignal、校验、脱敏 ──

describe("TASK-013: chat() — AbortSignal / 校验 / 脱敏", () => {
  const cfg = {
    provider: "openai-compatible",
    modelId: "test-model",
    baseUrl: "https://unit.test/v1",
    apiKey: "sk-unit-test-key",
    timeoutMs: 5000,
    maxTokens: 256,
    temperature: 0.1,
  };

  it("外部传入已 abort 的 signal 时立即抛出", async () => {
    const controller = new AbortController();
    controller.abort();
    const client = new OpenAICompatibleClient(cfg);
    await assert.rejects(
      client.chat([{ role: "user", content: "hi" }], controller.signal),
      (e: any) => e instanceof AdvisorLLMError && e.message.includes("取消")
    );
  });

  it("外部 signal abort 时请求被中止", async () => {
    const controller = new AbortController();
    const originalFetch = globalThis.fetch;
    // 模拟一个会监听 signal 的 fetch
    globalThis.fetch = (async (_url: any, init: any) => {
      const signal = init?.signal;
      return new Promise((_, reject) => {
        const abortErr = new DOMException("The operation was aborted.", "AbortError");
        if (signal?.aborted) {
          reject(abortErr);
          return;
        }
        signal?.addEventListener("abort", () => {
          reject(abortErr);
        });
        // 不立即 resolve，等待 abort
      });
    }) as any;
    try {
      const client = new OpenAICompatibleClient(cfg);
      // 启动请求后立即 abort
      const promise = client.chat([{ role: "user", content: "hi" }], controller.signal);
      controller.abort();
      await assert.rejects(promise, (e: any) => e instanceof AdvisorLLMError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("响应内容为空时抛 AdvisorLLMError", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "   " } }] }),
        { status: 200 }
      )) as any;
    try {
      const client = new OpenAICompatibleClient(cfg);
      await assert.rejects(
        client.chat([{ role: "user", content: "hi" }]),
        (e: any) => e instanceof AdvisorLLMError && e.message.includes("内容为空")
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("usage 字段非 number 时返回 null（不接受字符串 token 数）", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" } }],
          usage: { prompt_tokens: "120", completion_tokens: "45" },
        }),
        { status: 200 }
      )) as any;
    try {
      const client = new OpenAICompatibleClient(cfg);
      const result = await client.chat([{ role: "user", content: "hi" }]);
      assert.equal(result.usage, null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("usage 完全缺失时返回 null", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        { status: 200 }
      )) as any;
    try {
      const client = new OpenAICompatibleClient(cfg);
      const result = await client.chat([{ role: "user", content: "hi" }]);
      assert.equal(result.usage, null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("错误消息中的 API Key 被脱敏", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("Invalid sk-test-api-key-abc123 in header");
    }) as any;
    try {
      const client = new OpenAICompatibleClient(cfg);
      await assert.rejects(
        client.chat([{ role: "user", content: "hi" }]),
        (e: any) => {
          assert.ok(e instanceof AdvisorLLMError);
          assert.ok(!e.message.includes("sk-test-api-key-abc123"), "错误消息不应包含 API Key");
          assert.ok(e.message.includes("[REDACTED]"), "错误消息应包含脱敏标记");
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("Bearer Token 在错误消息中被脱敏", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("Authorization: Bearer sk-secret-token-xyz");
    }) as any;
    try {
      const client = new OpenAICompatibleClient(cfg);
      await assert.rejects(
        client.chat([{ role: "user", content: "hi" }]),
        (e: any) => {
          assert.ok(e instanceof AdvisorLLMError);
          assert.ok(!e.message.includes("sk-secret-token-xyz"), "错误消息不应包含 Token");
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("HTTP 500 响应体中的 API Key 被脱敏", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        `Error: Invalid key sk-leaked-key-12345`,
        { status: 500 }
      )) as any;
    try {
      const client = new OpenAICompatibleClient(cfg);
      await assert.rejects(
        client.chat([{ role: "user", content: "hi" }]),
        (e: any) => {
          assert.ok(e instanceof AdvisorLLMError && e.status === 500);
          assert.ok(!e.message.includes("sk-leaked-key-12345"), "HTTP 错误响应体不应包含 API Key");
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
