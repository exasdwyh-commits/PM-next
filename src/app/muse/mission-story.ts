/**
 * KX-23 主叙事：把一次任务讲成一条连续的故事（理解 → 简报 → 计划 → 执行 → 交付）。
 *
 * 纯函数，状态只来自 useMission 的状态快照与事件流，不用定时器推进，也不猜测：
 * - 站点由真实字段决定（有无契约 / 有无节点 / 节点是否开始 / outcome）；
 * - 动态岛文字：结束态 > 暂停 > 等你回答 > currentActivity；
 * - 诚实节拍：node.hypothesis / node.refuted / node.retracted 事件逐条可见；
 * - 执行日志：node.tool（模型调用除外）事件。
 * 动效原则见 docs/mcp-motion-principles.md。
 */
import {
  currentActivity,
  describeEvent,
  formatClock,
  type MissionEvent,
  type MissionStatusView,
} from "./mission-timeline";

export type StoryPhase = "think" | "brief" | "plan" | "run" | "deliver";

export const STORY_STEPS: { key: StoryPhase; label: string }[] = [
  { key: "think", label: "理解需求" },
  { key: "brief", label: "简报" },
  { key: "plan", label: "计划" },
  { key: "run", label: "执行" },
  { key: "deliver", label: "交付" },
];

const STARTED = new Set(["ACTIVE", "SUCCEEDED", "BLOCKED", "FAILED", "SKIPPED"]);

export interface MissionStory {
  phase: StoryPhase;
  tone?: "warn" | "bad";
  notch: { text: string; state: "live" | "warn" | "done" | "idle" };
  beats: { id: string; kind: "hypothesis" | "refuted" | "retracted"; text: string }[];
  log: { id: string; at: string; text: string; bad?: boolean }[];
}

type StoryStatus = Pick<MissionStatusView, "nodes" | "outcome" | "paused" | "contract" | "pendingAsks" | "progress" | "status" | "goal"> &
  Partial<MissionStatusView>;

export function storyPhase(status: StoryStatus): StoryPhase {
  if (status.outcome?.status === "COMPLETED") return "deliver";
  if (!status.nodes.length) return status.contract ? "brief" : "think";
  return status.nodes.some((n) => STARTED.has(n.status)) ? "run" : "plan";
}

const BEAT_KIND: Record<string, MissionStory["beats"][number]["kind"]> = {
  "node.hypothesis": "hypothesis",
  "node.refuted": "refuted",
  "node.retracted": "retracted",
};

export function buildStory(status: StoryStatus, events: MissionEvent[]): MissionStory {
  const phase = storyPhase(status);
  const outcome = status.outcome?.status;
  const tone = outcome === "CANCELLED" ? "bad" : outcome === "NEEDS_USER" || status.paused || status.pendingAsks?.length ? "warn" : undefined;

  const notch: MissionStory["notch"] =
    outcome === "COMPLETED"
      ? { text: "已完成，可以带走结果", state: "done" }
      : outcome === "CANCELLED"
        ? { text: "已取消", state: "idle" }
        : outcome === "NEEDS_USER"
          ? { text: "停下了，需要你处理", state: "warn" }
          : status.paused
            ? { text: "已暂停", state: "warn" }
            : status.pendingAsks?.length
              ? { text: "有个问题等你回答，其余步骤照常进行", state: "warn" }
              : { text: currentActivity(status as MissionStatusView, events) || "Kern 正在推进", state: "live" };

  const beats: MissionStory["beats"] = [];
  const log: MissionStory["log"] = [];
  for (const e of events) {
    const kind = BEAT_KIND[e.type];
    if (kind) {
      const d = describeEvent(e);
      if (d) beats.push({ id: `b${e.seq}`, kind, text: d.text });
    } else if (e.type === "node.tool" && (e.payload as { tool?: string } | null)?.tool !== "model_call") {
      const d = describeEvent(e);
      if (d) log.push({ id: `t${e.seq}`, at: formatClock(e.createdAt), text: d.text, bad: (e.payload as { ok?: boolean } | null)?.ok === false });
    }
  }
  return { phase, tone, notch, beats, log };
}
