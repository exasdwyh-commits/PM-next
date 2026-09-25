"use client";

import React from "react";
import Icon from "./icons";
import { Badge, Empty, Thinking } from "./ui";
import { fmtDateTime } from "@/shared/datetime";

/**
 * 本机执行（Hermes Desktop Runtime）的用户可见面。
 *
 * 设计前提：后端已经把排队、领取、回执全部真实落库，这里只负责如实呈现。
 * 三条硬规则：
 * 1. 不做假进度。没有百分比、没有假计时，状态文案严格来自 AgentTask.status。
 * 2. 在线状态未确认时说「未确认」，绝不说「在线」。
 * 3. 排队中但 runtime 未连接时，必须明说「还不会执行」并给出连接方式 ——
 *    这是用户最容易误判为「Hermes 正在干活」的时刻。
 */

export type DesktopPresenceStatus = "ONLINE" | "STALE" | "UNKNOWN";
export type DesktopTaskPhase =
  | "WAITING_RUNTIME"
  | "RUNNING"
  | "NEEDS_YOU"
  | "DONE"
  | "FAILED";

export interface DesktopPresenceView {
  status: DesktopPresenceStatus;
  deviceId: string | null;
  lastSeenAt: string | null;
  secondsSinceLastSeen: number | null;
  label: string;
  hint: string | null;
}

export interface DesktopTaskItem {
  taskId: string;
  goal: string;
  status: string;
  phase: DesktopTaskPhase;
  action: { tool: string; kind: string; detail: string } | null;
  createdAt: string;
  updatedAt: string;
  conversationId: string | null;
  claim: { deviceId: string; claimedAt: string } | null;
  result: {
    ok: boolean;
    summary: string;
    output: string | null;
    outputLength: number;
    artifacts?: Array<{
      kind: "file" | "directory" | "url" | "text";
      path?: string;
      url?: string;
      label?: string;
    }>;
    deviceId: string | null;
    finishedAt: string | null;
  } | null;
}

export interface DesktopOverviewView {
  presence: DesktopPresenceView;
  waitingRuntimeCount: number;
  runningCount: number;
  needsYouCount: number;
  tasks: DesktopTaskItem[];
  generatedAt: string;
}

const PHASE_LABEL: Record<DesktopTaskPhase, string> = {
  WAITING_RUNTIME: "等待本机领取",
  RUNNING: "本机执行中",
  NEEDS_YOU: "需要你处理",
  DONE: "已完成",
  FAILED: "执行失败",
};

const PHASE_TONE: Record<DesktopTaskPhase, "info" | "warn" | "ok" | "danger" | "neutral"> = {
  WAITING_RUNTIME: "neutral",
  RUNNING: "info",
  NEEDS_YOU: "warn",
  DONE: "ok",
  FAILED: "danger",
};

