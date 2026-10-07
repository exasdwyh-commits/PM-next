"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { WorkforceStudioData } from "@/modules/workforce/studio";

type Agent = WorkforceStudioData["agents"][number];
type Task = WorkforceStudioData["tasks"][number];
type Detail = { kind: "agent" | "task" | "handoff"; id: string };
type Pending = { conversationId: string; clientMessageId: string; text: string; accepted: boolean };
type Execution = { status: string; clientMessageId: string; outputMessageId: string | null; error: string | null };
type Receipt = { execution: Execution; output: string; workerReady: boolean };
type Messages = { executions: Execution[]; messages: { id: string; content: string }[]; workerReady: boolean };
const terminal = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);
const labels: Record<string, string> = {
  QUEUED: "等待执行", RUNNING: "正在处理", BLOCKED: "遇到阻塞", WAITING_HUMAN: "需要你", SUBMITTED: "待复核",
  SUCCEEDED: "执行完成", FAILED: "执行失败", CANCELLED: "已取消", CREATED: "已交接", ACCEPTED: "已接收", COMPLETED: "已返回",
  ACTIVE: "已启用", PAUSED: "已暂停", ARCHIVED: "已归档", WAITING_CONFIRMATION: "等待确认",
};
const roles: Record<string, [string, string]> = {
  PRODUCT_LEAD: ["团队负责人", "#e5c878"], PRODUCT: ["产品策略", "#81b5cb"], MARKET_RESEARCH: ["市场研究", "#90bfa8"],
  SCIENTIFIC_EVIDENCE: ["科学证据", "#aaa5d9"], FORMULATION: ["配方设计", "#cdb08e"], COMPLIANCE: ["法规合规", "#8fc7c0"],
  COST_BOM: ["成本核算", "#b9c790"], QA_VERIFIER: ["独立复核", "#a8b6db"], MARKETING: ["市场传播", "#d4a0b3"],
  SUPPLY_OPS: ["供应运营", "#d2b68c"], RED_TEAM: ["风险挑战", "#ca9b91"], TECH_ARCHITECT: ["技术架构", "#91b5da"],
  DESKTOP_OPERATOR: ["本机执行", "#a3b0bb"],
};
function role(agent: Agent) { return roles[agent.roleKey]?.[0] ?? agent.roleKey; }
function color(agent: Agent) { return roles[agent.roleKey]?.[1] ?? "#99b6aa"; }
function date(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).format(new Date(value));
}
function Status({ value }: { value: string }) { return <span className={`ws-status ws-status-${value.toLowerCase()}`}><i aria-hidden />{labels[value] ?? value}</span>; }
function Avatar({ agent, small = false }: { agent: Agent; small?: boolean }) {
  return <span className={`ws-avatar${small ? " ws-avatar-small" : ""}`} style={{ "--agent-color": color(agent) } as CSSProperties} aria-hidden>{role(agent).slice(0, 1)}</span>;
}
class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...options, cache: "no-store", signal: options.signal ?? AbortSignal.timeout(15_000) });
  const body = await response.json();
  if (!response.ok) throw new ApiError(body.message ?? "暂时无法完成请求，请稍后重试。", response.status);
  return body as T;
}
function parsePending(raw: string | null): Pending | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuid.test(value.conversationId) && uuid.test(value.clientMessageId) && typeof value.text === "string" && value.text.trim() && value.text.length <= 40_000 && typeof value.accepted === "boolean" ? value : null;
  } catch { return null; }
}

