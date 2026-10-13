/**
 * C6：Mission 链路补线 —— 能力约束执行化 + 研究三档。
 *
 * - 任务开始时解析能力包：requiredTools/forbiddenTools/tenants 进执行侧
 *   （role 沿用 C4 口径不传；没有能力包命中时约束为空、行为不变）。
 * - 研究步骤支持 researchTier（fast/deep/deeper）：显式指定时走 runResearch
 *   （三档预算 + 分档计量）；不传时保持原 searchKnowledge 行为。
 *
 * 全部离线可跑：能力包用临时 SKILL.md 夹具注入；研究档用 fake provider +
 * meter 注入，不碰真 DB。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { KnowledgeResultItem } from "@/modules/kern-contracts";
import type { CapabilitySkillDefinition } from "@/modules/kern-contracts";
import {
  registerKnowledgeProvider,
  unregisterKnowledgeProvider,
} from "@/modules/knowledge/router";
import {
  researchTierScopes,
  runResearch,
  type ResearchUsage,
} from "@/modules/research/research-tiers";
import { toolsFor, type ToolContext } from "@/modules/supervisor/tools";
import {
  resolveMissionToolConstraints,
  searchKnowledgeForMission,
} from "@/modules/supervisor/generic-executor";
import { loadCapabilitySkills } from "@/modules/assistant-runtime/capabilities/skill-registry";

const session = { userId: "u1", organizationId: "org-1", userEmail: "u1@x.com", userName: "U1" } as any;

// ---------------------------------------------------------------------------
// 能力包夹具
// ---------------------------------------------------------------------------

function makeTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "c6-mission-"));
}

/** 写入一个最小可用能力包（label/description/正文是解析器的硬要求）。 */
function writeSkill(root: string, domain: string, name: string, frontmatter: string): void {
  const dir = path.join(root, domain, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nlabel: ${name}\ndescription: 测试用能力包 ${name}\n${frontmatter}\n---\n\n正文：用于通过解析校验的做法说明。\n`,
    "utf8"
  );
}

function skillsFrom(root: string): CapabilitySkillDefinition[] {
  const { skills, diagnostics } = loadCapabilitySkills({ root });
  assert.equal(diagnostics.length, 0, `临时能力包不应有诊断：${JSON.stringify(diagnostics)}`);
  return skills;
}

/** 全量 stub 的 ToolContext：toolsFor 能组装出的完整工具表。 */
function fullCtx(): ToolContext {
  return {
    organizationId: "org-1",
    searchKnowledge: async () => [],
    webSearch: async () => [],
    webFetch: async () => ({ url: "", title: null, text: "", truncated: false }),
    webCrawl: async () => [],
    askUser: async () => ({ mode: "ignore" as const }),
  };
}

// ---------------------------------------------------------------------------
// 1. forbiddenTools：Mission 执行侧拿不到被禁工具
// ---------------------------------------------------------------------------

test("Mission：能力包声明 forbiddenTools → 执行侧工具表没有被禁工具", () => {
  const root = makeTempRoot();
  writeSkill(
    root,
    "test",
    "no-fetch",
    "triggers: [网页, 抓取, 竞品]\nforbiddenTools: [web_fetch]"
  );
  const skills = skillsFrom(root);
  const constraints = resolveMissionToolConstraints({
    session,
    text: "帮我抓取网页，调研竞品的价格",
    skills,
  });
  assert.ok(
    (constraints.forbiddenTools ?? []).includes("web_fetch"),
    `约束里应有 web_fetch：${JSON.stringify(constraints)}`
  );
  const names = toolsFor(fullCtx(), constraints).map((t) => t.name);
  assert.ok(!names.includes("web_fetch"), `web_fetch 应被挡掉，实际：${names.join(",")}`);
  // 其他工具不受影响
  assert.ok(names.includes("web_search"), `web_search 不应被连带：${names.join(",")}`);
  assert.ok(names.includes("knowledge_search"));
});

// ---------------------------------------------------------------------------
// 2. requiredTools：允许名单
// ---------------------------------------------------------------------------

test("Mission：能力包声明 requiredTools → 执行侧只剩允许名单", () => {
  const root = makeTempRoot();
  writeSkill(
    root,
    "test",
    "calc-only",
    "triggers: [计算, 成本]\nrequiredTools: [calculate]"
  );
  const skills = skillsFrom(root);
  const constraints = resolveMissionToolConstraints({
    session,
    text: "计算一下这次活动的成本",
    skills,
  });
  assert.deepEqual(constraints.requiredTools, ["calculate"]);
  const names = toolsFor(fullCtx(), constraints).map((t) => t.name);
  assert.deepEqual(names, ["calculate"]);
});

// ---------------------------------------------------------------------------
// 3. tenants：组织不匹配的能力包在解析阶段就被过滤
// ---------------------------------------------------------------------------

test("Mission：tenants 不匹配的能力包 → 约束为空（看不见它）", () => {
  const root = makeTempRoot();
  writeSkill(
    root,
    "test",
    "other-org-only",
    "triggers: [网页, 抓取]\ntenants: [other-org]\nforbiddenTools: [web_fetch]"
  );
  const skills = skillsFrom(root);
  const constraints = resolveMissionToolConstraints({
    session, // organizationId = org-1，不在 tenants 里
    text: "帮我抓取网页",
    skills,
  });
  assert.deepEqual(constraints.forbiddenTools, []);
  assert.deepEqual(constraints.requiredTools, []);
  // 行为不变：工具表完整
  const names = toolsFor(fullCtx(), constraints).map((t) => t.name);
  assert.ok(names.includes("web_fetch"));
});

test("Mission：tenants 匹配的能力包 → 约束生效", () => {
  const root = makeTempRoot();
  writeSkill(
    root,
    "test",
    "my-org-only",
    "triggers: [网页, 抓取]\ntenants: [org-1]\nforbiddenTools: [web_fetch]"
  );
  const skills = skillsFrom(root);
  const constraints = resolveMissionToolConstraints({
    session,
    text: "帮我抓取网页",
    skills,
  });
  assert.ok((constraints.forbiddenTools ?? []).includes("web_fetch"));
});

// ---------------------------------------------------------------------------
// 4. 回归：没有能力包命中 → 空约束，工具表与原来一致
// ---------------------------------------------------------------------------

test("Mission：没有能力包命中 → 空约束，执行侧行为不变", () => {
  const root = makeTempRoot();
  writeSkill(root, "test", "unrelated", "triggers: [火星, 殖民]");
  const skills = skillsFrom(root);
  const constraints = resolveMissionToolConstraints({
    session,
    text: "帮我总结一下今天的会议纪要",
    skills,
  });
  assert.deepEqual(constraints, { requiredTools: [], forbiddenTools: [] });
  const before = toolsFor(fullCtx()).map((t) => t.name).sort();
  const after = toolsFor(fullCtx(), constraints).map((t) => t.name).sort();
  assert.deepEqual(after, before);
});

// ---------------------------------------------------------------------------
// 5. 研究三档：tier=deep 走通，档位透传给 runResearch
// ---------------------------------------------------------------------------

test("Mission：researchTier=deep → 走 runResearch，档位透传", async () => {
  let capturedTier: unknown = null;
  const fakeRunResearch = (async (_s: any, params: any) => {
    capturedTier = params.tier;
    return {
      tier: "deep",
      route: {
        query: params.query,
        requested: [],
        ran: ["web"],
        items: [
          {
            scope: "web",
            ref: "web:https://example.com/a",
            title: "竞品 A",
            snippet: "售价 199",
            uri: "https://example.com/a",
            capturedAt: null,
            authorityTier: "unknown",
            authority: 0.5,
            score: 5,
            verified: false,
            conflictGroup: null,
            statement: null,
          } satisfies KnowledgeResultItem,
        ],
        unavailable: [],
        elapsedMs: 1,
      },
      usage: { tier: "deep" },
    };
  }) as unknown as typeof runResearch;

  const hits = await searchKnowledgeForMission(session, "竞品价格", {
    researchTier: "deep",
    runResearchFn: fakeRunResearch,
  });
  assert.equal(capturedTier, "deep");
  assert.deepEqual(hits, [{ title: "竞品 A", snippet: "售价 199", ref: "web:https://example.com/a" }]);
});

// ---------------------------------------------------------------------------
// 6. 分档计量：真实 runResearch + fake provider + 注入 meter，details.tier 可区分
// ---------------------------------------------------------------------------

function fakeItem(scope: string, ref: string): KnowledgeResultItem {
  return {
    scope,
    ref,
    title: "命中标题 kw1 kw2",
    snippet: "x".repeat(40),
    uri: null,
    capturedAt: null,
    authorityTier: "unknown",
    authority: 0.5,
    score: 5,
    verified: false,
    conflictGroup: null,
    statement: null,
  };
}

test("Mission：真实 runResearch 在 deep 档 → meter 收到 details.tier=deep", async () => {
  const scopes = researchTierScopes("deep");
  const regs: string[] = [];
  for (const s of scopes) {
    registerKnowledgeProvider({ scope: s, label: s, search: async () => [fakeItem(s, `${s}#1`)] });
    regs.push(s);
  }
  try {
    const seen: (ResearchUsage & { organizationId: string; query: string })[] = [];
    await runResearch(session, {
      query: "竞品价格调研",
      tier: "deep",
      limit: 4,
      meter: async (r) => {
        seen.push(r);
      },
    });
    assert.equal(seen.length, 1);
    // meter 收到的是 ResearchUsage（含 details 写库时的 tier 字段来源）
    assert.equal(seen[0].tier, "deep");
    assert.ok(seen[0].providerCalls > 0, "deep 档应有 provider 调用");
  } finally {
    for (const s of regs) unregisterKnowledgeProvider(s);
  }
});

// ---------------------------------------------------------------------------
// 7. 回归：不传 researchTier → 不走 runResearch，走原 plain 路径
// ---------------------------------------------------------------------------

test("Mission：不传 researchTier → 走原 searchKnowledge 路径（runResearch 未被调用）", async () => {
  let runResearchCalled = false;
  const hits = await searchKnowledgeForMission(session, "查一下", {
    runResearchFn: (async () => {
      runResearchCalled = true;
      throw new Error("should not be called");
    }) as unknown as typeof runResearch,
    plainSearchFn: (async () => ({
      query: "查一下",
      citations: [{ docTitle: "文档一", snippet: "内容", ref: "doc1" }],
      facts: [],
    })) as any,
  });
  assert.equal(runResearchCalled, false);
  assert.deepEqual(hits, [{ title: "文档一", snippet: "内容", ref: "knowledge:doc1" }]);
});
