/**
 * C5-A：知识层加固 —— AbortSignal 真实取消、并发上限、跨轮缓存、跨 provider 重排。
 *
 * 全部 DB 解耦：用注入的 fake provider 验证路由行为，不连库。
 * 环境变量在用例内设置、用完清理（router 每次调用都重读 env）。
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { KnowledgeResultItem } from "@/modules/kern-contracts";
import {
  registerKnowledgeProvider,
  unregisterKnowledgeProvider,
  routeKnowledge,
} from "@/modules/knowledge/router";
import { rerankKnowledgeItems } from "@/modules/knowledge/rerank";
import { clearKnowledgeCache, knowledgeCacheSize } from "@/modules/knowledge/query-cache";

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
    authority: 0,
    score: 0,
    verified: false,
    conflictGroup: null,
    statement: null,
    ...partial,
  };
}

const registered: string[] = [];
function reg(scope: string, search: (ctx: any) => Promise<KnowledgeResultItem[]>) {
  registered.push(scope);
  registerKnowledgeProvider({ scope, label: scope, search });
}

afterEach(() => {
  for (const s of registered.splice(0)) unregisterKnowledgeProvider(s);
  clearKnowledgeCache();
  delete process.env.KERN_KNOWLEDGE_PROVIDER_TIMEOUT_MS;
  delete process.env.KERN_KNOWLEDGE_MAX_PROVIDER_CONCURRENCY;
  delete process.env.KERN_KNOWLEDGE_CACHE_MAX_ENTRIES;
  delete process.env.KERN_KNOWLEDGE_CACHE_TTL_MS;
});

test("C5-A1：provider 超时 → 在途请求被真实取消（signal.aborted === true）", async () => {
  process.env.KERN_KNOWLEDGE_PROVIDER_TIMEOUT_MS = "120";
  let seenAborted: boolean | null = null;
  let settledAs: string | null = null;
  reg("slow", async (ctx) => {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        settledAs = "completed-leaked";
        resolve();
      }, 10_000);
      ctx.signal.addEventListener(
        "abort",
        () => {
          seenAborted = ctx.signal.aborted;
          settledAs = "aborted";
          clearTimeout(t);
          reject(new Error("cancelled by router"));
        },
        { once: true }
      );
    });
    return [];
  });

  const started = Date.now();
  const r = await routeKnowledge(session, { query: "竞品价格", scopes: ["slow"], cache: false });
  const elapsed = Date.now() - started;

  // 核心证据：fake provider 亲眼看到 signal.aborted，而不是「路由标记了超时、
  // provider 还在后台跑完 10 秒」。
  assert.equal(seenAborted, true, "provider 必须观察到 abort 信号");
  assert.equal(settledAs, "aborted", "在途请求必须被取消而非跑完");
  assert.ok(elapsed < 5000, `路由应在超时附近返回，实际 ${elapsed}ms`);
  assert.equal(r.ran.length, 0);
  assert.equal(r.unavailable.length, 1);
  assert.match(r.unavailable[0].reason, /超过|取消|cancelled/);
});

test("C5-A1：上游 signal 取消整轮 → 所有在途 provider 一起取消", async () => {
  const abortedScopes: string[] = [];
  for (const s of ["u1", "u2"]) {
    reg(s, async (ctx) => {
      await new Promise<void>((_, reject) => {
        ctx.signal.addEventListener(
          "abort",
          () => {
            abortedScopes.push(s);
            reject(new Error("cancelled"));
          },
          { once: true }
        );
      });
      return [];
    });
  }
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(new Error("用户取消")), 60);
  const r = await routeKnowledge(session, {
    query: "蛋白粉",
    scopes: ["u1", "u2"],
    signal: ctrl.signal,
    cache: false,
  });
  assert.deepEqual(abortedScopes.sort(), ["u1", "u2"]);
  assert.equal(r.items.length, 0);
});

test("C5-A2：并发上限 —— 6 个 provider、上限 2，同时在跑的不超过 2", async () => {
  process.env.KERN_KNOWLEDGE_MAX_PROVIDER_CONCURRENCY = "2";
  let current = 0;
  let maxSeen = 0;
  let calls = 0;
  const scopes: string[] = [];
  for (let i = 0; i < 6; i++) {
    const s = `cc${i}`;
    scopes.push(s);
    reg(s, async () => {
      calls++;
      current++;
      maxSeen = Math.max(maxSeen, current);
      await new Promise((r) => setTimeout(r, 30));
      current--;
      return [];
    });
  }
  await routeKnowledge(session, { query: "q", scopes, cache: false });
  assert.equal(calls, 6, "6 个 provider 都要被执行");
  assert.ok(maxSeen <= 2, `并发峰值 ${maxSeen} 不得超过上限 2`);
  assert.ok(maxSeen >= 2, `并发峰值 ${maxSeen} 应打满上限（验证限流真的在工作）`);
});

test("C5-A3：跨轮缓存 —— 同组织相同查询只查一次；换组织/换查询重新查", async () => {
  let calls = 0;
  reg("k1", async () => {
    calls++;
    return [item({ scope: "k1", ref: "a", title: "t", snippet: "s", score: 5 })];
  });
  const q = { query: "相同查询", scopes: ["k1"] };
  await routeKnowledge(session, q);
  await routeKnowledge(session, q);
  assert.equal(calls, 1, "第二轮应命中缓存");
  await routeKnowledge(session, { query: "不同查询", scopes: ["k1"] });
  assert.equal(calls, 2, "换查询应重新检索");
  await routeKnowledge({ ...session, organizationId: "o2" }, q);
  assert.equal(calls, 3, "换组织不得共享缓存（租户隔离）");
});

test("C5-A3：缓存条数上限 —— 超限时驱逐最早条目，不无限增长", async () => {
  process.env.KERN_KNOWLEDGE_CACHE_MAX_ENTRIES = "2";
  reg("k1", async () => [item({ scope: "k1", ref: "a", title: "t", snippet: "s", score: 1 })]);
  await routeKnowledge(session, { query: "q1", scopes: ["k1"] });
  await routeKnowledge(session, { query: "q2", scopes: ["k1"] });
  await routeKnowledge(session, { query: "q3", scopes: ["k1"] });
  assert.ok(knowledgeCacheSize() <= 2, `缓存条目 ${knowledgeCacheSize()} 不得超过上限 2`);
});

test("C5-A4：重排可解释 —— 低分高权威+已验证 排到 高分低权威 之前", () => {
  const items = [
    item({ scope: "a", ref: "a1", title: "t", snippet: "s", score: 100, authority: 0.1, verified: false }),
    item({
      scope: "b",
      ref: "b1",
      title: "t",
      snippet: "s",
      score: 1,
      authority: 0.9,
      verified: true,
      capturedAt: new Date().toISOString(),
    }),
  ];
  const out = rerankKnowledgeItems(items);
  // b1: 0.5*1 + 0.35*0.9 + 0.1 + ~0.05 ≈ 0.965；a1: 0.5*1 + 0.35*0.1 = 0.535
  assert.equal(out[0].ref, "b1");
  assert.equal(out[1].ref, "a1");
  for (const it of out) {
    assert.equal(typeof it.rerankScore, "number", "每条都要附 rerankScore");
  }
  assert.ok(out[0].rerankScore! > out[1].rerankScore!);
  // 原 score 不动，便于回溯 provider 原始排序
  assert.equal(out.find((i) => i.ref === "a1")!.score, 100);
});

test("C5-A4：路由级 —— 多源合并后按 rerankScore 降序", async () => {
  reg("ra", async () => [item({ scope: "ra", ref: "ra1", title: "t", snippet: "s", score: 50, authority: 0.2 })]);
  reg("rb", async () => [
    item({ scope: "rb", ref: "rb1", title: "t", snippet: "s", score: 5, authority: 0.95, verified: true }),
  ]);
  const r = await routeKnowledge(session, { query: "q", scopes: ["ra", "rb"], cache: false });
  assert.equal(r.items.length, 2);
  const scores = r.items.map((i) => i.rerankScore!);
  assert.ok(scores.every((s) => typeof s === "number"));
  assert.ok(scores[0] >= scores[1], "items 应按 rerankScore 降序");
});
