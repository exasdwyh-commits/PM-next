"use client";
/** In-message artifact card: live (sandboxed, non-interactive) thumbnail + open / download / retry. */
import { useEffect, useRef, useState } from "react";
import { ARTIFACT_KIND_LABEL, type ArtifactCitation } from "@/modules/artifacts/protocol";
import { ArtifactFrame, useArtifactVersion } from "./artifact-frame";
import { useKernHost } from "./reader-context";

function useVisible<T extends Element>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); } }, { rootMargin: "240px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);
  return { ref, visible };
}

export function ArtifactCard({ id, version, citation }: { id: string; version: number; citation: ArtifactCitation | null }) {
  const host = useKernHost();
  const openRef = useRef<HTMLButtonElement>(null);
  const { ref, visible } = useVisible<HTMLDivElement>();
  const failed = citation?.status === "FAILED";
  const { data, error, loading, retry } = useArtifactVersion(id, failed ? null : version, visible);
  const title = citation?.title ?? data?.title ?? "可视化成果";
  const kind = citation?.artifactKind ?? "other";
  const reading = host?.reader?.kind === "artifact" && host.reader.id === id;
  const latest = host?.artifact(id)?.version ?? version;
  const [retrySent, setRetrySent] = useState(false);

  if (failed) {
    // A later READY version already replaced this failure (retry succeeded, possibly before a refresh):
    // don't offer a second retry that would only create another version of the same content.
    const superseded = latest > version;
    return (
      <div className="kxr-artifact" data-state="failed" ref={ref} role="group" aria-label={`成果生成失败：${title}`}>
        <div className="kxr-artifact-meta">
          <span className="kxr-artifact-kind">{ARTIFACT_KIND_LABEL[kind]}</span>
          <b className="kxr-artifact-title">{title}</b>
          <span className="kxr-pill" data-tone="bad">生成失败</span>
        </div>
        <p className="kxr-artifact-error">{citation?.error ?? "成果没有完整生成"}。上方文字已保留；{superseded ? `已在 v${latest} 重新生成，失败版本不会覆盖可用版本。` : "重新生成会作为一条新消息发送。"}</p>
        <div className="kxr-artifact-actions">
          {superseded ? (
            <button type="button" className="kxr-btn" data-v="primary" onClick={(e) => host?.openReader({ kind: "artifact", id, version: latest, title }, e.currentTarget)}>打开 v{latest}</button>
          ) : <button type="button" className="kxr-btn" data-v="primary" disabled={!host || host.busy || retrySent}
            onClick={async () => { if (!host) return; setRetrySent(true); const ok = await host.send(`请重新生成可视化成果「${title}」（key=${citation?.key ?? id}），输出完整 HTML。`); if (!ok) setRetrySent(false); }}>
            {retrySent ? "已发送重新生成请求" : "重新生成"}
          </button>}
          {version > 1 && !superseded ? <button type="button" className="kxr-btn" onClick={(e) => host?.openReader({ kind: "artifact", id, title }, e.currentTarget)}>查看上一个可用版本</button> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="kxr-artifact" data-state={reading ? "reading" : data ? "ready" : error ? "error" : "loading"} ref={ref} role="group" aria-label={`可视化成果：${title}`}>
      <button type="button" className="kxr-artifact-preview" tabIndex={-1} aria-hidden onClick={() => host?.openReader({ kind: "artifact", id, version, title }, openRef.current)}>
        {data ? <ArtifactFrame data={data} title={title} preview className="kxr-artifact-thumb" /> : (
          <span className="kxr-artifact-skeleton">{error ? error : loading || !visible ? "正在载入预览…" : ""}</span>
        )}
        <span className="kxr-artifact-veil" />
      </button>
      <div className="kxr-artifact-bar">
        <div className="kxr-artifact-meta">
          <span className="kxr-artifact-kind">{ARTIFACT_KIND_LABEL[kind]}</span>
          <b className="kxr-artifact-title">{title}</b>
          <span className="kxr-artifact-ver">v{version}</span>
          {latest > version ? (
            <button type="button" className="kxr-pill kxr-newer" data-tone="brand" onClick={(e) => host?.openReader({ kind: "artifact", id, version: latest, title }, e.currentTarget)}>
              已更新到 v{latest}
            </button>
          ) : null}
        </div>
        <div className="kxr-artifact-actions">
          {error ? <button type="button" className="kxr-btn" onClick={retry}>重新读取</button> : null}
          <a className="kxr-btn" data-v="ghost" href={`/api/artifacts/${encodeURIComponent(id)}/versions/${version}/download`} download aria-label={`下载 ${title} v${version} 的离线 HTML`}>下载</a>
          <button ref={openRef} type="button" className="kxr-btn" data-v="primary" aria-pressed={reading}
            onClick={(e) => (reading ? host?.closeReader() : host?.openReader({ kind: "artifact", id, version, title }, e.currentTarget))}>
            {reading ? "正在阅读区" : "打开"}
          </button>
        </div>
      </div>
    </div>
  );
}
