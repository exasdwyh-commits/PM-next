import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_MAX_TOOL_STEPS,
  MAX_TOOL_STEPS_CAP,
  BUILTIN_TOOLS,
  evaluateExpression,
  incompleteToReason,
  makeAskUserTool,
  parseToolCall,
  resolveToolStepLimit,
  runToolLoop,
  toolInstructions,
  toolSchemasFor,
  usageTokensOf,
} from "../src/modules/supervisor/tools";
import type { KernTool } from "../src/modules/kern-contracts";
import { computePendingAsks } from "../src/modules/supervisor/service";
import { buildLanes, describeEvent, type MissionEvent } from "../src/app/muse/mission-timeline";

type Msg = { role: "system" | "user" | "assistant" | "tool"; content: string; toolCalls?: unknown[]; toolCallId?: string };
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

test("TL5：步数有上限（默认 12），超限工具请求不算可交付结论", async () => {
  delete process.env.KERN_TOOL_MAX_STEPS;
  let n = 0;
  const out = await runToolLoop({
    messages: [],
    invoke: async () => { n += 1; return ok("还想再算\n" + block({ tool: "calculate", input: { expression: `1+${n}` } })); },
    ctx: { organizationId: "o" },
  });
  assert.equal(n, DEFAULT_MAX_TOOL_STEPS + 1);
  assert.equal(out.toolCalls?.length, DEFAULT_MAX_TOOL_STEPS);
  assert.equal(out.incomplete, "BUDGET_STEPS");
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
    assert.equal(out.incomplete, "BUDGET_STEPS");
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

test("TL7：提示词列出工具与上限（上限与执行侧同源）", () => {
  delete process.env.KERN_TOOL_MAX_STEPS;
  const s = toolInstructions();
  assert.match(s, /knowledge_search/);
  assert.match(s, /calculate/);
  assert.match(s, new RegExp(`最多调用 ${DEFAULT_MAX_TOOL_STEPS} 次`));
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

// ---------------------------------------------------------------------------
// C1：预算贯通 / per-tool 超时 / 截断 / 去重 / 原生 function calling
// ---------------------------------------------------------------------------

test("TL14：步数预算可配置——默认 12、KERN_TOOL_MAX_STEPS 覆盖、上限 20", () => {
  assert.equal(DEFAULT_MAX_TOOL_STEPS, 12);
  assert.equal(MAX_TOOL_STEPS_CAP, 20);
  assert.equal(resolveToolStepLimit({}), 12);
  assert.equal(resolveToolStepLimit({ KERN_TOOL_MAX_STEPS: "7" }), 7);
  assert.equal(resolveToolStepLimit({ KERN_TOOL_MAX_STEPS: "1" }), 1);
  assert.equal(resolveToolStepLimit({ KERN_TOOL_MAX_STEPS: "0" }), 12);
  assert.equal(resolveToolStepLimit({ KERN_TOOL_MAX_STEPS: "-3" }), 12);
  assert.equal(resolveToolStepLimit({ KERN_TOOL_MAX_STEPS: "abc" }), 12);
  assert.equal(resolveToolStepLimit({ KERN_TOOL_MAX_STEPS: "999" }), 20, "超过上限钳制到 20");
  delete process.env.KERN_TOOL_MAX_STEPS;
  assert.match(toolInstructions(BUILTIN_TOOLS), /最多调用 12 次/);
  assert.match(toolInstructions(BUILTIN_TOOLS, 7), /最多调用 7 次/);
});

test("TL15：时长预算 deadlineMs——耗尽后停止发起模型调用，诚实 BUDGET_TIME", async () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let modelCalls = 0;
  const out = await runToolLoop({
    messages: [],
    budget: { maxSteps: 10, deadlineMs: 60 },
    invoke: async () => { modelCalls++; await sleep(40); return ok(block({ tool: "calculate", input: { expression: `1+${modelCalls}` } })); },
    ctx: { organizationId: "o" },
  });
  assert.equal(out.incomplete, "BUDGET_TIME");
  assert.ok(modelCalls >= 1 && modelCalls <= 3, `时长预算耗尽后应停止模型调用，实际 ${modelCalls}`);
  assert.ok((out.toolCalls?.length ?? 0) < 10, "工具执行数应少于步数预算，说明是时长先触发");
  assert.match((out as { text: string }).text, /时长预算已用完/);
});

test("TL16：token 预算 maxTokens——usage 逐次累计，耗尽不再调用，诚实 BUDGET_TOKENS", async () => {
  assert.equal(usageTokensOf({ totalTokens: 10 }), 10);
  assert.equal(usageTokensOf({ outputTokens: 7 }), 7);
  assert.equal(usageTokensOf({ totalTokens: 0, outputTokens: 5 }), 5);
  assert.equal(usageTokensOf(null), 0);
  assert.equal(usageTokensOf(undefined), 0);

  let n = 0;
  const out = await runToolLoop({
    messages: [],
    budget: { maxSteps: 10, maxTokens: 100 },
    invoke: async () => {
      n++;
      return { ...ok(block({ tool: "calculate", input: { expression: `1+${n}` } })), usage: { totalTokens: 40 } };
    },
    ctx: { organizationId: "o" },
  });
  assert.equal(out.incomplete, "BUDGET_TOKENS");
  assert.equal(n, 3, "3 次调用累计 120 tokens ≥ 100，第 4 次模型调用不得发起");
  assert.equal(out.toolCalls?.length, 3);
  assert.match((out as { text: string }).text, /token 预算已用完/);
});

test("TL17：per-tool 超时——超时变成失败观察回喂，循环不崩溃", async () => {
  const slow: KernTool = {
    ...BUILTIN_TOOLS.find((t) => t.name === "calculate")!,
    run: async () => new Promise((r) => setTimeout(() => r({ ok: true, output: "迟到的结果" }), 300)),
  };
  let n = 0;
  const out = await runToolLoop({
    messages: [],
    tools: [slow],
    perToolTimeoutMs: 50,
    invoke: async (m) => {
      n++;
      if (n === 1) return ok(block({ tool: "calculate", input: { expression: "1+1" } }));
      assert.match(m.at(-1)!.content, /执行超时/);
      assert.match(m.at(-1)!.content, /不要编造/);
      return ok("结论：该计算标记 UNKNOWN");
    },
    ctx: { organizationId: "o" },
  });
  assert.equal(n, 2);
  assert.equal(out.toolCalls?.[0].ok, false);
  assert.match(out.toolCalls?.[0].output, /超时/);
  assert.equal((out as { text: string }).text, "结论：该计算标记 UNKNOWN");
});

test("TL18：相同调用去重——只读同名同参复用结果不重复执行；写/审批工具不去重", async () => {
  let calculateRuns = 0;
  let writeRuns = 0;
  const calculate: KernTool = {
    ...BUILTIN_TOOLS.find((t) => t.name === "calculate")!,
    run: async (input) => { calculateRuns++; return { ok: true, output: `${input.expression} = 2` }; },
  };
  const writeTool: KernTool = {
    name: "fake_write", label: "写", description: "d", inputHint: "{}", risk: "ask",
    run: async () => { writeRuns++; return { ok: false, output: "blocked: approval-required" }; },
  };
  let n = 0;
  const out = await runToolLoop({
    messages: [],
    tools: [calculate, writeTool],
    invoke: async (m) => {
      n++;
      if (n === 1) return ok(block({ tool: "calculate", input: { expression: "1+1" } }));
      if (n === 2) {
        assert.match(m.at(-1)!.content, /1\+1 = 2/);
        return ok(block({ tool: "calculate", input: { expression: "1+1" } }));
      }
      if (n === 3) {
        assert.match(m.at(-1)!.content, /未重复执行/);
        return ok(block({ tool: "fake_write", input: {} }));
      }
      if (n === 4) {
        assert.match(m.at(-1)!.content, /approval-required/);
        return ok(block({ tool: "fake_write", input: {} }));
      }
      if (n === 5) {
        assert.match(m.at(-1)!.content, /approval-required/);
        return ok("结论：已记录");
      }
      throw new Error("too many model calls");
    },
    ctx: { organizationId: "o" },
  });
  assert.equal(calculateRuns, 1, "只读同名同参只真实执行一次");
  assert.equal(writeRuns, 2, "写/审批工具每次都真实执行（要过凭据检查）");
  assert.equal(out.toolCalls?.length, 4);
  const dedup = out.toolCalls?.find((c) => c.deduplicated);
  assert.ok(dedup && dedup.tool === "calculate");
  assert.equal((out as { text: string }).text, "结论：已记录");
});

test("TL19：工具结果截断——超长输出截断进观察，记录标记 truncated", async () => {
  const big: KernTool = {
    name: "big", label: "大输出", description: "d", inputHint: "{}", risk: "read",
    run: async () => ({ ok: true, output: "x".repeat(5000) }),
  };
  let n = 0;
  const out = await runToolLoop({
    messages: [],
    tools: [big],
    maxToolOutputChars: 100,
    invoke: async (m) => {
      n++;
      if (n === 1) return ok(block({ tool: "big", input: {} }));
      assert.doesNotMatch(m.at(-1)!.content, /x{101}/, "观察里不应出现超过截断上限的原文");
      return ok("结论");
    },
    ctx: { organizationId: "o" },
  });
  assert.equal(out.toolCalls?.[0].truncated, true);
  assert.equal(out.toolCalls?.[0].output.length, 100);
});

test("TL20：同一任务在原生/文本两种协议下结果对拍——相同工具序列与最终答案", async () => {
  const steps = [
    { tool: "knowledge_search", input: { query: "竞品价格" } },
    { tool: "calculate", input: { expressions: ["299-99", "200/299*100"] } },
  ];
  const final = "## 结论\n小佩毛利约 200 元（事实：知识库 + 计算）";
  const run = (protocol: "native" | "text") =>
    runToolLoop({
      messages: [{ role: "user", content: "分析竞品" }],
      tools: [...BUILTIN_TOOLS],
      ...(protocol === "native" ? { nativeTools: toolSchemasFor(BUILTIN_TOOLS), protocol } : { protocol }),
      ctx: { organizationId: "o", searchKnowledge: async () => [{ title: "竞品表", snippet: "小佩 299 元", ref: "k1" }] },
      invoke: async (msgs, opts) => {
        const idx = opts?.toolProtocol === "native"
          ? msgs.filter((m) => m.role === "tool").length
          : msgs.filter((m) => m.content.includes("## 工具结果")).length;
        if (opts?.toolProtocol === "native") {
          assert.ok(opts.nativeTools?.length, "原生协议必须随请求下发 tools schema");
          if (idx < steps.length) {
            return { text: "", provenance: {}, nativeToolCalls: [{ id: `n${idx + 1}`, name: steps[idx].tool, arguments: steps[idx].input }] };
          }
          return { text: final, provenance: {} };
        }
        if (idx < steps.length) return ok(block(steps[idx]));
        return ok(final);
      },
    });
  const nativeOut = await run("native");
  const textOut = await run("text");
  assert.equal((nativeOut as { text: string }).text, final);
  assert.equal((textOut as { text: string }).text, final);
  assert.deepEqual(nativeOut.toolCalls?.map((c) => [c.tool, c.input]), textOut.toolCalls?.map((c) => [c.tool, c.input]));
  assert.deepEqual(nativeOut.toolCalls?.map((c) => c.ok), [true, true]);
  assert.equal(nativeOut.protocolUsed, "native");
  assert.equal(textOut.protocolUsed, undefined, "纯文本协议不做协议标注");
});

test("TL21：原生调用失败时自动回落文本协议，本步重做、后续保持文本", async () => {
  const seen: string[] = [];
  const out = await runToolLoop({
    messages: [],
    nativeTools: toolSchemasFor(BUILTIN_TOOLS),
    invoke: async (_msgs, opts) => {
      seen.push(opts?.toolProtocol ?? "?");
      if (opts?.toolProtocol === "native") throw new Error("模型调用失败且禁止 fallback：BAD_REQUEST");
      if (seen.filter((s) => s === "text").length === 1) return ok(block({ tool: "calculate", input: { expression: "1+1" } }));
      return ok("结论：回落成功");
    },
    ctx: { organizationId: "o" },
  });
  assert.equal((out as { text: string }).text, "结论：回落成功");
  assert.deepEqual(seen, ["native", "text", "text"], "本步先 native 失败、再 text 重做；后续步骤保持 text");
  assert.equal(out.protocolUsed, "text");
  assert.equal(out.toolCalls?.length, 1);
});

test("TL22：显式 native 协议失败不回落，如实抛出", async () => {
  await assert.rejects(
    runToolLoop({
      messages: [],
      nativeTools: toolSchemasFor(BUILTIN_TOOLS),
      protocol: "native",
      invoke: async () => { throw new Error("模型调用失败且禁止 fallback：BAD_REQUEST"); },
      ctx: { organizationId: "o" },
    }),
    /禁止 fallback/
  );
});

test("TL23：原生工具参数非法——作为观察回喂，不执行、不崩溃", async () => {
  let runs = 0;
  const calculate: KernTool = {
    ...BUILTIN_TOOLS.find((t) => t.name === "calculate")!,
    run: async () => { runs++; return { ok: true, output: "不应该执行" }; },
  };
  let n = 0;
  const out = await runToolLoop({
    messages: [],
    tools: [calculate],
    nativeTools: toolSchemasFor([calculate]),
    invoke: async (m) => {
      n++;
      if (n === 1) {
        return { text: "", provenance: {}, nativeToolCalls: [{ id: "bad1", name: "calculate", arguments: {}, argumentError: "arguments 不是合法 JSON" }] };
      }
      assert.match(m.at(-1)!.content, /工具参数无效/);
      return ok("结论：参数损坏已如实上报");
    },
    ctx: { organizationId: "o" },
  });
  assert.equal(runs, 0);
  assert.equal(out.toolCalls?.[0].ok, false);
  assert.match(out.toolCalls?.[0].output, /参数无效/);
  assert.equal((out as { text: string }).text, "结论：参数损坏已如实上报");
});

test("TL24：maxSteps 参数优先于 budget.maxSteps；99 步被钳制到上限 20", async () => {
  let n = 0;
  const out = await runToolLoop({
    messages: [],
    maxSteps: 2,
    budget: { maxSteps: 9 },
    invoke: async () => { n++; return ok(block({ tool: "calculate", input: { expression: `1+${n}` } })); },
    ctx: { organizationId: "o" },
  });
  assert.equal(n, 3);
  assert.equal(out.toolCalls?.length, 2);
  assert.equal(out.incomplete, "BUDGET_STEPS");

  n = 0;
  const big = await runToolLoop({
    messages: [],
    budget: { maxSteps: 99 },
    invoke: async () => { n++; return ok(block({ tool: "calculate", input: { expression: `${n}+${n}` } })); },
    ctx: { organizationId: "o" },
  });
  assert.equal(n, 21, "99 钳制到 20：20 次工具执行 + 1 次超限请求");
  assert.equal(big.toolCalls?.length, 20);
  assert.equal(big.incomplete, "BUDGET_STEPS");
});

test("TL25：incomplete → 诚实 BLOCKED reason 映射", () => {
  assert.equal(incompleteToReason("BUDGET_STEPS"), "BUDGET_STEPS");
  assert.equal(incompleteToReason("BUDGET_TOKENS"), "BUDGET_TOKENS");
  assert.equal(incompleteToReason("BUDGET_TIME"), "BUDGET_TIME");
  assert.equal(incompleteToReason("EMPTY_OUTPUT"), "OUTPUT_INCOMPLETE:EMPTY_OUTPUT");
});
