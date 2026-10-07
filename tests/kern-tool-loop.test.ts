import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateExpression, makeAskUserTool, parseToolCall, runToolLoop, toolInstructions, BUILTIN_TOOLS, MAX_TOOL_STEPS } from "../src/modules/supervisor/tools";
import { computePendingAsks } from "../src/modules/supervisor/service";
import { buildLanes, describeEvent, type MissionEvent } from "../src/app/muse/mission-timeline";

type Msg = { role: "system" | "user" | "assistant"; content: string };
const block = (o: unknown) => "```kern-tool\n" + JSON.stringify(o) + "\n```";
const ok = (text: string) => ({ text, provenance: { provider: "fake", modelId: "m" } });

test("TL1：计算器正确且拒绝非算式", () => {
  assert.equal(evaluateExpression("(199-68)/199*100"), ((199 - 68) / 199) * 100);
  assert.equal(evaluateExpression("2^3^2"), 512);
  assert.equal(evaluateExpression("-3+1,000×2"), 1997);
  assert.throws(() => evaluateExpression("process.exit()"));
  assert.throws(() => evaluateExpression("1/0"));
  assert.throws(() => evaluateExpression("(1+2"));
});

test("TL2：解析工具块；非法 JSON 给出错误而非抛出", () => {
  assert.equal(parseToolCall("普通回答"), null);
  assert.deepEqual(parseToolCall(block({ tool: "calculate", input: { expression: "1+1" } })), { tool: "calculate", input: { expression: "1+1" } });
  assert.deepEqual(parseToolCall("```kern-tool\n{bad\n```"), { error: "工具块不是合法 JSON" });
});

test("TL13：批量定价核验在一次工具调用内计算六项，仍拒绝非法算式与超量输入", async () => {
  const calculate = BUILTIN_TOOLS.find(t => t.name === "calculate")!;
  const ctx = { organizationId: "o" };
  const expressions = ["199-68-199*0.15-12", "169-68-169*0.15-12", "89.15/199*100", "63.65/169*100", "30000/89.15", "30000/63.65"];
  const result = await calculate.run({ expressions }, ctx);
  assert.equal(result.ok, true);
  assert.match(result.output, /169-68-169\*0\.15-12 = 63\.65/);
  assert.match(result.output, /30000\/63\.65 = 471\.327/);
  assert.equal(result.output.split("\n").length, 6);
  for (const input of [{ expressions: [] }, { expressions: Array(9).fill("1+1") }, { expressions: ["1+1", "process.exit()"] }, { expressions: [1] }, { expressions: ["1/0"] }]) {
    assert.equal((await calculate.run(input, ctx)).ok, false);
  }
});

test("TL3：调用工具 → 观察回喂 → 最终答案；记录每次调用与引用", async () => {
  const seen: Msg[][] = [];
  const replies = [
    block({ tool: "knowledge_search", input: { query: "喂食器 竞品" } }),
    block({ tool: "calculate", input: { expression: "199*0.4" } }),
    "## 结论\n毛利约 79.6 元（事实：知识库）",
  ];
  const tools: string[] = [];
  let modelCalls = 0;
  const out = await runToolLoop({
    messages: [{ role: "user", content: "go" }],
    invoke: async (m) => { seen.push(m); return ok(replies[seen.length - 1]); },
    ctx: { organizationId: "o", searchKnowledge: async () => [{ title: "竞品表", snippet: "小佩 299 元", ref: "k1" }] },
    onModelCall: () => { modelCalls += 1; },
    onToolCall: (r) => { tools.push(`${r.tool}:${r.ok}`); },
  });
  assert.ok(!("unavailable" in out));
  assert.match((out as { text: string }).text, /79\.6/);
  assert.deepEqual(tools, ["knowledge_search:true", "calculate:true"]);
  assert.equal(modelCalls, 3);
  assert.equal(out.toolCalls?.[0].citations[0].title, "竞品表");
  assert.match(seen[2].at(-1)!.content, /199\*0\.4 = 79\.6/);
});

test("TL4：未知工具与工具异常作为观察回喂，不中断节点", async () => {
  let n = 0;
  const out = await runToolLoop({
    messages: [],
    invoke: async (m) => {
      n += 1;
      if (n === 1) return ok(block({ tool: "web_fetch", input: {} }));
      if (n === 2) { assert.match(m.at(-1)!.content, /没有名为 web_fetch 的工具/); return ok(block({ tool: "knowledge_search", input: { query: "x" } })); }
      assert.match(m.at(-1)!.content, /工具执行出错：db down/);
      return ok("结论：UNKNOWN");
    },
    ctx: { organizationId: "o", searchKnowledge: async () => { throw new Error("db down"); } },
  });
  assert.equal((out as { text: string }).text, "结论：UNKNOWN");
  assert.deepEqual(out.toolCalls?.map((c) => c.ok), [false, false]);
});

test("TL5：步数有上限，超限工具请求不算可交付结论", async () => {
  let n = 0;
  const out = await runToolLoop({
    messages: [],
    invoke: async () => { n += 1; return ok("还想再算\n" + block({ tool: "calculate", input: { expression: "1+1" } })); },
    ctx: { organizationId: "o" },
  });
  assert.equal(n, MAX_TOOL_STEPS + 1);
  assert.equal(out.toolCalls?.length, MAX_TOOL_STEPS);
  assert.equal(out.incomplete, "TOOL_LIMIT");
  assert.match((out as { text: string }).text, /尚未形成可交付结果/);
  assert.equal(parseToolCall((out as { text: string }).text), null);
});

