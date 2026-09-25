"use client";
/** 抽屉层：审计轨迹、来源详情、信任与权限、命令面板。科恩的可信度来自这四块。 */
import { useEffect, useMemo, useState } from "react";
import type { ActivityItem, EvidenceRef, Mission, RuntimeStatus } from "../types";
import { Btn, CONF, I, Tag } from "./kit";

function Sheet({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <>
      <div className="m-scrim" onClick={onClose} />
      <aside className="m-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header className="m-sheet-head">
          <div>
            <h2>{title}</h2>
            {sub ? <p>{sub}</p> : null}
          </div>
          <button type="button" className="m-btn" data-v="ghost" data-size="sm" onClick={onClose} aria-label="关闭">
            <I.close />
          </button>
        </header>
        <div className="m-sheet-body">{children}</div>
      </aside>
    </>
  );
}

/** “科恩做过什么、接下来打算做什么” —— 完整可读的轨迹，不是日志。 */
export function TrailSheet({ activity, missions, onClose }: { activity: ActivityItem[]; missions: Mission[]; onClose: () => void }) {
  const planned = missions.flatMap((m) =>
    m.steps.filter((s) => s.state === "idle").map((s) => ({ id: `${m.id}-${s.id}`, title: s.title, mission: m.title })),
  );
  return (
    <Sheet title="轨迹" sub="科恩做过的每一步，以及接下来打算做的事" onClose={onClose}>
      <h3 className="m-sheet-sub">已经发生</h3>
      <ol className="m-trail">
        {activity.map((a) => (
          <li key={a.id}>
            <span className="m-trail-dot" data-s={a.state} aria-hidden><i /></span>
            <div className="m-trail-text">
              <b>{a.text}</b>
              <small>{a.at}</small>
            </div>
          </li>
        ))}
      </ol>
      <h3 className="m-sheet-sub">还没开始</h3>
      {planned.length === 0 ? (
        <p className="m-quiet">当前目标里没有待开始的步骤。</p>
      ) : (
        <ol className="m-trail">
          {planned.map((p) => (
            <li key={p.id}>
              <span className="m-trail-dot" data-s="idle" aria-hidden><i /></span>
              <div className="m-trail-text">
                <b>{p.title}</b>
                <small>{p.mission}</small>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Sheet>
  );
}

export function SourceSheet({ ref_, onClose }: { ref_: EvidenceRef; onClose: () => void }) {
  const c = CONF[ref_.confidence];
  const kind = { internal: "内部资料", literature: "公开文献", runtime: "本机执行回执", human: "人工提供" }[ref_.kind];
  return (
    <Sheet title="来源" sub={ref_.title} onClose={onClose}>
      <div className="m-kv">
        <i>可信度</i><span><Tag tone={c.tone}>{c.label}</Tag></span>
        <i>类型</i><span>{kind}</span>
        <i>出处</i><span>{ref_.source}</span>
        <i>采集时间</i><span>{ref_.capturedAt}</span>
        <i>复核</i><span>{ref_.verified ? "已由独立 QA 复核" : "尚未复核"}</span>
      </div>
      {ref_.excerpt ? <blockquote className="m-quote">{ref_.excerpt}</blockquote> : <p className="m-quiet">没有可引用的原文片段，科恩不会替它编一段。</p>}
      {ref_.confidence === "unknown" ? (
        <p className="m-hint">这条依然是 UNKNOWN。科恩不会把它当成结论使用，只会提示你补齐。</p>
      ) : null}
    </Sheet>
  );
}

/** 逐能力授权：科恩能碰什么，由你一项一项决定。 */
export function TrustSheet({ runtime, onClose }: { runtime: RuntimeStatus; onClose: () => void }) {
  const [on, setOn] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(runtime.capabilities.map((c, i) => [c, i < 4])),
  );
  return (
    <Sheet title="信任与权限" sub={`${runtime.host} · ${runtime.connected ? "已连接" : "未连接"} · 最近心跳 ${runtime.lastHeartbeat}`} onClose={onClose}>
      <p className="m-quiet">科恩只会用你打开的能力。关掉的项目，它会改成先问你。</p>
      <div className="m-perms">
        {runtime.capabilities.map((c) => (
          <div key={c} className="m-perm">
            <div>
              <b>{c}</b>
              <small>{on[c] ? "可自行使用" : "每次都要先问你"}</small>
            </div>
            <button
              type="button"
              className="m-switch"
              role="switch"
              aria-checked={on[c] ? "true" : "false"}
              aria-label={c}
              onClick={() => setOn((p) => ({ ...p, [c]: !p[c] }))}
            >
              <span aria-hidden />
            </button>
          </div>
        ))}
      </div>
      <p className="m-hint">写业务数据永远不在这张表里 —— 那类改动一律走确认卡片。</p>
    </Sheet>
  );
}

export function Palette({ missions, onClose, onPick }: { missions: Mission[]; onClose: () => void; onPick: (id: string | null) => void }) {
  const [q, setQ] = useState("");
  const hits = useMemo(
    () => missions.filter((m) => (m.title + m.goal + m.productName).toLowerCase().includes(q.toLowerCase())),
    [missions, q],
  );
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <>
      <div className="m-scrim" onClick={onClose} />
      <div className="m-cmd" role="dialog" aria-modal="true" aria-label="跳转">
        <div className="m-cmd-in">
          <I.search />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="跳到某个目标，或输入要做的事" aria-label="搜索目标" />
        </div>
        <ul className="m-cmd-list">
          <li>
            <button type="button" onClick={() => { onPick(null); onClose(); }}>
              <I.spark /><b>今天</b><small>需要你决定的事</small>
            </button>
          </li>
          {hits.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => { onPick(m.id); onClose(); }}>
                <I.plan /><b>{m.title}</b><small>{m.productName}</small>
              </button>
            </li>
          ))}
          {hits.length === 0 ? <li><p className="m-quiet" style={{ padding: "10px 14px" }}>没有匹配的目标。直接回车让科恩把它当新目标。</p></li> : null}
        </ul>
        <footer className="m-cmd-foot">
          <Btn size="sm" onClick={onClose}>关闭</Btn>
          <span className="m-hint">Esc 关闭 · ⌘K 呼出</span>
        </footer>
      </div>
    </>
  );
}
