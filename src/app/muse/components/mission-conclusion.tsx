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
import { ResponseRoleBased } from "../response/response-role-based";
import { Prose } from "./prose";
import { MissionConclusionRich } from "./mission-conclusion-rich";
import "./mission-conclusion-rich.css";
import { ReportV3 } from "@/components/report-v3";
import type { ExecutiveReportPayload } from "@/shared/executive-report-types";
import type { ExecutiveReportCitation } from "@/shared/executive-report-citation";
import { ReportCard } from "../rich/report-card";
import { useRole } from "@/components/role-context";
import { useConclusionDecisions } from "./conclusion-decisions";

type Loaded = { envelope: ResponseEnvelope; renderable: boolean };

export function MissionConclusionOriginal({
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
  const decisions = useConclusionDecisions();

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
  const choice = envelope.ask ? { missionId, question: envelope.ask.question, demo: envelope.demo, label: "" } : null;
  return <ResponseRoleBased envelope={envelope} defaultDensity={density} fallback={fallback}
    onAsk={decisions && choice ? label => decisions.choose({ ...choice, label }) : undefined}
    askState={decisions && choice ? decisions.state(choice, envelope.ask!.options.map(o => o.label)) : undefined}
  />;
}


type ConclusionProps = {
  missionId: string;
  text: string;
  density?: "summary" | "full";
  showAsk?: boolean;
};

/** Historical completed mission citations also resolve through this reader. */
export function MissionConclusion(props: ConclusionProps) {
  const { source } = useRole();
  const [presentation, setPresentation] = useState<{ id: string; poster: ExecutiveReportPayload | null; citation: ExecutiveReportCitation | null } | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/missions/${encodeURIComponent(props.missionId)}/response`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then(data => { if (!controller.signal.aborted) {
        setPresentation({ id: props.missionId, poster: data.poster ?? null, citation: data.citation ?? null });
        setErrorId(null);
      } })
      .catch(() => { if (!controller.signal.aborted) setErrorId(props.missionId); });
    return () => controller.abort();
  }, [props.missionId, retry]);

  if (errorId === props.missionId) return <p className="m-hint" role="status">报告暂时无法读取。<button type="button" className="m-link" onClick={() => { setErrorId(null); setRetry(value => value + 1); }}>重试</button></p>;
  if (presentation?.id !== props.missionId) return <p className="m-hint" role="status">正在读取研究报告…</p>;
  if (presentation.poster && presentation.citation) {
    return props.density === "full"
      ? <ReportV3 report={presentation.poster} embedded />
      : <ReportCard citation={presentation.citation} />;
  }
  // Generic missions retain their established response/decision presentation.
  return source !== "default" ? <MissionConclusionRich {...props} /> : <MissionConclusionOriginal {...props} />;
}
