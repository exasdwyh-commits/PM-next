"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { currentActivity, reasonLabel } from "../mission-timeline";
import { useMission } from "../use-mission";
import { Btn, Card, CardHead, I, Tag } from "./kit";
import { MissionWorkspace } from "./mission-workspace";
import { ExecutionFlow } from "./execution-flow";
import { AskCard } from "./ask-card";

/**
 * Live view of a Kern mission inside the conversation.
 * One card: what's happening now, steps in plain language, quick pause /
 * continue, and the way into the workspace (「过程」/「产出」).
 */
export function MissionCard({ missionId }: { missionId: string }) {
  // KX-23：主叙事需要事件流（假设 / 证伪 / 收回、工具调用），所以这里订阅事件
  const { status: data, events, error, connected, control } = useMission(missionId);
  const [open, setOpen] = useState<null | "process" | "output">(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (error && !data) return null;
  const outcome = data?.outcome ?? null;

  const aside = !data ? null : outcome ? (
    <Tag tone={outcome.status === "COMPLETED" ? "ok" : outcome.status === "CANCELLED" ? "neutral" : "warn"}>
      {outcome.status === "COMPLETED" ? "已完成" : outcome.status === "CANCELLED" ? "已取消" : "需要你处理"}
    </Tag>
  ) : data.paused ? (
    <Tag tone="warn">已暂停</Tag>
  ) : (
    <Tag tone="accent" live={connected && data.nodes.some(node => node.status === "ACTIVE")}>{data.nodes.some(node => node.status === "ACTIVE") ? "执行中" : "等待执行"}</Tag>
  );
  const title = !data
    ? "Kern 正在推进"
    : outcome?.status === "COMPLETED"
      ? "Kern 已完成"
      : outcome?.status === "CANCELLED"
        ? "已取消"
        : outcome
          ? "这项工作停下了"
          : data.paused
            ? "已暂停"
            : "Kern 正在推进";
  const conclusion = data?.nodes.find((n) => n.kind === "SYNTHESIS")?.summary ?? null;
  const quick = async (body: Record<string, unknown>) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await control(body);
      if (!result.ok) setNotice(result.message ?? "操作失败，请重试");
    } finally { setBusy(false); }
  };

  return (
    <Card className="m-mission">
      <CardHead icon={<I.plan />} title={title} aside={aside} />
      <div className="m-card-body">
        {!data ? (
          <p className="m-hint">读取进展…</p>
        ) : (
          <>
            {data.demo ? <p className="m-ws-demo">演示模式 · 不调用模型、不写入业务数据</p> : null}
            <ExecutionFlow status={data} events={events} connected={connected} activity={data.outcome ? (data.outcome.status === "COMPLETED" ? "本轮工作已完成" : data.outcome.status === "CANCELLED" ? "本轮工作已取消" : "工作停下了，需要你处理") : data.paused ? "已暂停 · 当前步骤结束后停止派发" : currentActivity(data, events)} />
            {error ? <p className="m-hint" role="status">进展连接暂时中断，正在重新连接；下方保留最近状态。</p> : null}
            {notice ? <p className="m-ws-notice" data-t="bad" role="alert">{notice}</p> : null}
            {outcome?.status !== "CANCELLED" && data.pendingAsks?.length
              ? data.pendingAsks.map((a) => <AskCard key={a.askId} ask={a} control={control} canAbort={!outcome} />)
              : null}
            {outcome?.status === "COMPLETED" && conclusion ? (
              <blockquote className="m-conclusion">{plainExcerpt(conclusion, 200)}</blockquote>
            ) : null}
            {outcome?.status === "NEEDS_USER" ? (
              <ul className="m-reasons">{outcome.reasons.map((r) => <li key={r}>{reasonLabel(r)}</li>)}</ul>
            ) : null}
            <div className="m-card-actions">
              <Btn size="sm" v={outcome?.status === "COMPLETED" ? "default" : "primary"} onClick={() => setOpen("process")}>查看过程</Btn>
              {outcome?.status === "COMPLETED" ? <Btn size="sm" v="primary" onClick={() => setOpen("output")}>查看产出</Btn> : null}
              {!outcome && !data.paused ? <Btn size="sm" v="ghost" disabled={busy} onClick={() => quick({ action: "pause" })}>暂停</Btn> : null}
              {!outcome && data.paused ? <Btn size="sm" v="ghost" disabled={busy} onClick={() => quick({ action: "resume" })}>继续</Btn> : null}
              {outcome?.status === "NEEDS_USER" ? <Btn size="sm" v="ghost" disabled={busy} onClick={() => quick({ action: "resume" })}>继续推进</Btn> : null}
            </div>
          </>
        )}
      </div>
      {open && mounted
        ? createPortal(<MissionWorkspace missionId={missionId} initialTab={open} onClose={() => setOpen(null)} />, document.querySelector(".muse") ?? document.body)
        : null}
    </Card>
  );
}

export function plainExcerpt(md: string, max: number) {
  const text = md
    .split(/\n+/)
    .filter((l) => l.trim() && !/^\s*#/.test(l) && !/^\s*\|/.test(l))
    .join(" ")
    .replace(/\*\*|__|`|^[-*]\s+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max) + "…" : text;
}
