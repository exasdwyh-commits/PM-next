/**
 * KX-73 Knowledge 层：Router（选域、并发、缺 provider 要说出来）与
 * Synthesis（去重、聚类、冲突裁决、置信度）+ 可配置权威策略。
 *
 * 这一层刻意与 DB 解耦：用注入的 provider 和手工构造的 route 结果验证行为，
 * 不连库也能跑——「权限在 provider 内部」由 provider 契约保证，路由不提供越权入口。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import type { KnowledgeResultItem, KnowledgeRouteResult } from "@/modules/kern-contracts";
import {
  MISSING_PROVIDER_NOTES,
  ON_DEMAND_ONLY_SCOPES,
  hasKnowledgeProvider,
  listKnowledgeProviders,
  registerKnowledgeProvider,
  routeKnowledge,
  unregisterKnowledgeProvider,
} from "@/modules/knowledge/router";
import { normalizeUri, synthesizeKnowledge } from "@/modules/knowledge/synthesis";
import { bindKnowledgeToEvidence, knowledgeHash } from "@/modules/knowledge/evidence-bridge";
import { sourceTitle } from "@/modules/knowledge/source-title";
import { collectCandidates } from "@/modules/knowledge/search";
import {
  DEFAULT_AUTHORITY_POLICY,
  authorityScore,
  clearAuthorityPolicyCache,
  freshnessFactor,
  freshnessLabel,
  loadAuthorityPolicy,
  trustTierToAuthorityTier,
} from "@/modules/knowledge/authority";

const session = {
  userId: "u1",
  organizationId: "o1",
  userEmail: "u1@example.com",
  userName: "U1",
};

/** 源码断言专用：读仓库文件（部分契约只能静态验证，如 SQL where 的形状）。 */
function read(rel: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), rel), "utf8").replace(/\r/g, "");
}

function item(over: Partial<KnowledgeResultItem> & { ref: string }): KnowledgeResultItem {
  return {
    scope: "project",
    title: `标题 ${over.ref}`,
    snippet: `片段 ${over.ref}`,
    uri: `https://example.com/${over.ref}`,
    capturedAt: "2026-09-01T00:00:00.000Z",
    authorityTier: "first_party",
    authority: 0.9,
    score: 1,
    verified: true,
    conflictGroup: null,
    statement: null,
    ...over,
  };
}

function route(items: KnowledgeResultItem[], query = "问题"): KnowledgeRouteResult {
  return { query, requested: ["project"], ran: ["project"], items, unavailable: [], elapsedMs: 1 };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

test("内置 provider 已注册；没实现的域有明确说明", () => {
  for (const scope of ["project", "company-facts", "db", "files"]) {
    assert.ok(hasKnowledgeProvider(scope), `内置 scope ${scope} 应已注册`);
  }
  assert.ok(listKnowledgeProviders().some((p) => p.scope === "project"));
  assert.match(MISSING_PROVIDER_NOTES.github, /GitHub/);
});

test("路由：注册的域被执行，没注册的域进 unavailable 并写清原因", async () => {
  registerKnowledgeProvider({
    scope: "fake",
    label: "测试域",
    search: async () => [item({ ref: "f1", scope: "fake" })],
  });
  try {
    const r = await routeKnowledge(session, { query: "查一下", scopes: ["fake", "github"] });
    assert.deepEqual(r.ran, ["fake"]);
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].scope, "fake");
    assert.equal(r.unavailable.length, 1);
    assert.equal(r.unavailable[0].scope, "github");
    assert.match(r.unavailable[0].reason, /GitHub/);
  } finally {
    unregisterKnowledgeProvider("fake");
  }
});

test("路由：provider 自己报不可用时跳过它，不静默返回空", async () => {
  registerKnowledgeProvider({
    scope: "fake",
    label: "测试域",
    unavailable: () => "未配置凭据",
    search: async () => [],
  });
  try {
    const r = await routeKnowledge(session, { query: "查一下", scopes: ["fake"] });
    assert.deepEqual(r.ran, []);
    assert.equal(r.unavailable[0]?.reason, "未配置凭据");
    assert.equal(r.items.length, 0);
  } finally {
    unregisterKnowledgeProvider("fake");
  }
});

