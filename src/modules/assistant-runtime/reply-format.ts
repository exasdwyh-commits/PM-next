/**
 * Kern reply format — spec + harness.
 *
 * Three layers keep replies consistently readable:
 *   1. SPEC   (KERN_REPLY_FORMAT_PROMPT) — told to the model in the persona.
 *   2. HARNESS (normalizeReply)         — every model reply passes through it
 *      before it is stored: repairs what models commonly get wrong (H1s,
 *      unclosed fences, raw HTML, "好的！" preambles, ragged tables…) and
 *      reports what it could not fix (lintReply) so we can measure drift.
 *   3. RENDERER (src/app/muse/components/prose.tsx) — renders exactly this
 *      Markdown subset; anything outside it degrades to plain text.
 *
 * Pure module: no server imports, unit-tested in tests/kern-reply-format.test.ts.
 */

import { findBannedPhrase, hasEmoji, PREAMBLE } from "@/modules/response-format/text-rules";

export const KERN_REPLY_FORMAT_VERSION = "kern-reply-format/v1";

export const CALLOUT_KINDS = ["NOTE", "TIP", "WARNING", "DECISION", "UNKNOWN"] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

export const CALLOUT_LABEL: Record<CalloutKind, string> = {
  NOTE: "说明",
  TIP: "建议",
  WARNING: "注意",
  DECISION: "需要你决定",
  UNKNOWN: "待验证",
};

/** Injected into the Kern persona for every ASSISTANT_* task class. */
export const KERN_REPLY_FORMAT_PROMPT = [
  `回复格式规范（${KERN_REPLY_FORMAT_VERSION}，界面按此渲染，务必遵守）：`,
  "1. 先给答案：第一段就是结论或直接回答（1–2 句）。不要寒暄或复述问题，不要以“好的”“当然”“作为 AI”开头。",
  "2. 按长度选结构：",
  "   - 简单问题：1–3 句话，不用标题、不用列表。",
  "   - 中等：短段落 + 至多一个列表。",
  "   - 长回复（报告、方案、对比）：先一段摘要，再用 `##` 分节（不超过 5 节），需要时用 `###` 细分。",
  "3. 标题只用 `##` 和 `###`，不要用 `#`。标题要短（≤ 16 字），不加句号、不编号。",
  "4. 列表：无序用 `- `，步骤或排序用 `1. `；最多两层（子项缩进 2 个空格）；每项一句话，结构平行。",
  "5. 强调：只用 **加粗** 标出关键结论或术语，每段最多一处；中文不用斜体。",
  "6. 表格：比较 ≥3 个对象或 ≥2 个维度时用 Markdown 表格；必须有表头；不超过 6 列；数字列右对齐（`---:`）。",
  "7. 代码、命令、配置用带语言标记的代码块（```ts、```bash）；行内标识符用 `反引号`。",
  "8. 提示框（整条回复最多 2 个），语法为引用块首行写类型：",
  "   > [!DECISION]",
  "   > 只有真正需要用户拍板的事（资金、对外、不可逆、战略取舍）才用。",
  "   其余类型：[!NOTE] 背景说明、[!TIP] 建议做法、[!WARNING] 风险或限制、[!UNKNOWN] 尚未验证、需要数据的判断。",
  "9. 事实与推断分开：推断在句末标注（推断），缺数据标注（待验证）；不要把 UNKNOWN 写成结论。",
  "10. 数字带单位：金额用 ¥，比例用 %，日期用 YYYY-MM-DD；约数写“约”。",
  "11. 结尾最多一句下一步，或者一个最关键的问题，二者选一；不要每条回复都追问。",
  "12. 禁止：原始 HTML、Mermaid/图表代码、表情符号（除非用户先用）、大段加粗、为凑结构而加的空标题。",
].join("\n");

export type ReplyIssue =
  | "preamble"
  | "h1"
  | "deep-heading"
  | "unclosed-fence"
  | "raw-html"
  | "ragged-table"
  | "bullet-style"
  | "blank-lines"
  | "callout-alias"
  | "headings-on-short"
  | "too-many-callouts"
  | "too-many-sections"
  | "emoji"
  | "banned-phrase"
  | "no-lead";

export type NormalizedReply = { text: string; fixed: ReplyIssue[]; issues: ReplyIssue[] };

const CALLOUT_ALIASES: Record<string, CalloutKind> = {
  NOTE: "NOTE", INFO: "NOTE", IMPORTANT: "NOTE", 说明: "NOTE", 提示: "NOTE",
  TIP: "TIP", 建议: "TIP",
  WARNING: "WARNING", WARN: "WARNING", CAUTION: "WARNING", 注意: "WARNING", 风险: "WARNING",
  DECISION: "DECISION", 决定: "DECISION", 需要你决定: "DECISION",
  UNKNOWN: "UNKNOWN", 待验证: "UNKNOWN", 未知: "UNKNOWN",
};
const HTML_TAG = /<\/?(?:div|span|p|br|b|i|strong|em|u|font|table|tr|td|th|thead|tbody|ul|ol|li|h[1-6]|img|a|center|small|sup|sub|details|summary|style|script)\b[^>]*>/gi;

