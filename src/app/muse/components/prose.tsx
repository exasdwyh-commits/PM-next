"use client";
/**
 * Kern reply renderer — renders exactly the Markdown subset defined in
 * src/modules/assistant-runtime/reply-format.ts (KERN_REPLY_FORMAT_PROMPT).
 *
 * Safe by construction: no dangerouslySetInnerHTML; anything outside the
 * subset renders as plain text. Links are limited to http(s)/mailto.
 *
 *   paragraphs · ## / ### headings · nested lists (2 levels) · task lists ·
 *   tables (alignment, numeric columns) · fenced code (language + copy) ·
 *   quotes · callouts > [!NOTE|TIP|WARNING|DECISION|UNKNOWN] · hr ·
 *   inline **bold** *em* ~~del~~ `code` [links](https://…), [n] source markers and (推断)/(待验证) tags
 */
import { createContext, Fragment, useContext, useState, type ReactNode } from "react";
import { isTableDivider, tableCells } from "@/modules/supervisor/report-format";
import { CALLOUT_KINDS, CALLOUT_LABEL, type CalloutKind } from "@/modules/assistant-runtime/reply-format";

// ───────── block model ─────────

export type ListItem = { text: string; task: null | boolean; children: Block[] };
export type Align = "left" | "right" | "center";
export type Block =
  | { t: "p"; lines: string[] }
  | { t: "h"; level: number; text: string }
  | { t: "ul" | "ol"; start: number; items: ListItem[] }
  | { t: "table"; head: string[]; rows: string[][]; align: Align[] }
  | { t: "code"; lang: string; text: string }
  | { t: "quote"; children: Block[] }
  | { t: "callout"; kind: CalloutKind; title: string; children: Block[] }
  | { t: "hr" };

