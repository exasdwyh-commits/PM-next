"use client";
/** 抽屉层：审计轨迹、来源详情、信任与权限、命令面板。Kern 的可信度来自这四块。 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { fmtDateTime } from "@/shared/datetime";
import { WorkerNotice } from "./worker-notice";
import { notifyState, setNotifyEnabled, type NotifyState } from "../desktop-notify";
import type { ActivityItem, ConversationSummary, EvidenceRef, RuntimeStatus } from "../types";
import { Btn, CONF, I, StatefulBtn, Tag } from "./kit";
import { useDialog } from "@/components/use-dialog";
import { toggleDetails } from "@/components/motion/collapse";
import { MOTION, play } from "@/components/motion/motion";
import { useExitAnimation, useHeightMorph, type BtnState } from "@/components/motion/react";
import { useListFlip } from "@/components/motion/list";
import { Sheet } from "./sheet";
import { Prose } from "./prose";
export { Sheet } from "./sheet";

async function requestSheet(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message || body?.error?.message || "操作失败，请重试");
  }
  return response;
}

/**
 * 面板内的写操作：同一时间只跑一个（防重复请求），失败保留输入并给出错误。
 * 传入 key 时记录是哪个按钮发起的：busy → done（接口确认成功后）/ error → 自动回到 idle，
 * 供 StatefulBtn 和行内按钮显示处理中、成功、失败。
 */
function useSheetMutation(setError: (error: string | null) => void) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<{ key: string; state: BtnState } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const run = async (operation: () => Promise<unknown>, key?: string) => {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError(null);
    if (timer.current) clearTimeout(timer.current);
    setAction(key ? { key, state: "busy" } : null);
    let ok = false;
    try { await operation(); ok = true; }
    catch (error) { setError(error instanceof Error ? error.message : "网络连接失败，请重试"); }
    finally {
      pending.current = false;
      setBusy(false);
      if (key) {
        setAction({ key, state: ok ? "done" : "error" });
        timer.current = setTimeout(() => setAction(null), ok ? 1600 : 2400);
      }
    }
    return ok;
  };
  const stateOf = (key: string): BtnState => (action?.key === key ? action.state : "idle");
  /** 行内小按钮的状态属性：样式见 muse.css「面板行内按钮」。 */
  const rowState = (key: string) => {
    const state = stateOf(key);
    return { "data-state": state === "idle" ? undefined : state, "aria-busy": state === "busy" || undefined };
  };
  return { busy, run, stateOf, rowState };
}

function SheetSectionTitle({ title, count }: { title: string; count?: number }) {
  return <div className="m-sheet-section-title"><h3>{title}</h3>{count !== undefined ? <span>{count} 项</span> : null}</div>;
}

/** 首次读取时的骨架（KX-28）：只在真的在读取时出现，形状接近真实卡片，读完直接换成内容。 */
function SheetSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="m-skel" role="status">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="m-skel-card" aria-hidden><span /><span /><span /></div>)}
      <span className="m-sr">读取中…</span>
    </div>
  );
}

const byPinned = (a: { pinned: boolean; createdAt: string }, b: { pinned: boolean; createdAt: string }) =>
  Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt);

