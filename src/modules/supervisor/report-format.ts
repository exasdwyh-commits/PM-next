/**
 * Pure helpers for turning a finished mission into take-away artifacts.
 * No server imports: used by the workspace UI (decision card) and by the
 * export / proposal code on the server, so both read the report the same way.
 */

export type ReportStep = { key: string; label: string; agent: string; status: string; output: string | null };

export type MissionReport = {
  missionTaskId: string;
  title: string;
  goal: string;
  status: string;
  outcome: string | null;
  demo: boolean;
  createdAt: string;
  constraints: { question: string; answer: string }[];
  conclusion: string | null;
  decision: string | null;
  recommendation: string | null;
  steps: ReportStep[];
  meta: {
    tasksCreated: number;
    maxTasks: number;
    memoriesUsed: string[];
    successCriteria: string[];
    humanGates: string[];
  };
};

/** First line of the goal — the brief appends "已确认的约束" below it. */
export function goalHeadline(goal: string): string {
  return goal.split("\n")[0].trim() || goal.trim();
}

/** "- 问题：答案" lines under "已确认的约束：". */
export function parseConstraints(goal: string): { question: string; answer: string }[] {
  const idx = goal.indexOf("已确认的约束");
  if (idx < 0) return [];
  const out: { question: string; answer: string }[] = [];
  for (const line of goal.slice(idx).split("\n").slice(1)) {
    const m = /^\s*[-•]\s*(.+?)[：:]\s*(.+)$/.exec(line);
    if (m) out.push({ question: m[1].trim(), answer: m[2].trim() });
  }
  return out;
}

const NO_DECISION = /^(目前)?(不需要|无需|暂无|没有)/;

/**
 * The "需要你决定的事" section of the synthesis. Accepts heading form
 * ("## 5. 需要你决定的事" + following lines) and inline form
 * ("**需要你决定的事**：……"). Returns null when the report says nothing
 * needs the user.
 */
export function extractDecision(conclusion: string | null | undefined): string | null {
  if (!conclusion) return null;
  const lines = conclusion.replace(/\r/g, "").split("\n");
  const at = lines.findIndex((l) => /需要你(来)?决定/.test(l));
  if (at < 0) return null;
  const head = lines[at];
  const m = /需要你(?:来)?决定(?:的事项|的事)?/.exec(head)!;
  const inline = head.slice(m.index + m[0].length).replace(/^[\s*_：:）)]+/, "").trim();
  const body: string[] = inline ? [inline] : [];
  for (const l of lines.slice(at + 1)) {
    if (/^\s*#{1,6}\s/.test(l) || /^\s*\d+[.、)]\s*\S{0,12}(风险|依据|结论|UNKNOWN|下一步)/.test(l)) break;
    if (/^\s*\*\*[^*]+\*\*\s*[：:]/.test(l) && body.length) break;
    body.push(l);
  }
  const text = body.join("\n").trim().replace(/\*\*/g, "");
  if (!text || NO_DECISION.test(text)) return null;
  return text;
}

/** "推荐做「X」" / "推荐方向：X" → X. */
export function extractRecommendation(conclusion: string | null | undefined): string | null {
  if (!conclusion) return null;
  const q = /推荐(?:做|方向[：:]?\s*)?[「“"]([^」”"]{1,40})[」”"]/.exec(conclusion);
  if (q) return q[1].trim();
  const p = /推荐方向[：:]\s*([^\n，。；;,]{1,40})/.exec(conclusion);
  return p ? p[1].replace(/\*\*/g, "").trim() : null;
}

