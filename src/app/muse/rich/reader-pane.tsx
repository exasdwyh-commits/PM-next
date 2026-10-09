"use client";
/**
 * Reading pane — one surface for artifacts, long replies and mission reports.
 * Desktop: a resizable column beside the conversation (width persisted per browser).
 * < 1100px: full-screen layer; closing returns to the exact scroll position because the
 * conversation underneath is never unmounted. Focus moves into the pane on open and
 * back to the opener on close.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ARTIFACT_KIND_LABEL, describeMarkers, type ArtifactCitation, type ArtifactKind } from "@/modules/artifacts/protocol";
import { richTextToMarkdown, splitRichText } from "@/modules/artifacts/rich-blocks";
import { I } from "../components/kit";
import { fmtDate, fmtTime } from "@/shared/datetime";
import { MissionConclusion } from "../components/mission-conclusion";
import { ArtifactFrame, useArtifactVersion } from "./artifact-frame";
import { RichSegments, formatCount, readingStats } from "./rich-text";
import { useKernHost, type ReaderItem } from "./reader-context";

const WIDTH_KEY = "kern.muse.reader.w";
const MIN_W = 380;
const DEFAULT_W = 560;

type Summary = {
  id: string; key: string; kind: ArtifactKind; title: string; currentVersion: number; updatedAt: string;
  versions: { version: number; title: string; status: "READY" | "FAILED"; error: string | null; messageId: string | null; bytes: number; createdAt: string }[];
};

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy"); ta.remove(); return ok;
  } catch { return false; }
}

function useToast() {
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const timer = useRef(0);
  const show = useCallback((text: string, error?: boolean) => {
    setToast({ text, error });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);
  return { toast, show };
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 2.5v8M4.75 7.5 8 10.75 11.25 7.5M3 13.5h10" />
    </svg>
  );
}

function fmtWhen(iso: string) {
  // Business timezone (same as the conversation timestamps), never the browser's local zone.
  const [, m, d] = fmtDate(iso, "").split("-");
  return m ? `${Number(m)}月${Number(d)}日 ${fmtTime(iso, "").slice(0, 5)}` : "";
}

// ───────── artifact reader ─────────
function ArtifactReader({ item, theme, onToast, titleRef }: {
  item: Extract<ReaderItem, { kind: "artifact" }>;
  theme: "light" | "dark";
  onToast: (text: string, error?: boolean) => void;
  titleRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const host = useKernHost();
  const latestKnown = host?.artifact(item.id)?.version ?? 0;
  const latestKnownRef = useRef(latestKnown);
  latestKnownRef.current = latestKnown;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(item.version ?? null);
  const [view, setView] = useState<"preview" | "source">("preview");
  // Opening the newest version (or no specific version) means "follow this artifact": a follow-up
  // edit moves the reader to the new version. Opening an older card, or picking a version, pins it.
  const followLatest = useRef(item.version === undefined || item.version >= latestKnown);

  useEffect(() => {
    setPicked(item.version ?? null);
    followLatest.current = item.version === undefined || item.version >= latestKnownRef.current;
  }, [item.id, item.version]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/artifacts/${encodeURIComponent(item.id)}`, { cache: "no-store" })
      .then(async (r) => { if (!r.ok) throw new Error(r.status === 404 ? "成果不存在或无权查看" : "成果读取失败"); return r.json() as Promise<Summary>; })
      .then((s) => { if (!alive) return; setSummary(s); setSummaryError(null); })
      .catch((e: unknown) => alive && setSummaryError(e instanceof Error ? e.message : "成果读取失败"));
    return () => { alive = false; };
  }, [item.id, latestKnown]);

  // A follow-up that produced a new version moves the reader forward (unless the user pinned an older one).
  useEffect(() => {
    if (summary && followLatest.current && summary.currentVersion > 0) setPicked(summary.currentVersion);
  }, [summary]);

  const pickedMeta = summary?.versions.find((v) => v.version === picked) ?? null;
  const readyVersion = pickedMeta?.status === "FAILED" ? null : picked;
  const { data, error, loading, retry } = useArtifactVersion(item.id, readyVersion, readyVersion !== null);
  const title = data?.title ?? pickedMeta?.title ?? summary?.title ?? item.title ?? "可视化成果";
  useEffect(() => { titleRef.current?.focus({ preventScroll: true }); }, [item.id, titleRef]);

  const ask = useCallback((text: string) => {
    host?.prefill(`关于「${title}」：${text}`);
    onToast("已把问题放进输入框，确认后发送");
  }, [host, title, onToast]);

  return (
    <>
      <div className="kxr-reader-sub">
        <span className="kxr-artifact-kind">{ARTIFACT_KIND_LABEL[summary?.kind ?? "other"]}</span>
        {summary ? (
          <label className="kxr-select">
            <span className="m-sr">版本</span>
            <select value={picked ?? ""} onChange={(e) => { const v = Number(e.target.value); followLatest.current = v === summary.currentVersion; setPicked(v); }}>
              {[...summary.versions].reverse().map((v) => (
                <option key={v.version} value={v.version}>
                  v{v.version}{v.version === summary.currentVersion ? " · 当前" : ""}{v.status === "FAILED" ? " · 失败" : ""} · {fmtWhen(v.createdAt)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="m-seg kxr-reader-tabs" role="tablist" aria-label="查看方式">
          <button type="button" role="tab" aria-selected={view === "preview"} onClick={() => setView("preview")}>预览</button>
          <button type="button" role="tab" aria-selected={view === "source"} onClick={() => setView("source")}>源码</button>
        </div>
        <span className="kxr-grow" />
        <button type="button" className="kxr-btn" data-v="ghost" aria-label="复制 HTML" disabled={!data} onClick={async () => onToast((await copyText(data?.html ?? "")) ? "HTML 已复制" : "复制失败：浏览器没有给剪贴板权限", !data)}>
          <I.copy /><span className="kxr-btn-label">复制 HTML</span>
        </button>
        {readyVersion ? (
          <a className="kxr-btn" data-v="ghost" href={`/api/artifacts/${encodeURIComponent(item.id)}/versions/${readyVersion}/download`} download aria-label="下载离线版 HTML"><DownloadIcon /><span className="kxr-btn-label">下载离线版</span></a>
        ) : null}
      </div>
      <div className="kxr-reader-stage" data-view={view}>
        {summaryError ? <p className="kxr-reader-empty" role="alert">{summaryError}</p>
          : pickedMeta?.status === "FAILED" ? (
            <div className="kxr-reader-empty" role="alert">
              <b>v{pickedMeta.version} 生成失败</b>
              <p>{pickedMeta.error ?? "成果没有完整生成"}</p>
              {summary && summary.currentVersion > 0 ? <button type="button" className="kxr-btn" onClick={() => setPicked(summary.currentVersion)}>查看可用的 v{summary.currentVersion}</button> : null}
            </div>
          ) : error ? (
            <div className="kxr-reader-empty" role="alert"><p>{error}</p><button type="button" className="kxr-btn" onClick={retry}>重新读取</button></div>
          ) : !data || loading ? <p className="kxr-reader-empty" aria-busy>正在载入…</p>
          : view === "preview" ? <ArtifactFrame key={`${data.artifactId}@${data.version}`} data={data} title={title} theme={theme} onAsk={ask} className="kxr-reader-frame" />
          : <pre className="kxr-source"><code>{data.html}</code></pre>}
      </div>
      <footer className="kxr-reader-foot">
        <I.shield />
        <span>成果在隔离沙箱里运行：不能联网，不能读取你的账号、Cookie 或业务数据。里面的「提问」只会把文字放进输入框，由你决定是否发送。</span>
      </footer>
    </>
  );
}

// ───────── message reader ─────────
function MessageReader({ text, artifacts, messageId, onToast }: { text: string; artifacts: ArtifactCitation[]; messageId: string; onToast: (t: string, e?: boolean) => void }) {
  const segments = useMemo(() => splitRichText(text), [text]);
  const stats = useMemo(() => readingStats(text), [text]);
  const body = useRef<HTMLDivElement>(null);
  const [toc, setToc] = useState<{ id: string; label: string; level: number }[]>([]);
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const heads = Array.from(el.querySelectorAll<HTMLElement>("h2, h3, .kxr-head h3"));
    heads.forEach((h, i) => { if (!h.id) h.id = `kxr-read-${i}`; });
    setToc(heads.map((h) => ({ id: h.id, label: h.textContent?.trim() ?? "", level: h.tagName === "H2" ? 2 : 3 })).filter((t) => t.label));
    const scroller = el.closest(".kxr-reader-body");
    if (!scroller || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) setActive(top.target.id);
    }, { root: scroller, rootMargin: "0px 0px -70% 0px" });
    heads.forEach((h) => io.observe(h));
    return () => io.disconnect();
  }, [segments]);
  const markdown = () => richTextToMarkdown(text, (id, v) => describeMarkers(`[[kern-artifact:${id}@${v}]]`, artifacts));
  return (
    <>
      <div className="kxr-reader-sub">
        <span className="kxr-sub">约 {formatCount(stats.chars)} 字{stats.sections ? ` · ${stats.sections} 个章节` : ""}</span>
        <span className="kxr-grow" />
        <button type="button" className="kxr-btn" data-v="ghost" onClick={async () => onToast((await copyText(markdown())) ? "已复制为 Markdown" : "复制失败：浏览器没有给剪贴板权限")}>
          <I.copy />复制 Markdown
        </button>
      </div>
      <div className="kxr-reader-doc">
        {toc.length > 2 ? (
          <nav className="kxr-toc" aria-label="章节">
            {toc.map((t) => (
              <a key={t.id} href={`#${t.id}`} data-level={t.level} aria-current={active === t.id ? "location" : undefined}
                onClick={(e) => { e.preventDefault(); document.getElementById(t.id)?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); setActive(t.id); }}>
                {t.label}
              </a>
            ))}
          </nav>
        ) : null}
        <div className="kxr-reader-article" ref={body}>
          <RichSegments segments={segments} artifacts={artifacts} scope={`r${messageId.replace(/[^A-Za-z0-9]/g, "").slice(-10)}`} />
        </div>
      </div>
    </>
  );
}

// ───────── pane shell ─────────
export function ReaderPane({ item, theme, lookupMessage, onClose }: {
  item: ReaderItem;
  theme: "light" | "dark";
  lookupMessage: (id: string) => { text: string; artifacts: ArtifactCitation[] } | null;
  onClose: () => void;
}) {
  const pane = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const { toast, show } = useToast();
  const [width, setWidth] = useState(DEFAULT_W);

  useEffect(() => {
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(stored) && stored >= MIN_W) setWidth(stored);
  }, []);
  const clamp = useCallback((w: number) => {
    const muse = pane.current?.closest(".muse") as HTMLElement | null;
    const rail = muse?.querySelector<HTMLElement>(".m-rail");
    const railW = rail && getComputedStyle(rail).position !== "fixed" ? rail.offsetWidth : 0;
    const max = Math.max(MIN_W, (muse?.clientWidth ?? window.innerWidth) - railW - 480);
    return Math.round(Math.min(Math.max(w, MIN_W), max));
  }, []);
  useEffect(() => {
    const muse = pane.current?.closest(".muse") as HTMLElement | null;
    if (!muse) return;
    muse.style.setProperty("--m-reader-w", `${clamp(width)}px`);
    return () => { muse.style.removeProperty("--m-reader-w"); };
  }, [width, clamp]);
  const commit = useCallback((w: number) => { const v = clamp(w); setWidth(v); try { localStorage.setItem(WIDTH_KEY, String(v)); } catch { /* ignore */ } }, [clamp]);

  const onDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX, startW = width;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const muse = pane.current?.closest(".muse") as HTMLElement | null;
    muse?.setAttribute("data-resizing", "true");
    const move = (ev: PointerEvent) => setWidth(clamp(startW + (startX - ev.clientX)));
    const up = (ev: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      muse?.removeAttribute("data-resizing");
      commit(startW + (startX - ev.clientX));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  };
  const onHandleKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); commit(width + 32); }
    if (e.key === "ArrowRight") { e.preventDefault(); commit(width - 32); }
    if (e.key === "Home") { e.preventDefault(); commit(DEFAULT_W); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector(".m-sheet, [role='dialog'][aria-modal='true']:not(.kxr-reader)")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const msg = item.kind === "message" ? lookupMessage(item.messageId) : null;
  const heading = item.kind === "artifact" ? (item.title ?? "可视化成果") : item.kind === "message" ? (item.title ?? "阅读模式") : (item.title ?? "任务成果");
  useEffect(() => { if (item.kind !== "artifact") titleRef.current?.focus({ preventScroll: true }); }, [item]);

  return (
    <aside ref={pane} className="kxr-reader" data-kind={item.kind} aria-label={heading} role="complementary">
      <div className="kxr-reader-handle" role="separator" aria-orientation="vertical" aria-label="调整阅读区宽度（←/→，Home 复位）"
        aria-valuemin={MIN_W} aria-valuenow={width} tabIndex={0} onPointerDown={onDragStart} onKeyDown={onHandleKey} onDoubleClick={() => commit(DEFAULT_W)} />
      <header className="kxr-reader-top">
        <button type="button" className="kxr-reader-back" onClick={onClose}><span aria-hidden>←</span>返回对话</button>
        <h2 ref={titleRef} tabIndex={-1}>{heading}</h2>
        <button type="button" className="kxr-btn kxr-reader-close" data-v="ghost" onClick={onClose} aria-label="关闭阅读区（Esc）"><I.close /></button>
      </header>
      <div className="kxr-reader-body">
        {item.kind === "artifact" ? <ArtifactReader item={item} theme={theme} onToast={show} titleRef={titleRef} />
          : item.kind === "message" ? (msg ? <MessageReader text={msg.text} artifacts={msg.artifacts} messageId={item.messageId} onToast={show} /> : <p className="kxr-reader-empty">这条消息已不在当前对话中。</p>)
          : <div className="kxr-reader-article"><MissionConclusion missionId={item.missionId} text={item.text} density="full" /></div>}
      </div>
      {toast ? <div className="kxr-toast" role={toast.error ? "alert" : "status"}>{toast.text}</div> : null}
    </aside>
  );
}