test("路由：provider 抛错被收进 unavailable，不让整轮失败", async () => {
  registerKnowledgeProvider({
    scope: "fake",
    label: "测试域",
    search: async () => {
      throw new Error("连不上");
    },
  });
  try {
    const r = await routeKnowledge(session, { query: "查一下", scopes: ["fake"] });
    assert.match(r.unavailable[0]?.reason ?? "", /连不上/);
    assert.deepEqual(r.ran, []);
  } finally {
    unregisterKnowledgeProvider("fake");
  }
});

test("路由：空查询直接返回，不调用任何 provider", async () => {
  const r = await routeKnowledge(session, { query: "   ", scopes: ["github"] });
  assert.deepEqual(r.items, []);
  assert.deepEqual(r.ran, []);
  assert.deepEqual(r.unavailable, []);
});

// ---------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------

test("normalizeUri：去 query/fragment、统一小写、剥尾斜杠", () => {
  assert.equal(normalizeUri("https://Example.com/a/?x=1#frag"), "https://example.com/a");
  assert.equal(normalizeUri("  https://example.com  "), "https://example.com");
  assert.equal(normalizeUri(null), null);
  assert.equal(normalizeUri("   "), null);
  assert.equal(normalizeUri("capabilities/research/x/SKILL.md"), "capabilities/research/x/skill.md");
});

test("去重：同址只留权威更高的那条，并记录被丢的原因", () => {
  const syn = synthesizeKnowledge(
    route([
      item({ ref: "low", uri: "https://example.com/a?x=1", authority: 0.3 }),
      item({ ref: "high", uri: "https://example.com/a#b", authority: 0.9 }),
    ])
  );
  assert.deepEqual(syn.top.map((i) => i.ref), ["high"]);
  assert.equal(syn.dropped.length, 1);
  assert.equal(syn.dropped[0].ref, "low");
  assert.match(syn.dropped[0].reason, /同址/);
});

test("去重：文本高度重复的跨源命中也会被合并", () => {
  const text = "季度营收同比增长百分之二十，主要来自新渠道。";
  const syn = synthesizeKnowledge(
    route([
      item({ ref: "a", uri: "https://a.example.com/1", title: text, snippet: text, statement: text }),
      item({ ref: "b", uri: "https://b.example.com/2", title: text, snippet: text, statement: text }),
    ])
  );
  assert.equal(syn.top.length, 1, `应合并为 1 条，实际 ${syn.top.length}`);
  assert.ok(syn.dropped.some((d) => d.reason.includes("重复")));
});

test("冲突：同一 conflictGroup 下两种说法显式列出，权威高的胜出", () => {
  const syn = synthesizeKnowledge(
    route([
      item({
        ref: "official",
        conflictGroup: "sales-2026",
        statement: "年销目标为 1200 万",
        authority: 0.95,
        authorityTier: "first_party",
        uri: "db://project/sales",
      }),
      item({
        ref: "draft",
        conflictGroup: "sales-2026",
        statement: "年销目标为 800 万",
        authority: 0.4,
        authorityTier: "public",
        uri: "https://example.com/draft",
      }),
    ])
  );
  assert.equal(syn.conflicts.length, 1, "必须显式报告冲突");
  assert.equal(syn.conflicts[0].group, "g:sales-2026");
  assert.equal(syn.conflicts[0].statements.length, 2, "两种说法都要能看到");
  assert.equal(syn.conflicts[0].winnerRef, "official");
  assert.deepEqual(
    syn.top.map((i) => i.ref),
    ["official"],
    "落败说法不进 top，但仍在 cluster 里可查"
  );
  const cluster = syn.clusters.find((c) => c.id === "g:sales-2026");
  assert.equal(cluster?.items.length, 2, "两种说法都要留在簇里给界面看");
  assert.ok((cluster?.agreement ?? 1) < 1, "有分歧时 agreement 应小于 1");
});

test("冲突：权威打平时不硬判，winnerRef 为 null 且两条都留在 top", () => {
  const syn = synthesizeKnowledge(
    route([
      item({ ref: "p1", conflictGroup: "g1", statement: "说法一", authority: 0.5, uri: "db://a" }),
      item({ ref: "p2", conflictGroup: "g1", statement: "说法二", authority: 0.5, uri: "db://b" }),
    ])
  );
  assert.equal(syn.conflicts.length, 1);
  assert.equal(syn.conflicts[0].winnerRef, null, "打平要承认打平");
  assert.equal(syn.top.length, 2);
});