export default function StudioClient({ initial }: { initial: WorkforceStudioData }) {
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState<"overview" | "tasks" | "handoffs">("overview");
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [teamOpen, setTeamOpen] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [sendError, setSendError] = useState("");
  const [receiptError, setReceiptError] = useState("");
  const [restored, setRestored] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const refreshController = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);
  const sendController = useRef<AbortController | null>(null);
  const storageKey = `kern.studio.pending.v1:${initial.viewer.organizationId}:${initial.viewer.userId}`;

  useEffect(() => {
    try { setPending(parsePending(localStorage.getItem(storageKey))); } catch { /* Storage can be unavailable; sending handles this explicitly. */ }
    setRestored(true);
  }, [storageKey]);

  const refresh = useCallback(async () => {
    if (refreshController.current) return;
    const controller = new AbortController(); refreshController.current = controller;
    setRefreshing(true);
    try {
      setData(await request<WorkforceStudioData>("/api/workforce/studio", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) }));
      setWorkspaceError("");
    } catch (error) { if (!controller.signal.aborted) setWorkspaceError(error instanceof Error ? error.message : "刷新失败"); }
    finally { if (refreshController.current === controller) { refreshController.current = null; setRefreshing(false); } }
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      if (!document.hidden) await refresh();
      if (!stopped) timer = setTimeout(tick, 15_000);
    }
    timer = setTimeout(tick, 15_000);
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { stopped = true; clearTimeout(timer); refreshController.current?.abort(); sendController.current?.abort(); document.removeEventListener("visibilitychange", visible); };
  }, [refresh]);

  const conversationId = pending?.conversationId;
  const clientMessageId = pending?.clientMessageId;
  useEffect(() => {
    if (!conversationId || !clientMessageId) return;
    const controller = new AbortController();
    let stopped = false;
    let done = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (!document.hidden) {
        try {
          const result = await request<Messages>(`/api/conversations/${conversationId}/messages`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
          if (stopped) return;
          const execution = result.executions.find(item => item.clientMessageId === clientMessageId);
          if (execution) {
            setReceipt({ execution, workerReady: result.workerReady, output: result.messages.find(item => item.id === execution.outputMessageId)?.content ?? "" });
            setPending(current => {
              if (!current || current.clientMessageId !== clientMessageId) return current;
              const accepted = { ...current, accepted: true };
              try { localStorage.setItem(storageKey, JSON.stringify(accepted)); } catch { /* The pre-send receipt already contains the stable IDs. */ }
              return current.accepted ? current : accepted;
            });
            done = terminal.has(execution.status);
            if (done) void refresh();
          }
          setReceiptError("");
        } catch (error) {
          if (!stopped) {
            // A send may still be creating the conversation. Never replay a POST on refresh.
            setReceiptError(error instanceof ApiError && error.status === 404 ? "尚未查询到接收记录；若提交中断，可使用相同交办重试。" : "暂时无法更新交办状态，可打开原对话查看。");
            if (error instanceof ApiError && error.status === 401) done = true;
          }
        }
      }
      if (!stopped && !done) timer = setTimeout(poll, 4000);
    }
    void poll();
    // The timer owns polling; visibility resumes on its next tick to avoid overlapping requests.
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [conversationId, clientMessageId, storageKey, refresh]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (detail && dialog && !dialog.open) dialog.showModal();
    if (!detail && dialog?.open) dialog.close();
  }, [detail]);

  async function send() {
    if (sendingRef.current || !restored) return;
    const work = pending ?? { conversationId: crypto.randomUUID(), clientMessageId: crypto.randomUUID(), text: draft.trim(), accepted: false };
    if (!work.text || work.accepted) return;
    try { localStorage.setItem(storageKey, JSON.stringify(work)); }
    catch { setSendError("浏览器无法保存交办回执，请打开 Kern 对话交办，以便刷新后继续查看。"); return; }
    sendingRef.current = true; setSending(true); setSendError(""); setReceiptError(""); setPending(work);
    const controller = new AbortController(); sendController.current = controller;
    const options = { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]) };
    try {
      await request("/api/conversations", { ...options, body: JSON.stringify({ clientConversationId: work.conversationId, title: work.text.slice(0, 60) }) });
      const result = await request<{ execution: Execution; workerReady: boolean }>(`/api/conversations/${work.conversationId}/messages`, { ...options, body: JSON.stringify({ content: work.text, clientMessageId: work.clientMessageId }) });
      if (controller.signal.aborted) return;
      const accepted = { ...work, accepted: true };
      try { localStorage.setItem(storageKey, JSON.stringify(accepted)); } catch { /* Stable IDs were saved before posting. */ }
      setPending(accepted);
      setReceipt(current => current?.execution.clientMessageId === work.clientMessageId && terminal.has(current.execution.status) ? current : { execution: result.execution, output: "", workerReady: result.workerReady });
      setDraft(""); void refresh();
    } catch (error) { if (!controller.signal.aborted) setSendError(`${error instanceof Error ? error.message : "提交中断"}。可重试相同交办，系统会检查已有接收记录。`); }
    finally { sendingRef.current = false; setSending(false); sendController.current = null; }
  }

  function newWork() {
    try { localStorage.removeItem(storageKey); } catch { setSendError("无法清除本地回执，请打开原对话继续。"); return; }
    setPending(null); setReceipt(null); setSendError(""); setReceiptError(""); setDraft(""); textRef.current?.focus();
  }

  const agents = new Map(data.agents.map(agent => [agent.id, agent]));
  const tasks = data.tasks.filter(task => tab === "overview" || ((!filter || task.agentId === filter) && (!query.trim() || task.goal.toLowerCase().includes(query.trim().toLowerCase()))));
  const attention = data.tasks.filter(task => ["BLOCKED", "WAITING_HUMAN", "SUBMITTED"].includes(task.status));
  const handoffs = data.handoffs.filter(item => !filter || item.fromAgentId === filter || item.toAgentId === filter);
  const lead = data.agents.find(agent => agent.code === "hermes_pm" || agent.roleKey === "PRODUCT_LEAD");
  const satellites = data.agents.filter(agent => agent.id !== lead?.id).slice(0, 5);
  const selectedAgent = detail?.kind === "agent" ? agents.get(detail.id) : undefined;
  const selectedHandoff = detail?.kind === "handoff" ? data.handoffs.find(item => item.id === detail.id) : undefined;
  const selectedTask = detail?.kind === "task" ? data.tasks.find(task => task.id === detail.id) : selectedHandoff ? data.tasks.find(task => task.id === selectedHandoff.childTaskId) : undefined;
  const busy = data.tasks.filter(task => task.status === "RUNNING").length;
  const completed = data.tasks.filter(task => task.status === "SUCCEEDED").length;

  function taskRow(task: Task) {
    const agent = agents.get(task.agentId);
    return <button key={task.id} className="ws-task-row" onClick={() => setDetail({ kind: "task", id: task.id })}>
      <span className="ws-task-goal">{task.goal}</span>
      <span className="ws-assignee">{agent && <Avatar agent={agent} small />}{agent ? role(agent) : "员工"}</span>
      <Status value={task.status} /><time dateTime={task.updatedAt}>{date(task.updatedAt)}</time>
    </button>;
  }

  return <div className="ws">
    <header className="ws-header">
      <Link href="/muse" className="ws-brand"><span>K</span>Kern<span className="ws-header-slash">/</span><strong>数字员工工作室</strong></Link>
      <div className="ws-header-actions"><button className="ws-mobile-toggle" aria-expanded={teamOpen} aria-controls="ws-team" onClick={() => setTeamOpen(!teamOpen)}>团队</button><button onClick={() => void refresh()} disabled={refreshing} className="ws-refresh">{refreshing ? "更新中…" : "↻ 刷新"}</button><Link href="/muse" className="ws-back">返回 Kern ↗</Link></div>
    </header>
    <div className="ws-layout">
      <aside id="ws-team" className={`ws-sidebar${teamOpen ? " is-open" : ""}`}>
        <div className="ws-sidebar-label">WORKSPACE</div>
        <nav aria-label="工作室导航">
          {([ ["overview", "◈", "工作总览"], ["tasks", "☷", "任务"], ["handoffs", "⇄", "交接记录"] ] as const).map(([key, icon, title]) => <button key={key} className={tab === key ? "is-current" : ""} aria-current={tab === key ? "page" : undefined} onClick={() => { setTab(key); setTeamOpen(false); }}><span aria-hidden>{icon}</span>{title}<small>{key === "tasks" ? data.tasks.length : key === "handoffs" ? data.handoffs.length : ""}</small></button>)}
        </nav>
        <div className="ws-sidebar-label ws-team-label">团队成员 <span>{data.agents.length}</span></div>
        <div className="ws-team-list">{data.agents.map(agent => {
          const working = data.tasks.some(task => task.agentId === agent.id && task.status === "RUNNING");
          const needsYou = attention.some(task => task.agentId === agent.id);
          return <button key={agent.id} className="ws-member" onClick={() => { setDetail({ kind: "agent", id: agent.id }); setTeamOpen(false); }}><Avatar agent={agent} small /><span><b>{role(agent)}</b><small>{agent.name}</small></span><i className={`ws-member-dot ${working ? "working" : needsYou ? "attention" : agent.status !== "ACTIVE" ? "paused" : ""}`} aria-label={working ? "正在处理" : needsYou ? "需要关注" : labels[agent.status]} /></button>;
        })}{!data.agents.length && <p className="ws-sidebar-empty">团队尚未建立。<Link href="/workforce">去初始化团队 ↗</Link></p>}</div>
        <footer className="ws-sidebar-footer"><Link href="/workforce">⚙ 团队管理与审批</Link><Link href="/manage">项目工作台 ↗</Link><span className="ws-user"><span>{data.viewer.name.slice(0, 1)}</span>{data.viewer.name}</span></footer>
      </aside>
      <main className="ws-main">
        {workspaceError && <div className="ws-notice ws-warning" role="alert">数据暂未更新：{workspaceError} <Link href="/login">登录</Link></div>}
        {tab === "overview" && <section className="ws-hero" aria-labelledby="ws-title">
          <div className="ws-orbit" aria-hidden><div className="ws-orbit-ring" /><span className="ws-lead-orb">K<span>Kern</span></span>{satellites.map((agent, index) => <span className={`ws-satellite ws-satellite-${index}`} key={agent.id}><Avatar agent={agent} /><small>{role(agent)}</small></span>)}</div>
          <div className="ws-eyebrow">YOUR TEAM, ONE WORKSPACE</div><h1 id="ws-title">今天，推进哪件事？</h1><p>说明目标和范围，Kern 会组织分工，在需要你判断时回来找你。</p>
        </section>}
        <section className={`ws-composer${tab !== "overview" ? " ws-composer-compact" : ""}`} aria-label="统一交办">
          {data.enabledModelProfiles === 0 && <div className="ws-model-note">当前组织没有启用的模型配置，可先交代目标、查看计划。<Link href="/settings#models">配置模型 ↗</Link></div>}
          {!pending ? <form onSubmit={event => { event.preventDefault(); void send(); }}>
            <label htmlFor="ws-assignment" className="ws-sr-only">交办给 Kern 的目标</label><textarea id="ws-assignment" ref={textRef} value={draft} onChange={event => setDraft(event.target.value)} maxLength={40_000} placeholder="把目标交给 Kern，例如：分析这款产品的竞品，列出需要补充的证据…" rows={3} disabled={!restored || sending} />
            <div className="ws-composer-bottom"><span><span className="ws-kern-mini" aria-hidden>K</span>交给 Kern，统一协调</span><button className="ws-primary" type="submit" disabled={!restored || sending || !draft.trim()}>{sending ? "接收中…" : "交办"}<span aria-hidden>↑</span></button></div>
          </form> : <div className="ws-receipt" aria-live="polite">
            <div className="ws-receipt-head"><span className="ws-section-label">本次交办</span>{receipt ? <Status value={receipt.execution.status} /> : <span>{sending ? "正在接收…" : "待确认接收"}</span>}</div>
            <p className="ws-receipt-goal">{pending.text}</p>
            {receipt?.output && <details className="ws-reply" open={tab === "overview"}><summary>查看回复</summary><div className="ws-output">{receipt.output}</div></details>}
            {receipt?.execution.error && <p className="ws-warning">{receipt.execution.error}</p>}
            {receipt && !receipt.workerReady && !terminal.has(receipt.execution.status) && <p className="ws-warning">交办已接收。当前没有可用的对话执行进程，恢复后才能继续处理。</p>}
            {receiptError && <p className="ws-warning">{receiptError}</p>}
            <div className="ws-receipt-actions"><Link href={`/muse?c=${pending.conversationId}`}>打开原对话 ↗</Link>{pending.accepted ? <button onClick={newWork} disabled={sending}>交办下一件事 ＋</button> : <button className="ws-primary" onClick={() => void send()} disabled={sending}>{sending ? "接收中…" : "重试相同交办"}</button>}</div>
          </div>}
          {sendError && <div role="alert" className="ws-notice ws-warning">{sendError}</div>}
        </section>
        {tab === "overview" && !pending && <div className="ws-prompts">{["研究竞品与差异化", "检查方案证据和风险", "整理下一步执行计划"].map(text => <button key={text} onClick={() => { setDraft(`${text}：`); textRef.current?.focus(); }}>{text}<span aria-hidden>↗</span></button>)}</div>}
        <div className="ws-content">
          {tab === "overview" && <>
            <div className="ws-stats"><div><span>进行中的员工任务</span><b>{busy}<small> / {data.tasks.length}</small></b></div><div><span>需要你关注</span><b className={attention.length ? "ws-amber" : ""}>{attention.length}</b></div><div><span>已返回的交接</span><b>{data.handoffs.filter(item => item.status === "COMPLETED").length}</b></div><div><span>员工执行完成</span><b>{completed}</b></div></div>
            <section className="ws-section"><div className="ws-section-head"><h2>需要你关注</h2><span>{attention.length}</span></div>{attention.length ? attention.map(task => <button key={task.id} className="ws-attention-row" onClick={() => setDetail({ kind: "task", id: task.id })}>{agents.get(task.agentId) && <Avatar agent={agents.get(task.agentId)!} small />}<span><b>{task.goal}</b><small>{task.blockedReason ?? (task.status === "SUBMITTED" ? "结果已提交，等待复核。" : "打开详情，查看需要处理的问题。")}</small></span><Status value={task.status} /><span aria-hidden>↗</span></button>) : <div className="ws-quiet"><span aria-hidden>✓</span>目前没有等待你处理的事项。</div>}</section>
          </>}
          {tab !== "handoffs" && <section className="ws-section"><div className="ws-section-head"><h2>{tab === "overview" ? "最近任务" : "任务"}</h2>{tab === "overview" ? <button onClick={() => setTab("tasks")}>查看全部 ↗</button> : <span>{tasks.length} 条</span>}</div>{tab === "tasks" && <div className="ws-filters"><label className="ws-sr-only" htmlFor="ws-search">搜索任务</label><input id="ws-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索任务目标…" /><label className="ws-sr-only" htmlFor="ws-person">负责人</label><select id="ws-person" value={filter} onChange={event => setFilter(event.target.value)}><option value="">全部成员</option>{data.agents.map(agent => <option key={agent.id} value={agent.id}>{role(agent)} · {agent.name}</option>)}</select></div>}<div className="ws-task-table"><div className="ws-table-head"><span>任务目标</span><span>负责人</span><span>状态</span><span>更新于</span></div>{(tab === "overview" ? tasks.slice(0, 6) : tasks).map(taskRow)}{!tasks.length && <div className="ws-empty"><b>{filter || query ? "没有匹配的任务" : "从一件工作开始"}</b><p>{filter || query ? "调整搜索或负责人筛选。" : "上方交办由 Kern 接收；产生的员工任务会显示在这里。"}</p></div>}</div></section>}
          {tab === "handoffs" && <section className="ws-section"><div className="ws-section-head"><h2>交接记录</h2><span>最近 {data.limits.handoffs} 条</span></div><div className="ws-filters"><label htmlFor="ws-handoff-person">关联成员</label><select id="ws-handoff-person" value={filter} onChange={event => setFilter(event.target.value)}><option value="">全部成员</option>{data.agents.map(agent => <option key={agent.id} value={agent.id}>{role(agent)}</option>)}</select></div><div className="ws-handoffs">{handoffs.map(item => {
            const from = agents.get(item.fromAgentId)!; const to = agents.get(item.toAgentId)!; const task = data.tasks.find(task => task.id === item.childTaskId);
            return <button className="ws-handoff" key={item.id} onClick={() => setDetail({ kind: "handoff", id: item.id })}><div className="ws-handoff-route"><Avatar agent={from} small /><b>{role(from)}</b><span aria-hidden>→</span><Avatar agent={to} small /><b>{role(to)}</b><Status value={item.status} /></div><h3>{task?.goal ?? "已交接任务"}</h3><p>{item.reason}</p>{task?.summary && <div className="ws-handoff-preview">返回摘要：{task.summary}</div>}<footer><time dateTime={item.updatedAt}>{date(item.updatedAt)}</time><span>查看回执 ↗</span></footer></button>;
          })}{!handoffs.length && <div className="ws-empty"><span className="ws-empty-icon" aria-hidden>⇄</span><b>交接有迹可循</b><p>员工之间发生委派后，这里会记录交给谁、为什么交接，以及返回的运行摘要。</p></div>}</div></section>}
          <footer className="ws-main-footer"><span>仅显示你可查看的工作 · 最近 {data.limits.tasks} 个任务</span><time dateTime={data.generatedAt}>更新于 {date(data.generatedAt)}</time></footer>
          <div className="ws-worker-health"><span><i className={data.workers.conversation.status === "running" ? "ready" : ""} />对话执行：{data.workers.conversation.status === "running" ? "心跳正常" : "未检测到可用进程"}</span><span><i className={data.workers.executor.status === "running" ? "ready" : ""} />员工执行：{data.workers.executor.status === "running" ? "心跳正常" : "未检测到可用进程"}</span><Link href="/workforce">查看团队与执行设置 ↗</Link></div>
        </div>
      </main>
    </div>
    <dialog ref={dialogRef} className="ws-dialog" aria-labelledby="ws-detail-title" onCancel={() => setDetail(null)} onClose={() => setDetail(null)} onClick={event => { if (event.target === event.currentTarget) setDetail(null); }}>
      <div className="ws-drawer"><header><span className="ws-section-label">{detail?.kind === "agent" ? "员工档案" : detail?.kind === "handoff" ? "交接回执" : "任务详情"}</span><button autoFocus aria-label="关闭详情" onClick={() => setDetail(null)}>×</button></header>
        {selectedAgent ? <><div className="ws-agent-heading"><Avatar agent={selectedAgent} /><div><h2 id="ws-detail-title">{role(selectedAgent)}</h2><p>{selectedAgent.name}</p></div></div><Status value={selectedAgent.status} /><p className="ws-detail-description">{selectedAgent.description ?? "尚未填写职责说明。"}</p><h3>职责与配置</h3><dl><dt>模型策略</dt><dd>{selectedAgent.modelPolicyKey ?? "采用组织默认策略"}</dd><dt>并行任务上限</dt><dd>{selectedAgent.maxConcurrentTasks}</dd><dt>可见范围</dt><dd>{selectedAgent.accessMode === "ORGANIZATION" ? "组织共享" : "仅本人及组织管理员"}</dd></dl><h3>已启用技能</h3><div className="ws-skill-list">{selectedAgent.skills.map(skill => <div key={skill.key}><b>{skill.name}</b>{skill.tools.length > 0 && <small>工具：{skill.tools.join("、")}</small>}</div>)}{!selectedAgent.skills.length && <p>尚未绑定可用技能。</p>}</div><p className="ws-detail-note">启用状态表示员工配置已开启。实际执行仍取决于执行进程、模型和工具权限。</p><h3>最近任务</h3><div className="ws-agent-tasks">{data.tasks.filter(task => task.agentId === selectedAgent.id).slice(0, 5).map(task => <button key={task.id} onClick={() => setDetail({ kind: "task", id: task.id })}><span>{task.goal}</span><Status value={task.status} /></button>)}{!data.tasks.some(task => task.agentId === selectedAgent.id) && <p>暂无可查看的任务。</p>}</div><button className="ws-primary" onClick={() => { setFilter(selectedAgent.id); setTab("tasks"); setDetail(null); }}>查看此员工的任务</button></> : selectedTask ? <>
          <h2 id="ws-detail-title">{selectedTask.goal}</h2><Status value={selectedTask.status} />
          {selectedHandoff && <><h3>交接路径</h3><p>{role(agents.get(selectedHandoff.fromAgentId)!)} → {role(agents.get(selectedHandoff.toAgentId)!)}</p><Status value={selectedHandoff.status} /><h3>交接原因</h3><p className="ws-detail-description">{selectedHandoff.reason}</p>{selectedHandoff.parentTaskId && <button className="ws-text-button" onClick={() => setDetail({ kind: "task", id: selectedHandoff.parentTaskId! })}>查看发起任务 ↗</button>}</>}
          <dl><dt>负责人</dt><dd>{agents.get(selectedTask.agentId)?.name}</dd><dt>最后更新</dt><dd>{date(selectedTask.updatedAt)}</dd></dl>
          {selectedTask.blockedReason && <><h3>需要处理的问题</h3><p className="ws-detail-description ws-warning">{selectedTask.blockedReason}</p></>}
          {selectedTask.error && <><h3>执行说明</h3><p className="ws-detail-description ws-warning">{selectedTask.error}</p></>}
          <h3>运行摘要</h3>{selectedTask.summary ? <div className="ws-output">{selectedTask.summary}</div> : <p className="ws-detail-note">尚无返回摘要。执行完成和复核通过会分别记录。</p>}
          <div className="ws-detail-links">{selectedTask.conversationHref && <Link className="ws-primary" href={selectedTask.conversationHref}>打开原对话 ↗</Link>}<Link href="/workforce">进入团队管理与审批 ↗</Link></div>
        </> : <><h2 id="ws-detail-title">记录已更新</h2><p>该记录已不在最近记录中，请关闭详情后刷新。</p></>}
      </div>
    </dialog>
  </div>;
}
