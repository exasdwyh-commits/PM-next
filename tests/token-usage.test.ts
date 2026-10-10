import test from "node:test";
import assert from "node:assert/strict";

import {
  MODEL_TOKEN_PRICING,
  TOKEN_PRICING_AS_OF,
  TOKEN_USAGE_NOTICES,
  TokenUsageTracker,
  estimateCostUsd,
  formatCostUsd,
  formatTokenCostLine,
  formatTokenUsageSummary,
  normalizeTokenUsageRecords,
  resolveModelPricing,
  summarizeTokenUsage,
  toTokenUsageRecord,
} from "../src/modules/usage/token-usage";

test("按公开参考价估算成本，未知模型不估算", () => {
  assert.equal(estimateCostUsd("gpt-4o", 1000, 1000), 0.0125);
  assert.equal(estimateCostUsd("gpt-4o-mini", 1000, 1000), 0.00075);
  assert.equal(estimateCostUsd("gpt-4o-2026-06-01", 1000, 0), 0.0025, "带日期后缀的模型按前缀匹配");
  assert.equal(estimateCostUsd("gpt-4o-mini", 1000, 0), 0.00015, "最长前缀优先于 gpt-4o");
  assert.equal(estimateCostUsd("totally-unknown-model", 1000, 1000), null);
  assert.ok(resolveModelPricing("claude-sonnet-4-20260101"));
  assert.equal(resolveModelPricing(""), null);
  assert.ok(Object.keys(MODEL_TOKEN_PRICING).length >= 5);
  assert.equal(TOKEN_PRICING_AS_OF.length, 7);
});

test("toTokenUsageRecord 规范化记录并推导 total", () => {
  const record = toTokenUsageRecord({ model: "gpt-4o", purpose: "简报生成", inputTokens: 100, outputTokens: 50 });
  assert.equal(record.totalTokens, 150);
  assert.equal(record.estimatedCostUsd, 0.00025 + 0.0005);
  const totalOnly = toTokenUsageRecord({ model: "gpt-4o", totalTokens: 42 });
  assert.equal(totalOnly.inputTokens, 0);
  assert.equal(totalOnly.outputTokens, 0);
  assert.equal(totalOnly.totalTokens, 42);
  assert.equal(totalOnly.purpose, "未标明用途");
  assert.throws(() => toTokenUsageRecord({ model: "   ", inputTokens: 1 }), /模型名/);
  assert.throws(() => toTokenUsageRecord({ model: "gpt-4o", inputTokens: -1 }), /整数/);
  assert.throws(() => toTokenUsageRecord({ model: "gpt-4o", inputTokens: 1.5 }), /整数/);
  assert.throws(() => toTokenUsageRecord({ model: "gpt-4o" }), /至少提供/);
});

test("normalizeTokenUsageRecords 校验不受信的数组输入", () => {
  assert.deepEqual(normalizeTokenUsageRecords(undefined), []);
  assert.deepEqual(normalizeTokenUsageRecords(null), []);
  assert.equal(normalizeTokenUsageRecords([{ model: "gpt-4o", inputTokens: 1 }]).length, 1);
  assert.throws(() => normalizeTokenUsageRecords("nope"), /数组/);
  assert.throws(() => normalizeTokenUsageRecords([{ model: "gpt-4o" }, "x"]), /对象/);
  const many = Array.from({ length: 51 }, () => ({ model: "m", totalTokens: 1 }));
  assert.throws(() => normalizeTokenUsageRecords(many), /50/);
});

test("tracker 汇总调用、token 与成本", () => {
  const tracker = new TokenUsageTracker();
  tracker.record({ model: "gpt-4o", inputTokens: 1000, outputTokens: 1000 });
  tracker.record({ model: "gpt-4o", inputTokens: 1000, outputTokens: 1000 });
  tracker.record({ model: "mystery-model", totalTokens: 100 });
  const summary = tracker.summarize();
  assert.equal(summary.calls, 3);
  assert.equal(summary.totalInputTokens, 2000);
  assert.equal(summary.totalOutputTokens, 2000);
  assert.equal(summary.totalTokens, 4100);
  assert.equal(summary.unknownPricingCalls, 1);
  assert.equal(summary.estimatedCostUsd, null, "任一调用定价未知时合计为 null");
  assert.equal(summary.knownCostUsd, 0.025);
  assert.equal(summary.byModel["gpt-4o"].calls, 2);
  assert.equal(summary.byModel["gpt-4o"].totalTokens, 4000);
  assert.equal(summary.byModel["mystery-model"].estimatedCostUsd, null);
  assert.equal(tracker.list().length, 3);
});

test("summarizeTokenUsage 空集与全部已知定价", () => {
  const empty = summarizeTokenUsage([]);
  assert.equal(empty.calls, 0);
  assert.equal(empty.totalTokens, 0);
  assert.equal(empty.estimatedCostUsd, null);
  const priced = summarizeTokenUsage([
    toTokenUsageRecord({ model: "gpt-4o-mini", inputTokens: 1000, outputTokens: 1000 }),
  ]);
  assert.equal(priced.estimatedCostUsd, 0.00075);
  assert.equal(priced.unknownPricingCalls, 0);
});

test("成本文本包含用量、估算与免责口径", () => {
  const line = formatTokenCostLine(
    summarizeTokenUsage([toTokenUsageRecord({ model: "gpt-4o", inputTokens: 8000, outputTokens: 4345 })]),
  );
  assert.match(line, /1 次/);
  assert.match(line, /12,345 tokens/);
  assert.match(line, /输入 8,000 \/ 输出 4,345/);
  assert.match(line, /\$0\.0/);
  assert.match(line, /账单/);
  const unknownLine = formatTokenCostLine(
    summarizeTokenUsage([toTokenUsageRecord({ model: "mystery", totalTokens: 10 })]),
  );
  assert.match(unknownLine, /未知/);
  assert.match(formatTokenCostLine(summarizeTokenUsage([])), /未提供/);
  const lines = formatTokenUsageSummary(
    summarizeTokenUsage([toTokenUsageRecord({ model: "gpt-4o", inputTokens: 100, outputTokens: 50 })]),
  );
  assert.ok(lines.some((item) => item.includes("调用次数")));
  assert.ok(lines.some((item) => item.includes("参考价")));
  assert.ok(lines.some((item) => item.includes("gpt-4o")));
  assert.ok(TOKEN_USAGE_NOTICES.length >= 1);
  assert.equal(formatCostUsd(0.0125), "$0.0125");
  assert.equal(formatCostUsd(12), "$12");
  assert.equal(formatCostUsd(0), "$0");
});
