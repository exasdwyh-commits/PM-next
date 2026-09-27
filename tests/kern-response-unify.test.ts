/**
 * Layered reply model: the Markdown reply layer (docs/KERN_REPLY_FORMAT.md)
 * and the mission ResponseEnvelope (docs/KERN_RESPONSE_SPEC.md) share one
 * inline renderer, one set of text rules, and one conclusion hand-off.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { lintReply, normalizeReply } from "../src/modules/assistant-runtime/reply-format";
import { envelopeFromMission } from "../src/modules/response-format/from-mission";
import { BANNED_PHRASES, hasEmoji, startsWithPreamble } from "../src/modules/response-format/text-rules";
import type { ResponseEnvelope } from "../src/modules/response-format/types";
import { BANNED_PHRASES as VALIDATE_BANNED, validate } from "../src/modules/response-format/validate";
import { isMissionConclusionCitation, type MissionReport } from "../src/modules/supervisor/report-format";

test("both layers use the same banned-phrase list", () => {
  assert.equal(VALIDATE_BANNED, BANNED_PHRASES);
  assert.ok(lintReply("作为一个AI，我建议先做调研。").includes("banned-phrase"));
  assert.ok(!lintReply("建议先做两周调研。").includes("banned-phrase"));
});

test("shared preamble + emoji rules", () => {
  assert.ok(startsWithPreamble("好的！我来为你分析一下："));
  assert.ok(!startsWithPreamble("好价格是关键。"));
  assert.equal(normalizeReply("好的！下面是结论：\n\n先做 A。").text, "先做 A。");
  assert.ok(hasEmoji("上线了🚀"));
  assert.ok(!hasEmoji("完成 ✓ → 下一步"), "typographic symbols are allowed");
});

function envelope(over: Partial<ResponseEnvelope> = {}): ResponseEnvelope {
  return {
    v: 1, kind: "ANSWER", demo: false, lede: "先做小范围验证", confidence: "LOW",
    blocks: [{ type: "prose", body: ["先用两周验证需求。"] }],
    meta: { model: "m", elapsedMs: 1, steps: 1, quota: null, memoriesUsed: [], sources: 0 },
    ...over,
  };
}

test("R15 flags a preamble in lede or prose (warn, still renderable)", () => {
  const issues = validate(envelope({ lede: "好的！我来总结：先验证" }));
  const r15 = issues.find((i) => i.id === "R15");
  assert.equal(r15?.level, "warn");
  assert.ok(!issues.some((i) => i.level === "error"));
});

test("R16 flags H1 / raw HTML inside prose", () => {
  assert.ok(validate(envelope({ blocks: [{ type: "prose", body: ["# 大标题"] }] })).some((i) => i.id === "R16"));
  assert.ok(validate(envelope({ blocks: [{ type: "prose", body: ["<div>x</div>"] }] })).some((i) => i.id === "R16"));
  assert.ok(!validate(envelope()).some((i) => i.id === "R16"));
});

test("mission conclusion prose keeps the whole Markdown (code blocks with blank lines survive)", () => {
  const conclusion = "## 结论\n\n先做 A。\n\n```bash\nnpm i\n\nnpm test\n```\n\n" + Array.from({ length: 15 }, (_, i) => `段落 ${i}`).join("\n\n");
  const r: MissionReport = {
    missionTaskId: "m1", title: "t", goal: "g", status: "COMPLETED", outcome: "COMPLETED", demo: false,
    createdAt: new Date().toISOString(), constraints: [], conclusion, decision: null, recommendation: null, steps: [],
    meta: { tasksCreated: 3, maxTasks: 8, memoriesUsed: [], successCriteria: [], humanGates: [] },
  } as unknown as MissionReport;
  const env = envelopeFromMission(r, { model: "m", elapsedMs: 0, quota: null });
  const prose = env.blocks.find((b) => b.type === "prose" && b.title === "结论");
  assert.ok(prose && prose.type === "prose");
  assert.equal(prose.body.length, 1);
  assert.equal(prose.body[0], conclusion);
});

test("conclusion citation detection: explicit flag, legacy title, and non-conclusions", () => {
  assert.equal(isMissionConclusionCitation({ kind: "kern-mission", ref: "a", conclusion: true }), "a");
  assert.equal(isMissionConclusionCitation({ kind: "kern-mission", ref: "b", title: "Kern 工作结果 · 已完成" }), "b");
  assert.equal(isMissionConclusionCitation({ kind: "kern-mission", ref: "c", title: "Kern 工作结果 · 需要你处理" }), null);
  assert.equal(isMissionConclusionCitation({ kind: "kern-brief", ref: "d", conclusion: true }), null);
  assert.equal(isMissionConclusionCitation(null), null);
});

test("[n] source markers: static superscript outside an envelope, button inside", async () => {
  const React = await import("react");
  (globalThis as { React?: unknown }).React = React;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { Prose, SourceRefContext } = await import("../src/app/muse/components/prose");
  const plain = renderToStaticMarkup(React.createElement(Prose, { text: "市场在增长[2]，见 [文档](https://a.b)。" }));
  assert.match(plain, /<sup class="kr-ref" data-static="true">2<\/sup>/);
  assert.match(plain, /<a href="https:\/\/a.b"/, "links are not mistaken for markers");
  const wired = renderToStaticMarkup(
    React.createElement(SourceRefContext.Provider, { value: () => undefined }, React.createElement(Prose, { text: "增长[2]" }))
  );
  assert.match(wired, /<button type="button" class="kr-ref"[^>]*>2<\/button>/);
});

test("ResponseView renders ProseBlock through the reply renderer and falls back when rejected", async () => {
  const React = await import("react");
  (globalThis as { React?: unknown }).React = React;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { ResponseView } = await import("../src/app/muse/response/response-view");
  const ok = renderToStaticMarkup(
    React.createElement(ResponseView, { envelope: envelope({ blocks: [{ type: "prose", body: ["| 项 | 值 |\n|---|---:|\n| A | 12 |"] }] }) })
  );
  assert.match(ok, /class="m-prose"/);
  assert.match(ok, /class="m-table"/, "tables in prose now render (the old inline-only renderer showed pipes)");
  const bad = envelope({ lede: "" }); // R1 error
  const fb = renderToStaticMarkup(React.createElement(ResponseView, { envelope: bad, fallback: React.createElement("p", null, "FALLBACK") }));
  assert.equal(fb, "<p>FALLBACK</p>");
  const ask = renderToStaticMarkup(React.createElement(ResponseView, {
    envelope: envelope({ ask: { question: "批吗", why_you: "预算", options: [{ label: "批", consequence: "x" }, { label: "不批", consequence: "y" }] } }),
  }));
  assert.ok(!/<button[^>]*class="opt"/.test(ask), "ask options are not dead buttons without onAsk");
});
