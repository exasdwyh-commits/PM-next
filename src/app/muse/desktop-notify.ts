"use client";
/**
 * KX-64 · 浏览器系统通知
 * ======================
 * - 默认关闭；用户在「定时」面板打开时才向浏览器申请权限，开关存在本机 localStorage。
 * - 每 30 秒读一次 /api/attention；只对“新出现的”条目弹通知，页面打开时已存在的不弹。
 * - 只在 Kern 页面不在前台时弹（在前台时页面本身就能看到）。
 * - 一轮最多弹 3 条；点通知回到 Kern 并打开对应对话。
 */
import { useEffect, useRef } from "react";

export const NOTIFY_KEY = "kern.notify.v1";
export const NOTIFY_EVENT = "kern-notify-changed";
export const NOTIFY_POLL_MS = 30_000;
export const NOTIFY_MAX_PER_ROUND = 3;

export type FeedItem = { key: string; kind: "needs_you" | "done" | "schedule_failed"; title: string; body: string; href: string };
export type NotifyState = "unsupported" | "denied" | "on" | "off";

/** 纯函数：第一轮（seen 为 null）只建立基线不弹；之后返回未见过的条目。 */
export function diffFeed(seen: ReadonlySet<string> | null, items: FeedItem[]): { fresh: FeedItem[]; seen: Set<string> } {
  const next = new Set(seen ?? []);
  const fresh: FeedItem[] = [];
  for (const it of items) {
    if (next.has(it.key)) continue;
    next.add(it.key);
    if (seen) fresh.push(it);
  }
  return { fresh, seen: next };
}

export function notifyState(): NotifyState {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return Notification.permission === "granted" && window.localStorage.getItem(NOTIFY_KEY) === "on" ? "on" : "off";
}

export async function setNotifyEnabled(on: boolean): Promise<NotifyState> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (on) {
    const perm = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (perm === "granted") window.localStorage.setItem(NOTIFY_KEY, "on");
  } else {
    window.localStorage.removeItem(NOTIFY_KEY);
  }
  window.dispatchEvent(new Event(NOTIFY_EVENT));
  return notifyState();
}

export function useDesktopNotify() {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    let timer: number | null = null;
    let disposed = false;
    const tick = async () => {
      if (notifyState() !== "on") return;
      try {
        const r = await fetch("/api/attention", { cache: "no-store" });
        if (!r.ok || disposed) return;
        const { items } = (await r.json()) as { items: FeedItem[] };
        const { fresh, seen: next } = diffFeed(seen.current, items);
        seen.current = next;
        if (!document.hidden && document.hasFocus()) return;
        for (const it of fresh.slice(0, NOTIFY_MAX_PER_ROUND)) {
          const n = new Notification(it.title, { body: it.body, tag: it.key });
          n.onclick = () => {
            window.focus();
            window.location.href = it.href;
            n.close();
          };
        }
      } catch {
        // 轮询失败静默，下一轮再试。
      }
    };
    const restart = () => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      seen.current = null;
      if (notifyState() !== "on") return;
      void tick();
      timer = window.setInterval(() => void tick(), NOTIFY_POLL_MS);
    };
    restart();
    window.addEventListener(NOTIFY_EVENT, restart);
    return () => {
      disposed = true;
      if (timer !== null) window.clearInterval(timer);
      window.removeEventListener(NOTIFY_EVENT, restart);
    };
  }, []);
}