test("TL11：超限的 XML 与裸工具请求都明确未完成，且不增加工具或模型费用", async () => {
  for (const request of [
    '<tool_call>{"name":"calculate","arguments":{"expression":"1+1"}}</tool_call>',
    'kern-tool\n{"tool":"calculate","input":{"expression":"1+1"}}',
    '```kern-tool\n{bad\n```',
  ]) {
    let modelCalls = 0;
    let toolCalls = 0;
    const out = await runToolLoop({ messages: [], maxSteps: 1,
      invoke: async () => { modelCalls++; return ok(modelCalls === 1 ? block({ tool: "calculate", input: { expression: "1+1" } }) : request); },
      ctx: { organizationId: "o" }, onToolCall: () => { toolCalls++; },
    });
    assert.equal(modelCalls, 2);
    assert.equal(toolCalls, 1);
    assert.equal(out.incomplete, "TOOL_LIMIT");
    assert.equal(parseToolCall((out as { text: string }).text), null);
    assert.equal(out.toolCalls?.[0].output, "1+1 = 2");
  }
});

test("TL12：最后一次模型确实给出答案时正常完成；空回答仍未完成", async () => {
  for (const answer of ["结论：2", "   "]) {
    let modelCalls = 0;
    const out = await runToolLoop({ messages: [], maxSteps: 1,
      invoke: async () => ok(++modelCalls === 1 ? block({ tool: "calculate", input: { expression: "1+1" } }) : answer),
      ctx: { organizationId: "o" },
    });
    assert.equal(modelCalls, 2);
    assert.equal(out.incomplete, answer.trim() ? undefined : "EMPTY_OUTPUT");
    assert.equal(out.toolCalls?.length, 1);
    if (answer.trim()) assert.equal((out as { text: string }).text, answer);
  }
});

test("TL6：模型不可用直接返回，不进入工具", async () => {
  const out = await runToolLoop({ messages: [], invoke: async () => ({ unavailable: "none" }), ctx: { organizationId: "o" } });
  assert.deepEqual(out, { unavailable: "none" });
});

test("TL7：提示词列出工具与上限", () => {
  const s = toolInstructions();
  assert.match(s, /knowledge_search/);
  assert.match(s, /calculate/);
  assert.match(s, new RegExp(`最多调用 ${MAX_TOOL_STEPS} 次`));
});

test("TL9：ask_user 每步最多问一次；忽略时回喂默认假设", async () => {
  const asks: string[] = [];
  const ask = (q: string) => block({ tool: "ask_user", input: { question: q, defaultAssumption: "中端价位" } });
  let n = 0;
  const out = await runToolLoop({
    messages: [],
    tools: [...BUILTIN_TOOLS, makeAskUserTool()],
    invoke: async (m) => {
      n += 1;
      if (n === 1) return ok(ask("价位？"));
      if (n === 2) { assert.match(m.at(-1)!.content, /选择不回答。按默认假设继续：中端价位/); return ok(ask("再问一次")); }
      assert.match(m.at(-1)!.content, /已经问过一次/);
      return ok("结论");
    },
    ctx: { organizationId: "o", askUser: async (q) => { asks.push(q.question); return { mode: "ignore" }; } },
  });
  assert.equal((out as { text: string }).text, "结论");
  assert.deepEqual(asks, ["价位？"]);
});

test("TL10：未回答的提问 = ask 减去 answered", () => {
  const at = "2026-09-28T00:00:00.000Z";
  const open = computePendingAsks([
    { type: "node.ask", nodeKey: "market", payload: { askId: "a", question: "Q1", defaultAssumption: "D", timeoutSec: 300 }, createdAt: at },
    { type: "node.ask", nodeKey: "gtm", payload: { askId: "b", question: "Q2", defaultAssumption: "D" }, createdAt: at },
    { type: "node.answered", nodeKey: "market", payload: { askId: "a", mode: "answer", text: "x" }, createdAt: at },
  ]);
  assert.deepEqual(open.map((a) => [a.askId, a.nodeKey, a.timeoutSec]), [["b", "gtm", null]]);
});

test("TL8：过程页把工具调用单独展示，并有一句话描述", () => {
  const at = "2026-09-28T00:00:00.000Z";
  const ev = (seq: number, type: string, payload: Record<string, unknown>): MissionEvent =>
    ({ seq, type, nodeKey: "market", payload, createdAt: at }) as unknown as MissionEvent;
  const events = [
    ev(1, "node.started", { agentCode: "research_agent" }),
    ev(2, "node.tool", { tool: "model_call", ok: true, latencyMs: 10, model: "m" }),
    ev(3, "node.tool", { tool: "knowledge_search", ok: true, input: '{"query":"竞品价格"}', output: "[1] 竞品表", latencyMs: 5 }),
  ];
  const lane = buildLanes(null, events)[0];
  assert.equal(lane.attempts[0].modelCalls.length, 1);
  assert.equal(lane.attempts[0].toolCalls[0].label, "知识库检索");
  assert.match(describeEvent(events[2])!.text, /使用工具：知识库检索「竞品价格」/);
});
