/**
 * C5-B：研究三档（快速 / 深搜 / 更深）。
 *
 * - 每档走通一次：断言轮数、provider 调用数符合档位语义；
 * - 预算逐档放大：maxSteps / maxTokens / maxTimeMs 严格递增，env 可覆盖；
 * - 分档计量：注入 meter 捕获 usage 记录，三档 tier 可区分、预算数值可区分；
 * - 熔断：maxTimeMs 触发时 timedOut=true、返回部分结果、不抛错；
 * - token 预算：applyTokenBudget 纯函数用例。
 *
 * DB 解耦：fake provider 覆盖三档全部 scope；meter 注入不写库。
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { KnowledgeResultItem } from "@/modules/kern-contracts";
import {
  registerKnowledgeProvider,
  unregisterKnowledgeProvider,
} from "@/modules/knowledge/router";
import { ensureAssistantKnowledgeProviders } from "@/modules/assistant-runtime/knowledge-providers";
import {
  applyTokenBudget,
  researchTierBudget,
  researchTierScopes,
  resolveResearchTier,
  runResearch,
  type ResearchTier,
  type ResearchUsage,
} from "@/modules/research/research-tiers";

const session = {
  userId: "u1",
  organizationId: "o1",
  userEmail: "u1@example.com",
  userName: "U1",
} as any;

function item(partial: Partial<KnowledgeResultItem> & { scope: string; ref: string; title: string }): KnowledgeResultItem {
  return {
    snippet: "",
    uri: null,
    capturedAt: null,
    authorityTier: "unknown",
    authority: 0.5,
    score: 5,
    verified: false,
    conflictGroup: null,
    statement: null,
    ...partial,
  };
}

const SCOPES = researchTierScopes("deeper");
let seq = 0;

/** 每调用一次返回全新 ref、标题带全新扩展词 —— 多轮合并可区分、查询扩展有词可用。 */
function fakeSearch(scope: string) {
  return async () => {
    seq++;
    const n = seq;
    const words = [`kw${n}a`, `kw${n}b`, `kw${n}c`, `kw${n}d`, `kw${n}e`, `kw${n}f`, `kw${n}g`, `kw${n}h`];
    return [
      item({
        scope,
        ref: `${scope}#${n}`,
        title: words.join(" "),
        snippet: "x".repeat(40),
      }),
    ];
  };
}

before(() => {
  // 先让 L2 把 memory/web/signal 的真实 provider 注册上，再用 fake 覆盖同名 scope。
  ensureAssistantKnowledgeProviders();
  for (const s of SCOPES) {
    registerKnowledgeProvider({ scope: s, label: s, search: fakeSearch(s) });
  }
});

after(() => {
  for (const s of SCOPES) unregisterKnowledgeProvider(s);
  delete process.env.KERN_RESEARCH_DEEP_MAX_STEPS;
  delete process.env.KERN_RESEARCH_FAST_MAX_TIME_MS;
  delete process.env.KERN_KNOWLEDGE_PROVIDER_TIMEOUT_MS;
});

test("C5-B1：三档默认预算逐档放大（步数/token/时长）", () => {
  const fast = researchTierBudget("fast");
  const deep = researchTierBudget("deep");
  const deeper = researchTierBudget("deeper");
  assert.deepEqual([fast.maxSteps, deep.maxSteps, deeper.maxSteps], [1, 2, 3]);
  assert.ok(fast.maxTokens < deep.maxTokens && deep.maxTokens < deeper.maxTokens);
  assert.ok(fast.maxTimeMs < deep.maxTimeMs && deep.maxTimeMs < deeper.maxTimeMs);
});

test("C5-B1：预算 env 可覆盖", () => {
  process.env.KERN_RESEARCH_DEEP_MAX_STEPS = "5";
  assert.equal(researchTierBudget("deep").maxSteps, 5);
  delete process.env.KERN_RESEARCH_DEEP_MAX_STEPS;
});

test("C5-B1：档位解析 —— 未知/空回落 fast，大小写不敏感", () => {
  assert.equal(resolveResearchTier("bogus"), "fast");
  assert.equal(resolveResearchTier(null), "fast");
  assert.equal(resolveResearchTier("DEEP"), "deep");
  assert.equal(resolveResearchTier("deeper"), "deeper");
});

