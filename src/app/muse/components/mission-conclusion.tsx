"use client";
/**
 * Mission conclusion — the layered reply model in one place:
 *   ResponseEnvelope (structured, docs/KERN_RESPONSE_SPEC.md) when the harness accepts it,
 *   otherwise the Markdown conclusion via Prose (docs/KERN_REPLY_FORMAT.md).
 * The Markdown shows immediately, so there is never a blank card while loading.
 */
import { useEffect, useState } from "react";

import type { ResponseEnvelope } from "@/modules/response-format/types";

import "../response/response.css";
import { ResponseView } from "../response/response-view";
import { Prose } from "./prose";

type Loaded = { envelope: ResponseEnvelope; renderable: boolean };

export function MissionConclusion({
  missionId,
  text,
  density = "summary",
  showAsk = true,
}: {
  missionId: string;
  text: string;
  density?: "summary" | "full";
  /** The workspace already has its own 「需要你决定」 section; avoid showing it twice. */
  showAsk?: boolean;
}) {
  const [data, setData] = useState<Loaded | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/missions/${encodeURIComponent(missionId)}/response`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Loaded>) : null))
      .then((d) => { if (alive && d?.envelope) setData(d); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [missionId]);

  const fallback = <Prose text={text} />;
  if (!data?.renderable) return fallback;
  const envelope = showAsk ? data.envelope : { ...data.envelope, ask: undefined };
  return <ResponseView envelope={envelope} defaultDensity={density} fallback={fallback} />;
}