test("聚类：同址/同主题归一簇，不同主题各自成簇", () => {
  const syn = synthesizeKnowledge(
    route([
      item({ ref: "c1", uri: "https://example.com/one", title: "主题一" }),
      item({ ref: "c2", uri: "https://example.com/one/child", title: "主题一的续篇" }),
      item({ ref: "c3", uri: "https://example.com/two", title: "另一个主题" }),
    ])
  );
  assert.equal(syn.clusters.length, 3, "URI 不同就是不同簇");
  assert.equal(syn.top.length, 3);
  assert.ok(syn.clusters.every((c) => c.items.length === 1));
});

test("置信度：三个独立高权威来源 → high；两个 → medium；单条弱来源 → low", () => {
  const three = synthesizeKnowledge(
    route([
      item({ ref: "h1", uri: "https://a.example.com/1", title: "甲乙丙的结论", authority: 0.9, snippet: "一" }),
      item({ ref: "h2", uri: "https://b.example.com/2", title: "丁戊己的证据", authority: 0.9, snippet: "二" }),
      item({ ref: "h3", uri: "https://c.example.com/3", title: "庚辛壬的记录", authority: 0.9, snippet: "三" }),
    ])
  );
  assert.equal(three.confidence, "high");

  const two = synthesizeKnowledge(
    route([
      item({ ref: "m1", uri: "https://a.example.com/1", title: "甲乙丙的结论", authority: 0.9, snippet: "一" }),
      item({ ref: "m2", uri: "https://b.example.com/2", title: "丁戊己的证据", authority: 0.9, snippet: "二" }),
    ])
  );
  assert.equal(two.confidence, "medium");

  const one = synthesizeKnowledge(route([item({ ref: "l1", authority: 0.2, verified: false, uri: null })]));
  assert.equal(one.confidence, "low");
});

test("没有命中时诚实返回空，不编结果", () => {
  const syn = synthesizeKnowledge(route([]));
  assert.deepEqual(syn.top, []);
  assert.deepEqual(syn.clusters, []);
  assert.deepEqual(syn.conflicts, []);
  assert.equal(syn.confidence, "low");
});

test("freshness：越旧权重越低，新鲜度标签按时效窗口划分", () => {
  const now = new Date("2026-10-01T00:00:00.000Z");
  const recent = freshnessFactor("2026-09-30T00:00:00.000Z", now, DEFAULT_AUTHORITY_POLICY);
  const ancient = freshnessFactor("2020-01-01T00:00:00.000Z", now, DEFAULT_AUTHORITY_POLICY);
  assert.ok(recent > ancient, `新鮮度应随时间衰减：${recent} vs ${ancient}`);
  assert.equal(freshnessFactor(null, now, DEFAULT_AUTHORITY_POLICY), 0.6, "无时间戳给中性值");

  assert.equal(freshnessLabel("2026-09-30T00:00:00.000Z", now), "近期"); // ≤30 天
  assert.equal(freshnessLabel("2026-05-01T00:00:00.000Z", now), "半年内"); // ≤180 天
  assert.equal(freshnessLabel("2026-03-01T00:00:00.000Z", now), "一年以上"); // >180 天
  assert.equal(freshnessLabel(null, now), "时间未知");
});

test("权威：信任档映射复用 evidence 的分类，不另立一套；verified 有加成", () => {
  assert.equal(trustTierToAuthorityTier("OFFICIAL"), "first_party");
  assert.equal(trustTierToAuthorityTier("PRIMARY"), "curated");
  assert.equal(trustTierToAuthorityTier("REPUTABLE"), "curated");
  assert.equal(trustTierToAuthorityTier("UNRATED"), "unknown");

  const p = DEFAULT_AUTHORITY_POLICY;
  const plain = authorityScore("public", false, p);
  const verified = authorityScore("public", true, p);
  assert.equal(plain, p.tierWeights.public);
  assert.equal(verified, Math.min(1, plain + p.verifiedBoost));
  assert.equal(authorityScore("first_party", true, p), 1, "封顶 1");
});