function SheetText({ text, title = false }: { text: string; title?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  // 展开 / 收起：高度平滑过渡，后面的卡片跟着移位；收起时按钮若已滚出视野先拉回来。
  const captureHeight = useHeightMorph(boxRef, toggleRef);
  const preview = text.replace(/#{1,6}\s+/g, "").replace(/(\*\*|__|`|~~)/g, "").replace(/\s+/g, " ").trim();
  const long = preview.length > (title ? 70 : 130) || text.split("\n").length > 4;
  return <div className="m-sheet-text">
    <div id={id} ref={boxRef}>
      {expanded || (!title && !long) ? <Prose text={text} variant="compact" /> : <p className="m-sheet-text-preview" data-title={title || undefined}>{preview}</p>}
    </div>
    {long ? <button ref={toggleRef} type="button" className="m-sheet-more" aria-expanded={expanded} aria-controls={id} onClick={() => { captureHeight(); setExpanded(value => !value); }}>
      {expanded ? "收起" : title ? "查看完整标题" : "展开全文"}
    </button> : null}
  </div>;
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
    <Sheet title="轨迹" sub="Kern 与后台 Work 已经真实发生的执行记录" utility="trail" onClose={onClose}>
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const { closing, requestClose } = useExitAnimation(onClose, () => {
    const opts = { key: "exit", duration: MOTION.fast, easing: MOTION.easePress, fill: "forwards" as const };
    return [
      play(dialogRef.current, [{ opacity: 0, transform: "translateX(-50%) translateY(6px) scale(.98)" }], opts),
      play(scrimRef.current, [{ opacity: 0 }], opts),
    ];
  });
  useDialog(dialogRef, requestClose);
  const hits = useMemo(
    () => conversations.filter((conversation) => (conversation.title + conversation.preview + (conversation.productName || "")).toLowerCase().includes(q.toLowerCase())),
    [conversations, q],
  );
  return (
    <>
      <div ref={scrimRef} className="m-scrim" data-dialog-scrim data-closing={closing || undefined} onClick={requestClose} />
      <div ref={dialogRef} tabIndex={-1} className="m-cmd" data-closing={closing || undefined} role="dialog" aria-modal="true" aria-label="跳转">
        <div className="m-cmd-in">
          <I.search />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索最近对话" aria-label="搜索对话" />
        </div>
        <ul className="m-cmd-list">
          <li>
            <button type="button" onClick={() => { onPick(null); requestClose(); }}>
              <I.spark /><b>新对话</b><small>交代一件新工作</small>
            </button>
          </li>
          {hits.map((conversation) => (
            <li key={conversation.id}>
              <button type="button" onClick={() => { onPick(conversation.id); requestClose(); }}>
                <I.plan /><b>{conversation.title}</b><small>{conversation.productName}</small>
              </button>
            </li>
          ))}
          {hits.length === 0 ? <li><p className="m-quiet" style={{ padding: "10px 14px" }}>没有匹配的对话。</p></li> : null}
        </ul>
        <footer className="m-cmd-foot">
          <Btn size="sm" onClick={requestClose}>关闭</Btn>
          <span className="m-hint">Esc 关闭 · ⌘K 呼出</span>
        </footer>
      </div>
    </>
  );
}

type MemoryItem = { id: string; kind: string; content: string; pinned: boolean; createdAt: string };
const MEMORY_KIND: Record<string, string> = { PREFERENCE: "偏好", FACT: "事实", DECISION: "决定", OUTCOME: "过往结论", CORRECTION: "纠正" };

/** Kern 记得的关于你：全部可见、可置顶、可忘记。 */
type PlaybookItem = { id: string; name: string; sourceGoal: string; useCount: number; successCount: number; acceptedStreak?: number };

/** KX-74：每周复盘——建议只在你点「采纳」后生效。 */
type ReviewData = {
  summary: { runs: number; completed: number; accepted: number; avgHumanInterventions: number | null; avgReworkRounds: number | null; modelCalls: number };
  proposals: { id: string; kind: string; title: string; reason: string; apply: Record<string, unknown> & { op: string } }[];
};
const PROPOSAL_KIND: Record<string, string> = { charter: "章程", memory: "记忆", playbook: "做法" };
function WeeklyReview() {
  const [data, setData] = useState<ReviewData | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const [hidden, setHidden] = useState<Record<string, true>>({});
  useEffect(() => {
    fetch("/api/reviews/weekly", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ReviewData | null) => setData(d))
      .catch(() => setData(null));
  }, []);
  const accept = async (p: ReviewData["proposals"][number]) => {
    const r = await fetch("/api/reviews/weekly", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p.apply) }).catch(() => null);
    const body = r ? ((await r.json().catch(() => ({}))) as { applied?: string; error?: { message?: string } }) : null;
    setDone((d) => ({ ...d, [p.id]: r?.ok ? body?.applied ?? "已采纳" : body?.error?.message ?? "没能采纳" }));
  };
  if (!data) return null;
  const s = data.summary;
  const open = data.proposals.filter((p) => !hidden[p.id]);
  return (
    <section className="m-playbooks" aria-label="本周复盘">
      <SheetSectionTitle title="本周复盘" />
      <dl className="m-sheet-stats">
        <div><dt>执行任务</dt><dd>{s.runs}<small>项</small></dd></div>
        <div><dt>已完成</dt><dd>{s.completed}<small>项</small></dd></div>
        <div><dt>验收通过</dt><dd>{s.accepted}<small>项</small></dd></div>
      </dl>
      <p className="m-quiet">
        {s.runs === 0 ? "过去 7 天没有跑过任务。" : `过去 7 天${s.avgHumanInterventions === null ? "" : `，平均人工介入 ${s.avgHumanInterventions} 次、返工 ${s.avgReworkRounds ?? 0} 轮`}，模型调用 ${s.modelCalls} 次。`}
      </p>
      {open.length === 0 ? <p className="m-quiet">没有需要你决定的建议。</p> : (
        <ul className="m-mem">
          {open.map((p) => (
            <li key={p.id}>
              <Tag tone={p.kind === "charter" ? "accent" : "neutral"}>{PROPOSAL_KIND[p.kind] ?? p.kind}</Tag>
              <p>{p.title}<span className="m-quiet">{` · ${p.reason}`}</span></p>
              <div className="m-mem-acts">
                {done[p.id] ? <span className="m-quiet">{done[p.id]}</span> : p.apply.op === "note" ? null : (
                  <button type="button" onClick={() => void accept(p)}>采纳</button>
                )}
                <button type="button" onClick={() => setHidden((h) => ({ ...h, [p.id]: true }))}>忽略</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** KX-36：保存的做法——重命名 / 删除。 */
function PlaybookList() {
  const [items, setItems] = useState<PlaybookItem[] | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useSheetMutation(setError);
  useEffect(() => {
    fetch("/api/playbooks", { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error("读取失败"); return r.json(); })
      .then((d: { items: PlaybookItem[] }) => setItems(d.items))
      .catch(() => { setItems([]); setError("读取做法失败，请重新打开记忆重试"); });
  }, []);
  const rename = async () => {
    if (!editing?.name.trim()) return;
    const { id, name } = editing;
    await run(async () => {
      await requestSheet(`/api/playbooks/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      setEditing(null);
      setItems((xs) => xs?.map((x) => (x.id === id ? { ...x, name: name.trim() } : x)) ?? null);
    });
  };
  const remove = async (id: string) => {
    await run(async () => {
      await requestSheet(`/api/playbooks/${id}`, { method: "DELETE" });
      setItems((xs) => xs?.filter((x) => x.id !== id) ?? null);
    });
  };
  if (!items?.length && !error) return null;
  return (
    <section className="m-playbooks" aria-label="保存的做法">
      <SheetSectionTitle title="保存的做法" count={items?.length} />
      {error ? <p className="m-quiet" role="alert">{error}</p> : null}
      <p className="m-quiet">说类似的事时，Kern 会按这些做法拆计划；简报里可以选择不用。</p>
      <ul className="m-mem">
        {items?.map((p) => (
          <li key={p.id}>
            <Tag tone="accent">做法</Tag>
            {editing?.id === p.id ? (
              <form onSubmit={(e) => { e.preventDefault(); void rename(); }}>
                <input value={editing.name} disabled={busy} onChange={(e) => setEditing({ id: p.id, name: e.target.value })} maxLength={80} aria-label="做法名称" autoFocus />
              </form>
            ) : (
              <div className="m-sheet-card-copy"><p><strong>{p.name}</strong></p><p className="m-sheet-meta">{`用过 ${p.useCount} 次 · 顺利 ${p.successCount} 次${p.acceptedStreak ? ` · 连续验收 ${p.acceptedStreak} 次` : ""}`}</p></div>
            )}
            <div className="m-mem-acts">
              {editing?.id === p.id ? <button type="button" disabled={busy} onClick={() => void rename()}>保存</button> : <button type="button" disabled={busy} onClick={() => setEditing({ id: p.id, name: p.name })}>改名</button>}
              <button type="button" disabled={busy} onClick={() => void remove(p.id)}>删除</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MemorySheet({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<MemoryItem[] | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { busy, run, stateOf, rowState } = useSheetMutation(setError);
  const listRef = useRef<HTMLUListElement>(null);
  useListFlip(listRef);
  const load = async () => {
    setError(null);
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
    await run(async () => {
      await requestSheet(`/api/memory/${id}`, { method: "DELETE" });
      setItems((xs) => xs?.filter((x) => x.id !== id) ?? null);
    }, `forget:${id}`);
  };
  const pin = async (id: string, pinned: boolean) => {
    await run(async () => {
      await requestSheet(`/api/memory/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ pinned }) });
      // 和服务端同序（置顶在前、新的在前）：被置顶的那条滑到顶部，取消置顶的滑回原位。
      setItems((xs) => xs?.map((x) => (x.id === id ? { ...x, pinned } : x)).sort(byPinned) ?? null);
    }, `pin:${id}`);
  };
  const add = async () => {
    const content = draft.trim();
    if (!content) return;
    await run(async () => {
      await requestSheet("/api/memory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content }) });
      setDraft("");
      await load();
    }, "add");
  };
  return (
    <Sheet title="Kern 的记忆" sub="Kern 会在之后的工作中参考这些。你可以置顶、删除，或直接告诉它“记住…”。" utility="memory" onClose={onClose}>
      <form className="m-mem-add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <label className="m-sheet-form-label" htmlFor="m-memory-draft">新增记忆</label>
        <div className="m-sheet-input-action">
        <input id="m-memory-draft" value={draft} disabled={busy} aria-label="新增记忆" onChange={(e) => setDraft(e.target.value)} placeholder="例如：只做跨境电商，预算上限 5 万" maxLength={400} />
        <StatefulBtn size="sm" type="submit" state={stateOf("add")} disabled={!draft.trim() || busy}>记住</StatefulBtn>
        </div>
      </form>
      {error ? <p className="m-quiet" role="alert">{error} <button type="button" disabled={busy} onClick={() => void load()}>重新读取</button></p> : null}
      <section className="m-sheet-section">
      <SheetSectionTitle title="已保存的记忆" count={items?.length} />
      {items === null ? (
        <SheetSkeleton />
      ) : items.length === 0 ? (
        <p className="m-quiet">还没有记忆。完成的工作结论和你让它记住的偏好会出现在这里。</p>
      ) : (
        <ul className="m-mem" ref={listRef}>
          {items.map((m) => (
            <li key={m.id} data-key={m.id} data-pinned={m.pinned || undefined}>
              <div className="m-sheet-card-head"><Tag tone={m.kind === "PREFERENCE" ? "accent" : "neutral"}>{MEMORY_KIND[m.kind] ?? m.kind}</Tag>{m.pinned ? <span className="m-sheet-meta">已置顶</span> : null}</div>
              <SheetText text={m.content} />
              <div className="m-mem-acts">
                <button type="button" disabled={busy} {...rowState(`pin:${m.id}`)} onClick={() => void pin(m.id, !m.pinned)}>{m.pinned ? "取消置顶" : "置顶"}</button>
                <button type="button" disabled={busy} {...rowState(`forget:${m.id}`)} onClick={() => void forget(m.id)}>忘掉</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      </section>
      <WeeklyReview />
      <PlaybookList />
    </Sheet>
  );
}

type VaultItem = { id: string; target: string; label: string; hint: string; oneTime: boolean; expiresAt: string | null; status: string; useCount: number; lastUsedAt: string | null; devKey: boolean };
const VAULT_STATUS: Record<string, string> = { ACTIVE: "可用", EXPIRED: "已过期", USED: "已用过", REVOKED: "已撤销" };
const TTL_OPTIONS: Array<[string, number | null]> = [["长期", null], ["1 小时", 3600], ["1 天", 86400], ["30 天", 30 * 86400]];

/** 凭证保管：Kern 只在调用对应服务时注入，永不在聊天或文件里显示。 */
export function VaultSheet({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<VaultItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { busy, run, stateOf, rowState } = useSheetMutation(setError);
  const [target, setTarget] = useState("");
  const [label, setLabel] = useState("");
  const [headers, setHeaders] = useState<Array<{ name: string; value: string }>>([{ name: "Authorization", value: "" }]);
  const [ttl, setTtl] = useState(0);
  const [oneTime, setOneTime] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  useListFlip(listRef);
  const load = async () => {
    setError(null);
    try {
      const r = await fetch("/api/vault", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      setItems(((await r.json()) as { items: VaultItem[] }).items);
    } catch {
      setError("读取凭证失败");
      setItems([]);
    }
  };
  useEffect(() => { void load(); }, []);
  const setHeader = (k: number, patch: Partial<{ name: string; value: string }>) =>
    setHeaders((hs) => hs.map((h, i) => (i === k ? { ...h, ...patch } : h)));
  const save = async () => {
    await run(async () => {
    await requestSheet("/api/vault", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, label, headers: headers.filter((h) => h.name.trim() || h.value), ttlSeconds: TTL_OPTIONS[ttl][1], oneTime }),
    });
      setTarget("");
      setLabel("");
      setHeaders([{ name: "Authorization", value: "" }]);
      setOneTime(false);
      await load();
    }, "save");
  };
  const revoke = async (id: string) => {
    await run(async () => {
      await requestSheet(`/api/vault/${id}`, { method: "DELETE" });
      setItems((xs) => xs?.map((x) => (x.id === id ? { ...x, status: "REVOKED" } : x)) ?? null);
    }, `revoke:${id}`);
  };
  const canSave = target.trim() && headers.some((h) => h.name.trim() && h.value);
  return (
    <Sheet title="凭证保管" sub="只在调用对应服务时注入，不会出现在聊天、文件或模型上下文里。使用有记录，可随时撤销。" utility="vault" onClose={onClose}>
      <details className="m-sheet-compose">
        <summary onClick={toggleDetails}><I.plus /><span>保管新凭证</span><span className="m-sheet-disclosure" aria-hidden>⌄</span></summary>
      <form className="m-vault-add" onSubmit={(e) => { e.preventDefault(); if (canSave) void save(); }} autoComplete="off">
        <fieldset className="m-form-fields" disabled={busy}>
        <div className="m-sheet-form-grid">
          <label className="m-sheet-field">目标服务
          <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="目标，如 api.example.com 或 connector:notion" aria-label="目标" />
          </label>
          <label className="m-sheet-field">名称（可选）
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="名称（可选）" maxLength={60} aria-label="名称" />
          </label>
        </div>
        {headers.map((h, k) => (
          <div className="m-sheet-form-grid" key={k}>
            <label className="m-sheet-field">Header 名
            <input value={h.name} onChange={(e) => setHeader(k, { name: e.target.value })} placeholder="Header 名" aria-label="Header 名" />
            </label>
            <label className="m-sheet-field">Header 值
            <input type="password" value={h.value} onChange={(e) => setHeader(k, { value: e.target.value })} placeholder="值（保存后不再显示）" aria-label="Header 值" autoComplete="new-password" />
            </label>
          </div>
        ))}
        <div className="m-sheet-form-actions">
          {headers.length < 8 ? <button type="button" onClick={() => setHeaders((hs) => [...hs, { name: "", value: "" }])}>+ 再加一个 header</button> : null}
        </div>
        <div className="m-sheet-form-grid">
          <label className="m-sheet-field">有效期
          <select value={ttl} onChange={(e) => setTtl(Number(e.target.value))} aria-label="有效期">
            {TTL_OPTIONS.map(([t], i) => <option key={t} value={i}>{t}</option>)}
          </select>
          </label>
          <label className="m-sheet-check"><input type="checkbox" checked={oneTime} onChange={(e) => setOneTime(e.target.checked)} /> 只用一次</label>
        </div>
        <div className="m-sheet-form-actions"><StatefulBtn size="sm" v="primary" type="submit" state={stateOf("save")} disabled={!canSave || busy}>保管</StatefulBtn></div>
        </fieldset>
      </form>
      </details>
      {error ? <p className="m-quiet" role="alert">{error} <button type="button" disabled={busy} onClick={() => void load()}>重新读取</button></p> : null}
      <section className="m-sheet-section">
      <SheetSectionTitle title="已保管的凭证" count={items?.length} />
      {items === null ? (
        <SheetSkeleton />
      ) : items.length === 0 ? (
        <p className="m-quiet">还没有保管凭证。Kern 需要访问某个服务时，会请你在这里录入。</p>
      ) : (
        <ul className="m-mem" ref={listRef}>
          {items.map((c) => (
            <li key={c.id} data-key={c.id} data-pinned={c.status === "ACTIVE" || undefined}>
              <div className="m-sheet-card-head"><strong>{c.label || c.target}</strong><Tag tone={c.status === "ACTIVE" ? "ok" : "neutral"}>{VAULT_STATUS[c.status] ?? c.status}</Tag></div>
              <p className="m-sheet-target">{c.target}</p>
              <div className="m-sheet-card-copy">
                <p className="m-sheet-meta">{c.hint}</p>
                <div className="m-sheet-meta-row"><span>用过 {c.useCount} 次</span>{c.oneTime ? <span>一次性</span> : null}{c.devKey ? <span>开发密钥</span> : null}</div>
                <p className="m-sheet-meta">{c.expiresAt ? `到期 ${fmtDateTime(c.expiresAt)}` : "长期有效"}</p>
              </div>
              {c.status === "ACTIVE" ? (
                <div className="m-mem-acts">
                  <button type="button" disabled={busy} {...rowState(`revoke:${c.id}`)} onClick={() => void revoke(c.id)}>撤销</button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      </section>
    </Sheet>
  );
}

type ConnTool = { name: string; title: string; description: string; effect: "read" | "write"; enabled: boolean };
type ConnAccess = "off" | "read" | "interact" | "custom";
type ConnItem = { id: string; name: string; url: string; host: string; tools: ConnTool[]; access?: ConnAccess; lastError: string | null; refreshedAt: string | null };

/** 连接器：接入 MCP 服务器，Kern 自动拿到它的工具。读默认可用，写需你打开且每次仍要确认。 */
const CONN_ACCESS: Array<{ id: Exclude<ConnAccess, "custom">; label: string; hint: string }> = [
  { id: "off", label: "关闭", hint: "Kern 不会使用这个连接器" },
  { id: "read", label: "只读", hint: "只能读取，不能改动任何东西" },
  { id: "interact", label: "读写交互", hint: "可读可写；每次写入前仍会先问你" },
];

export function ConnectorSheet({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<ConnItem[] | null>(null);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { busy, run, stateOf, rowState } = useSheetMutation(setError);
  const load = async () => {
    setError(null);
    try {
      const r = await fetch("/api/connectors", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      setItems(((await r.json()) as { items: ConnItem[] }).items);
    } catch {
      setError("读取连接器失败");
      setItems([]);
    }
  };
  useEffect(() => { void load(); }, []);
  const add = async () => {
    await run(async () => {
      await requestSheet("/api/connectors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url, name }) });
      setUrl("");
      setName("");
      await load();
    }, "add");
  };
  const patch = async (id: string, body: Record<string, unknown>, key: string) => {
    await run(async () => {
      const r = await requestSheet(`/api/connectors/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const item = ((await r.json()) as { item: ConnItem }).item;
      setItems((xs) => xs?.map((x) => (x.id === id ? item : x)) ?? null);
    }, key);
  };
  const remove = async (id: string) => {
    await run(async () => {
      await requestSheet(`/api/connectors/${id}`, { method: "DELETE" });
      setItems((xs) => xs?.filter((x) => x.id !== id) ?? null);
    }, `remove:${id}`);
  };
  return (
    <Sheet title="连接器" sub="接入外部工具。读取默认可用，写入需开启且每次仍需确认；需要登录时，请先在「凭证」里保管同一主机的凭证。" utility="connectors" onClose={onClose}>
      <details className="m-sheet-compose">
        <summary onClick={toggleDetails}><I.plus /><span>接入新连接器</span><span className="m-sheet-disclosure" aria-hidden>⌄</span></summary>
      <form className="m-vault-add" onSubmit={(e) => { e.preventDefault(); if (url.trim() && !busy) void add(); }}>
        <label className="m-sheet-field">MCP 地址
          <input value={url} disabled={busy} onChange={(e) => setUrl(e.target.value)} placeholder="MCP 地址，如 https://mcp.example.com/mcp" aria-label="MCP 地址" />
        </label>
        <label className="m-sheet-field">名称（可选）
          <input value={name} disabled={busy} onChange={(e) => setName(e.target.value)} placeholder="名称（可选）" maxLength={40} aria-label="名称" />
        </label>
        <div className="m-sheet-form-actions"><StatefulBtn size="sm" v="primary" type="submit" state={stateOf("add")} disabled={!url.trim() || busy}>{stateOf("add") === "busy" ? "连接中…" : "接入"}</StatefulBtn></div>
      </form>
      </details>
      {error ? <p className="m-quiet" role="alert">{error} <button type="button" disabled={busy} onClick={() => void load()}>重新读取</button></p> : null}
      <section className="m-sheet-section">
      <SheetSectionTitle title="已接入的服务" count={items?.length} />
      {items === null ? (
        <SheetSkeleton />
      ) : items.length === 0 ? (
        <p className="m-quiet">还没有连接器。</p>
      ) : (
        items.map((c) => (
          <section key={c.id} className="m-conn">
            <header className="m-sheet-card-head">
              <div className="m-sheet-card-copy"><strong>{c.name}</strong><p className="m-sheet-meta">{c.host}</p></div>
              <div className="m-sheet-inline-actions">
              <button type="button" disabled={busy} {...rowState(`refresh:${c.id}`)} onClick={() => void patch(c.id, { refresh: true }, `refresh:${c.id}`)}>刷新</button>
              <button type="button" disabled={busy} {...rowState(`remove:${c.id}`)} onClick={() => void remove(c.id)}>移除</button>
              </div>
            </header>
            <div className="m-conn-access">
              <div className="m-seg" role="radiogroup" aria-label={`${c.name} 的权限`}>
                {CONN_ACCESS.map((a) => (
                  <button key={a.id} type="button" disabled={busy} role="radio" aria-checked={c.access === a.id} title={a.hint} {...rowState(`access:${c.id}:${a.id}`)} onClick={() => { if (c.access !== a.id) void patch(c.id, { access: a.id }, `access:${c.id}:${a.id}`); }}>
                    {a.label}
                  </button>
                ))}
              </div>
              <span className="m-quiet">{c.access === "custom" ? "自定义：下面逐个工具设置" : CONN_ACCESS.find((a) => a.id === c.access)?.hint ?? ""}</span>
            </div>
            {c.lastError ? <p className="m-sheet-inline-error">上次刷新失败：{c.lastError}</p> : null}
            {c.tools.length ? <details className="m-conn-tools">
              <summary onClick={toggleDetails}><span>工具清单</span><span className="m-sheet-meta">{c.tools.filter(t => t.enabled).length} / {c.tools.length} 已启用</span><span className="m-sheet-disclosure" aria-hidden>⌄</span></summary>
            <ul className="m-mem">
              {c.tools.map((t) => (
                <li key={t.name} data-pinned={t.enabled || undefined}>
                  <div className="m-sheet-card-head"><strong>{t.title}</strong><Tag tone={t.effect === "read" ? "neutral" : "accent"}>{t.effect === "read" ? "读取" : "写入"}</Tag></div>
                  {t.description ? <p className="m-sheet-meta">{t.description}</p> : null}
                  <div className="m-mem-acts">
                    <button type="button" disabled={busy} {...rowState(`tool:${c.id}:${t.name}`)} onClick={() => void patch(c.id, { tool: t.name, enabled: !t.enabled }, `tool:${c.id}:${t.name}`)}>
                      {t.enabled ? "停用" : t.effect === "write" ? "允许（每次仍需确认）" : "启用"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            </details> : <p className="m-sheet-meta">暂未发现可用工具，可刷新后查看。</p>}
          </section>
        ))
      )}
      </section>
    </Sheet>
  );
}


type SchedItem = { id: string; kind: "DAILY_BRIEF" | "REMINDER" | "MISSION"; title: string; cron: string; cronText: string; timezone?: string; enabled: boolean; nextRunAt: string | null; lastRunAt: string | null; lastStatus: string | null; lastError: string | null };
const SCHED_KIND: Record<SchedItem["kind"], string> = { DAILY_BRIEF: "简报", REMINDER: "提醒", MISSION: "重跑" };
const SCHED_STATUS: Record<string, string> = { POSTED: "已发送", SKIPPED_EMPTY: "没有新情况，未打扰", LAUNCHED: "已启动工作", FAILED: "失败" };
const FREQ_OPTIONS: Array<[string, string]> = [["每天", "*"], ["工作日", "1-5"], ["每周一", "1"], ["每周五", "5"]];
const toCron = (time: string, dow: string) => {
  const [h, m] = time.split(":").map(Number);
  return `${m || 0} ${h || 0} * * ${dow}`;
};
const fmtWhen = (iso: string | null) => fmtDateTime(iso);

/** KX-34：定时与主动。每日简报只在有真实新情况时发；提醒到点发到对话；定时重跑按原计划再做一次。 */
const NOTIFY_TEXT: Record<NotifyState, string> = {
  on: "已开启：Kern 不在前台时，需要你确认、任务完成、定时失败会弹系统通知。",
  off: "未开启。打开后，Kern 不在前台时也能及时知道需要你的事。",
  denied: "浏览器已拒绝通知权限，需要在浏览器的网站设置里重新允许。",
  unsupported: "当前浏览器不支持系统通知。",
};

/** KX-64：浏览器系统通知开关（默认关闭，只存在本机）。 */
function NotifyToggle() {
  const [state, setState] = useState<NotifyState>("off");
  const [busy, setBusy] = useState(false);
  useEffect(() => setState(notifyState()), []);
  const flip = async () => {
    setBusy(true);
    setState(await setNotifyEnabled(state !== "on"));
    setBusy(false);
  };
  return (
    <div className="m-notify-row">
      <p>
        <strong>系统通知</strong>
        <br />
        <span className="m-quiet">{NOTIFY_TEXT[state]}</span>
      </p>
      {state === "on" || state === "off" ? (
        <Btn size="sm" v={state === "on" ? "ghost" : undefined} disabled={busy} onClick={() => void flip()}>
          {state === "on" ? "关闭" : "开启"}
        </Btn>
      ) : null}
    </div>
  );
}

export function ScheduleSheet({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<SchedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [briefTime, setBriefTime] = useState("09:00");
  const [briefDow, setBriefDow] = useState("*");
  const [text, setText] = useState("");
  const [remTime, setRemTime] = useState("10:00");
  const [remDow, setRemDow] = useState("1");
  const { busy, run, stateOf, rowState } = useSheetMutation(setError);
  const timezone = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "Asia/Shanghai";
  const load = async () => {
    setError(null);
    try {
      const r = await fetch("/api/schedules", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const next = ((await r.json()) as { items: SchedItem[] }).items;
      setItems(next);
      const saved = next.find(item => item.kind === "DAILY_BRIEF");
      const parts = saved?.cron.match(/^(\d+) (\d+) \* \* (\S+)$/);
      if (parts) {
        setBriefTime(`${parts[2].padStart(2, "0")}:${parts[1].padStart(2, "0")}`);
        setBriefDow(parts[3]);
      }
    } catch {
      setError("读取定时失败");
      setItems([]);
    }
  };
  useEffect(() => { void load(); }, []);
  const send = async (url: string, method: string, body: unknown, key: string) => {
    return run(async () => {
      await requestSheet(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      await load();
    }, key);
  };
  const brief = items?.find((s) => s.kind === "DAILY_BRIEF") ?? null;
  const saveBrief = () =>
    brief
      ? send(`/api/schedules/${brief.id}`, "PATCH", { cron: toCron(briefTime, briefDow), timezone: brief.timezone || timezone, enabled: true }, "brief")
      : send("/api/schedules", "POST", { kind: "DAILY_BRIEF", cron: toCron(briefTime, briefDow), timezone }, "brief");
  const addReminder = async () => {
    if (await send("/api/schedules", "POST", { kind: "REMINDER", cron: toCron(remTime, remDow), timezone, text: text.trim() }, "reminder")) setText("");
  };
  const others = items?.filter((s) => s.kind !== "DAILY_BRIEF") ?? [];
  return (
    <Sheet title="定时" sub="每日简报只在有新情况时发；提醒到点发到「Kern 简报」对话。需要后台 Worker 在运行。" utility="schedules" onClose={onClose}>
      <NotifyToggle />
      <section className="m-conn">
        <header className="m-sheet-card-head">
          <h3>每日简报</h3>
          <Tag tone={brief?.enabled ? "ok" : "neutral"}>{brief ? (brief.enabled ? "已开启" : "已暂停") : "未开启"}</Tag>
        </header>
        <p className="m-sheet-meta">
          {brief ? <span className="m-quiet">{brief.enabled ? `${brief.cronText} · 下次 ${fmtWhen(brief.nextRunAt)}` : "恢复后按所设时间发送"}{brief.lastStatus ? ` · 上次：${SCHED_STATUS[brief.lastStatus] ?? brief.lastStatus}` : ""}</span> : <span className="m-quiet">开启后，有新情况时才会发送简报。</span>}
        </p>
        <form className="m-sheet-settings-form" onSubmit={(e) => { e.preventDefault(); if (!busy) void saveBrief(); }}>
          <div className="m-sheet-form-grid">
          <label className="m-sheet-field">频率
          <select value={briefDow} disabled={busy} onChange={(e) => setBriefDow(e.target.value)} aria-label="简报频率">
            {!FREQ_OPTIONS.some(([, value]) => value === briefDow) ? <option value={briefDow}>现有频率</option> : null}
            {FREQ_OPTIONS.map(([l, v]) => <option key={v} value={v}>{l}</option>)}
          </select>
          </label>
          <label className="m-sheet-field">时间
          <input type="time" required disabled={busy} value={briefTime} onChange={(e) => setBriefTime(e.target.value)} aria-label="简报时间" />
          </label>
          </div>
          <div className="m-sheet-form-actions">
          <StatefulBtn size="sm" type="submit" state={stateOf("brief")} disabled={busy}>{brief ? (brief.enabled ? "改时间" : "恢复") : "开启"}</StatefulBtn>
          {brief?.enabled ? <button type="button" disabled={busy} {...rowState("brief-pause")} onClick={() => void send(`/api/schedules/${brief.id}`, "PATCH", { enabled: false }, "brief-pause")}>暂停</button> : null}
          </div>
        </form>
      </section>
      <section className="m-conn">
        <header className="m-sheet-card-head"><h3>新增提醒</h3></header>
        <form className="m-sheet-settings-form" onSubmit={(e) => { e.preventDefault(); if (text.trim() && !busy) void addReminder(); }}>
          <label className="m-sheet-field">提醒内容
          <input value={text} disabled={busy} onChange={(e) => setText(e.target.value)} placeholder="提醒我…，如：看一下竞品定价" maxLength={200} aria-label="提醒内容" />
          </label>
          <div className="m-sheet-form-grid">
          <label className="m-sheet-field">频率
          <select value={remDow} disabled={busy} onChange={(e) => setRemDow(e.target.value)} aria-label="提醒频率">
            {FREQ_OPTIONS.map(([l, v]) => <option key={v} value={v}>{l}</option>)}
          </select>
          </label>
          <label className="m-sheet-field">时间
          <input type="time" required disabled={busy} value={remTime} onChange={(e) => setRemTime(e.target.value)} aria-label="提醒时间" />
          </label>
          </div>
          <div className="m-sheet-form-actions">
          <StatefulBtn size="sm" type="submit" state={stateOf("reminder")} disabled={!text.trim() || busy}>添加</StatefulBtn>
          </div>
        </form>
      </section>
      <WorkerNotice active={!!items?.some((s) => s.enabled)} what="定时" />
      {error ? <p className="m-quiet" role="alert">{error} <button type="button" disabled={busy} onClick={() => void load()}>重新读取</button></p> : null}
      <section className="m-sheet-section">
      <SheetSectionTitle title="提醒与定时重跑" count={items === null ? undefined : others.length} />
      {items === null ? (
        <SheetSkeleton />
      ) : others.length === 0 ? (
        <p className="m-quiet">还没有提醒或定时重跑。任务完成后，可以在结果里选择「定期重跑」。</p>
      ) : (
        <ul className="m-mem">
          {others.map((s) => (
            <li key={s.id} data-pinned={s.enabled || undefined}>
              <div className="m-sheet-card-head"><Tag tone={s.kind === "MISSION" ? "accent" : "neutral"}>{SCHED_KIND[s.kind]}</Tag><span className="m-sheet-meta">{s.enabled ? "已开启" : "已暂停"}</span></div>
              <p><strong>{s.title}</strong></p>
              <div className="m-sheet-card-copy">
                <p className="m-sheet-meta">{s.cronText}</p>
                {s.enabled ? <p className="m-sheet-meta">下次 {fmtWhen(s.nextRunAt)}</p> : null}
                {s.lastStatus ? <p className="m-sheet-meta">上次：{SCHED_STATUS[s.lastStatus] ?? s.lastStatus}</p> : null}
                {s.lastError ? <p className="m-sheet-inline-error">{s.lastError}</p> : null}
              </div>
              <div className="m-mem-acts">
                <button type="button" disabled={busy} {...rowState(`toggle:${s.id}`)} onClick={() => void send(`/api/schedules/${s.id}`, "PATCH", { enabled: !s.enabled }, `toggle:${s.id}`)}>{s.enabled ? "暂停" : "恢复"}</button>
                <button type="button" disabled={busy} {...rowState(`delete:${s.id}`)} onClick={() => void send(`/api/schedules/${s.id}`, "DELETE", undefined, `delete:${s.id}`)}>删除</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      </section>
    </Sheet>
  );
}
/** 拒绝理由：进入正式审计记录，因此必须填写。 */
export function RejectSheet({ title, onClose, onSubmit }: { title: string; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Sheet title="拒绝这项改动" sub={title} onClose={onClose}>
      <form className="m-reject" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) onSubmit(reason.trim()); }}>
        <label htmlFor="m-reject-reason">拒绝理由（会写入审计记录，Kern 也会据此调整）</label>
        <textarea id="m-reject-reason" autoFocus rows={4} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        <div className="m-reject-acts">
          <Btn size="sm" v="ghost" onClick={onClose}>取消</Btn>
          <Btn size="sm" v="danger" type="submit" disabled={!reason.trim()}>确认拒绝</Btn>
        </div>
      </form>
    </Sheet>
  );
}

type LibItem = { missionTaskId: string; title: string; goal: string; finishedAt: string; downloads: Array<{ format: string; label: string; href: string }> };

/** KX-62 产出库：你已完成的任务，随时再下载成文档、表格或演示稿。 */
export function LibrarySheet({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<LibItem[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const load = async (query: string) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/library${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`, { cache: "no-store", signal: controller.signal });
      if (!r.ok) throw new Error(String(r.status));
      const next = ((await r.json()) as { items: LibItem[] }).items;
      if (request.current !== controller) return;
      setItems(next);
      setSearchQuery(query.trim());
    } catch {
      if (controller.signal.aborted) return;
      setError("读取产出库失败");
    } finally {
      if (request.current === controller) setLoading(false);
    }
  };
  useEffect(() => { void load(""); return () => request.current?.abort(); }, []);
  return (
    <Sheet title="产出库" sub="已完成的任务集中保存在这里，可下载为文档、表格或演示稿。只有你自己看得到。" utility="library" onClose={onClose}>
      <form className="m-vault-add" onSubmit={(e) => { e.preventDefault(); void load(q); }}>
        <label className="m-sheet-form-label" htmlFor="m-library-search">查找产出</label>
        <div className="m-sheet-input-action">
          <input id="m-library-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="按任务目标搜索" maxLength={60} aria-label="搜索产出" />
          <Btn size="sm" type="submit" disabled={loading}>{loading ? "搜索中…" : "搜索"}</Btn>
        </div>
      </form>
      {error ? <p className="m-quiet" role="alert">{error} <button type="button" onClick={() => void load(q)}>重试</button></p> : null}
      <section className="m-sheet-section">
      <SheetSectionTitle title={searchQuery ? "搜索结果" : "已完成的产出"} count={items?.length} />
      {loading ? <p className="m-quiet" role="status">读取中…</p> : items === null ? null : (
      items.length === 0 ? (
        <p className="m-quiet">{searchQuery ? "没有匹配的产出。" : "还没有已完成的任务。交给 Kern 一件事，完成后结果会出现在这里。"}</p>
      ) : (
        <ul className="m-mem m-lib">
          {items.map((it) => (
            <li key={it.missionTaskId}>
              <SheetText text={it.title} title />
              <p className="m-sheet-meta">完成于 {fmtDateTime(it.finishedAt)}</p>
              <div className="m-lib-dl" aria-label={`${it.title} 的下载格式`}>
                {it.downloads.map((d) => (
                  <a key={d.format} href={d.href} target={d.format === "pdf" ? "_blank" : undefined} rel="noopener" download={d.format === "pdf" ? undefined : ""}>
                    {d.label}
                  </a>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ))}
      </section>
    </Sheet>
  );
}
