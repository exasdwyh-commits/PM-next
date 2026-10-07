"use client";
/**
 * Brief card: clarify (2–3 clickable questions, “我记得：…” pre-filled) →
 * plan (steps, members, why, estimated usage) → 开始 / 演示 / 调整.
 * Nothing runs until the user presses 开始.
 */
import { useCallback, useEffect, useState } from "react";
import { agentLabel, nodeLabel } from "../mission-timeline";
import { Btn, Card, CardHead, I, Tag } from "./kit";
import { MissionCard } from "./mission";
import { ContractCard, type ContractView } from "./contract-card";
import { ExecutionFlow } from "./execution-flow";

type Option = { id: string; label: string };
type Question = {
  id: string;
  required?: boolean;
  text: string;
  why: string;
  options: Option[];
  remembered: { memoryId: string; text: string } | null;
  answer: { optionId: string | null; text: string } | null;
};
type PlanNode = { key: string; kind: string; agentCode: string; objective: string; dependsOn: string[]; critical: boolean };
type Brief = {
  stage: "CLARIFY" | "PLAN" | "LAUNCHED" | "DISMISSED";
  goal: string;
  playbook: string;
  questions: Question[];
  plan: { goal: string; nodes: PlanNode[]; budget: { maxTasks: number; maxRevisionRounds: number } } | null;
  missionTaskId: string | null;
  demo: boolean;
  memoriesUsed: { id: string; text: string }[];
  /** KX-36：套用了你保存的做法。 */
  playbookRef?: { id: string; name: string; useCount: number; successCount: number } | null;
  /** KX-72：契约卡。 */
  contract?: ContractView | null;
  researchScope?: string;
};
type Estimate = {
  steps: number;
  members: number;
  modelCalls: { min: number; max: number };
  usage: { used: number; limit: number | null; afterLaunch: number } | null;
} | null;

type Readiness = { ready: boolean; demoReady: boolean; blockers: { code: string; message: string }[]; warnings: string[]; checkedAt: string };

type Draft = Record<string, { optionId: string | null; text: string }>;

const ERR: [RegExp, string][] = [
  [/上限|USAGE_LIMIT/, "已达到本部署设置的月度上限：可以先用演示模式看看效果，或联系管理员调整"],
  [/already launched/, "已经开工了"],
  [/NODE_STRUCTURAL/, "QA 与综合结论是固定环节"],
];

