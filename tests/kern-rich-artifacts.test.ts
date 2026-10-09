/**
 * kern-rich/v1 — protocol, harness and sandbox guarantees (pure, no DB).
 * Run: node --import tsx --test tests/kern-rich-artifacts.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ARTIFACT_CSP,
  buildSandboxDocument,
  buildStandaloneDocument,
  describeMarkers,
  extractArtifacts,
  readArtifactCitation,
  readArtifactMessage,
  artifactFileName,
} from "../src/modules/artifacts/protocol";
import { parseRichBlock, richTextToMarkdown, sanitizeRichFences, splitRichText } from "../src/modules/artifacts/rich-blocks";
import { normalizeReply } from "../src/modules/assistant-runtime/reply-format";

const DOC = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>body{font:14px system-ui}</style></head><body><h1>对比</h1><script>document.body.dataset.ok="1"</script></body></html>`;

test("extractArtifacts keeps prose, replaces the tag with a marker and survives the Markdown harness", () => {
  const raw = `**推荐方案 A。** 下面是对比视图。\n\n<kern-artifact key="Plan Compare" title="两个方案的对比" kind="compare">\n${DOC}\n</kern-artifact>\n\n还需要确认供应商报价（待验证）。`;
  const { text, artifacts } = extractArtifacts(raw);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].key, "plan-compare");
  assert.equal(artifacts[0].kind, "compare");
  assert.equal(artifacts[0].complete, true);
  assert.match(text, /\[\[kern-artifact:plan-compare\]\]/);
  assert.doesNotMatch(text, /<html|<script/);
  // The harness strips raw HTML — artifacts must already be out of the text by then.
  const normalized = normalizeReply(text).text;
  assert.match(normalized, /\[\[kern-artifact:plan-compare\]\]/);
  assert.match(normalized, /推荐方案 A/);
});

test("a truncated artifact fails honestly and keeps the text written before it", () => {
  const { text, artifacts } = extractArtifacts(`结论：先做方案 B。\n<kern-artifact key="cost" title="成本"><!doctype html><html><body><div>半截`);
  assert.equal(artifacts[0].complete, false);
  assert.match(artifacts[0].error ?? "", /没有完整返回/);
  assert.match(text, /结论：先做方案 B/);
});

test("incomplete documents and unbalanced scripts are rejected", () => {
  assert.equal(extractArtifacts(`<kern-artifact key="x" title="x"><html><body>no end</body></kern-artifact>`).artifacts[0].complete, false);
  assert.equal(extractArtifacts(`<kern-artifact key="x" title="x"><div><script>let a=1</div></kern-artifact>`).artifacts[0].complete, false);
  assert.equal(extractArtifacts(`<kern-artifact key="x" title="x"><div>fragment ok</div></kern-artifact>`).artifacts[0].complete, true);
});

test("an ```html fence around the document is unwrapped; a missing key is derived from the title deterministically", () => {
  const a = extractArtifacts("<kern-artifact title=\"项目计划\">\n```html\n" + DOC + "\n```\n</kern-artifact>").artifacts[0];
  assert.ok(a.html.startsWith("<!doctype html>"));
  const b = extractArtifacts("<kern-artifact title=\"项目计划\">" + DOC + "</kern-artifact>").artifacts[0];
  assert.equal(a.key, b.key);
  assert.match(a.key, /^artifact-/);
});

test("sandbox document: network-less CSP first in <head>, bridge bound to artifact id + nonce", () => {
  const doc = buildSandboxDocument(DOC, { artifactId: "a1", nonce: "n1" });
  const head = doc.slice(doc.indexOf("<head"), doc.indexOf("<style>"));
  assert.ok(head.includes(`content="${ARTIFACT_CSP}"`));
  assert.match(ARTIFACT_CSP, /default-src 'none'/);
  assert.match(ARTIFACT_CSP, /connect-src 'none'/);
  assert.doesNotMatch(ARTIFACT_CSP, /https?:/);
  assert.ok(doc.indexOf("Content-Security-Policy") < doc.indexOf("document.body.dataset.ok"));
  assert.match(doc, /"a1"/);
  // fragments get a full skeleton
  assert.match(buildSandboxDocument("<p>hi</p>", { artifactId: "a", nonce: "n" }), /^<!doctype html><html lang="zh-CN"><head>/);
});

test("standalone export is self-contained: CSP, provenance and an offline bridge, no host messaging", () => {
  const doc = buildStandaloneDocument(DOC, { artifactId: "a1", title: "两个方案", version: 3, createdAt: "2026-10-09T00:00:00.000Z" });
  assert.match(doc, /^<!doctype html>\n<!-- Kern 成果「两个方案」 v3/);
  assert.ok(doc.includes(ARTIFACT_CSP));
  assert.doesNotMatch(doc, /parent\.postMessage/);
  assert.match(doc, /window\.kern=\{ask/);
  assert.equal(artifactFileName("两个 方案/对比", 2), "两个-方案-对比-v2.html");
});

test("host accepts only well-formed messages for the expected artifact and nonce", () => {
  const ok = { channel: "kern-artifact/v1", artifactId: "a1", nonce: "n1" };
  assert.deepEqual(readArtifactMessage({ ...ok, type: "ask", text: "  突出风险  " }, { artifactId: "a1", nonce: "n1" }), { type: "ask", text: "突出风险" });
  assert.equal(readArtifactMessage({ ...ok, type: "ask", text: "x" }, { artifactId: "a2", nonce: "n1" }), null);
  assert.equal(readArtifactMessage({ ...ok, nonce: "forged", type: "ask", text: "x" }, { artifactId: "a1", nonce: "n1" }), null);
  assert.equal(readArtifactMessage({ ...ok, type: "fetch", url: "/api/proposals/1/confirm" }, { artifactId: "a1", nonce: "n1" }), null);
  assert.equal(readArtifactMessage("kern-artifact/v1", { artifactId: "a1", nonce: "n1" }), null);
  assert.equal((readArtifactMessage({ ...ok, type: "ask", text: "x".repeat(900) }, { artifactId: "a1", nonce: "n1" }) as { text: string }).text.length, 500);
});

test("rich blocks: charts require a source and never invent values", () => {
  assert.equal(parseRichBlock(JSON.stringify({ type: "chart", unit: "元", series: [{ label: "a", value: 1 }, { label: "b", value: 2 }] })).ok, false);
  assert.equal(parseRichBlock(JSON.stringify({ type: "chart", unit: "元", source: "用户提供", series: [{ label: "a", value: "n/a" }, { label: "b", value: 2 }] })).ok, false);
  const ok = parseRichBlock(JSON.stringify({ type: "chart", chart: "waterfall", unit: "元", source: "用户提供的报价单", basis: "fact", series: [{ label: "原料", value: 8.05 }, { label: "包装", value: "2.4" }] }));
  assert.ok(ok.ok && ok.block.type === "chart" && ok.block.series[1].value === 2.4);
  assert.equal(parseRichBlock(JSON.stringify({ type: "chart", chart: "donut", unit: "%", source: "x", series: [{ label: "a", value: -1 }, { label: "b", value: 2 }] })).ok, false);
  assert.equal(parseRichBlock("{not json").ok, false);
  assert.equal(parseRichBlock(JSON.stringify({ type: "compare", options: [{ name: "only one" }] })).ok, false);
});

test("rich blocks: metrics default to unknown basis; next actions are capped at three", () => {
  const m = parseRichBlock(JSON.stringify({ type: "metrics", items: [{ label: "单件成本", value: "¥18.95" }] }));
  assert.ok(m.ok && m.block.type === "metrics" && m.block.items[0].basis === "unknown");
  const n = parseRichBlock(JSON.stringify({ type: "next", items: [1, 2, 3, 4].map((i) => ({ label: `L${i}`, prompt: `P${i}` })) }));
  assert.ok(n.ok && n.block.type === "next" && n.block.items.length === 3);
});

test("splitRichText: kern-ui blocks, persisted markers and ordinary code fences", () => {
  const text = [
    "结论在前。",
    "```kern-ui",
    JSON.stringify({ type: "callout", tone: "warn", title: "注意", body: "报价未确认" }),
    "```",
    "[[kern-artifact:5b1d2c3e-aaaa-bbbb-cccc-111122223333@2]]",
    "```ts",
    "[[kern-artifact:5b1d2c3e-aaaa-bbbb-cccc-111122223333@2]]",
    "```",
    "```kern-ui",
    "{oops",
    "```",
  ].join("\n");
  const segs = splitRichText(text);
  assert.deepEqual(segs.map((s) => s.t), ["md", "block", "artifact", "md", "invalid"]);
  assert.equal((segs[2] as { version: number }).version, 2);
});

test("server harness replaces invalid blocks with an honest note and normalises valid ones", () => {
  const out = sanitizeRichFences(["```kern-ui", '{"type":"chart","series":[]}', "```", "```kern-ui", '{ "type": "callout", "title": "t", "body": "b" }', "```"].join("\n"));
  assert.equal(out.issues.length, 1);
  assert.match(out.text, /\[!NOTE\]/);
  assert.match(out.text, /\{"type":"callout","tone":"info","title":"t","body":"b"\}/);
});

test("markdown fallback and marker descriptions for copy / model history", () => {
  const md = richTextToMarkdown(["前言", "```kern-ui", JSON.stringify({ type: "chart", unit: "元", source: "报价单", basis: "fact", series: [{ label: "原料", value: 8 }, { label: "包装", value: 2 }] }), "```"].join("\n"));
  assert.match(md, /\| 原料 \| 8 \|/);
  assert.match(md, /来源：报价单（事实）/);
  const cite = readArtifactCitation({ kind: "kern-artifact", ref: "id-1", key: "plan", version: 2, title: "计划", status: "READY" });
  assert.ok(cite);
  assert.equal(describeMarkers("看这里 [[kern-artifact:id-1@2]]", [cite!]), "看这里 〔可视化成果「计划」key=plan v2〕");
  assert.equal(readArtifactCitation({ kind: "kern-mission", ref: "x" }), null);
});
