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


export function MissionConclusion(props: any) {
  try {
    const { role } = useRole();
    if (role !== "default") {
      return <MissionConclusionRich {...props} />;
    }
  } catch {}
  return <MissionConclusionOriginal {...props} />;
}
