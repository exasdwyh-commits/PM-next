import assert from "node:assert/strict";
import test from "node:test";
import { lintReply, normalizeReply, KERN_REPLY_FORMAT_PROMPT } from "../src/modules/assistant-runtime/reply-format";
import { buildDepartmentAssistantSystemPrompt } from "../src/modules/assistant-runtime/persona";
import { parseProse, type Block } from "../src/app/muse/components/prose";

test("harness repairs common model mistakes", () => {
  const messy = [
    "好的！下面是我的分析：",
    "# 结论。",
    "推荐做 A。<br>理由见下。",
    "",
    "",
    "",
    "* 第一点",
    "+ 第二点",
    "• 第三点",
    "",
    "> [!注意] 风险",
    "> 原料涨价",
    "",
    "| 方案 | 价格 |",
    "|---|---|---|",
    "| A | ¥199 | 多余 |",
    "| B |",
    "",
    "###### 深层标题",
    "```ts",
    "const a = '<div>'",
  ].join("\n");
  const r = normalizeReply(messy);
  const lines = r.text.split("\n");
  assert.equal(lines[0], "## 结论", "preamble removed, H1 → ##, trailing 。 dropped");
  assert.equal(lines[1], "推荐做 A。");
  assert.equal(lines[2], "理由见下。", "<br> → newline");
  assert.equal(lines[3], "", "blank runs collapsed");
  assert.deepEqual(lines.slice(4, 7), ["- 第一点", "- 第二点", "- 第三点"]);
  assert.ok(r.text.includes("> [!WARNING] 风险"));
  assert.ok(r.text.includes("| --- | --- |"), "divider fixed to header width");
  assert.ok(r.text.includes("| A | ¥199 / 多余 |"), "extra cells merged");
  assert.ok(r.text.includes("| B |  |"), "short row padded");
  assert.ok(r.text.includes("### 深层标题"));
  assert.ok(r.text.includes("const a = '<div>'"), "code untouched");
  assert.ok(r.text.endsWith("```"), "unclosed fence closed");
  for (const f of ["preamble", "h1", "raw-html", "blank-lines", "bullet-style", "callout-alias", "ragged-table", "deep-heading", "unclosed-fence"]) {
    assert.ok(r.fixed.includes(f as never), `fixed ${f}`);
  }
});

test("harness leaves a well-formed reply alone", () => {
  const good = "推荐做 **随行冷萃杯**。\n\n## 依据\n\n- 需求上升（推断）\n- 价格带空白\n\n> [!DECISION]\n> 是否投入 ¥60k 做验证？";
  const r = normalizeReply(good);
  assert.equal(r.text, good);
  assert.deepEqual(r.fixed, []);
});

test("preamble only stripped when real content follows; not inside words", () => {
  assert.equal(normalizeReply("好的").text, "好的");
  assert.equal(normalizeReply("好的，我来看看：这件事需要先确认预算。").text, "这件事需要先确认预算。");
  assert.equal(normalizeReply("好评率 92%").text, "好评率 92%");
});

test("lint reports what the harness cannot fix", () => {
  assert.deepEqual(lintReply("## 标题\n短回答"), ["headings-on-short"]);
  assert.ok(lintReply("> [!NOTE]\n> a\n\n> [!TIP]\n> b\n\n> [!WARNING]\n> c").includes("too-many-callouts"));
  assert.ok(lintReply("太好了 🎉").includes("emoji"));
  const noLead = "## 背景\n" + "内容".repeat(120);
  assert.ok(lintReply(noLead).includes("no-lead"));
  assert.deepEqual(lintReply("完成 ✓ → 下一步"), [], "arrows/check marks are not emoji");
});

test("persona carries the format spec for every assistant task class", () => {
  for (const tc of ["ASSISTANT_DIALOGUE", "ASSISTANT_PLANNING", "ASSISTANT_SYNTHESIS"]) {
    assert.ok(buildDepartmentAssistantSystemPrompt(tc)!.includes(KERN_REPLY_FORMAT_PROMPT));
  }
  assert.equal(buildDepartmentAssistantSystemPrompt("CLASSIFY"), null);
});

const kinds = (b: Block[]) => b.map((x) => x.t);

test("renderer parses the full subset", () => {
  const src = [
    "先给结论。",
    "",
    "## 方案",
    "1. 第一步",
    "   - 子项 a",
    "   - 子项 b",
    "2. 第二步",
    "",
    "- [x] 已完成",
    "- [ ] 待办",
    "",
    "| 竞品 | 价格 | 份额 |",
    "|:---|---:|:---:|",
    "| X | ¥199 | 32% |",
    "",
    "> [!DECISION] 预算",
    "> 是否投入 **¥60k**？",
    "",
    "> 普通引用",
    "",
    "```bash",
    "npm run test",
    "```",
    "---",
  ].join("\n");
  const b = parseProse(src);
  assert.deepEqual(kinds(b), ["p", "h", "ol", "ul", "table", "callout", "quote", "code", "hr"]);
  const ol = b[2] as Extract<Block, { t: "ul" | "ol" }>;
  assert.equal(ol.items.length, 2);
  assert.deepEqual(kinds(ol.items[0].children), ["ul"], "nested list");
  const tasks = b[3] as Extract<Block, { t: "ul" | "ol" }>;
  assert.deepEqual(tasks.items.map((i) => [i.task, i.text]), [[true, "已完成"], [false, "待办"]]);
  const table = b[4] as Extract<Block, { t: "table" }>;
  assert.deepEqual(table.align, ["left", "right", "center"]);
  const callout = b[5] as Extract<Block, { t: "callout" }>;
  assert.equal(callout.kind, "DECISION");
  assert.equal(callout.title, "预算");
  assert.deepEqual(kinds(callout.children), ["p"]);
  const code = b[7] as Extract<Block, { t: "code" }>;
  assert.deepEqual([code.lang, code.text], ["bash", "npm run test"]);
});

test("ordered list keeps its start number; unknown callout type is a plain quote", () => {
  const b = parseProse("3. 三\n4. 四\n\n> [!FOO] x");
  assert.equal((b[0] as Extract<Block, { t: "ul" | "ol" }>).start, 3);
  assert.equal(b[1].t, "quote");
});

test("inline renderer terminates with nested bold/link (regression: shared regex state)", async () => {
  (globalThis as { React?: unknown }).React = await import("react");
  const { inline } = await import("../src/app/muse/components/prose");
  const nodes = inline("前 **粗 [链接](https://a.b) 体** 中 `c` 后 **再粗** 尾（推断）", "k");
  assert.ok(nodes.length >= 7 && nodes.length < 20);
});
