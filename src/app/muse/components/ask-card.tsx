"use client";

import { useRef, useState } from "react";
import { nodeLabel, type MissionStatusView } from "../mission-timeline";
import { Btn } from "./kit";

type Ask = NonNullable<MissionStatusView["pendingAsks"]>[number];

/**
 * KX-51b：步骤中途的提问（不阻塞）。步骤已经按默认假设在做；
 * 回答后以回答为准重做这一步（任务已完成也会重新打开），并记住答案。
 */
export function AskCard({
  ask,
  control,
  canAbort = true,
}: {
  ask: Ask;
  control: (body: Record<string, unknown>) => Promise<{ ok: boolean; message?: string }>;
  canAbort?: boolean;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmAbort, setConfirmAbort] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const quickReply = (preset: string) => {
    setText(preset);
    inputRef.current?.focus();
  };
  const approve = async (allow: boolean) => {
    setBusy(true);
    const r = await control({ action: "approve", askId: ask.askId, allow });
    setBusy(false);
    if (!r.ok) setMsg(r.message ?? "没有提交成功，请重试");
  };
  if (ask.approval) {
    // KX-31b：连接器写操作的审批卡。「允许一次」只对这一次、完全相同的输入有效。
    return (
      <div className="m-ask" role="group" aria-label="操作审批">
        <p className="m-ask-q">
          <b>{ask.nodeKey ? `「${nodeLabel(ask.nodeKey)}」需要你批准` : "需要你批准"}</b>
          {ask.question}
        </p>
        <pre className="m-ask-def m-ask-input">{ask.approval.inputPreview}</pre>
        <p className="m-ask-def">这会写入外部系统（{ask.approval.connector}）。允许一次后，Kern 会用完全相同的内容重做这一步；内容变了需要重新批准。</p>
        <div className="m-card-actions">
          <Btn size="sm" v="primary" disabled={busy} onClick={() => approve(true)}>允许一次</Btn>
          <Btn size="sm" v="ghost" disabled={busy} onClick={() => approve(false)}>不允许</Btn>
        </div>
        {msg ? <p className="m-hint" role="alert">{msg}</p> : null}
      </div>
    );
  }
  const send = async (mode: "answer" | "ignore" | "abort") => {
    setBusy(true);
    const r = await control({ action: "answer", askId: ask.askId, mode, text: mode === "answer" ? text.trim() : undefined });
    setBusy(false);
    if (!r.ok) setMsg(r.message ?? "没有提交成功，请重试");
  };
  return (
    <div className="m-ask" role="group" aria-label="步骤提问">
      <p className="m-ask-q">
        <b>{ask.nodeKey ? `「${nodeLabel(ask.nodeKey)}」问你` : "Kern 问你"}</b>
        {ask.question}
      </p>
      <p className="m-ask-def">我先按这个假设在做：{ask.defaultAssumption}。回答后会按你的答案重做这一步，并记住。</p>
      <div className="m-ask-quick">
        <span aria-hidden>快捷回复：</span>
        <Btn size="sm" v="ghost" disabled={busy} onClick={() => quickReply("换一个方案，不要用当前假设。")}>换个方案</Btn>
        <Btn size="sm" v="ghost" disabled={busy} onClick={() => quickReply("展开说明一下，我再决定。")}>展开说说</Btn>
      </div>
      <textarea
        ref={inputRef}
        className="m-ask-in"
        rows={2}
        value={text}
        maxLength={2000}
        placeholder="你的回答"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) void send("answer");
        }}
      />
      <div className="m-card-actions">
        <Btn size="sm" v="primary" disabled={busy || !text.trim()} onClick={() => send("answer")}>回答</Btn>
        <Btn size="sm" v="ghost" disabled={busy} onClick={() => send("ignore")}>假设没问题</Btn>
        {!canAbort ? null : confirmAbort ? (
          <>
            <Btn size="sm" v="ghost" disabled={busy} onClick={() => send("abort")}>确认中止整个任务</Btn>
            <Btn size="sm" v="ghost" disabled={busy} onClick={() => setConfirmAbort(false)}>算了</Btn>
          </>
        ) : (
          <Btn size="sm" v="ghost" disabled={busy} onClick={() => setConfirmAbort(true)}>中止任务</Btn>
        )}
      </div>
      {msg ? <p className="m-hint" role="alert">{msg}</p> : null}
    </div>
  );
}
