"use client";
/**
 * Brief card: clarify (2–3 clickable questions, “我记得：…” pre-filled) →
 * plan (steps, members, why, estimated usage) → 开始 / 演示 / 调整.
 * Nothing runs and no quota is used until the user presses 开始.
 */
import { useCallback, useEffect, useState } from "react";
import { agentLabel, nodeLabel } from "../mission-timeline";
import { Btn, Card, CardHead, I, Tag } from "./kit";
import { MissionCard } from "./mission";

type Option = { id: string; label: string };
type Question = {
  id: string;
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
};
type Estimate = {
  steps: number;
  members: number;
  modelCalls: { min: number; max: number };
  quota: { used: number; limit: number | null; afterLaunch: number } | null;
} | null;

type Draft = Record<string, { optionId: string | null; text: string }>;

const ERR: [RegExp, string][] = [
  [/额度|quota|Quota/, "本月任务额度已用完：可以升级套餐，或先用演示模式看看效果"],
  [/already launched/, "已经开工了"],
  [/NODE_STRUCTURAL/, "QA 与综合结论是固定环节"],
];

export function BriefCard({ messageId }: { messageId: string }) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [estimate, setEstimate] = useState<Estimate>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [launchedHere, setLaunchedHere] = useState(false);
  const [missing, setMissing] = useState(false);

  const apply = useCallback((json: { brief: Brief; estimate: Estimate }) => {
    setBrief(json.brief);
    setEstimate(json.estimate);
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
    return launchedHere && brief.missionTaskId ? (
      <MissionCard missionId={brief.missionTaskId} />
    ) : (
      <p className="m-brief-done">
        <I.check /> 你已确认计划{brief.demo ? "（演示运行）" : ""}，进展见下方。
      </p>
    );
  }
  if (brief.stage === "DISMISSED") {
    return <p className="m-brief-done">这项工作没有开始，也没有消耗额度。</p>;
  }

  if (brief.stage === "CLARIFY") {
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
            <Btn v="primary" size="sm" disabled={!!busy} onClick={() => act("answer", { action: "answer", answers: draft })}>
              {busy === "answer" ? "拟计划中…" : "确认，看计划"}
            </Btn>
            <Btn v="ghost" size="sm" disabled={!!busy} onClick={() => act("skip", { action: "skip-questions" })}>跳过，让团队自己判断</Btn>
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
  const quota = estimate?.quota;

  return (
    <Card className="m-brief">
      <CardHead icon={<I.plan />} title="我拟的计划" aside={<Tag tone="accent">待你确认</Tag>} />
      <div className="m-card-body">
        {constraints.length ? (
          <div className="m-constraints">
            {constraints.map((c) => <span key={c.q}><i>{c.q}</i>{c.a}</span>)}
          </div>
        ) : null}
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
        <div className="m-brief-why">
          <p><b>为什么是这些成员：</b>{[...new Set(producers.map((n) => agentLabel(n.agentCode)))].join("、")}各管一块；红队专门找反例，独立 QA 不参与产出、只负责挑错，最后由 Kern 汇总。</p>
          <p><b>什么时候会找你：</b>只有预算、对外发布、不可逆操作或战略取舍。其余团队自己推进。</p>
          {brief.memoriesUsed.length ? <p><b>用到的记忆：</b>{brief.memoriesUsed.map((m) => m.text).join("；")}</p> : null}
        </div>
        {estimate ? (
          <div className="m-estimate">
            <span><b>{estimate.steps}</b> 步</span>
            <span><b>{estimate.members}</b> 位成员</span>
            <span>预计 <b>{estimate.modelCalls.min}–{estimate.modelCalls.max}</b> 次模型调用</span>
            {quota ? (
              <span>
                本月任务额度 <b>{quota.used}</b>{quota.limit !== null ? `/${quota.limit}` : ""} → <b>{quota.afterLaunch}</b>
                {quota.limit !== null ? `/${quota.limit}` : ""}
              </span>
            ) : null}
          </div>
        ) : null}
        {error ? <p className="m-ws-notice" data-t="bad">{error}</p> : null}
        <div className="m-card-actions">
          <Btn v="primary" size="sm" disabled={!!busy} onClick={() => act("launch", { action: "launch" })}>
            {busy === "launch" ? "开工中…" : "开始"}
          </Btn>
          <Btn size="sm" disabled={!!busy} onClick={() => act("demo", { action: "launch", demo: true })} title="示例数据走完整流程：不调用模型、不写业务数据、不耗额度">
            演示运行
          </Btn>
          {brief.questions.length ? <Btn v="ghost" size="sm" disabled={!!busy} onClick={() => act("back", { action: "back" })}>改答案</Btn> : null}
          <Btn v="ghost" size="sm" disabled={!!busy} onClick={() => act("dismiss", { action: "dismiss" })}>先不做</Btn>
        </div>
      </div>
    </Card>
  );
}
