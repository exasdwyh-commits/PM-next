import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assembleCompressedHistory,
  estimateMessagesTokens,
  estimateTokens,
  extractKeyConstraints,
  renderSummaryBlock,
  RollingSummaryCache,
  splitHistory,
} from "../src/modules/history-compression";
import { resolveAuxModelSlot } from "../src/modules/model-gateway/aux-slots";
import { buildAdvisorLLMMessages } from "../src/modules/advisor/llm";

/** 构造 N 轮长会话 fixture：user 短问 + assistant 长答，混中英文，长度贴近真实 */
function buildLongSession(rounds: number): { role: string; content: string }[] {
  const turns: { role: string; content: string }[] = [];
  const topics = ["Q3 销售数据分析", "新品上市节奏", "渠道库存水位", "竞品价格跟踪", "用户复购率"];
  for (let i = 1; i <= rounds; i++) {
    const topic = topics[i % topics.length];
    let user = `第${i}轮：请帮我看一下${topic}，重点标出异常波动，并给出下一步建议。`;
    if (i === 3) user += "另外记住一条长期规则：报价不得高于50万，任何方案都要先过这一关。";
    if (i === 7) user += "还有，回复必须带引用来源，没有来源的数据不要写进结论。";
    const assistant =
      `第${i}轮分析（${topic}）：本期核心指标环比变化 ${((i * 37) % 19) - 9}% ` +
      "主要驱动来自华东与华南两个大区。异常点有两处，一是 9 月中旬的促销透支了部分需求，" +
      "二是某竞品在同一时段降价 8%，分流了价格敏感型用户。建议：1）未来两周暂停大额折扣，" +
      "观察自然流量回升情况；2）针对竞品降价的 SKU 做一轮小批量买赠测试，验证价格弹性；" +
      "3）把复购人群单独建包，推送会员专享价。以上结论基于现有报表口径，口径变化时需重算。" +
      "Detailed metrics: conversion uplift, CAC payback and inventory turnover are within normal bands.";
    turns.push({ role: "user", content: user });
    turns.push({ role: "assistant", content: assistant });
  }
  return turns;
}

test("C3-1：60 轮长会话，旧方式（全量原文）vs 新方式（近期原文+远期摘要）token 对比", async () => {
  const turns = buildLongSession(60); // 120 条消息
  const oldMessages = turns.map((t) => ({
    role: t.role === "user" ? "user" : "assistant",
    content: t.content,
  }));
  const oldTokens = estimateMessagesTokens(oldMessages);

  const fakeSummary =
    "远期摘要：用户持续跟踪 Q3 销售、新品节奏、库存与竞品价格；助手每轮给出波动分析与三条建议；" +
    "长期规则：报价不得高于50万；回复必须带引用来源。";
  const assembled = await assembleCompressedHistory({
    turns,
    keepRecentTurns: 10,
    maxChars: 2000,
    summarize: async () => fakeSummary,
  });
  assert.ok(assembled.summaryBlock, "应产出摘要块");
  assert.equal(assembled.recent.length, 10);
  const newMessages = [
    { role: "system", content: assembled.summaryBlock! },
    ...assembled.recent.map((t) => ({
      role: t.role === "user" ? "user" : "assistant",
      content: t.content,
    })),
  ];
  const newTokens = estimateMessagesTokens(newMessages);

  // 证据数字：打印出来供 PR 描述引用
  console.log(`[C3-1] 旧方式全量原文 ≈ ${oldTokens} tokens；新方式 ≈ ${newTokens} tokens；压缩比 ≈ ${(newTokens / oldTokens).toFixed(2)}`);
  assert.ok(newTokens < oldTokens * 0.35, `新方式应显著小于旧方式（${newTokens} vs ${oldTokens}）`);
});

test("C3-2：摘要不得丢失关键约束——远期轮次里的约束必须原文保留在摘要区", async () => {
  const turns = buildLongSession(60);
  const assembled = await assembleCompressedHistory({
    turns,
    keepRecentTurns: 5, // 约束在第 3/7 轮，必进远期摘要段
    maxChars: 2000,
    // 假摘要器故意不提约束，验证约束靠提取逻辑、而非模型复述来保留
    summarize: async () => "通用摘要：讨论了销售与新品话题。",
  });
  const block = assembled.summaryBlock ?? "";
  assert.ok(
    block.includes("报价不得高于50万"),
    "约束「报价不得高于50万」必须原文出现在摘要区"
  );
  assert.ok(
    block.includes("回复必须带引用来源"),
    "约束「回复必须带引用来源」必须原文出现在摘要区"
  );
});

test("C3-3：摘要块受长度上限约束，约束区优先保", () => {
  const block = renderSummaryBlock({
    summaryText: "摘".repeat(10_000),
    constraints: ["报价不得高于50万。", "回复必须带引用来源。"],
    maxChars: 2000,
  });
  assert.ok(block.length <= 2000, `摘要块长度 ${block.length} 应 ≤2000`);
  assert.ok(block.includes("报价不得高于50万"), "截断后约束仍保留");
});

