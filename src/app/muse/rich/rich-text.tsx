"use client";
/**
 * Assistant reply renderer: Markdown prose + kern-ui blocks + artifact cards.
 * Plain replies render exactly like before (Prose); long replies get a calm fold with
 * an explicit "expand" and a reading-mode entry so the chat column never becomes a wall.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Prose, SourceRefContext } from "../components/prose";
import { splitRichText, type RichSegment } from "@/modules/artifacts/rich-blocks";
import type { ArtifactCitation } from "@/modules/artifacts/protocol";
import { RichBlockView } from "./rich-blocks";
import { ArtifactCard } from "./artifact-card";
import { RichScopeContext, useKernHost } from "./reader-context";

const LONG_CHARS = 1800;
const COUNT = new Intl.NumberFormat("zh-CN");
export const formatCount = (n: number) => COUNT.format(n);

export function readingStats(text: string) {
  const plain = text.replace(/```[\s\S]*?```/g, " ").replace(/\[\[kern-artifact:[^\]]+\]\]/g, " ");
  const chars = plain.replace(/\s+/g, "").length;
  const sections = (text.match(/^#{2,3}\s+\S/gm) ?? []).length;
  return { chars, sections };
}

function jumpToSource(scope: string) {
  return (n: number) => {
    const el = document.getElementById(`kxr-src-${scope}-${n}`);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
}

export function RichSegments({ segments, artifacts, scope }: { segments: RichSegment[]; artifacts: ArtifactCitation[]; scope: string }) {
  const hasSources = segments.some((s) => s.t === "block" && s.block.type === "sources");
  const body: ReactNode = segments.map((s, i) => {
    if (s.t === "md") return <Prose key={i} text={s.text} />;
    if (s.t === "block") return <RichBlockView key={i} block={s.block} />;
    if (s.t === "invalid") return <p key={i} className="kxr-invalid" role="note">有一段结构化内容格式不完整，已省略（{s.error}）。</p>;
    const citation = artifacts.find((a) => a.ref === s.id && a.version === s.version) ?? artifacts.find((a) => a.ref === s.id) ?? null;
    return <ArtifactCard key={i} id={s.id} version={s.version} citation={citation} />;
  });
  return (
    <RichScopeContext.Provider value={scope}>
      {hasSources ? <SourceRefContext.Provider value={jumpToSource(scope)}>{body}</SourceRefContext.Provider> : body}
    </RichScopeContext.Provider>
  );
}

/** Keep the first segments up to ~budget characters for the folded view; artifacts always stay visible. */
function head(segments: RichSegment[], budget: number): RichSegment[] {
  const out: RichSegment[] = [];
  let used = 0;
  let cut = segments.length;
  for (const [idx, s] of segments.entries()) {
    if (used >= budget) { cut = idx; break; }
    if (s.t === "md") {
      if (used + s.text.length <= budget) { out.push(s); used += s.text.length; continue; }
      const paras = s.text.split(/\n{2,}/);
      const keep: string[] = [];
      for (const p of paras) { if (used + p.length > budget && keep.length) break; keep.push(p); used += p.length; }
      out.push({ t: "md", text: keep.join("\n\n") });
      cut = idx + 1;
      break;
    }
    out.push(s);
    used += 400;
  }
  return [...out, ...segments.slice(cut).filter((s) => s.t === "artifact")];
}

export function RichText({ text, artifacts, messageId, collapsible = true }: {
  text: string;
  artifacts: ArtifactCitation[];
  messageId: string;
  collapsible?: boolean;
}) {
  const host = useKernHost();
  const segments = useMemo(() => splitRichText(text), [text]);
  const stats = useMemo(() => readingStats(text), [text]);
  const long = collapsible && stats.chars > LONG_CHARS;
  const [open, setOpen] = useState(false);
  const rich = segments.some((s) => s.t !== "md");
  const scope = messageId.replace(/[^A-Za-z0-9_-]/g, "").slice(-12) || "m";

  if (!rich && !long) return <Prose text={text} />;
  const shown = long && !open ? head(segments, 900) : segments;
  return (
    <div className="kxr-rich" data-folded={long && !open ? "true" : undefined}>
      <RichSegments segments={shown} artifacts={artifacts} scope={scope} />
      {long ? (
        <div className="kxr-fold">
          {!open ? (
            <button type="button" className="kxr-fold-btn" onClick={() => setOpen(true)} aria-expanded={false}>
              展开全文<span>约 {formatCount(stats.chars)} 字{stats.sections ? ` · ${stats.sections} 个章节` : ""}</span>
            </button>
          ) : (
            <button type="button" className="kxr-fold-btn" data-v="quiet" onClick={() => setOpen(false)} aria-expanded>收起</button>
          )}
          {host ? (
            <button type="button" className="kxr-fold-btn" data-v="read" onClick={(e) => host.openReader({ kind: "message", messageId }, e.currentTarget)}>
              阅读模式
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
