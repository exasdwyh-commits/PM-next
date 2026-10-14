/**
 * C2 对话工具循环单测（挂 test:regression-units，DB-free）。
 *
 * 覆盖：
 * - CT1：先查知识再作答（原生协议；知识命中进入引用与作答）
 * - CT2：先算数再作答（文本协议回落；无 TOOLS 能力 profile）
 * - CT3：先抓网页再作答（web_fetch 工具提供方注入；signal 透传到工具）
 * - CT4：超预算诚实（步数 BUDGET_STEPS / token BUDGET_TOKENS，回复出现未完成说明）
 * - CT5：可中断（assertActive 抛 ExecutionStoppedError 上浮；AbortSignal 中断）
 * - CT6：对话只开放只读工具（ask_user 即使注入也进不了候选；模型误调给诚实观察）
 * - CT7：网关缝形状——invoker 收到 tools + requiredCapabilities["TOOLS"]，
 *   即证明生产路径的每次模型调用都经持久化网关请求（账本证据见 DB 回归）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ExecutionStoppedError } from "../src/modules/worker/claim";
import {
  runConversationToolLoop,
  setConversationModelInvokerForTest,
  conversationReadTools,
  desktopStatusTool,
  conversationToolBudget,
  type ConversationModelInvoker,
} from "../src/modules/assistant-runtime/conversation-tool-loop";
import {
  DEFAULT_MAX_TOOL_STEPS,
  MAX_TOOL_STEPS_CAP,
} from "../src/modules/supervisor/tools";
import type { ModelPolicy, ModelProfile, ModelToolSchema } from "../src/modules/model-gateway/types";
import type { SessionContext } from "../src/modules/identity/session";
import type { ToolContext } from "../src/modules/kern-contracts";

const session = {
  organizationId: "org-c2",
  userId: "user-c2",
  userEmail: "c2@hermes.test",
  userName: "C2",
} as SessionContext;

const profilesWithTools: ModelProfile[] = [
  {
    id: "p-tools",
    provider: "fake",
    modelId: "m",
    displayName: "Fake",
    capabilities: ["TEXT", "TOOLS"],
    locality: "LOCAL",
    health: "HEALTHY",
    enabled: true,
    qualityTier: "FAST",
    latencyTier: "FAST",
    costTier: "FREE",
  },
];
const profilesTextOnly: ModelProfile[] = [
  { ...profilesWithTools[0], id: "p-text", capabilities: ["TEXT"] },
];
const policy = {
  id: "pol-c2",
  version: "1",
  taskClass: "ASSISTANT_DIALOGUE",
  candidates: [{ profileId: "p-tools", priority: 0 }],
  requiredCapabilities: ["TEXT"],
  cloudAllowed: false,
  failurePolicy: { failureThreshold: 1, cooldownMs: 60_000 },
} as unknown as ModelPolicy;

const baseInput = {
  session,
  agentRunId: "run-c2",
  policy,
  taskClass: "ASSISTANT_DIALOGUE" as const,
  messages: [
    { role: "system", content: "你是 Kern。" },
    { role: "user", content: "问" },
  ],
};

type InvokeCall = Parameters<ConversationModelInvoker>[0];
function ok(text: string, usage?: { totalTokens: number }) {
  return { text, provenance: { provider: "fake", modelId: "m", modelRunId: `mr-${Math.random()}` }, ...(usage ? { usage } : {}) };
}
const block = (o: unknown) => "```kern-tool\n" + JSON.stringify(o) + "\n```";

function withInvoker(fn: ConversationModelInvoker, run: () => Promise<void>): Promise<void> {
  setConversationModelInvokerForTest(fn);
  return run().finally(() => setConversationModelInvokerForTest(null));
}

function withEnv(pairs: Record<string, string | undefined>, run: () => Promise<void>): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(pairs)) {
    saved[k] = process.env[k];
    if (pairs[k] === undefined) delete process.env[k];
    else process.env[k] = pairs[k]!;
  }
  return run().finally(() => {
    for (const k of Object.keys(pairs)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
  });
}

test("CT0：预算口径与 C1 同源（默认 12 步、上限 20）", () => {
  delete process.env.KERN_TOOL_MAX_STEPS;
  delete process.env.KERN_TOOL_BUDGET_TOKENS;
  delete process.env.KERN_TOOL_BUDGET_MS;
  const b = conversationToolBudget();
  assert.equal(b.maxSteps, DEFAULT_MAX_TOOL_STEPS);
  assert.equal(b.maxSteps <= MAX_TOOL_STEPS_CAP, true);
  assert.equal(b.maxTokens, 60_000);
  assert.equal(b.deadlineMs, 600_000);
});

test("CT1：先查知识再作答（原生协议；知识命中进引用与作答）", async () => {
  const seen: InvokeCall[] = [];
  let n = 0;
  await withInvoker(
    async (input) => {
      seen.push(input);
      n += 1;
      if (n === 1) {
        assert.ok(input.tools?.length, "原生协议必须随网关请求下发 tools schema");
        assert.deepEqual(input.messages.at(-1)?.role, "user");
        return {
          ...ok("", { totalTokens: 10 }),
          nativeToolCalls: [{ id: "c1", name: "knowledge_search", arguments: { query: "辅酶Q10 竞品价格" } }],
        };
      }
      const toolMsg = input.messages.at(-1);
      assert.equal(toolMsg?.role, "tool");
      assert.match(toolMsg!.content, /汤臣倍健 99 元/);
      return ok("结论：竞品汤臣倍健约 99 元（来源：知识库）", { totalTokens: 12 });
    },
    async () => {
      const out = await runConversationToolLoop({
        ...baseInput,
        profiles: profilesWithTools,
        toolContextOverrides: {
          searchKnowledge: async () => [{ title: "竞品表", snippet: "汤臣倍健 99 元", ref: "k1" }],
        },
      });
      assert.equal(out.incomplete, undefined);
      assert.match(out.text, /汤臣倍健约 99 元/);
      assert.equal(out.modelCalls, 2);
      assert.equal(out.toolCalls.length, 1);
      assert.equal(out.toolCalls[0].tool, "knowledge_search");
      assert.equal(out.toolCalls[0].ok, true);
      assert.deepEqual(
        out.citations.map((c) => c.ref),
        ["k1"]
      );
      // 两次模型调用的 usage 合计（记账口径）
      assert.deepEqual(out.usage, { inputTokens: 0, outputTokens: 0, totalTokens: 22 });
      assert.equal(out.protocolUsed, "native");
      assert.ok(out.modelRunId);
    }
  );
  assert.equal(seen.length, 2);
  assert.ok(seen[0].agentRunId === "run-c2" && seen[0].organizationId === "org-c2");
});

test("CT2：先算数再作答（无 TOOLS 能力的 profile → 文本协议）", async () => {
  const toolsSeen: (ModelToolSchema[] | undefined)[] = [];
  let n = 0;
  await withInvoker(
    async (input) => {
      toolsSeen.push(input.tools);
      n += 1;
      if (n === 1) return ok(block({ tool: "calculate", input: { expression: "(199-68)/199*100" } }));
      assert.match(input.messages.at(-1)!.content, /65\.82/);
      return ok("结论：毛利率约 65.83%");
    },
    async () => {
      const out = await runConversationToolLoop({ ...baseInput, profiles: profilesTextOnly });
      assert.equal(out.incomplete, undefined);
      assert.match(out.text, /毛利率约 65\.83%/);
      assert.equal(out.toolCalls.length, 1);
      assert.equal(out.toolCalls[0].tool, "calculate");
      assert.match(out.toolCalls[0].output, /\(199-68\)\/199\*100 = 65\.82/);
    }
  );
  assert.deepEqual(toolsSeen, [undefined, undefined], "无 TOOLS 能力时网关请求不带 tools");
});

test("CT3：先抓网页再作答（web_fetch 注入；AbortSignal 透传到工具）", async () => {
  let n = 0;
  let toolSignal: unknown = null;
  const controller = new AbortController();
  await withInvoker(
    async () => {
      n += 1;
      if (n === 1)
        return ok(block({ tool: "web_fetch", input: { url: "https://example.com/pricing" } }));
      return ok("结论：官网售价 129 元（来源：网页）");
    },
    async () => {
      const out = await runConversationToolLoop({
        ...baseInput,
        profiles: profilesTextOnly,
        signal: controller.signal,
        toolContextOverrides: {
          webFetch: async (url, signal) => {
            toolSignal = signal;
            assert.equal(url, "https://example.com/pricing");
            return { url, title: "价格页", text: "售价 129 元", truncated: false };
          },
        },
      });
      assert.match(out.text, /售价 129 元/);
      assert.equal(out.toolCalls[0].tool, "web_fetch");
      assert.equal(toolSignal, controller.signal, "调用方的 AbortSignal 必须透传到工具执行");
    }
  );
});

test("CT4：步数超预算——诚实 BUDGET_STEPS，不静默截断", async () => {
  let modelCalls = 0;
  await withEnv({ KERN_TOOL_MAX_STEPS: "1" }, () =>
    withInvoker(
      async () => {
        modelCalls += 1;
        return ok(block({ tool: "calculate", input: { expression: `1+${modelCalls}` } }));
      },
      async () => {
        const out = await runConversationToolLoop({ ...baseInput, profiles: profilesTextOnly });
        assert.equal(out.incomplete, "BUDGET_STEPS");
        assert.equal(modelCalls, 2);
        assert.equal(out.toolCalls.length, 1);
        assert.match(out.text, /步数预算已用完/);
        assert.match(out.text, /尚未形成可交付结果/);
      }
    )
  );
});

test("CT4b：token 超预算——usage 逐次累计，诚实 BUDGET_TOKENS", async () => {
  let modelCalls = 0;
  await withEnv({ KERN_TOOL_BUDGET_TOKENS: "50" }, () =>
    withInvoker(
      async () => {
        modelCalls += 1;
        return { ...ok(block({ tool: "calculate", input: { expression: `1+${modelCalls}` } }), { totalTokens: 40 }) };
      },
      async () => {
        const out = await runConversationToolLoop({ ...baseInput, profiles: profilesTextOnly });
        assert.equal(out.incomplete, "BUDGET_TOKENS");
        assert.equal(modelCalls, 2, "40 < 50 调第 2 次，80 ≥ 50 后不再调第 3 次");
        assert.match(out.text, /token 预算已用完/);
      }
    )
  );
});

test("CT5a：assertActive 中断——ExecutionStoppedError 如实上浮", async () => {
  let checks = 0;
  await withInvoker(
    async () => ok(block({ tool: "calculate", input: { expression: "1+1" } })),
    async () => {
      await assert.rejects(
        runConversationToolLoop({
          ...baseInput,
          profiles: profilesTextOnly,
          assertActive: async () => {
            checks += 1;
            if (checks >= 2) throw new ExecutionStoppedError();
          },
        }),
        (e) => e instanceof ExecutionStoppedError
      );
    }
  );
});

test("CT5b：AbortSignal 中断——工具执行前抛出 AbortError", async () => {
  const controller = new AbortController();
  await withInvoker(
    async () => {
      controller.abort();
      return ok(block({ tool: "calculate", input: { expression: "1+1" } }));
    },
    async () => {
      await assert.rejects(
        runConversationToolLoop({ ...baseInput, profiles: profilesTextOnly, signal: controller.signal }),
        (e: unknown) => (e as Error).name === "AbortError"
      );
    }
  );
});

test("CT6：对话只开放只读工具——ask_user 注入也进不了候选", async () => {
  const ctx = {
    organizationId: "org-c2",
    askUser: async () => ({ mode: "ignore" as const }),
  } as ToolContext;
  const tools = conversationReadTools(ctx, () => ({
    status: "UNKNOWN",
    deviceId: null,
    lastSeenAt: null,
    secondsSinceLastSeen: null,
    label: "未确认",
    hint: null,
  }));
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ["calculate", "desktop_status", "knowledge_search"].sort(),
    "即使 ctx 注入了 askUser，对话候选也只留只读工具"
  );
  assert.ok(tools.every((t) => t.risk === "read"));

  let n = 0;
  await withInvoker(
    async () => {
      n += 1;
      if (n === 1) return ok(block({ tool: "ask_user", input: { question: "Q?", defaultAssumption: "D" } }));
      return ok("结论");
    },
    async () => {
      const out = await runConversationToolLoop({
        ...baseInput,
        profiles: profilesTextOnly,
        toolContextOverrides: { askUser: async () => ({ mode: "ignore" }) },
      });
      assert.equal(out.toolCalls[0].tool, "ask_user");
      assert.equal(out.toolCalls[0].ok, false);
      assert.match(out.toolCalls[0].output, /没有名为 ask_user 的工具/);
    }
  );
  assert.equal(n, 2);
});

test("CT8：显式提供搜索和爬取时开放对应工具", async () => {
  const seen: InvokeCall[] = [];
  await withEnv({ KERN_WEB_FETCH: "on", KERN_CRAWL: "on" }, () => withInvoker(
    async input => { seen.push(input); return ok("结论：无需执行工具"); },
    async () => {
      await runConversationToolLoop({
        ...baseInput, profiles: profilesWithTools,
        toolContextOverrides: { webSearch: async () => [], webCrawl: async () => [] },
      });
    }
  ));
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].tools!.map(tool => tool.name).sort(),
    ["calculate", "desktop_status", "knowledge_search", "web_fetch", "web_search", "web_crawl"].sort());
});

test("CT7：网关缝形状——原生下发 tools + requiredCapabilities TOOLS", async () => {
  const seen: InvokeCall[] = [];
  await withInvoker(
    async (input) => {
      seen.push(input);
      return ok("结论：无工具需求");
    },
    async () => {
      await withEnv({ KERN_WEB_FETCH: "on" }, () => runConversationToolLoop({
        ...baseInput, profiles: profilesWithTools,
        toolContextOverrides: { webSearch: undefined, webCrawl: undefined },
      }).then(() => undefined));
    }
  );
  assert.equal(seen.length, 1);
  const names = seen[0].tools!.map((t) => t.name).sort();
  // 显式固定提供方与 web_fetch 开关，测试不依赖本机配置。
  assert.deepEqual(names, ["calculate", "desktop_status", "knowledge_search", "web_fetch"].sort());
  // 生产 invoker 会把这组 tools + requiredCapabilities ["TOOLS"] 原样送进
  // executePersistedModelGateway（见 conversation-tool-loop 默认 invoker）；
  // DB 回归用真实网关 + 账本行数证明每次模型调用都被持久化记账。
});
