"use client";
/** 抽屉层：审计轨迹、来源详情、信任与权限、命令面板。Kern 的可信度来自这四块。 */
import { useEffect, useMemo, useState } from "react";
import type { ActivityItem, ConversationSummary, EvidenceRef, RuntimeStatus } from "../types";
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

/** 真实执行轨迹。计划属于 Work，不再从 Conversation 伪造“还没开始”的步骤。 */
export function TrailSheet({
  activity,
  onClose,
}: {
  activity: ActivityItem[];
  onClose: () => void;
}) {
  return (
    <Sheet title="轨迹" sub="Kern 与后台 Work 已经真实发生的执行记录" onClose={onClose}>
      {activity.length === 0 ? (
        <p className="m-quiet">当前没有可展示的真实执行轨迹。</p>
      ) : (
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
      {ref_.excerpt ? <blockquote className="m-quote">{ref_.excerpt}</blockquote> : <p className="m-quiet">没有可引用的原文片段，Kern 不会替它编一段。</p>}
      {ref_.confidence === "unknown" ? (
        <p className="m-hint">这条依然是 UNKNOWN。Kern 不会把它当成结论使用，只会提示你补齐。</p>
      ) : null}
    </Sheet>
  );
}

/** 运行与权限说明。当前 runtime 尚未提供细粒度权限持久化，因此这里必须只读。 */
export function TrustSheet({ runtime, onClose }: { runtime: RuntimeStatus; onClose: () => void }) {
  return (
    <Sheet title="运行与权限" sub={`${runtime.host} · ${runtime.connected ? "已连接" : "未连接"} · 最近心跳 ${runtime.lastHeartbeat}`} onClose={onClose}>
      <p className="m-quiet">
        Kern 当前只能展示服务端真实上报的连接与任务状态。细粒度本机能力授权尚未接入服务端，因此这里不提供会误导你的开关。
      </p>
      {runtime.capabilities.length > 0 ? (
        <div className="m-perms">
          {runtime.capabilities.map((c) => (
            <div key={c} className="m-perm">
              <div>
                <b>{c}</b>
                <small>由运行时真实上报</small>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="m-hint">当前运行时未上报细粒度能力清单。</p>
      )}
      <p className="m-hint">业务写入、审批与受保护动作仍按 Proposal / Approval / Governance 的真实规则执行。</p>
    </Sheet>
  );
}

export function Palette({ conversations, onClose, onPick }: { conversations: ConversationSummary[]; onClose: () => void; onPick: (id: string | null) => void }) {
  const [q, setQ] = useState("");
  const hits = useMemo(
    () => conversations.filter((conversation) => (conversation.title + conversation.preview + (conversation.productName || "")).toLowerCase().includes(q.toLowerCase())),
    [conversations, q],
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
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索最近对话" aria-label="搜索对话" />
        </div>
        <ul className="m-cmd-list">
          <li>
            <button type="button" onClick={() => { onPick(null); onClose(); }}>
              <I.spark /><b>新对话</b><small>交代一件新工作</small>
            </button>
          </li>
          {hits.map((conversation) => (
            <li key={conversation.id}>
              <button type="button" onClick={() => { onPick(conversation.id); onClose(); }}>
                <I.plan /><b>{conversation.title}</b><small>{conversation.productName}</small>
              </button>
            </li>
          ))}
          {hits.length === 0 ? <li><p className="m-quiet" style={{ padding: "10px 14px" }}>没有匹配的对话。</p></li> : null}
        </ul>
        <footer className="m-cmd-foot">
          <Btn size="sm" onClick={onClose}>关闭</Btn>
          <span className="m-hint">Esc 关闭 · ⌘K 呼出</span>
        </footer>
      </div>
    </>
  );
}

type MemoryItem = { id: string; kind: string; content: string; pinned: boolean; createdAt: string };
const MEMORY_KIND: Record<string, string> = { PREFERENCE: "偏好", FACT: "事实", DECISION: "决定", OUTCOME: "过往结论" };

/** Kern 记得的关于你：全部可见、可置顶、可忘记。 */
export function MemorySheet({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<MemoryItem[] | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    try {
      const r = await fetch("/api/memory", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      setItems(((await r.json()) as { items: MemoryItem[] }).items);
    } catch {
      setError("读取记忆失败");
      setItems([]);
    }
  };
  useEffect(() => { void load(); }, []);
  const forget = async (id: string) => {
    setItems((xs) => xs?.filter((x) => x.id !== id) ?? null);
    await fetch(`/api/memory/${id}`, { method: "DELETE" }).catch(() => undefined);
  };
  const pin = async (id: string, pinned: boolean) => {
    setItems((xs) => xs?.map((x) => (x.id === id ? { ...x, pinned } : x)) ?? null);
    await fetch(`/api/memory/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ pinned }) }).catch(() => undefined);
  };
  const add = async () => {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    const r = await fetch("/api/memory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content }) }).catch(() => null);
    if (r?.ok) void load();
    else setError("保存失败");
  };
  return (
    <Sheet title="Kern 的记忆" sub="Kern 会在之后的工作中参考这些。你可以置顶、删除，或直接告诉它“记住…”。" onClose={onClose}>
      <form className="m-mem-add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="例如：我们只做跨境电商，预算上限 5 万" maxLength={400} />
        <Btn size="sm" type="submit" disabled={!draft.trim()}>记住</Btn>
      </form>
      {error ? <p className="m-quiet">{error}</p> : null}
      {items === null ? (
        <p className="m-quiet">读取中…</p>
      ) : items.length === 0 ? (
        <p className="m-quiet">还没有记忆。完成的工作结论和你让它记住的偏好会出现在这里。</p>
      ) : (
        <ul className="m-mem">
          {items.map((m) => (
            <li key={m.id} data-pinned={m.pinned || undefined}>
              <Tag tone={m.kind === "PREFERENCE" ? "accent" : "neutral"}>{MEMORY_KIND[m.kind] ?? m.kind}</Tag>
              <p>{m.content}</p>
              <div className="m-mem-acts">
                <button type="button" onClick={() => void pin(m.id, !m.pinned)}>{m.pinned ? "取消置顶" : "置顶"}</button>
                <button type="button" onClick={() => void forget(m.id)}>忘掉</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