/** First meaningful sentence of the conclusion (headings / markers stripped). */
export function conclusionLead(conclusion: string | null | undefined, max = 160): string | null {
  if (!conclusion) return null;
  for (const raw of conclusion.split("\n")) {
    const l = raw.replace(/\*\*/g, "").replace(/^\s*(#{1,6}|[-*•]|\d+[.、)])\s+/, "").trim();
    if (!l || /^结论(与建议)?[：:]?$/.test(l)) continue;
    return l.length > max ? `${l.slice(0, max)}…` : l;
  }
  return null;
}

/** "面向白领的健康零食" → "白领"; used when the user skipped the audience question. */
export function goalAudience(goal: string): string | null {
  const m = /(?:面向|针对|给)([^的，,。；\n]{2,20})的/.exec(goalHeadline(goal));
  return m ? m[1].trim() : null;
}

/** Push nested headings below the report's own ## / ### levels. */
export function demoteHeadings(text: string, minLevel: number): string {
  return text.replace(/^(#{1,6})\s+/gm, (_m, h: string) => `${"#".repeat(Math.min(6, Math.max(minLevel, h.length + minLevel - 1)))} `);
}

export function answerFor(report: Pick<MissionReport, "constraints">, pattern: RegExp): string | null {
  return report.constraints.find((c) => pattern.test(c.question))?.answer ?? null;
}

const STATUS_LABEL: Record<string, string> = {
  SUCCEEDED: "完成",
  SKIPPED: "已跳过",
  BLOCKED: "受阻",
  FAILED: "失败",
  RUNNING: "进行中",
  PENDING: "等待中",
  READY: "等待中",
};

/** Full Markdown report (what 「导出 MD」 downloads and the PDF view prints). */
export function missionReportMarkdown(r: MissionReport): string {
  const out: string[] = [];
  out.push(`# ${r.title}`, "");
  out.push(`> Kern 任务报告 · ${r.createdAt.slice(0, 10)} · ${r.outcome === "COMPLETED" ? "已完成" : r.outcome === "CANCELLED" ? "已取消" : r.outcome ? "需要你处理" : "进行中"}`);
  if (r.demo) out.push(">", "> **演示模式**：以下为示例数据，不代表真实调研结论。");
  out.push("");
  if (r.constraints.length) {
    out.push("## 已确认的约束", "");
    for (const c of r.constraints) out.push(`- **${c.question}**：${c.answer}`);
    out.push("");
  }
  if (r.decision) out.push("## 需要你决定", "", r.decision, "");
  out.push("## 结论", "", r.conclusion?.trim() ? demoteHeadings(r.conclusion.trim(), 3) : "（这次没有形成综合结论）", "");
  out.push("## 各步骤产出", "");
  for (const s of r.steps) {
    out.push(`### ${s.label}（${s.agent} · ${STATUS_LABEL[s.status] ?? s.status}）`, "");
    out.push(s.output?.trim() ? demoteHeadings(s.output.trim(), 4) : "（暂无产出）", "");
  }
  out.push("## 关于这次任务", "");
  out.push(`- 消耗：${r.meta.tasksCreated} 个步骤任务（上限 ${r.meta.maxTasks}）${r.demo ? "，演示运行不计额度" : ""}`);
  out.push(`- 用到的记忆：${r.meta.memoriesUsed.length ? r.meta.memoriesUsed.join("；") : "无"}`);
  if (r.meta.successCriteria.length) out.push(`- 成功标准：${r.meta.successCriteria.join("；")}`);
  out.push("");
  return out.join("\n");
}

export function reportFileName(r: Pick<MissionReport, "title" | "createdAt">, ext: string): string {
  const base = r.title.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "kern-report";
  return `${base}-${r.createdAt.slice(0, 10)}.${ext}`;
}

// ───────── Markdown table + HTML rendering (print / PDF view) ─────────

/** `| a | b |` → ["a","b"]; null when the line is not a table row. */
export function tableCells(line: string): string[] | null {
  const t = line.trim();
  if (!t.startsWith("|") || t.length < 3) return null;
  return t.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}
export function isTableDivider(line: string): boolean {
  const cells = tableCells(line);
  return !!cells && cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function inlineHtml(s: string): string {
  return esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
}

/** Safe Markdown subset → HTML (everything is escaped first; no raw HTML). */
export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r/g, "").split("\n");
  const html: string[] = [];
  let list: "ul" | "ol" | null = null;
  let para: string[] = [];
  const flushPara = () => { if (para.length) { html.push(`<p>${para.map(inlineHtml).join("<br>")}</p>`); para = []; } };
  const closeList = () => { if (list) { html.push(`</${list}>`); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (!line.trim()) { flushPara(); closeList(); continue; }
    const head = tableCells(line);
    if (head && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      flushPara(); closeList();
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && tableCells(lines[i])) rows.push(tableCells(lines[i++])!);
      i--;
      html.push(`<table><thead><tr>${head.map((c) => `<th>${inlineHtml(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${head.map((_, j) => `<td>${inlineHtml(r[j] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { flushPara(); closeList(); const lv = Math.min(h[1].length, 4); html.push(`<h${lv}>${inlineHtml(h[2])}</h${lv}>`); continue; }
    if (/^\s*(---+|——+)\s*$/.test(line)) { flushPara(); closeList(); html.push("<hr>"); continue; }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) { flushPara(); closeList(); if (q[1]) html.push(`<blockquote>${inlineHtml(q[1])}</blockquote>`); continue; }
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.、)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const kind = ul ? "ul" : "ol";
      if (list !== kind) { closeList(); html.push(`<${kind}>`); list = kind; }
      html.push(`<li>${inlineHtml((ul ?? ol)![1])}</li>`);
      continue;
    }
    closeList();
    para.push(line);
  }
  flushPara(); closeList();
  return html.join("\n");
}

/** Standalone printable page; opens the print dialog so the user can save as PDF. */
export function missionReportHtml(r: MissionReport, markdown: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(r.title)}</title>
<style>
body{font:15px/1.7 -apple-system,"PingFang SC","Noto Sans CJK SC","Microsoft YaHei",sans-serif;color:#1d1d24;max-width:760px;margin:40px auto;padding:0 24px}
h1{font-size:24px;margin:0 0 8px}h2{font-size:18px;margin:28px 0 8px;padding-bottom:4px;border-bottom:1px solid #e6e6ee}h3,h4{font-size:15px;margin:18px 0 6px}
blockquote{margin:0;color:#6b6b78;font-size:13px}table{border-collapse:collapse;width:100%;margin:10px 0;font-size:13px}
th,td{border:1px solid #dcdce6;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f4f4f8}
code{background:#f4f4f8;padding:0 4px;border-radius:4px}.demo{border:1px dashed #d9822b;color:#a45a0f;padding:8px 12px;border-radius:8px;margin:12px 0}
@media print{body{margin:0}a{color:inherit}}
</style></head><body>
${r.demo ? '<div class="demo">演示模式 · 示例数据，不代表真实调研结论</div>' : ""}
${markdownToHtml(markdown)}
<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},300)})</script>
</body></html>`;
}