/** Map each line to whether it sits inside a fenced code block. */
function fenceMask(lines: string[]): boolean[] {
  let open = false;
  return lines.map((l) => {
    if (/^\s*(```|~~~)/.test(l)) { open = !open; return true; }
    return open;
  });
}

export function normalizeReply(input: string): NormalizedReply {
  const fixed = new Set<ReplyIssue>();
  let text = (input ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/\t/g, "  ");

  // preamble: only the very start, only when real content follows
  const pre = PREAMBLE.exec(text.trimStart());
  if (pre && pre[0].trim() && text.trimStart().length > pre[0].length + 4) {
    text = text.trimStart().slice(pre[0].length);
    fixed.add("preamble");
  }

  let lines = text.split("\n").map((l) => l.replace(/\s+$/, ""));

  // close an unclosed fence
  const fences = lines.filter((l) => /^\s*(```|~~~)/.test(l)).length;
  if (fences % 2 === 1) { lines.push("```"); fixed.add("unclosed-fence"); }

  const inCode = fenceMask(lines);
  lines = lines.map((line, i) => {
    if (inCode[i]) return line;
    let l = line;
    // raw HTML → text (line breaks kept)
    if (HTML_TAG.test(l)) {
      HTML_TAG.lastIndex = 0;
      l = l.replace(/<br\s*\/?>/gi, "\n").replace(HTML_TAG, "");
      fixed.add("raw-html");
    }
    HTML_TAG.lastIndex = 0;
    // headings: # → ##, ##### → ###
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) {
      const title = h[2].replace(/\s*#+\s*$/, "").replace(/[。.]$/, "");
      if (h[1].length === 1) { fixed.add("h1"); return `## ${title}`; }
      if (h[1].length > 4) { fixed.add("deep-heading"); return `### ${title}`; }
      return `${h[1]} ${title}`;
    }
    // bullets: * / + / • → -
    const b = /^(\s*)(?:[*+•·●▪])\s+(.*)$/.exec(l);
    if (b && !/^\s*\*\*/.test(l)) { fixed.add("bullet-style"); return `${b[1]}- ${b[2]}`; }
    // callout aliases
    const c = /^>\s*\[!([^\]]+)\]\s*(.*)$/.exec(l);
    if (c) {
      const key = c[1].trim().toUpperCase();
      const kind = CALLOUT_ALIASES[key] ?? CALLOUT_ALIASES[c[1].trim()];
      if (kind && kind !== c[1].trim()) fixed.add("callout-alias");
      if (kind) return `> [!${kind}]${c[2] ? ` ${c[2]}` : ""}`;
    }
    return l;
  });
  lines = lines.join("\n").split("\n");

  // tables: pad/truncate rows to header width
  const mask2 = fenceMask(lines);
  for (let i = 0; i < lines.length - 1; i++) {
    if (mask2[i]) continue;
    const head = cells(lines[i]);
    if (!head || !isDivider(lines[i + 1])) continue;
    const n = head.length;
    if (cells(lines[i + 1])!.length !== n) { lines[i + 1] = `| ${Array(n).fill("---").join(" | ")} |`; fixed.add("ragged-table"); }
    for (let j = i + 2; j < lines.length && cells(lines[j]); j++) {
      const row = cells(lines[j])!;
      if (row.length !== n) {
        const fixedRow = row.length > n ? [...row.slice(0, n - 1), row.slice(n - 1).join(" / ")] : [...row, ...Array(n - row.length).fill("")];
        lines[j] = `| ${fixedRow.join(" | ")} |`;
        fixed.add("ragged-table");
      }
    }
  }

  // blank lines: at most one in a row (outside code)
  const mask3 = fenceMask(lines);
  const out: string[] = [];
  lines.forEach((l, i) => {
    if (!mask3[i] && !l.trim() && out.length && !out[out.length - 1].trim()) { fixed.add("blank-lines"); return; }
    out.push(l);
  });
  text = out.join("\n").trim();

  return { text, fixed: [...fixed], issues: lintReply(text) };
}

/** What the harness cannot fix — reported for telemetry and tests. */
export function lintReply(text: string): ReplyIssue[] {
  const issues: ReplyIssue[] = [];
  const lines = text.split("\n");
  const mask = fenceMask(lines);
  const prose = lines.filter((_, i) => !mask[i]);
  const plain = prose.join("").replace(/[#>*`|\-\s]/g, "");
  const headings = prose.filter((l) => /^#{2,3}\s/.test(l));
  if (headings.length && plain.length < 180) issues.push("headings-on-short");
  if (prose.filter((l) => /^##\s/.test(l)).length > 6) issues.push("too-many-sections");
  if (prose.filter((l) => /^>\s*\[!/.test(l)).length > 2) issues.push("too-many-callouts");
  if (prose.some((l) => hasEmoji(l))) issues.push("emoji");
  if (findBannedPhrase(prose.join("\n"))) issues.push("banned-phrase");
  const first = prose.find((l) => l.trim());
  if (first && /^(#{1,6}\s|[-*]\s|\d+[.、)]\s|\|)/.test(first) && plain.length >= 180) issues.push("no-lead");
  return issues;
}

function cells(line: string): string[] | null {
  const t = line.trim();
  if (!t.startsWith("|") || t.length < 3) return null;
  return t.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}
function isDivider(line: string): boolean {
  const c = cells(line);
  return !!c && c.every((x) => /^:?-{2,}:?$/.test(x));
}
