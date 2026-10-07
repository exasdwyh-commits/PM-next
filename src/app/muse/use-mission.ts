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
  const [connected, setConnected] = useState(false);
  const [streamVersion, setStreamVersion] = useState(0);
  const lastSeq = useRef(0);
  const statusRequest = useRef(0);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disposed = useRef(false);

  const loadStatus = useCallback(async () => {
    const request = ++statusRequest.current;
    try {
      const r = await fetch(`/api/missions/${missionId}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const next = (await r.json()) as MissionStatusView;
      if (!disposed.current && request === statusRequest.current) {
        setStatus(next);
        setError(null);
        setConnected(true);
      }
      return next;
    } catch (e) {
      if (!disposed.current && request === statusRequest.current) {
        setError(e instanceof Error ? e.message : "load failed");
        setConnected(false);
      }
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

  // Conversation card and open workspace share controls, including restarting a drained stream.
  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ missionId: string; mission?: MissionStatusView; reconnect: boolean }>).detail;
      if (detail.missionId !== missionId) return;
      statusRequest.current++;
      if (detail.mission) setStatus(detail.mission);
      if (detail.reconnect) setStreamVersion(value => value + 1);
      else void loadStatus();
    };
    window.addEventListener("kern:mission-control", update);
    return () => window.removeEventListener("kern:mission-control", update);
  }, [missionId, loadStatus]);

  useEffect(() => {
    disposed.current = false;
    lastSeq.current = 0;
    setEvents([]);
    setConnected(false);
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let cancelled = false;
    const requests = statusRequest;

    const pollEvents = async () => {
      try {
        const r = await fetch(`/api/missions/${missionId}/events?after=${lastSeq.current}`, { cache: "no-store" });
        if (r.ok) {
          const incoming = ((await r.json()) as { events: MissionEvent[] }).events;
          if (!cancelled) push(incoming);
        }
      } catch {
        /* keep polling */
      }
      if (cancelled) return;
      const s = await loadStatus();
      if (!cancelled && !s?.outcome) poll = setTimeout(pollEvents, 3000);
    };

    const startSse = () => {
      if (typeof EventSource === "undefined") return void pollEvents();
      es = new EventSource(`/api/missions/${missionId}/stream?after=${lastSeq.current}`);
      es.onopen = () => {
        if (cancelled) return;
        failures = 0;
        setLive(true);
        setConnected(true);
      };
      es.onmessage = () => undefined;
      const handler = (ev: MessageEvent) => {
        if (cancelled) return;
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
        "node.hypothesis", "node.refuted", "node.retracted", "node.ask", "node.answered",
      ]) es.addEventListener(t, handler as EventListener);
      es.addEventListener("end", () => {
        if (cancelled) return;
        es?.close();
        setLive(false);
        void loadStatus();
      });
      es.onerror = () => {
        if (cancelled) return;
        failures++;
        setLive(false);
        setConnected(false);
        if (failures >= 3) {
          es?.close();
          es = null;
          void pollEvents();
        }
      };
    };

    void loadStatus().then((s) => {
      if (cancelled) return;
      if (!withEvents) {
        // Card-only mode: cheap status polling until terminal.
        const tick = async () => {
          const n = await loadStatus();
          if (!cancelled && !n?.outcome) poll = setTimeout(tick, 4000);
        };
        if (!s?.outcome) poll = setTimeout(tick, 4000);
        return;
      }
      startSse();
    });

    return () => {
      cancelled = true;
      disposed.current = true;
      requests.current++;
      es?.close();
      if (poll) clearTimeout(poll);
      if (statusTimer.current) clearTimeout(statusTimer.current);
      statusTimer.current = null;
    };
  }, [missionId, withEvents, loadStatus, push, streamVersion]);

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
        window.dispatchEvent(new CustomEvent("kern:mission-control", { detail: { missionId, mission: json.mission, reconnect: body.action === "rerun" || body.action === "resume" } }));
        return { ok: true };
      } catch {
        return { ok: false, message: "网络异常，操作未提交" };
      }
    },
    [missionId]
  );

  return { status, events, error, live, connected, control, reload: loadStatus };
}
