/**
 * kern-ui rich blocks — validation, splitting and Markdown fallback.
 * Pure module (server + client). See protocol.ts for the model-facing spec.
 *
 * Validation is a harness, not a guess: anything malformed is dropped with an
 * honest note instead of being "repaired" into numbers the model never gave.
 */
import { PERSISTED_MARKER_RE } from "./protocol";

export type Basis = "fact" | "inference" | "assumption" | "unknown";
export const BASIS_LABEL: Record<Basis, string> = { fact: "事实", inference: "推断", assumption: "假设", unknown: "未知" };
export type SourceTrust = "user" | "internal" | "external" | "model";
export const SOURCE_TRUST_LABEL: Record<SourceTrust, string> = { user: "用户提供", internal: "内部记录", external: "外部未核实", model: "模型知识·未核实" };

export type MetricsBlock = { type: "metrics"; title?: string; items: { label: string; value: string; note?: string; basis: Basis; source?: number }[] };
export type CompareBlock = { type: "compare"; title?: string; options: { name: string; tagline?: string; pick?: boolean; pros: string[]; cons: string[] }[]; criteria: { label: string; values: string[] }[] };
export type RichChartBlock = { type: "chart"; chart: "bar" | "waterfall" | "donut"; title?: string; unit: string; series: { label: string; value: number; display?: string; hi?: boolean }[]; basis: Basis; source: string };
export type RichTimelineBlock = { type: "timeline"; title?: string; items: { when: string; phase: string; deliverable: string; status?: "done" | "active" | "todo" | "blocked"; depends?: string[] }[] };
export type FlowBlock = { type: "flow"; title?: string; nodes: { id: string; label: string; detail?: string }[]; edges: [string, string][] };
export type RisksBlock = { type: "risks"; title?: string; items: { risk: string; impact: "high" | "medium" | "low"; mitigation?: string; basis: Basis }[] };
export type SourcesBlock = { type: "sources"; title?: string; items: { n: number; title: string; url?: string; trust: SourceTrust; note?: string }[] };
export type NextBlock = { type: "next"; title?: string; items: { label: string; prompt: string }[] };
export type RichTableBlock = { type: "table"; title?: string; caption?: string; cols: { label: string; num?: boolean }[]; rows: { cells: string[]; pick?: boolean }[] };
export type RichCalloutBlock = { type: "callout"; tone: "info" | "ok" | "warn" | "blocked"; title: string; body: string };
export type RichUnknownBlock = { type: "unknown"; title?: string; items: { question: string; needs: string }[] };
export type RichDecisionBlock = { type: "decision"; title?: string; headline: string; confidence: "HIGH" | "MEDIUM" | "LOW"; recommend: string[]; against: string[]; risks: string[] };
export type RichKeypointsBlock = { type: "keypoints"; title?: string; items: { kind: "fact" | "inference" | "unknown"; text: string }[] };

export type RichBlock =
  | MetricsBlock | CompareBlock | RichChartBlock | RichTimelineBlock | FlowBlock | RisksBlock
  | SourcesBlock | NextBlock | RichTableBlock | RichCalloutBlock | RichUnknownBlock | RichDecisionBlock | RichKeypointsBlock;

export const RICH_FENCE = "kern-ui";

// ───────── primitive coercers ─────────
const str = (v: unknown, max = 400): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : typeof v === "number" && Number.isFinite(v) ? String(v) : null);
const optStr = (v: unknown, max = 400): string | undefined => str(v, max) ?? undefined;
const strList = (v: unknown, maxItems = 8, max = 300): string[] => (Array.isArray(v) ? v.map((x) => str(x, max)).filter((x): x is string => !!x).slice(0, maxItems) : []);
const arr = (v: unknown, maxItems: number): unknown[] => (Array.isArray(v) ? v.slice(0, maxItems) : []);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const basis = (v: unknown, fallback: Basis = "unknown"): Basis => (["fact", "inference", "assumption", "unknown"].includes(v as string) ? (v as Basis) : fallback);
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return null;
};

export type RichParse = { ok: true; block: RichBlock } | { ok: false; error: string };

