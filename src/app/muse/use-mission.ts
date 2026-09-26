"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mergeEvents, type MissionEvent, type MissionStatusView } from "./mission-timeline";

/**
 * Live mission state: status snapshot + ordered event stream.
 * SSE first (resumes by Last-Event-ID automatically); if EventSource is
 * unavailable or keeps failing, falls back to polling `/events?after=`.
 * Status is refetched (debounced) whenever new events arrive.
 */
export function useMission(missionId: string, opts: { withEvents?: boolean } = {}) {
  const withEvents = opts.withEvents ?? true;
  const [status, setStatus] = useState<MissionStatusView | null>(null);
  const [events, setEvents] = useState<MissionEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const lastSeq = useRef(0);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disposed = useRef(false);

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch(`/api/missions/${missionId}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const next = (await r.json()) as MissionStatusView;
      if (!disposed.current) {
        setStatus(next);
        setError(null);
      }
      return next;
    } catch (e) {
      if (!disposed.current) setError(e instanceof Error ? e.message : "load failed");
      return null;
    }
  }, [missionId]);

  const scheduleStatus = useCallback(() => {
    if (statusTimer.current) return;
    statusTimer.current = setTimeout(() => {
      statusTimer.current = null;
      void loadStatus();
    }, 400);
  }, [loadStatus]);

  const push = useCallback(
    (incoming: MissionEvent[]) => {
      if (!incoming.length) return;
      lastSeq.current = Math.max(lastSeq.current, ...incoming.map((e) => e.seq));
      setEvents((prev) => mergeEvents(prev, incoming));
      scheduleStatus();
    },
    [scheduleStatus]
  );

  useEffect(() => {
    disposed.current = false;
    lastSeq.current = 0;
    setEvents([]);
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;

    const pollEvents = async () => {
      try {
        const r = await fetch(`/api/missions/${missionId}/events?after=${lastSeq.current}`, { cache: "no-store" });
        if (r.ok) push(((await r.json()) as { events: MissionEvent[] }).events);
      } catch {
        /* keep polling */
      }
      const s = await loadStatus();
      if (!disposed.current && !s?.outcome) poll = setTimeout(pollEvents, 3000);
    };

    const startSse = () => {
      if (typeof EventSource === "undefined") return void pollEvents();
      es = new EventSource(`/api/missions/${missionId}/stream?after=${lastSeq.current}`);
      es.onopen = () => {
        failures = 0;
        setLive(true);
      };
      es.onmessage = () => undefined;
      const handler = (ev: MessageEvent) => {
        try {
          push([JSON.parse(ev.data) as MissionEvent]);
        } catch {
          /* ignore malformed */
        }
      };
      for (const t of [
        "mission.launched", "mission.paused", "mission.resumed", "mission.cancelled", "mission.finished",
        "plan.edited", "node.dispatched", "node.started", "node.delta", "node.tool", "node.cite",
        "node.finished", "node.skipped", "node.rerun", "qa.revise", "user.input", "user.input.applied",
      ]) es.addEventListener(t, handler as EventListener);
      es.addEventListener("end", () => {
        es?.close();
        setLive(false);
        void loadStatus();
      });
      es.onerror = () => {
        failures++;
        setLive(false);
        if (failures >= 3) {
          es?.close();
          es = null;
          void pollEvents();
        }
      };
    };

    void loadStatus().then((s) => {
      if (disposed.current) return;
      if (!withEvents) {
        // Card-only mode: cheap status polling until terminal.
        const tick = async () => {
          const n = await loadStatus();
          if (!disposed.current && !n?.outcome) poll = setTimeout(tick, 4000);
        };
        if (!s?.outcome) poll = setTimeout(tick, 4000);
        return;
      }
      startSse();
    });

    return () => {
      disposed.current = true;
      es?.close();
      if (poll) clearTimeout(poll);
      if (statusTimer.current) clearTimeout(statusTimer.current);
      statusTimer.current = null;
    };
  }, [missionId, withEvents, loadStatus, push]);

  const control = useCallback(
    async (body: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> => {
      try {
        const r = await fetch(`/api/missions/${missionId}/control`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await r.json().catch(() => ({}))) as { mission?: MissionStatusView; error?: string; message?: string };
        if (!r.ok) return { ok: false, message: json.message ?? json.error ?? `操作失败（${r.status}）` };
        if (json.mission) setStatus(json.mission);
        return { ok: true };
      } catch {
        return { ok: false, message: "网络异常，操作未提交" };
      }
    },
    [missionId]
  );

  return { status, events, error, live, control, reload: loadStatus };
}
