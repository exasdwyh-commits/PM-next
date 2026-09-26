/**
 * Kern Attention Engine (pure)
 * ============================
 *
 * Decides what deserves the user's attention. The default is restraint:
 * Kern handles, watches, and only surfaces what truly needs a human.
 *
 *   AUTO_HANDLE – Kern is doing it; nothing to show beyond progress
 *   WATCH       – visible on demand (trail), never pushed
 *   SURFACE     – shown on the home "needs you" list
 *   INTERRUPT   – shown first and highlighted (protected / irreversible / blocking)
 */

export type AttentionLevel = "AUTO_HANDLE" | "WATCH" | "SURFACE" | "INTERRUPT";

export type AttentionSignal =
  | {
      kind: "MISSION";
      id: string;
      goal: string;
      status: "RUNNING" | "COMPLETED" | "NEEDS_USER";
      progress: { done: number; total: number };
      reasons: string[];
      finishedAt: string | null;
      conversationId: string | null;
      seenByUser: boolean;
    }
  | {
      kind: "PROPOSAL";
      id: string;
      title: string;
      actionType: string;
      createdAt: string;
      conversationId: string | null;
    }
  | {
      kind: "TASK_WAITING_HUMAN";
      id: string;
      goal: string;
      agentName: string;
      reason: string | null;
      createdAt: string;
    };

export interface AttentionItem {
  id: string;
  level: AttentionLevel;
  title: string;
  why: string;
  href: string | null;
  conversationId: string | null;
  sortKey: number;
}

const PROTECTED_ACTIONS = /(DELETE|PUBLISH|SEND|PAY|BUDGET|RELEASE|GATE|CONTRACT|PERMISSION)/i;

function reasonText(reasons: string[]): string {
  if (reasons.includes("MODEL_UNAVAILABLE")) return "模型服务不可用，恢复后说“继续”即可";
  if (reasons.some((r) => r.startsWith("SYNTHESIS_"))) return "Kern 没能形成可信结论";
  const critical = reasons.filter((r) => r.startsWith("CRITICAL_"));
  if (critical.length) return `关键环节未完成（${critical.length} 项），需要你补充条件或调整目标`;
  return "需要你处理";
}

export function classifyAttention(signal: AttentionSignal): AttentionItem {
  switch (signal.kind) {
    case "MISSION": {
      if (signal.status === "RUNNING") {
        return {
          id: `mission:${signal.id}`,
          level: "AUTO_HANDLE",
          title: signal.goal,
          why: `进行中 · ${signal.progress.done}/${signal.progress.total}`,
          href: null,
          conversationId: signal.conversationId,
          sortKey: 0,
        };
      }
      if (signal.status === "NEEDS_USER") {
        return {
          id: `mission:${signal.id}`,
          level: "INTERRUPT",
          title: signal.goal,
          why: reasonText(signal.reasons),
          href: null,
          conversationId: signal.conversationId,
          sortKey: 100,
        };
      }
      // Completed: surface once until the user opens the conversation.
      return {
        id: `mission:${signal.id}`,
        level: signal.seenByUser ? "WATCH" : "SURFACE",
        title: signal.goal,
        why: "结论已送达，等你看",
        href: null,
        conversationId: signal.conversationId,
        sortKey: 60,
      };
    }
    case "PROPOSAL":
      return {
        id: `proposal:${signal.id}`,
        level: PROTECTED_ACTIONS.test(signal.actionType) ? "INTERRUPT" : "SURFACE",
        title: signal.title,
        why: "改动需要你批准后才会写入",
        href: null,
        conversationId: signal.conversationId,
        sortKey: PROTECTED_ACTIONS.test(signal.actionType) ? 90 : 70,
      };
    case "TASK_WAITING_HUMAN":
      return {
        id: `task:${signal.id}`,
        level: "SURFACE",
        title: signal.goal,
        why: `${signal.agentName} 在等你${signal.reason ? "：" + signal.reason.slice(0, 80) : ""}`,
        href: "/workforce",
        conversationId: null,
        sortKey: 80,
      };
  }
}

export function buildAttentionBrief(signals: AttentionSignal[], limit = 6) {
  const items = signals.map(classifyAttention);
  const needsYou = items
    .filter((i) => i.level === "INTERRUPT" || i.level === "SURFACE")
    .sort((a, b) => b.sortKey - a.sortKey)
    .slice(0, limit);
  const inProgress = items.filter((i) => i.level === "AUTO_HANDLE").slice(0, limit);
  const handledQuietly = items.filter((i) => i.level === "WATCH").length;
  return { needsYou, inProgress, handledQuietly };
}