/** 轮询本机执行视图。只读接口，失败时静默保留上一次真实结果。 */
export function useDesktopOverview(options: {
  conversationId?: string | null;
  /** false 时完全不发请求（例如会话还没创建） */
  enabled?: boolean;
  intervalMs?: number;
  limit?: number;
}) {
  const { conversationId = null, enabled = true, intervalMs = 4000, limit } = options;
  const [data, setData] = React.useState<DesktopOverviewView | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    if (!enabled) {
      setData(null);
      setLoaded(false);
      return;
    }
    let disposed = false;

    const load = async () => {
      if (disposed || document.visibilityState === "hidden") return;
      const params = new URLSearchParams();
      if (conversationId) params.set("conversationId", conversationId);
      if (limit) params.set("limit", String(limit));
      try {
        const res = await fetch(`/api/desktop-runtime/overview?${params.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok || disposed) return;
        const json = (await res.json()) as DesktopOverviewView;
        if (!disposed) {
          setData(json);
          setLoaded(true);
        }
      } catch {
        // 本机视图拉取失败不应影响主流程；保留上一次真实数据，不伪造状态。
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), intervalMs);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [conversationId, enabled, intervalMs, limit]);

  return { overview: data, loaded };
}

export function DesktopPresenceChip({ presence }: { presence: DesktopPresenceView }) {
  return (
    <span
      className={`hermes-desktop-presence is-${presence.status.toLowerCase()}`}
      title={
        presence.lastSeenAt
          ? `最近一次连接 ${fmtDateTime(presence.lastSeenAt)}`
          : "本次服务启动后尚未收到 Mac 端连接"
      }
    >
      <i aria-hidden="true" />
      {presence.label}
    </span>
  );
}

function ArtifactList({ artifacts }: { artifacts: NonNullable<DesktopTaskItem["result"]>["artifacts"] }) {
  if (!artifacts || artifacts.length === 0) return null;
  return (
    <div className="hermes-desktop-artifacts">
      <span className="hermes-desktop-artifacts-label">产物</span>
      {artifacts.map((a, i) => {
        const text = a.label || a.path || a.url || a.kind;
        return a.url ? (
          <a key={i} href={a.url} target="_blank" rel="noreferrer" className="hermes-chip">
            {text}
          </a>
        ) : (
          <span key={i} className="hermes-chip">
            {text}
          </span>
        );
      })}
    </div>
  );
}

function DesktopTaskRow({ task }: { task: DesktopTaskItem }) {
  const result = task.result;
  return (
    <div className={`hermes-desktop-task is-${task.phase.toLowerCase()}`}>
      <div className="hermes-desktop-task-head">
        <Badge tone={PHASE_TONE[task.phase]}>{PHASE_LABEL[task.phase]}</Badge>
        {task.action ? <span className="hermes-desktop-task-kind">{task.action.kind}</span> : null}
        <span className="hermes-desktop-task-time">{fmtDateTime(task.updatedAt)}</span>
      </div>

      <p className="hermes-desktop-task-goal">{task.goal}</p>

      {task.action ? (
        <div className="hermes-desktop-task-detail" title={task.action.detail}>
          <Icon name="file" size={13} />
          <code>{task.action.detail}</code>
        </div>
      ) : null}

      {task.phase === "RUNNING" && task.claim ? (
        <p className="hermes-desktop-task-note">
          {task.claim.deviceId} 于 {fmtDateTime(task.claim.claimedAt)} 领取，正在你的电脑上执行。
        </p>
      ) : null}

      {task.phase === "WAITING_RUNTIME" ? (
        <p className="hermes-desktop-task-note">尚未被任何设备领取。</p>
      ) : null}

      {result ? (
        <div className="hermes-desktop-task-result">
          <p>{result.summary}</p>
          <ArtifactList artifacts={result.artifacts} />
          {result.output ? (
            <details className="hermes-details">
              <summary>
                查看完整输出
                {result.outputLength > 0 ? `（${result.outputLength} 字）` : ""}
              </summary>
              <pre className="hermes-desktop-output">{result.output}</pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 对话内的本机运行条。
 * 只在这个会话真的触发过本机任务时出现 —— 没有本机工作就不该占用对话注意力。
 */
export function DesktopConversationStrip({
  overview,
}: {
  overview: DesktopOverviewView | null;
}) {
  if (!overview || overview.tasks.length === 0) return null;
  const live = overview.tasks.filter(
    (t) => t.phase === "WAITING_RUNTIME" || t.phase === "RUNNING" || t.phase === "NEEDS_YOU"
  );
  const stuck = overview.waitingRuntimeCount > 0 && overview.presence.status !== "ONLINE";
  // 标题必须跟真实相位一致：只有确实有任务在执行时才能说「正在用你的电脑」。
  // 全部结束、或排队但 Mac 没连上时说成现在进行时，就是这个组件自己要防的误读。
  const title =
    overview.runningCount > 0
      ? "Hermes 正在用你的电脑"
      : overview.waitingRuntimeCount > 0
        ? stuck
          ? "本机任务在排队，尚未开始"
          : "本机任务在排队，等待领取"
        : overview.needsYouCount > 0
          ? "本机任务需要你处理"
          : "本机执行记录";

  return (
    <section className="hermes-desktop-strip" aria-label="本机执行">
      <div className="hermes-desktop-strip-head">
        <div className="hermes-desktop-strip-title">
          <Icon name="nodes" size={15} />
          <strong>{title}</strong>
        </div>
        <DesktopPresenceChip presence={overview.presence} />
      </div>

      {stuck ? (
        <div className="hermes-desktop-blocked" role="status">
          <strong>
            有 {overview.waitingRuntimeCount} 项本机任务在排队，但现在不会执行。
          </strong>
          <span>{overview.presence.hint ?? "需要先让 Mac 端连上 Hermes。"}</span>
          <code>npm run desktop</code>
        </div>
      ) : null}

      <div className="hermes-desktop-task-list">
        {(live.length > 0 ? live : overview.tasks.slice(0, 2)).map((t) => (
          <DesktopTaskRow key={t.taskId} task={t} />
        ))}
      </div>
    </section>
  );
}

/** 自动化中心里的「本机执行」面板正文。 */
export function DesktopActivityBody({
  overview,
  loaded,
}: {
  overview: DesktopOverviewView | null;
  loaded: boolean;
}) {
  // 语义边界：没读到不是「空」，是「还没读到」。
  if (!overview) {
    return loaded ? (
      <Empty>还没有本机执行记录。</Empty>
    ) : (
      <Thinking label="正在读取本机执行状态…" />
    );
  }

  const stuck = overview.waitingRuntimeCount > 0 && overview.presence.status !== "ONLINE";

  return (
    <div className="hermes-desktop-panel">
      <div className="hermes-desktop-panel-head">
        <DesktopPresenceChip presence={overview.presence} />
        <div className="hermes-desktop-counts">
          <span>
            <strong>{overview.waitingRuntimeCount}</strong>等待领取
          </span>
          <span>
            <strong>{overview.runningCount}</strong>执行中
          </span>
          <span className={overview.needsYouCount > 0 ? "is-alert" : undefined}>
            <strong>{overview.needsYouCount}</strong>需要你处理
          </span>
        </div>
      </div>

      {overview.presence.status !== "ONLINE" ? (
        <div className={stuck ? "hermes-desktop-blocked" : "hermes-desktop-hint"} role="status">
          <strong>
            {stuck
              ? `有 ${overview.waitingRuntimeCount} 项本机任务在排队，但现在不会执行。`
              : overview.presence.label}
          </strong>
          <span>{overview.presence.hint ?? ""}</span>
          <code>npm run desktop</code>
        </div>
      ) : null}

      {overview.tasks.length === 0 ? (
        <Empty>
          还没有本机任务。在 AI 助理里直接说「本机帮我…」，Hermes 会把工作发到这台电脑执行。
        </Empty>
      ) : (
        <div className="hermes-desktop-task-list">
          {overview.tasks.map((t) => (
            <DesktopTaskRow key={t.taskId} task={t} />
          ))}
        </div>
      )}
    </div>
  );
}
