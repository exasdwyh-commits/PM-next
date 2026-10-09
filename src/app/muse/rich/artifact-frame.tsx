"use client";
/**
 * Sandboxed artifact frame.
 *  - sandbox="allow-scripts" only: no same-origin (no cookies, storage or app APIs),
 *    no top navigation, no popups, no forms.
 *  - srcdoc carries a network-less CSP as the first <head> element.
 *  - The parent only accepts messages from this frame's window, for this artifact id
 *    and a per-mount nonce; the only actions are "ready", "height" and "ask"
 *    (prefill the composer — the user still decides whether to send).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { buildSandboxDocument, readArtifactMessage } from "@/modules/artifacts/protocol";

export type ArtifactVersionData = {
  artifactId: string; key: string; kind: string; version: number; title: string;
  status: "READY" | "FAILED"; error: string | null; html: string; createdAt: string; messageId: string | null;
};

const cache = new Map<string, Promise<ArtifactVersionData>>();
export function loadArtifactVersion(id: string, version: number): Promise<ArtifactVersionData> {
  const key = `${id}@${version}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = fetch(`/api/artifacts/${encodeURIComponent(id)}/versions/${version}`, { cache: "no-store" }).then(async (r) => {
      if (!r.ok) throw new Error(r.status === 404 ? "成果不存在或无权查看" : "成果读取失败");
      return r.json() as Promise<ArtifactVersionData>;
    });
    hit.catch(() => cache.delete(key));
    cache.set(key, hit);
  }
  return hit;
}

export function useArtifactVersion(id: string, version: number | null, enabled = true) {
  const [state, setState] = useState<{ data: ArtifactVersionData | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || !version) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    loadArtifactVersion(id, version).then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (e: unknown) => alive && setState({ data: null, error: e instanceof Error ? e.message : "成果读取失败", loading: false }),
    );
    return () => { alive = false; };
  }, [id, version, enabled, attempt]);
  return { ...state, retry: () => setAttempt((a) => a + 1) };
}

function nonce(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function ArtifactFrame({ data, title, theme, onAsk, preview = false, className }: {
  data: ArtifactVersionData;
  title: string;
  theme?: "light" | "dark";
  onAsk?: (text: string) => void;
  preview?: boolean;
  className?: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const token = useMemo(() => nonce(), []);
  const [ready, setReady] = useState(false);
  const doc = useMemo(() => buildSandboxDocument(data.html, { artifactId: data.artifactId, nonce: token, theme }), [data.html, data.artifactId, token, theme]);
  const askRef = useRef(onAsk);
  askRef.current = onAsk;
  useEffect(() => { setReady(false); }, [doc]);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const msg = readArtifactMessage(event.data, { artifactId: data.artifactId, nonce: token });
      if (!msg) return;
      if (msg.type === "ready") setReady(true);
      if (msg.type === "ask" && !preview) askRef.current?.(msg.text);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [data.artifactId, token, preview]);
  return (
    <iframe
      ref={frame}
      className={className}
      title={preview ? `${title}（预览）` : title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={doc}
      loading={preview ? "lazy" : undefined}
      tabIndex={preview ? -1 : 0}
      aria-hidden={preview || undefined}
      data-ready={ready || undefined}
      onLoad={() => setReady(true)}
    />
  );
}
