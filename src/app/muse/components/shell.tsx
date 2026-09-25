"use client";
/** 外壳：目标轨道、输入坞、空态。目标 = 一件你交给科恩去推进的事。 */
import { useRef } from "react";
import type { Mission, RuntimeStatus, StudioModel } from "../types";
import { Btn, I, StateTag } from "./kit";

export function Rail({
  user, missions, activeId, pendingCount, runtime, onPick, onNew, onTrust, onClose,
}: {
  user: StudioModel["user"];
  missions: Mission[];
  activeId: string | null;
  pendingCount: number;
  runtime: RuntimeStatus;
  onPick: (id: string | null) => void;
  onNew: () => void;
  onTrust: () => void;
  onClose: () => void;
}) {
  return (
    <nav className="m-rail" aria-label="目标">
      <div className="m-brand">
        <span className="m-brand-mark" aria-hidden>K</span>
        <b>科恩</b>
        <button type="button" className="m-btn m-rail-x" data-v="ghost" data-size="sm" onClick={onClose} aria-label="收起侧栏">
          <I.close />
        </button>
      </div>
      <button type="button" className="m-new" onClick={onNew}>
        <I.plus />
        交给科恩一件新的事
      </button>
      <div className="m-rail-scroll">
        <p className="m-rail-label">现在</p>
        <button type="button" className="m-goal" aria-current={activeId === null ? "true" : undefined} onClick={() => onPick(null)}>
          <span className="m-goal-title">今天</span>
          <span className="m-goal-sub">{pendingCount > 0 ? `${pendingCount} 件等你确认` : "没有待确认的事"}</span>
        </button>
        <p className="m-rail-label">目标</p>
        {missions.map((m) => (
          <button key={m.id} type="button" className="m-goal" aria-current={activeId === m.id ? "true" : undefined} onClick={() => onPick(m.id)}>
            <span className="m-goal-title">{m.title}</span>
            <span className="m-goal-sub">
              {[m.productName, m.progress === null ? "进度 UNKNOWN" : `已完成 ${m.progress}%`].filter(Boolean).join(" · ")}
            </span>
            <StateTag state={m.state} />
          </button>
        ))}
      </div>
      <div className="m-rail-foot">
        <button type="button" className="m-new" onClick={() => { window.location.href = "/manage"; }}>
          <I.plan />
          进入专业管理后台
        </button>
        <button type="button" className="m-me" onClick={onTrust}>
          <span className="m-me-av" aria-hidden>我</span>
          <span>
            <b>{user.name}</b>
            <small>{runtime.connected ? `已接入 ${runtime.host}` : "本机未接入"}</small>
          </span>
          <I.shield />
        </button>
      </div>
    </nav>
  );
}

export function Dock({
  value, onChange, onSend, sending, capabilities, onTrust,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  capabilities: string[];
  onTrust: () => void;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="m-dock">
      <form
        className="m-dock-inner"
        onSubmit={(e) => { e.preventDefault(); onSend(); }}
      >
        <textarea
          ref={ta}
          value={value}
          rows={1}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); }
          }}
          placeholder="说一件要做成的事，卡住我再找你"
          aria-label="对科恩说"
        />
        <div className="m-dock-bar">
          <button type="button" className="m-pill" onClick={onTrust}>
            <I.mac />
            {capabilities.length} 项本机能力
          </button>
          <span className="m-kbd">Enter 发送 · Shift+Enter 换行</span>
          <button type="submit" className="m-send" disabled={sending || value.trim().length === 0} aria-label="发送">
            <I.send />
          </button>
        </div>
      </form>
    </div>
  );
}

export function Blank({ seeds, onSeed }: { seeds: { id: string; title: string; why: string; prompt: string }[]; onSeed: (p: string) => void }) {
  return (
    <div className="m-blank">
      <span className="m-blank-orb" aria-hidden />
      <h2>今天想推进什么？</h2>
      <p>说结果就行，过程交给科恩。</p>
      <div className="m-seeds">
        {seeds.map((s) => (
          <button key={s.id} type="button" className="m-seed" onClick={() => onSeed(s.prompt)}>
            <b>{s.title}</b>
            <small>{s.why}</small>
          </button>
        ))}
      </div>
      <Btn size="sm" onClick={() => onSeed("")}>自己写</Btn>
    </div>
  );
}
