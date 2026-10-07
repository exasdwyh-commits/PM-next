/**
 * KX-64 · 注意力信号流（给浏览器系统通知用，只读）
 * ================================================
 * 复用首页「需要你」的同一套注意力判断（loadAttentionForUser），不分叉逻辑，另加：
 * - 最近 24 小时完成的任务；
 * - 最近一次运行失败的定时任务。
 * 每条带稳定 key：同一件事反复轮询 key 不变，前端据此只对“新出现的”弹通知。
 */
import type { SessionContext } from "@/modules/identity/session";
import { loadAttentionForUser } from "@/modules/muse/read-model";
import { listSchedules } from "@/modules/schedule/service";

export type FeedKind = "needs_you" | "done" | "schedule_failed";

export type FeedItem = {
  key: string;
  kind: FeedKind;
  title: string;
  body: string;
  href: string;
};

type Attention = Awaited<ReturnType<typeof loadAttentionForUser>>;
type ScheduleLike = { id: string; title: string; lastStatus: string | null; lastError: string | null; lastRunAt: string | null };

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};
const convHref = (conversationId: string | null | undefined) => (conversationId ? `/muse?c=${encodeURIComponent(conversationId)}` : "/muse");

export function buildAttentionFeed(attention: Pick<Attention, "needsYou" | "recentDone">, schedules: ScheduleLike[]): FeedItem[] {
  const items: FeedItem[] = [];
  for (const n of attention.needsYou) {
    items.push({
      key: `n:${n.id}`,
      kind: "needs_you",
      title: clip(`需要你：${n.title}`, 80),
      body: clip(n.why, 140),
      href: n.href && n.href.startsWith("/") && !n.href.startsWith("//") ? n.href : convHref(n.conversationId),
    });
  }
  for (const d of attention.recentDone) {
    items.push({ key: `d:${d.id}`, kind: "done", title: clip(`已完成：${d.title}`, 80), body: "Kern 已经给出结论，点开查看。", href: convHref(d.conversationId) });
  }
  for (const s of schedules) {
    if (s.lastStatus !== "FAILED") continue;
    items.push({
      key: `s:${s.id}:${s.lastRunAt ?? ""}`,
      kind: "schedule_failed",
      title: clip(`定时任务失败：${s.title}`, 80),
      body: clip(s.lastError ?? "运行失败", 140),
      href: "/muse",
    });
  }
  return items;
}

export async function loadAttentionFeed(session: SessionContext): Promise<FeedItem[]> {
  const [attention, schedules] = await Promise.all([loadAttentionForUser(session), listSchedules(session)]);
  return buildAttentionFeed(attention, schedules);
}