test("C3-4：辅助模型位未配置时禁用摘要、走原文，不崩溃", async () => {
  const saved: Record<string, string | undefined> = {};
  for (const k of ["KERN_AUX_SUMMARY_MODEL_ID", "KERN_AUX_SUMMARY_BASE_URL", "KERN_AUX_SUMMARY_API_KEY"]) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  try {
    assert.equal(resolveAuxModelSlot("summary"), null);
    const turns = buildLongSession(60).filter((t) => !t.content.includes("不得") && !t.content.includes("必须"));
    const assembled = await assembleCompressedHistory({
      turns,
      keepRecentTurns: 10,
      maxChars: 2000,
      // 不注入 summarize → 走默认（读 env），env 为空应降级
    });
    assert.equal(assembled.summaryBlock, null, "无约束+无配置时摘要块为 null，调用方走旧行为");
    assert.equal(assembled.recent.length, 10, "近期原文不受影响");
    assert.equal(assembled.summaryUsed, false);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("C3-5：滚动摘要增量——第二轮只摘要新增的远期轮次", async () => {
  const cache = new RollingSummaryCache();
  const calls: { prevSummary: string | null; segmentText: string }[] = [];
  const summarize = async (input: { prevSummary: string | null; segmentText: string; maxChars: number }) => {
    calls.push({ prevSummary: input.prevSummary, segmentText: input.segmentText });
    return `摘要v${calls.length}`;
  };
  const turns1 = buildLongSession(15); // 30 条
  await assembleCompressedHistory({
    turns: turns1, keepRecentTurns: 10, maxChars: 2000,
    cacheKey: "conv:test", cache, summarize,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].prevSummary, null);
  const firstSegmentLen = calls[0].segmentText.length;

  const turns2 = buildLongSession(18); // 新增 3 轮=6 条，远期从 20 条 → 26 条
  const a2 = await assembleCompressedHistory({
    turns: turns2, keepRecentTurns: 10, maxChars: 2000,
    cacheKey: "conv:test", cache, summarize,
  });
  assert.equal(calls.length, 2, "第二轮应触发增量摘要");
  assert.equal(calls[1].prevSummary, "摘要v1", "增量摘要应承接上一版");
  assert.ok(
    calls[1].segmentText.length < firstSegmentLen,
    `增量段(${calls[1].segmentText.length})应小于全量段(${firstSegmentLen})`
  );
  assert.ok(a2.summaryUsed);
});

test("C3-6：buildAdvisorLLMMessages 接摘要块；不传时行为不变", () => {
  const history = [
    { role: "USER", content: "第一轮问题" },
    { role: "ASSISTANT", content: "第一轮回答" },
  ];
  const withBlock = buildAdvisorLLMMessages({
    history, currentQuery: "追问", toolKey: "t", toolResultText: "d",
    summaryBlock: "## 历史滚动摘要\n远期内容摘要",
  });
  assert.ok(withBlock.some((m) => m.role === "system" && m.content.includes("远期内容摘要")));

  const withoutBlock = buildAdvisorLLMMessages({
    history, currentQuery: "追问", toolKey: "t", toolResultText: "d",
  });
  assert.ok(!withoutBlock.some((m) => m.content.includes("历史滚动摘要")));
});

test("C3-7：约束识别策略——义务模态句被收录，普通陈述句不被误收", () => {
  const found = extractKeyConstraints([
    { role: "user", content: "我们上周聊了定价策略，整体还行。对了，报价不得高于50万。明天再说。" },
    { role: "assistant", content: "好的，我记住了报价不得高于50万。" }, // 助手复述不是约束源
    { role: "user", content: "回复必须带引用来源！" },
  ]);
  assert.ok(found.some((c) => c.includes("报价不得高于50万")));
  assert.ok(found.some((c) => c.includes("回复必须带引用来源")));
  assert.ok(!found.some((c) => c.includes("我们上周聊了定价策略")), "普通陈述句不应被收录");
  assert.ok(!found.some((c) => c.includes("我记住了")), "助手复述不应成为约束源");
});

test("C3-8：token 估算器基本 sanity", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("hello"), 2); // 5*0.25=1.25 → ceil 2
  assert.equal(estimateTokens("你好"), 3); // 2*1.5=3
  assert.ok(estimateTokens("hello world 你好世界") > estimateTokens("hello world"));
});

test("C3-9：splitHistory 边界", () => {
  const turns = [1, 2, 3].map((i) => ({ role: "user", content: `m${i}` }));
  assert.deepEqual(splitHistory(turns, 10).recent.length, 3);
  assert.deepEqual(splitHistory(turns, 10).older.length, 0);
  assert.deepEqual(splitHistory(turns, 2).recent.map((t) => t.content), ["m2", "m3"]);
  assert.deepEqual(splitHistory(turns, 0).recent.length, 0);
});