test("权威策略可配置：env 覆盖 tierWeights 与 precedence，并带 source 标记", () => {
  clearAuthorityPolicyCache();
  try {
    const policy = loadAuthorityPolicy({
      NODE_ENV: "test",
      KERN_AUTHORITY_POLICY: JSON.stringify({
        tierWeights: { public: 0.99 },
        precedence: ["public", "first_party", "curated", "unknown"],
        freshnessHalfLifeDays: 30,
      }),
    });
    assert.equal(policy.tierWeights.public, 0.99);
    assert.equal(policy.tierWeights.first_party, 1, "未覆盖的字段保留默认");
    assert.equal(policy.precedence[0], "public");
    assert.equal(policy.freshnessHalfLifeDays, 30);
    assert.equal(policy.source, "env");

    clearAuthorityPolicyCache();
    const broken = loadAuthorityPolicy({ NODE_ENV: "test", KERN_AUTHORITY_POLICY: "{不是合法 JSON" });
    assert.equal(broken.source, "default", "写错的环境变量不该打挂知识路由");
    assert.equal(broken.tierWeights.public, DEFAULT_AUTHORITY_POLICY.tierWeights.public);
  } finally {
    clearAuthorityPolicyCache();
  }
});

// ---------------------------------------------------------------------------
// Evidence 绑定（纯逻辑部分；写库路径由 DB 测试覆盖）
// ---------------------------------------------------------------------------

test("knowledgeHash：同一批知识幂等，内容或裁决一变就换键", () => {
  const items = [item({ ref: "a" }), item({ ref: "b" })];
  const r1 = route(items, "问题一");
  const s1 = synthesizeKnowledge(r1);
  const h1 = knowledgeHash(r1, s1);
  assert.match(h1, /^[0-9a-f]{64}$/, "应是 sha256 十六进制");
  assert.equal(h1, knowledgeHash(r1, synthesizeKnowledge(r1)), "同输入必须同键，否则证据会被重复建");

  const r2 = route(items, "问题二");
  assert.notEqual(h1, knowledgeHash(r2, synthesizeKnowledge(r2)), "换了检索式就该另建一条");

  // 冲突裁决变了 → 键必须变（同一批来源但选了另一边）
  const conflictRoute = route(
    [
      item({ ref: "p1", conflictGroup: "g1", statement: "说法一", authority: 0.6, uri: "db://a" }),
      item({ ref: "p2", conflictGroup: "g1", statement: "说法二", authority: 0.5, uri: "db://b" }),
    ],
    "问题三"
  );
  const s3 = synthesizeKnowledge(conflictRoute);
  const h3 = knowledgeHash(conflictRoute, s3);
  assert.notEqual(h3, knowledgeHash(conflictRoute, { ...s3, conflicts: [] }), "裁决进键");
  assert.notEqual(h3, h1);
});

test("绑定：没有可绑定的条目时不碰数据库，直接说明原因", async () => {
  const r = route([]);
  const syn = synthesizeKnowledge(r);
  const res = await bindKnowledgeToEvidence(session, { projectId: "p1", route: r, syn });
  if (res.bound) assert.fail("没有条目时必须返回 bound:false");
  assert.match(res.reason, /没有可绑定/);
});

// ---------------------------------------------------------------------------
// 来源标题：切片器的 headingPath 里已含文档标题，拼接时不能重复
// ---------------------------------------------------------------------------

test("候选收集：宽泛词命中过千时，精确词的少量命中不会被挤出候选池", async () => {
  // 复现 2026-10-12 的真实故障：查询 = 精确词「恒天」+ 宽泛词「配方」。
  // 旧实现把整条 OR 一次性 `take(40)`（且无 orderBy）→ SQL 返回的任意 40 条几乎全是
  // 宽泛词命中，精确词那几条被挤出候选池，后面打分再准也救不回来 ——
  // 现象就是「库里明明有这篇笔记，检索却报告没命中」。
  const generic = Array.from({ length: 1300 }, (_, i) => ({ id: `g${i}` }));
  const precise = [{ id: "p1" }, { id: "p2" }, { id: "p3" }];
  const fetched: string[] = [];

  const pool = await collectCandidates(["配方", "恒天"], async (kw) => {
    fetched.push(kw);
    return kw === "恒天" ? precise : generic;
  });

  // 每个关键词单独查一次，不再合成一条会被 SQL 截断的 OR
  assert.deepEqual(fetched, ["配方", "恒天"]);
  const ids = new Set(pool.map((c) => c.id));
  for (const p of precise) {
    assert.ok(ids.has(p.id), `精确词命中 ${p.id} 必须在候选池里（这正是旧实现丢掉的）`);
  }
  // 候选池是并集，不做 SQL 层截断：1300 + 3
  assert.equal(pool.length, 1303);
});