/** Validate one kern-ui JSON payload. */
export function parseRichBlock(source: string): RichParse {
  let raw: unknown;
  try { raw = JSON.parse(source); } catch { return { ok: false, error: "JSON 无法解析" }; }
  const b = rec(raw);
  const title = optStr(b.title, 60);
  switch (b.type) {
    case "metrics": {
      const items = arr(b.items, 8).map(rec).flatMap((it) => {
        const label = str(it.label, 40); const value = str(it.value, 32);
        if (!label || !value) return [];
        const source = num(it.source);
        return [{ label, value, note: optStr(it.note, 120), basis: basis(it.basis), ...(source !== null ? { source: Math.trunc(source) } : {}) }];
      });
      return items.length ? { ok: true, block: { type: "metrics", title, items } } : { ok: false, error: "metrics 没有有效指标" };
    }
    case "compare": {
      const options = arr(b.options, 4).map(rec).flatMap((o) => {
        const name = str(o.name, 40);
        return name ? [{ name, tagline: optStr(o.tagline, 120), pick: o.pick === true, pros: strList(o.pros, 6), cons: strList(o.cons, 6) }] : [];
      });
      if (options.length < 2) return { ok: false, error: "compare 至少需要两个方案" };
      const criteria = arr(b.criteria, 10).map(rec).flatMap((c) => {
        const label = str(c.label, 40);
        const values = strList(c.values, options.length, 80);
        return label && values.length ? [{ label, values: options.map((_, i) => values[i] ?? "—") }] : [];
      });
      return { ok: true, block: { type: "compare", title, options, criteria } };
    }
    case "chart": {
      const chart = (["bar", "waterfall", "donut"] as const).find((c) => c === b.chart) ?? "bar";
      const series = arr(b.series, 12).map(rec).flatMap((s) => {
        const label = str(s.label, 30); const value = num(s.value);
        return label && value !== null ? [{ label, value, display: optStr(s.display, 24), hi: s.hi === true }] : [];
      });
      const source = str(b.source, 200);
      if (!source) return { ok: false, error: "chart 缺少数值来源（source）" };
      if (series.length < 2) return { ok: false, error: "chart 至少需要两个数据点" };
      if (chart === "donut" && series.some((s) => s.value < 0)) return { ok: false, error: "占比图不能包含负数" };
      return { ok: true, block: { type: "chart", chart, title, unit: str(b.unit, 16) ?? "", series, basis: basis(b.basis, "inference"), source } };
    }
    case "timeline": {
      const items = arr(b.items, 12).map(rec).flatMap((it) => {
        const phase = str(it.phase, 60);
        if (!phase) return [];
        const status = (["done", "active", "todo", "blocked"] as const).find((s) => s === it.status);
        return [{ when: str(it.when, 30) ?? "", phase, deliverable: str(it.deliverable, 200) ?? "", ...(status ? { status } : {}), depends: strList(it.depends, 4, 60) }];
      });
      return items.length ? { ok: true, block: { type: "timeline", title, items } } : { ok: false, error: "timeline 没有阶段" };
    }
    case "flow": {
      const nodes = arr(b.nodes, 12).map(rec).flatMap((n) => {
        const id = str(n.id, 32); const label = str(n.label, 50);
        return id && label ? [{ id, label, detail: optStr(n.detail, 160) }] : [];
      });
      const ids = new Set(nodes.map((n) => n.id));
      const edges = arr(b.edges, 24).flatMap((e) => (Array.isArray(e) && ids.has(String(e[0])) && ids.has(String(e[1])) && e[0] !== e[1] ? [[String(e[0]), String(e[1])] as [string, string]] : []));
      return nodes.length >= 2 ? { ok: true, block: { type: "flow", title, nodes, edges } } : { ok: false, error: "flow 至少需要两个节点" };
    }
    case "risks": {
      const items = arr(b.items, 8).map(rec).flatMap((it) => {
        const risk = str(it.risk, 200);
        const impact = (["high", "medium", "low"] as const).find((x) => x === it.impact) ?? "medium";
        return risk ? [{ risk, impact, mitigation: optStr(it.mitigation, 200), basis: basis(it.basis, "inference") }] : [];
      });
      return items.length ? { ok: true, block: { type: "risks", title, items } } : { ok: false, error: "risks 没有条目" };
    }
    case "sources": {
      const items = arr(b.items, 12).map(rec).flatMap((it, i) => {
        const t = str(it.title, 160);
        if (!t) return [];
        const url = str(it.url, 500);
        const trust = (["user", "internal", "external", "model"] as const).find((x) => x === it.trust) ?? "external";
        return [{ n: Math.trunc(num(it.n) ?? i + 1), title: t, ...(url && /^https?:\/\//.test(url) ? { url } : {}), trust, note: optStr(it.note, 160) }];
      });
      return items.length ? { ok: true, block: { type: "sources", title, items } } : { ok: false, error: "sources 没有条目" };
    }
    case "next": {
      const items = arr(b.items, 3).map(rec).flatMap((it) => {
        const label = str(it.label, 24); const prompt = str(it.prompt, 300);
        return label && prompt ? [{ label, prompt }] : [];
      });
      return items.length ? { ok: true, block: { type: "next", title, items } } : { ok: false, error: "next 没有条目" };
    }
    case "table": {
      const cols = arr(b.cols, 6).map((c) => (typeof c === "string" ? { label: c } : rec(c))).flatMap((c) => {
        const label = str((c as Record<string, unknown>).label, 30);
        return label ? [{ label, num: (c as Record<string, unknown>).num === true }] : [];
      });
      if (!cols.length) return { ok: false, error: "table 缺少表头" };
      const rows = arr(b.rows, 30).flatMap((r) => {
        const row = Array.isArray(r) ? { cells: r } : rec(r);
        const cells = Array.isArray(row.cells) ? row.cells.map((c) => str(c, 160) ?? "") : [];
        return cells.length ? [{ cells: cols.map((_, i) => cells[i] ?? ""), pick: row.pick === true }] : [];
      });
      return rows.length ? { ok: true, block: { type: "table", title, caption: optStr(b.caption, 120), cols, rows } } : { ok: false, error: "table 没有数据行" };
    }
    case "callout": {
      const t = str(b.title, 60); const body = str(b.body, 600);
      const tone = (["info", "ok", "warn", "blocked"] as const).find((x) => x === b.tone) ?? "info";
      return t && body ? { ok: true, block: { type: "callout", tone, title: t, body } } : { ok: false, error: "callout 缺少标题或内容" };
    }
    case "unknown": {
      const items = arr(b.items, 8).map(rec).flatMap((it) => {
        const q = str(it.question, 200);
        return q ? [{ question: q, needs: str(it.needs, 200) ?? "待补充" }] : [];
      });
      return items.length ? { ok: true, block: { type: "unknown", title, items } } : { ok: false, error: "unknown 没有条目" };
    }
    case "decision": {
      const headline = str(b.headline, 120);
      const confidence = (["HIGH", "MEDIUM", "LOW"] as const).find((x) => x === b.confidence) ?? "LOW";
      return headline ? { ok: true, block: { type: "decision", title, headline, confidence, recommend: strList(b.recommend), against: strList(b.against), risks: strList(b.risks) } } : { ok: false, error: "decision 缺少结论" };
    }
    case "keypoints": {
      const items = arr(b.items, 10).map(rec).flatMap((it) => {
        const text = str(it.text, 240);
        const kind = (["fact", "inference", "unknown"] as const).find((x) => x === it.kind) ?? "inference";
        return text ? [{ kind, text }] : [];
      });
      return items.length ? { ok: true, block: { type: "keypoints", title, items } } : { ok: false, error: "keypoints 没有条目" };
    }
    default:
      return { ok: false, error: `不支持的结构类型：${String(b.type ?? "缺失").slice(0, 20)}` };
  }
}

// ───────── splitting a reply into renderable segments ─────────

export type RichSegment =
  | { t: "md"; text: string }
  | { t: "block"; block: RichBlock }
  | { t: "invalid"; error: string }
  | { t: "artifact"; id: string; version: number };

const FENCE_OPEN = /^\s*```\s*kern-ui\s*$/;
const FENCE_ANY = /^\s*(```|~~~)/;

export function splitRichText(text: string): RichSegment[] {
  const lines = (text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out: RichSegment[] = [];
  let md: string[] = [];
  let inOtherFence = false;
  const flush = () => { const t = md.join("\n").trim(); if (t) out.push({ t: "md", text: t }); md = []; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inOtherFence && FENCE_OPEN.test(line)) {
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !/^\s*```\s*$/.test(lines[j])) body.push(lines[j++]);
      flush();
      const parsed = parseRichBlock(body.join("\n"));
      out.push(parsed.ok ? { t: "block", block: parsed.block } : { t: "invalid", error: parsed.error });
      i = j;
      continue;
    }
    if (FENCE_ANY.test(line)) inOtherFence = !inOtherFence;
    const marker = !inOtherFence ? PERSISTED_MARKER_RE.exec(line) : null;
    if (marker) { flush(); out.push({ t: "artifact", id: marker[1], version: Number(marker[2]) }); continue; }
    md.push(line);
  }
  flush();
  return out;
}

export function hasRichContent(text: string): boolean {
  return /```\s*kern-ui|\[\[kern-artifact:/.test(text ?? "");
}

/**
 * Server harness: re-serialise valid kern-ui blocks (normalised JSON), replace invalid
 * ones with an honest note. Returns the issues for telemetry.
 */
export function sanitizeRichFences(text: string): { text: string; issues: string[] } {
  const issues: string[] = [];
  const lines = (text ?? "").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_OPEN.test(lines[i])) {
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !/^\s*```\s*$/.test(lines[j])) body.push(lines[j++]);
      const parsed = parseRichBlock(body.join("\n"));
      if (parsed.ok) out.push("```kern-ui", JSON.stringify(parsed.block), "```");
      else { issues.push(parsed.error); out.push("> [!NOTE]", `> 有一段结构化内容格式不完整，已省略（${parsed.error}）。`); }
      i = j;
      continue;
    }
    out.push(lines[i]);
  }
  return { text: out.join("\n"), issues };
}

// ───────── Markdown fallback (copy, export, model history) ─────────

const row = (cells: string[]) => `| ${cells.map((c) => c.replace(/\|/g, "/")).join(" | ")} |`;

export function richBlockToMarkdown(b: RichBlock): string {
  const h = "title" in b && b.title ? `### ${b.title}\n\n` : "";
  switch (b.type) {
    case "metrics": return h + b.items.map((i) => `- **${i.label}**：${i.value}（${BASIS_LABEL[i.basis]}）${i.note ? ` ${i.note}` : ""}${i.source ? ` [${i.source}]` : ""}`).join("\n");
    case "compare": return h + [row(["", ...b.options.map((o) => o.name + (o.pick ? "（推荐）" : ""))]), row(["---", ...b.options.map(() => "---")]),
      ...b.criteria.map((c) => row([c.label, ...c.values])),
      row(["优点", ...b.options.map((o) => o.pros.join("；") || "—")]), row(["顾虑", ...b.options.map((o) => o.cons.join("；") || "—")])].join("\n");
    case "chart": return h + [row(["项目", `数值${b.unit ? `（${b.unit}）` : ""}`]), row(["---", "---:"]), ...b.series.map((s) => row([s.label, s.display ?? String(s.value)]))].join("\n") + `\n\n来源：${b.source}（${BASIS_LABEL[b.basis]}）`;
    case "timeline": return h + b.items.map((i, n) => `${n + 1}. **${i.phase}**${i.when ? `（${i.when}）` : ""}：${i.deliverable}${i.depends?.length ? ` · 依赖 ${i.depends.join("、")}` : ""}`).join("\n");
    case "flow": return h + b.edges.map(([a, c]) => `- ${b.nodes.find((n) => n.id === a)?.label} → ${b.nodes.find((n) => n.id === c)?.label}`).join("\n");
    case "risks": return h + b.items.map((i) => `- **${i.risk}**（影响${{ high: "高", medium: "中", low: "低" }[i.impact]}，${BASIS_LABEL[i.basis]}）${i.mitigation ? `：${i.mitigation}` : ""}`).join("\n");
    case "sources": return h + b.items.map((i) => `${i.n}. ${i.title}（${SOURCE_TRUST_LABEL[i.trust]}）${i.url ? ` ${i.url}` : ""}`).join("\n");
    case "next": return h + b.items.map((i) => `- ${i.label}`).join("\n");
    case "table": return h + [row(b.cols.map((c) => c.label)), row(b.cols.map((c) => (c.num ? "---:" : "---"))), ...b.rows.map((r) => row(r.cells))].join("\n");
    case "callout": return `> **${b.title}** ${b.body}`;
    case "unknown": return h + b.items.map((i) => `- ${i.question} — 需要：${i.needs}`).join("\n");
    case "decision": return h + `**${b.headline}**\n\n` + [...b.recommend.map((x) => `- 推荐：${x}`), ...b.against.map((x) => `- 反对：${x}`), ...b.risks.map((x) => `- 风险：${x}`)].join("\n");
    case "keypoints": return h + b.items.map((i) => `- ${i.text}（${{ fact: "事实", inference: "推断", unknown: "未知" }[i.kind]}）`).join("\n");
  }
}

/** Whole reply → plain Markdown (kern-ui blocks rendered as tables/lists). */
export function richTextToMarkdown(text: string, describeArtifact?: (id: string, version: number) => string): string {
  return splitRichText(text).map((s) => s.t === "md" ? s.text : s.t === "block" ? richBlockToMarkdown(s.block) : s.t === "artifact" ? (describeArtifact?.(s.id, s.version) ?? "〔可视化成果〕") : "").filter(Boolean).join("\n\n");
}
