"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { agentLabel, currentActivity, nodeLabel, reasonLabel } from "../mission-timeline";
import { useMission } from "../use-mission";
import { Btn, Card, CardHead, I, Node, Tag } from "./kit";
import { MissionWorkspace, laneState } from "./mission-workspace";

/**
 * Live view of a Kern mission inside the conversation.
 * One card: what's happening now, steps in plain language, quick pause /
 * continue, and the way into the workspace (「过程」/「产出」).
 */
export function MissionCard({ missionId }: { missionId: string }) {
  const { status: data, error, control } = useMission(missionId, { withEvents: false });
  const [open, setOpen] = useState<null | "process" | "output">(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (error && !data) return null;
  const outcome = data?.outcome ?? null;
  const pct = data ? Math.round((data.progress.done / Math.max(1, data.progress.total)) * 100) : 0;
  const aside = !data ? null : outcome ? (
    <Tag tone={outcome.status === "COMPLETED" ? "ok" : outcome.status === "CANCELLED" ? "neutral" : "warn"}>
      {outcome.status === "COMPLETED" ? "已完成" : outcome.status === "CANCELLED" ? "已取消" : "需要你处理"}
    </Tag>
  ) : data.paused ? (
    <Tag tone="warn">已暂停</Tag>
  ) : (
    <Tag tone="accent" live>{data.progress.done}/{data.progress.total}</Tag>
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
  const visible = data ? (expanded || data.nodes.length <= 5 ? data.nodes : data.nodes.filter((n) => n.status === "ACTIVE" || n.status === "BLOCKED" || n.status === "FAILED").slice(0, 4)) : [];

  const quick = async (body: Record<string, unknown>) => {
    setBusy(true);
    await control(body);
    setBusy(false);
  };

  return (
    <Card className="m-mission">
      <CardHead icon={<I.plan />} title={title} aside={aside} />
      <div className="m-card-body">
        {!data ? (
          <p className="m-hint">读取进展…</p>
        ) : (
          <>
            {data.demo ? <p className="m-ws-demo">演示模式 · 不写入业务数据、不消耗额度</p> : null}
            <div className="m-progress" aria-label={`进度 ${pct}%`}><i style={{ width: `${pct}%` }} data-s={outcome?.status ?? (data.paused ? "PAUSED" : "RUNNING")} /></div>
            <p className="m-now">{currentActivity(data, [])}</p>
            {outcome?.status === "COMPLETED" && conclusion ? (
              <blockquote className="m-conclusion">{plainExcerpt(conclusion, 200)}</blockquote>
            ) : null}
            {outcome?.status === "NEEDS_USER" ? (
              <ul className="m-reasons">{outcome.reasons.map((r) => <li key={r}>{reasonLabel(r)}</li>)}</ul>
            ) : null}
            {visible.length ? (
              <ol className="m-plan">
                {visible.map((node) => (
                  <li key={node.key} className="m-step">
                    <Node state={laneState(node.status)} />
                    <div className="m-step-main">
                      <b>{nodeLabel(node.key)}</b>
                      {node.attempts > 1 ? <span>第 {node.attempts} 次（返工或重跑）</span> : null}
                      {node.status === "BLOCKED" ? <span>受阻，结论中按 UNKNOWN 处理</span> : null}
                      {node.status === "SKIPPED" ? <span>{reasonLabel(node.reason) ?? "已跳过"}</span> : null}
                    </div>
                    <span className="m-step-by">{agentLabel(node.agentCode)}</span>
                  </li>
                ))}
              </ol>
            ) : null}
            {data.nodes.length > 5 ? (
              <button type="button" className="m-link" onClick={() => setExpanded((v) => !v)}>
                {expanded ? "收起" : `全部 ${data.nodes.length} 个步骤`}
              </button>
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