export function BriefCard({ messageId, missionAttached = false }: { messageId: string; missionAttached?: boolean }) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [estimate, setEstimate] = useState<Estimate>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [scopeDraft, setScopeDraft] = useState("");
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [launchedHere, setLaunchedHere] = useState(false);
  const [missing, setMissing] = useState(false);

  const apply = useCallback((json: { brief: Brief; estimate: Estimate; readiness?: Readiness | null }) => {
    setBrief(json.brief);
    setEstimate(json.estimate);
    setReadiness(json.readiness ?? null);
    setScopeDraft(json.brief.researchScope ?? "");
    const d: Draft = {};
    for (const q of json.brief.questions) if (q.answer) d[q.id] = q.answer;
    setDraft(d);
  }, []);

  useEffect(() => {
    let off = false;
    void fetch(`/api/missions/brief/${messageId}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j) => !off && apply(j))
      .catch(() => !off && setMissing(true));
    return () => {
      off = true;
    };
  }, [messageId, apply]);

  const act = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    setError(null);
    try {
      const r = await fetch(`/api/missions/brief/${messageId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const m = String(j.message ?? `操作失败（${r.status}）`);
        setError(ERR.find(([re]) => re.test(m))?.[1] ?? m);
        return false;
      }
      apply(j);
      if (body.action === "launch") setLaunchedHere(true);
      return true;
    } catch {
      setError("网络异常，操作未提交");
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (missing) return null;
  if (!brief) return <Card><div className="m-card-body"><p className="m-hint">读取计划…</p></div></Card>;

  if (brief.stage === "LAUNCHED") {
    return launchedHere && brief.missionTaskId && !missionAttached ? (
      <MissionCard missionId={brief.missionTaskId} />
    ) : (
      <p className="m-brief-done">
        <I.check /> 你已确认计划{brief.demo ? "（演示运行）" : ""}，进展见下方。
      </p>
    );
  }
  if (brief.stage === "DISMISSED") {
    return <p className="m-brief-done">这项工作没有开始。</p>;
  }

  if (brief.stage === "CLARIFY") {
    const requiredMissing = brief.questions.some(q => q.required && !draft[q.id]?.text?.trim() && !draft[q.id]?.optionId);
    const answered = brief.questions.filter((q) => draft[q.id]?.optionId || draft[q.id]?.text?.trim()).length;
    return (
      <Card className="m-brief">
        <CardHead icon={<I.spark />} title="开工前确认几件事" aside={<Tag>{answered}/{brief.questions.length}</Tag>} />
        <div className="m-card-body">
          {brief.questions.map((q, qi) => {
            const d = draft[q.id];
            const remembered = q.remembered && d && !d.optionId && d.text === q.remembered.text && !editing[q.id];
            return (
              <fieldset key={q.id} className="m-q">
                <legend>
                  <span className="m-q-n">{qi + 1}</span>
                  {q.text}
                  <small>{q.why}</small>
                </legend>
                {remembered ? (
                  <div className="m-remember">
                    <span><b>我记得：</b>{q.remembered!.text}</span>
                    <button type="button" className="m-link" onClick={() => setEditing((e) => ({ ...e, [q.id]: true }))}>改</button>
                  </div>
                ) : (
                  <>
                    <div className="m-opts" role="radiogroup" aria-label={q.text}>
                      {q.options.map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          role="radio"
                          aria-checked={d?.optionId === o.id}
                          className="m-opt"
                          onClick={() => setDraft((x) => ({ ...x, [q.id]: { optionId: o.id, text: "" } }))}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                    <input
                      className="m-q-other"
                      placeholder="或者直接写…"
                      aria-label={q.text}
                      required={q.required}
                      maxLength={200}
                      value={d && !d.optionId ? d.text : ""}
                      onChange={(e) => setDraft((x) => ({ ...x, [q.id]: { optionId: null, text: e.target.value } }))}
                    />
                  </>
                )}
              </fieldset>
            );
          })}
          {error ? <p className="m-ws-notice" data-t="bad">{error}</p> : null}
          <div className="m-card-actions">
            <Btn v="primary" size="sm" disabled={!!busy || requiredMissing} onClick={() => act("answer", { action: "answer", answers: draft })}>
              {busy === "answer" ? "拟计划中…" : "确认，看计划"}
            </Btn>
            {!brief.questions.some(q => q.required) ? <Btn v="ghost" size="sm" disabled={!!busy} onClick={() => act("skip", { action: "skip-questions" })}>跳过，让团队自己判断</Btn> : null}
          </div>
        </div>
      </Card>
    );
  }

  // PLAN
  const plan = brief.plan!;
  const constraints = brief.questions
    .map((q) => {
      const a = q.answer;
      if (!a) return null;
      const label = a.optionId ? q.options.find((o) => o.id === a.optionId)?.label : a.text;
      if (!label || a.optionId === "open") return null;
      return { q: q.text.replace(/[？?]$/, ""), a: label };
    })
    .filter((x): x is { q: string; a: string } => !!x);
  const producers = plan.nodes.filter((n) => n.kind !== "SYNTHESIS");
  const usage = estimate?.usage;

  return (
    <Card className="m-brief">
      <CardHead icon={<I.plan />} title="我拟的计划" aside={<Tag tone="accent">待你确认</Tag>} />
      <div className="m-card-body">
        {constraints.length ? (
          <div className="m-constraints">
            {constraints.map((c) => <span key={c.q}><i>{c.q}</i>{c.a}</span>)}
          </div>
        ) : null}
        <ExecutionFlow status={{ missionTaskId: messageId, status: "DRAFT", goal: plan.goal, playbook: brief.playbook, progress: { done: 0, total: plan.nodes.length }, revisionRounds: 0, tasksCreated: 0, nodes: plan.nodes.map(node => ({ ...node, status: "PENDING", attempts: 0, taskId: null })), outcome: null, paused: null, userInputs: [] }} activity="这是拟定计划，确认后开始执行" />
        <details className="m-brief-plan-edit">
        <summary>调整计划步骤</summary>
        <ol className="m-planlist">
          {plan.nodes.map((n, i) => {
            const removable = n.kind === "SPECIALIST" && !n.critical;
            const deps = n.dependsOn.length ? `等「${n.dependsOn.map(nodeLabel).join("」「")}」` : "立即开始";
            return (
              <li key={n.key} data-kind={n.kind}>
                <span className="m-planlist-n">{i + 1}</span>
                <div>
                  <b>{nodeLabel(n.key)}</b>
                  <span className="m-planlist-who">{agentLabel(n.agentCode)}{n.critical ? " · 关键" : ""} · {deps}</span>
                  <p>{n.objective.length > 80 ? n.objective.slice(0, 80) + "…" : n.objective}</p>
                </div>
                {removable ? (
                  <button
                    type="button"
                    className="m-planlist-x"
                    aria-label={`移除 ${nodeLabel(n.key)}`}
                    title="这一步不需要"
                    disabled={!!busy}
                    onClick={() => act(`rm:${n.key}`, { action: "edit-plan", edits: [{ op: "remove", key: n.key }] })}
                  >
                    <I.close />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ol>
        </details>
        {brief.researchScope ? <div className="m-q">
          <label htmlFor={`scope-${messageId}`}>调研范围（可以调整区域、渠道、时间和比较维度）</label>
          <textarea id={`scope-${messageId}`} className="m-q-other" rows={3} maxLength={1000} value={scopeDraft} onChange={e => setScopeDraft(e.target.value)} />
          <Btn size="sm" disabled={!!busy || !scopeDraft.trim() || scopeDraft === brief.researchScope} onClick={() => act("scope", { action: "set-research-scope", text: scopeDraft })}>保存范围</Btn>
        </div> : null}
        {brief.contract ? <ContractCard c={brief.contract} /> : null}
        <div className="m-brief-why">
          <p><b>为什么是这些成员：</b>{[...new Set(producers.map((n) => agentLabel(n.agentCode)))].join("、")}各自负责计划列出的步骤。{plan.nodes.some(n => n.kind === "RED_TEAM") ? "红队负责寻找反例。" : ""}{plan.nodes.some(n => n.kind === "QA") ? "独立 QA 只负责复核。" : "本计划没有独立复核步骤。"}{plan.nodes.some(n => n.kind === "SYNTHESIS") ? "最后由 Kern 汇总。" : ""}</p>
          <p><b>什么时候会找你：</b>缺少必需信息、步骤受阻，或涉及计划列出的审批事项时。其余步骤按计划推进。</p>
          {brief.memoriesUsed.length ? <p><b>用到的记忆：</b>{brief.memoriesUsed.map((m) => m.text).join("；")}</p> : null}
          {brief.playbookRef ? (
            <p className="m-brief-playbook">
              <b>按你保存的做法「{brief.playbookRef.name}」：</b>
              {brief.playbookRef.useCount ? `用过 ${brief.playbookRef.useCount} 次，顺利完成 ${brief.playbookRef.successCount} 次。` : "第一次套用。"}
              <Btn v="ghost" size="sm" disabled={!!busy} onClick={() => act("drop-playbook", { action: "drop-playbook" })}>不用这个做法</Btn>
            </p>
          ) : null}
        </div>
        {estimate ? (
          <div className="m-estimate">
            <span><b>{estimate.steps}</b> 步</span>
            <span><b>{estimate.members}</b> 位成员</span>
            <span>预计 <b>{estimate.modelCalls.min}–{estimate.modelCalls.max}</b> 次步骤生成（工具循环、重试会增加调用）</span>
            {usage ? (
              <span>
                本月第 <b>{usage.afterLaunch}</b> 项工作{usage.limit !== null ? `（上限 ${usage.limit}）` : ""}
              </span>
            ) : null}
          </div>
        ) : null}
        {error ? <p className="m-ws-notice" data-t="bad">{error}</p> : null}
        <div className="m-brief-readiness" role="status">
          <p><b>{readiness?.ready ? "当前条件满足，可以开始" : "开始前还需完成"}</b></p>
          {readiness?.blockers.map(b => <p key={b.code}>{b.message}</p>)}
          {!readiness ? <p>正在检查运行条件…</p> : null}
          {readiness?.warnings.map(w => <p className="m-hint" key={w}>{w}</p>)}
          <a className="m-link" href="/settings#models">查看设置</a>
          <Btn v="ghost" size="sm" disabled={!!busy} onClick={async () => {
            setBusy("refresh");
            try {
              const r = await fetch(`/api/missions/brief/${messageId}`, { cache: "no-store" });
              if (!r.ok) throw new Error();
              apply(await r.json()); setError(null);
            } catch { setError("无法刷新运行条件，请稍后重试"); }
            finally { setBusy(null); }
          }}>重新检查</Btn>
        </div>
        <div className="m-card-actions">
          <Btn v="primary" size="sm" disabled={!!busy || !readiness?.ready} onClick={() => act("launch", { action: "launch" })}>
            {busy === "launch" ? "开工中…" : "开始"}
          </Btn>
          <Btn size="sm" disabled={!!busy || !readiness?.demoReady} onClick={() => act("demo", { action: "launch", demo: true })} title="使用示例数据生成演示任务，不调用模型">
            演示运行
          </Btn>
          {brief.questions.length ? <Btn v="ghost" size="sm" disabled={!!busy} onClick={() => act("back", { action: "back" })}>改答案</Btn> : null}
          <Btn v="ghost" size="sm" disabled={!!busy} onClick={() => act("dismiss", { action: "dismiss" })}>先不做</Btn>
        </div>
      </div>
    </Card>
  );
}