test("候选收集：同一 id 跨关键词命中只保留一次，顺序稳定", async () => {
  const pool = await collectCandidates(["甲", "乙"], async (kw) =>
    kw === "甲" ? [{ id: "x" }, { id: "shared" }] : [{ id: "shared" }, { id: "y" }]
  );
  assert.deepEqual(pool.map((c) => c.id), ["x", "shared", "y"]);
});

test("sourceTitle：headingPath 已含文档标题时不重复", () => {
  assert.equal(
    sourceTitle("汉和生物原料知识库", "汉和生物原料知识库 > 4.2.4 应用场景"),
    "汉和生物原料知识库 > 4.2.4 应用场景"
  );
});

test("sourceTitle：首个一级标题=文档标题时折叠重复段（MOC 场景）", () => {
  assert.equal(
    sourceTitle(
      "Obsidian Vault 知识体系总览 (MOC)",
      "Obsidian Vault 知识体系总览 (MOC) > Obsidian Vault 知识体系总览 (MOC) > 1.可用方法论速查(一图直达分域文件)"
    ),
    "Obsidian Vault 知识体系总览 (MOC) > 1.可用方法论速查(一图直达分域文件)"
  );
  assert.equal(sourceTitle("A", "A > B > B > C"), "A > B > C", "中段相邻重复也要折叠");
});

test("sourceTitle：路径不含文档标题则补在前；空路径只留文档标题", () => {
  assert.equal(sourceTitle("文档A", "章节一 > 小节二"), "文档A > 章节一 > 小节二");
  assert.equal(sourceTitle("文档A", ""), "文档A");
  assert.equal(sourceTitle("文档A", null), "文档A");
  assert.equal(sourceTitle(null, "章节一"), "章节一");
  assert.equal(sourceTitle("", ""), "");
});

// ---------------------------------------------------------------------------
// 知识源隔离（2026-10-12）：「指定文件夹」必须真的限定检索范围
// ---------------------------------------------------------------------------

test("路由：files 是仅按需域，默认不参与（仓库文档不再挤占 PM 检索）", async () => {
  assert.ok(ON_DEMAND_ONLY_SCOPES.has("files"), "files 必须登记为仅按需域");

  const r = await routeKnowledge(session, { query: "查一下" });
  assert.equal(
    r.requested.includes("files"),
    false,
    `默认域不应包含 files，实际：${r.requested.join("、")}`
  );

  // 但显式声明时仍然可用 —— 降权不等于删除。
  const explicit = await routeKnowledge(session, { query: "查一下", scopes: ["files"] });
  assert.deepEqual(explicit.requested, ["files"]);
});

test("检索：停用的知识源不参与召回（enabled 是总闸，此前只有自动同步读它）", () => {
  const search = read("src/modules/knowledge/search.ts");
  assert.match(
    search,
    /document:\s*\{\s*deletedAt:\s*null,\s*source:\s*sourceFilter\s*\}/,
    "chunk 查询必须按 source 过滤，否则停用源照样出在回执里"
  );
  assert.match(search, /enabled:\s*true/, "sourceFilter 必须要求 source.enabled = true");
  // 显式指定源时，enabled 与 id 一起生效，不能因为指定了就绕过总闸。
  assert.match(
    search,
    /params\.sourceIds\?\.length[\s\S]{0,120}enabled:\s*true/,
    "指定 sourceIds 时仍须叠加 enabled 过滤"
  );
});

test("知识源启停：有 service 实现与 PATCH 路由，且鉴权到组织管理员", () => {
  const service = read("src/modules/knowledge/service.ts");
  assert.match(service, /export async function setKnowledgeSourceEnabled/);
  // 跨组织必须按 not-found 处理，不能只凭 id 就改。
  assert.match(
    service,
    /setKnowledgeSourceEnabled[\s\S]{0,600}source\.organizationId !== session\.organizationId[\s\S]{0,120}NotFoundError/,
    "启停必须校验组织归属"
  );

  const route = read("src/app/api/knowledge/sources/[id]/route.ts");
  assert.match(route, /export async function PATCH/);
  assert.match(route, /assertOrgAdmin/, "启停属知识库配置面，必须组织管理员");

  const matrix = read("tests/authz-matrix.ts");
  assert.match(
    matrix,
    /path:\s*"\/api\/knowledge\/sources\/\{id\}"[\s\S]{0,200}method:\s*"PATCH"/,
    "新路由必须在权限矩阵登记，否则 authz-route-coverage 守卫会红"
  );
});

after(() => {
  unregisterKnowledgeProvider("fake");
  clearAuthorityPolicyCache();
});