test("C5-B1：deep 档含 signal 域（社交/竞品信号进深搜），deeper 含 files", () => {
  assert.ok(researchTierScopes("deep").includes("signal"), "deep 必须动用 signal 域");
  assert.ok(researchTierScopes("deeper").includes("files"), "deeper 必须动用 files 域");
  assert.ok(!researchTierScopes("fast").includes("web"), "fast 不碰外部源");
});

test("C5-B：三档各走通一次 —— 轮数与 provider 调用数符合档位", async () => {
  const records: Array<ResearchUsage & { organizationId: string; query: string }> = [];
  const meter = async (rec: ResearchUsage & { organizationId: string; query: string }) => {
    records.push(rec);
  };
  const expectations: Record<ResearchTier, { rounds: number; calls: number }> = {
    fast: { rounds: 1, calls: researchTierScopes("fast").length * 1 },
    deep: { rounds: 2, calls: researchTierScopes("deep").length * 2 },
    deeper: { rounds: 3, calls: researchTierScopes("deeper").length * 3 },
  };
  for (const tier of ["fast", "deep", "deeper"] as ResearchTier[]) {
    const r = await runResearch(session, {
      query: "蛋白粉 竞品",
      tier,
      limit: 500,
      meter,
    });
    const exp = expectations[tier];
    assert.equal(r.tier, tier);
    assert.equal(r.usage.rounds, exp.rounds, `${tier} 轮数`);
    assert.equal(r.usage.providerCalls, exp.calls, `${tier} provider 调用数`);
    assert.ok(r.usage.items > 0, `${tier} 应有命中`);
    assert.equal(r.usage.timedOut, false);
    // 多轮合并后重排：rerankScore 降序
    const scores = r.route.items.map((i) => i.rerankScore ?? -1);
    for (let i = 1; i < scores.length; i++) {
      assert.ok(scores[i - 1] >= scores[i], `${tier} 合并结果应按 rerankScore 降序`);
    }
  }

  // C5-B2 分档计量：三条记录的 tier 与预算数值各自可区分
  assert.deepEqual(records.map((r) => r.tier), ["fast", "deep", "deeper"]);
  assert.deepEqual(records.map((r) => r.budget.maxSteps), [1, 2, 3]);
  const tokens = records.map((r) => r.budget.maxTokens);
  assert.ok(tokens[0] < tokens[1] && tokens[1] < tokens[2], "账本记录的预算 token 逐档放大");
  for (const rec of records) {
    assert.equal(rec.organizationId, "o1");
    assert.ok(rec.query.includes("蛋白粉"));
  }
});

test("C5-B1：maxTimeMs 熔断 —— timedOut=true、返回部分结果、不抛错", async () => {
  process.env.KERN_RESEARCH_FAST_MAX_TIME_MS = "80";
  const slowScopes = researchTierScopes("fast");
  // 本用例内把 fast 的 4 个域换成慢 fake（遵守 signal，2 秒才返回）
  for (const s of slowScopes) {
    registerKnowledgeProvider({
      scope: s,
      label: s,
      search: async (ctx) => {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => resolve(), 2000);
          ctx.signal.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new Error("cancelled"));
          }, { once: true });
        });
        return [];
      },
    });
  }
  try {
    const started = Date.now();
    const r = await runResearch(session, {
      query: "q",
      tier: "fast",
      meter: async () => {},
    });
    const elapsed = Date.now() - started;
    assert.equal(r.usage.timedOut, true, "应标记超时熔断");
    assert.ok(elapsed < 1500, `应在熔断附近返回，实际 ${elapsed}ms`);
  } finally {
    // 恢复普通 fake
    for (const s of slowScopes) {
      registerKnowledgeProvider({ scope: s, label: s, search: fakeSearch(s) });
    }
    delete process.env.KERN_RESEARCH_FAST_MAX_TIME_MS;
  }
});

test("C5-B1：token 预算 —— 超限时从低分条目开始丢弃", () => {
  const big = item({ scope: "s", ref: "big", title: "t", snippet: "x".repeat(1000), score: 1 });
  const small = item({ scope: "s", ref: "small", title: "t", snippet: "y".repeat(10), score: 100 });
  // 先按分排好序（调用方保证降序），再截断
  const sorted = [small, big];
  const out = applyTokenBudget(sorted, 100); // 400 字符预算
  assert.equal(out.length, 1);
  assert.equal(out[0].ref, "small", "高分条目优先保留");
});