const LIST_RE = /^(\s*)([-*+•]|\d+[.、)])\s+(.*)$/;
const HR_RE = /^\s*(——+|---+|\*\*\*+|___+)\s*$/;
const FENCE_RE = /^\s*(```|~~~)\s*([\w+#.-]*)\s*$/;

function indentOf(s: string): number {
  return (/^\s*/.exec(s)?.[0].length ?? 0);
}

export function parseProse(src: string): Block[] {
  return parseBlocks((src ?? "").replace(/\r\n?/g, "\n").split("\n"));
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { blocks.push({ t: "p", lines: para }); para = []; } };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\s+$/, "");

    // fenced code
    const fence = FENCE_RE.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*(```|~~~)\s*$/.test(lines[i])) body.push(lines[i++]);
      blocks.push({ t: "code", lang: fence[2] ?? "", text: body.join("\n") });
      continue;
    }
    if (!line.trim()) { flush(); continue; }

    // table
    const head = tableCells(line);
    if (head && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      flush();
      const align = tableCells(lines[i + 1])!.map((c): Align => (/^:-+:$/.test(c) ? "center" : /-:$/.test(c) ? "right" : "left"));
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && tableCells(lines[i])) rows.push(tableCells(lines[i++])!);
      i--;
      blocks.push({ t: "table", head, rows, align: head.map((_, j) => align[j] ?? "left") });
      continue;
    }

    if (HR_RE.test(line)) { flush(); blocks.push({ t: "hr" }); continue; }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { flush(); blocks.push({ t: "h", level: Math.min(4, Math.max(2, h[1].length)), text: h[2].replace(/\s*#+\s*$/, "") }); continue; }

    // quote / callout: gather the contiguous ">" run
    if (/^\s*>/.test(line)) {
      flush();
      const inner: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) inner.push(lines[i++].replace(/^\s*>\s?/, ""));
      i--;
      const c = /^\[!([A-Z]+)\]\s*(.*)$/.exec(inner[0] ?? "");
      if (c && (CALLOUT_KINDS as readonly string[]).includes(c[1])) {
        blocks.push({ t: "callout", kind: c[1] as CalloutKind, title: c[2] ?? "", children: parseBlocks(inner.slice(1)) });
      } else {
        blocks.push({ t: "quote", children: parseBlocks(inner) });
      }
      continue;
    }

    // list: gather items + indented continuation lines
    const li = LIST_RE.exec(line);
    if (li && indentOf(line) < 2) {
      flush();
      const ordered = /\d/.test(li[2]);
      const start = ordered ? parseInt(li[2], 10) || 1 : 1;
      const items: ListItem[] = [];
      let cur: { first: string; rest: string[] } | null = null;
      const close = () => {
        if (!cur) return;
        const task = /^\[( |x|X)\]\s+/.exec(cur.first);
        const nested = cur.rest.length ? parseBlocks(dedent(cur.rest)) : [];
        items.push({ text: task ? cur.first.slice(task[0].length) : cur.first, task: task ? task[1] !== " " : null, children: nested });
        cur = null;
      };
      while (i < lines.length) {
        const l = lines[i].replace(/\s+$/, "");
        const m = LIST_RE.exec(l);
        if (m && indentOf(l) < 2 && /\d/.test(m[2]) === ordered) { close(); cur = { first: m[3], rest: [] }; i++; continue; }
        if (cur && l.trim() && indentOf(l) >= 2) { cur.rest.push(l); i++; continue; }
        if (cur && !l.trim() && i + 1 < lines.length && indentOf(lines[i + 1]) >= 2 && lines[i + 1].trim()) { cur.rest.push(""); i++; continue; }
        break;
      }
      close();
      i--;
      blocks.push({ t: ordered ? "ol" : "ul", start, items });
      continue;
    }

    para.push(line.trim());
  }
  flush();
  return blocks;
}

function dedent(lines: string[]): string[] {
  const n = Math.min(...lines.filter((l) => l.trim()).map(indentOf));
  return lines.map((l) => l.slice(Math.min(n, indentOf(l))));
}

// ───────── inline ─────────

/**
 * Source markers `[n]` (see docs/KERN_RESPONSE_SPEC.md). Inside a ResponseView
 * the envelope provides a handler that jumps to evidence item n; elsewhere the
 * marker renders as a quiet superscript so the text stays honest.
 */
export const SourceRefContext = createContext<((n: number) => void) | null>(null);

function SourceRef({ n }: { n: number }) {
  const onRef = useContext(SourceRefContext);
  if (!onRef) return <sup className="kr-ref" data-static>{n}</sup>;
  return (
    <button type="button" className="kr-ref" onClick={() => onRef(n)} title={`查看来源 ${n}`}>
      {n}
    </button>
  );
}

const INLINE_SRC =
  /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*|__[^_\n]+?__)|(~~[^~\n]+?~~)|(\[[^\]\n]+\]\((?:https?:\/\/|mailto:)[^)\s]+\))|((?:https?:\/\/)[^\s<>()（）]+[^\s<>()（）.,;:!?。，；：！？])|((?<![*\w])\*[^*\s][^*\n]*?\*(?![*\w]))|([（(](?:推断|待验证|UNKNOWN|事实|估算)[）)])|(\[\d{1,3}\](?!\())/g;

export function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  // fresh instance per call: inline() recurses (bold/link text) and a shared
  // global regex would have its lastIndex reset by the inner call.
  const re = new RegExp(INLINE_SRC.source, "g");
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${key}-${i++}`;
    if (m[1]) out.push(<code key={k}>{tok.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{inline(tok.slice(2, -2), k)}</strong>);
    else if (m[3]) out.push(<del key={k}>{tok.slice(2, -2)}</del>);
    else if (m[4]) {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!;
      out.push(<a key={k} href={lm[2]} target="_blank" rel="noreferrer noopener">{inline(lm[1], k)}</a>);
    } else if (m[5]) out.push(<a key={k} href={tok} target="_blank" rel="noreferrer noopener">{tok.replace(/^https?:\/\//, "")}</a>);
    else if (m[6]) out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    else if (m[7]) {
      const label = tok.slice(1, -1);
      out.push(<span key={k} className="m-tagline" data-k={label === "事实" ? "fact" : label === "推断" || label === "估算" ? "infer" : "unknown"}>{label}</span>);
    } else if (m[8]) out.push(<SourceRef key={k} n={Number(tok.slice(1, -1))} />);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ───────── render ─────────

const NUMERIC = /^[-+≈~约]?\s*[¥$€£]?\s*[\d.,]+\s*(%|万|亿|k|K|M|x|倍|元|g|kg|ml|天|周|月|年)?$/;

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }).catch(() => undefined);
  };
  return (
    <figure className="m-code">
      <figcaption>
        <span>{lang || "text"}</span>
        <button type="button" onClick={copy} aria-label="复制代码">{copied ? "已复制" : "复制"}</button>
      </figcaption>
      <pre><code>{text}</code></pre>
    </figure>
  );
}

const CALLOUT_ICON: Record<CalloutKind, string> = {
  NOTE: "M12 8h.01M11 12h1v4h1M12 3a9 9 0 110 18 9 9 0 010-18z",
  TIP: "M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0012 3z",
  WARNING: "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z",
  DECISION: "M12 3l8 4v5c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V7l8-4zM9 12l2 2 4-4",
  UNKNOWN: "M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3M12 17h.01M12 3a9 9 0 110 18 9 9 0 010-18z",
};

function renderList(b: Extract<Block, { t: "ul" | "ol" }>, k: string): ReactNode {
  const items = b.items.map((it, j) => (
    <li key={j} data-task={it.task === null ? undefined : it.task ? "done" : "todo"}>
      {it.task !== null ? <span className="m-check" aria-hidden>{it.task ? "✓" : ""}</span> : null}
      <span className="m-li-body">
        {inline(it.text, `${k}-${j}`)}
        {it.children.length ? renderBlocks(it.children, `${k}-${j}c`) : null}
      </span>
    </li>
  ));
  return b.t === "ol"
    ? <ol key={k} start={b.start !== 1 ? b.start : undefined} style={b.start !== 1 ? { counterReset: `m-ol ${b.start - 1}` } : undefined}>{items}</ol>
    : <ul key={k} className={b.items.some((x) => x.task !== null) ? "m-tasks" : undefined}>{items}</ul>;
}

function renderBlocks(blocks: Block[], prefix: string): ReactNode[] {
  return blocks.map((b, i) => {
    const k = `${prefix}${i}`;
    switch (b.t) {
      case "hr": return <hr key={k} />;
      case "h": {
        const H = (b.level <= 2 ? "h3" : b.level === 3 ? "h4" : "h5") as "h3" | "h4" | "h5";
        return <H key={k} className="m-h" data-l={b.level}>{inline(b.text, k)}</H>;
      }
      case "ul":
      case "ol": return renderList(b, k);
      case "code": return <CodeBlock key={k} lang={b.lang} text={b.text} />;
      case "quote": return <blockquote key={k}>{renderBlocks(b.children, `${k}q`)}</blockquote>;
      case "callout":
        return (
          <aside key={k} className="m-callout" data-k={b.kind.toLowerCase()} role="note">
            <header>
              <svg viewBox="0 0 24 24" aria-hidden><path d={CALLOUT_ICON[b.kind]} /></svg>
              <b>{CALLOUT_LABEL[b.kind]}</b>
              {b.title ? <span>{inline(b.title, `${k}t`)}</span> : null}
            </header>
            {b.children.length ? <div className="m-callout-body">{renderBlocks(b.children, `${k}c`)}</div> : null}
          </aside>
        );
      case "table": {
        const numeric = b.head.map((_, j) => b.align[j] === "right" || (b.rows.length > 0 && b.rows.every((r) => !r[j] || NUMERIC.test(r[j].replace(/\*\*/g, "")))));
        return (
          <div key={k} className="m-table-wrap" role="region" aria-label="表格" tabIndex={0}>
            <table className="m-table">
              <thead><tr>{b.head.map((c, j) => <th key={j} data-num={numeric[j] || undefined} style={b.align[j] === "center" ? { textAlign: "center" } : undefined}>{inline(c, `${k}-h${j}`)}</th>)}</tr></thead>
              <tbody>
                {b.rows.map((r, ri) => (
                  <tr key={ri}>{b.head.map((_, j) => <td key={j} data-num={numeric[j] || undefined} style={b.align[j] === "center" ? { textAlign: "center" } : undefined}>{inline(r[j] ?? "", `${k}-${ri}-${j}`)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      default:
        return <p key={k}>{b.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l, `${k}-${j}`)}</Fragment>)}</p>;
    }
  });
}

export function Prose({ text, variant }: { text: string; variant?: "compact" }) {
  return <div className="m-prose" data-v={variant}>{renderBlocks(parseProse(text), "b")}</div>;
}
