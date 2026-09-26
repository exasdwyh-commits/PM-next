"use client";
/**
 * Mission workspace (「过程」/「产出」). Opened from the mission card in the
 * conversation. Default is the summary; 「完整」 shows everything we record:
 * method, model, latency, sources, retries, the user's interventions.
 */
import { useMemo, useState } from "react";
import type { AiState } from "../types";
import {
  AGENT_LABEL,
  GATE_LABEL,
  agentLabel,
  buildChallenges,
  buildLanes,
  buildTimeline,
  currentActivity,
  formatClock,
  formatMs,
  nodeLabel,
  qaLabel,
  reasonLabel,
  totalModelCalls,
  type Lane,
  type MissionStatusView,
} from "../mission-timeline";
import { useMission } from "../use-mission";
import { Btn, I, Node, Tag } from "./kit";
import { Prose } from "./prose";
import { Sheet } from "./sheets";

export function laneState(status: string): AiState {
  switch (status) {
    case "SUCCEEDED":
      return "success";
    case "ACTIVE":
      return "working";
    case "BLOCKED":
      return "needs-review";
    case "FAILED":
      return "error";
    case "SKIPPED":
      return "cancelled";
    default:
      return "idle";
  }
}

const STATUS_TEXT: Record<string, string> = {
  PENDING: "等待中",
  ACTIVE: "进行中",
  SUCCEEDED: "完成",
  BLOCKED: "受阻",
  FAILED: "失败",
  SKIPPED: "已跳过",
};

const ERROR_TEXT: [RegExp, string][] = [
  [/RERUN_LIMIT/, "这项任务重跑次数已到上限（5 次）"],
  [/DOWNSTREAM_ACTIVE/, "它的下游步骤还在进行，等它们做完再重跑"],
  [/NODE_NOT_FINISHED/, "这一步还没做完，不能重跑"],
  [/NODE_NOT_PENDING/, "只能调整还没开始的步骤"],
  [/STRUCTURAL/, "QA 与综合结论是固定环节，不能删改"],
  [/CONSUMER_STARTED/, "QA 已经开始，不能再加步骤了"],
  [/already paused/, "已经暂停了"],
  [/not paused/, "任务没有暂停"],
  [/already finished|was cancelled/, "任务已经结束"],
  [/is paused/, "先继续任务，再重跑"],
  [/synthesis step cannot be skipped/, "综合结论不能跳过；不想要了可以取消任务"],
  [/INVALID_KEY|DUPLICATE_KEY/, "步骤名称无效或重复"],
];
function friendly(message?: string) {
  if (!message) return "操作失败";
  return ERROR_TEXT.find(([re]) => re.test(message))?.[1] ?? message;
}

const TERMINAL = new Set(["SUCCEEDED", "BLOCKED", "FAILED", "SKIPPED"]);

export function MissionWorkspace({ missionId, onClose, initialTab = "process" }: { missionId: string; onClose: () => void; initialTab?: "process" | "output" }) {
  const { status, events, live, control } = useMission(missionId);
  const [tab, setTab] = useState<"process" | "output">(initialTab);
  const [detail, setDetail] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const lanes = useMemo(() => buildLanes(status, events), [status, events]);
  const timeline = useMemo(() => buildTimeline(events), [events]);
  const challenges = useMemo(() => buildChallenges(events), [events]);
  const usage = useMemo(() => totalModelCalls(lanes), [lanes]);

  const running = !!status && !status.outcome;
  const act = async (key: string, body: Record<string, unknown>, ok: string) => {
    setBusy(key);
    setNotice(null);
    const r = await control(body);
    setBusy(null);
    setNotice(r.ok ? { tone: "ok", text: ok } : { tone: "bad", text: friendly(r.message) });
    return r.ok;
  };

  const controls = status ? (
    <div className="m-ws-controls">
      {running && !status.paused ? (
        <Btn size="sm" disabled={!!busy} onClick={() => act("pause", { action: "pause" }, "已暂停：进行中的步骤做完后停下")}>
          暂停
        </Btn>
      ) : null}
      {running && status.paused ? (
        <Btn size="sm" v="primary" disabled={!!busy} onClick={() => act("resume", { action: "resume" }, "已继续")}>
          继续
        </Btn>
      ) : null}
      {status.outcome?.status === "NEEDS_USER" ? (
        <Btn size="sm" v="primary" disabled={!!busy} onClick={() => act("resume", { action: "resume" }, "已从停下的地方继续")}>
          继续推进
        </Btn>
      ) : null}
      {running ? (
        confirmCancel ? (
          <>
            <Btn size="sm" v="danger" disabled={!!busy} onClick={async () => { setConfirmCancel(false); await act("cancel", { action: "cancel" }, "任务已取消"); }}>
              确认取消
            </Btn>
            <Btn size="sm" v="ghost" onClick={() => setConfirmCancel(false)}>算了</Btn>
          </>
        ) : (
          <Btn size="sm" v="ghost" disabled={!!busy} onClick={() => setConfirmCancel(true)}>
            取消任务
          </Btn>
        )
      ) : null}
    </div>
  ) : null;

  return (
    <Sheet
      wide
      title={status?.goal ?? "任务"}
      sub={status ? `${status.progress.done}/${status.progress.total} 步 · ${currentActivity(status, events)}` : "读取中…"}
      onClose={onClose}
      aside={controls}
    >
      {status?.demo ? <div className="m-ws-demo">演示模式 · 不写入业务数据、不消耗额度</div> : null}
      <div className="m-ws-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "process"} onClick={() => setTab("process")}>过程</button>
        <button type="button" role="tab" aria-selected={tab === "output"} onClick={() => setTab("output")}>
          产出{status?.outcome?.status === "COMPLETED" ? <i className="m-ws-dot" aria-hidden /> : null}
        </button>
        <span className="m-ws-spacer" />
        {tab === "process" ? (
          <div className="m-seg" role="group" aria-label="展示粒度">
            <button type="button" aria-pressed={!detail} onClick={() => setDetail(false)}>摘要</button>
            <button type="button" aria-pressed={detail} onClick={() => setDetail(true)}>完整</button>
          </div>
        ) : null}
        {live ? <Tag tone="accent" live>实时</Tag> : null}
      </div>
      {notice ? <p className="m-ws-notice" data-t={notice.tone} role="status">{notice.text}</p> : null}

      {!status ? (
        <p className="m-quiet">读取进展…</p>
      ) : tab === "process" ? (
        <>
          {status.paused ? (
            <div className="m-ws-banner" data-t="warn">
              <b>已暂停</b>
              <span>进行中的步骤会做完，不会派发新步骤。你可以趁现在补充信息或调整计划。</span>
            </div>
          ) : null}
          <ol className="m-lanes">
            {lanes.map((lane) => (
              <LaneRow
                key={lane.key}
                lane={lane}
                status={status}
                detail={detail}
                busy={busy}
                onRerun={(feedback) => act(`rerun:${lane.key}`, { action: "rerun", nodeKey: lane.key, feedback }, `已安排重跑「${lane.label}」`)}
                onSkip={() => act(`skip:${lane.key}`, { action: "skip", nodeKey: lane.key }, `已跳过「${lane.label}」`)}
                onRemove={() => act(`rm:${lane.key}`, { action: "edit-plan", edits: [{ op: "remove", key: lane.key }] }, `已从计划中移除「${lane.label}」`)}
              />
            ))}
          </ol>

          {running ? (
            <InterventionPanel
              status={status}
              busy={busy}
              onInput={(text) => act("input", { action: "add-input", text }, "已收到，会带入后续步骤")}
              onAddStep={(node) => act("add", { action: "edit-plan", edits: [{ op: "add", node }] }, `已加入步骤「${node.key}」`)}
            />
          ) : null}

          {status.userInputs.length ? (
            <section className="m-ws-sec">
              <h3>你补充的信息</h3>
              <ul className="m-inputs">
                {status.userInputs.map((u) => (
                  <li key={u.id}>
                    <p>{u.text}</p>
                    <small>
                      {formatClock(u.at)} ·{" "}
                      {u.appliedTo.length ? (
                        <>已带入后续步骤：{u.appliedTo.map(nodeLabel).join("、")}</>
                      ) : running ? (
                        "等待带入下一个开始的步骤"
                      ) : (
                        "之后没有新步骤开始，未被使用"
                      )}
                    </small>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {challenges.length ? (
            <section className="m-ws-sec">
              <h3>QA 与红队</h3>
              {challenges.map((c) => (
                <div key={c.seq} className="m-challenge" data-v={c.verdict ?? undefined}>
                  <header>
                    <Tag tone={c.verdict === "PASS" ? "ok" : c.verdict === "REVISE" ? "warn" : "bad"}>QA {qaLabel(c.verdict)}</Tag>
                    <small>{formatClock(c.at)}</small>
                  </header>
                  {c.items.length ? (
                    <ul>
                      {c.items.map((i, k) => (
                        <li key={k}><b>{i.target ? nodeLabel(i.target) : "整体"}</b>：{i.problem}</li>
                      ))}
                    </ul>
                  ) : <p className="m-quiet">没有提出问题。</p>}
                  {c.revised.length ? <p className="m-hint">→ 已返工：{c.revised.map(nodeLabel).join("、")}</p> : null}
                </div>
              ))}
            </section>
          ) : null}

          {detail ? (
            <section className="m-ws-sec">
              <h3>全部事件 <small>{events.length} 条</small></h3>
              <ol className="m-log">
                {timeline.map((t) => (
                  <li key={t.seq} data-k={t.kind}>
                    <time>{formatClock(t.at)}</time>
                    <span>{t.text}</span>
                    <code>#{t.seq}</code>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </>
      ) : (
        <OutputTab status={status} lanes={lanes} usage={usage} />
      )}
    </Sheet>
  );
}

function LaneRow({
  lane,
  status,
  detail,
  busy,
  onRerun,
  onSkip,
  onRemove,
}: {
  lane: Lane;
  status: MissionStatusView;
  detail: boolean;
  busy: string | null;
  onRerun: (feedback?: string) => Promise<boolean>;
  onSkip: () => Promise<boolean>;
  onRemove: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [rerunOpen, setRerunOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const running = !status.outcome;
  const last = lane.attempts.at(-1);
  const structural = lane.kind === "QA" || lane.kind === "SYNTHESIS";
  const canRerun = TERMINAL.has(lane.status) && status.outcome?.status !== "CANCELLED" && !status.paused;
  const canSkip = running && !TERMINAL.has(lane.status) && lane.kind !== "SYNTHESIS";
  const canRemove = running && lane.status === "PENDING" && !structural;
  const expanded = detail || open;
  const reason = reasonLabel(lane.skippedReason ?? last?.reason ?? null);

  return (
    <li className="m-lane" data-s={lane.status}>
      <div className="m-lane-head">
        <Node state={laneState(lane.status)} />
        <button type="button" className="m-lane-title" onClick={() => setOpen((v) => !v)} aria-expanded={expanded}>
          <b>{lane.label}</b>
          <span>
            {lane.agentLabel}
            {lane.critical ? " · 关键" : ""}
            {lane.attempts.length > 1 ? ` · 第 ${lane.attempts.length} 次` : ""}
          </span>
        </button>
        <span className="m-lane-meta">
          {last?.modelCalls.at(-1)?.latencyMs != null ? formatMs(last.modelCalls.at(-1)!.latencyMs) + " · " : ""}
          {STATUS_TEXT[lane.status] ?? lane.status}
        </span>
      </div>
      {!expanded ? (
        last?.output ? <p className="m-lane-peek">{lane.kind === "QA" ? qaPeek(last.output) : firstLine(last.output)}</p> : reason ? <p className="m-lane-peek" data-t="warn">{reason}</p> : null
      ) : (
        <div className="m-lane-body">
          {lane.objective ? <p className="m-lane-obj"><i>任务</i>{lane.objective}</p> : null}
          {reason ? <p className="m-hint">{reason}</p> : null}
          {lane.attempts.length === 0 ? <p className="m-quiet">{lane.status === "PENDING" ? "等上游完成后开始。" : "暂无执行记录。"}</p> : null}
          {lane.attempts.map((a) => (
            <div key={a.attempt} className="m-attempt">
              {lane.attempts.length > 1 ? (
                <h4>第 {a.attempt} 次{a.revision ? " · 按意见返工" : ""}</h4>
              ) : null}
              <div className="m-kv m-kv-tight">
                {a.method.length ? (<><i>方法</i><span>{a.method.join("、")}</span></>) : null}
                {a.modelCalls.map((c, k) => (
                  <FragmentKV key={k} label={`模型${a.modelCalls.length > 1 ? " " + (k + 1) : ""}`}>
                    {c.ok ? `${c.model ?? "未知模型"}${c.provider ? ` · ${c.provider}` : ""} · ${formatMs(c.latencyMs)}` : `调用失败：${c.error ?? ""}`}
                  </FragmentKV>
                ))}
                {a.durationMs != null ? (<><i>用时</i><span>{formatMs(a.durationMs)}</span></>) : null}
                {a.userInputIds.length ? (<><i>带入</i><span>你补充的 {a.userInputIds.length} 条信息</span></>) : null}
                <i>来源</i>
                <span>
                  {a.cites.length
                    ? a.cites.map((c, k) => <span key={k} className="m-cite">{c.url ? <a href={c.url} target="_blank" rel="noreferrer noopener">{c.title}</a> : c.title}</span>)
                    : "本步没有引用外部来源（结论中的推断会标注）"}
                </span>
              </div>
              {a.output ? (
                <div className="m-lane-out"><Prose text={lane.kind === "QA" ? qaPeek(a.output) : a.output} /></div>
              ) : a.startedAt && !a.finishedAt ? (
                <p className="m-quiet m-typing">正在生成…</p>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {(canRerun || canSkip || canRemove) && (expanded || lane.status === "ACTIVE") ? (
        <div className="m-lane-actions">
          {canRerun ? (
            rerunOpen ? (
              <div className="m-rerun">
                <input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="希望这次改进什么？（可空）" maxLength={500} />
                <Btn size="sm" v="primary" disabled={!!busy} onClick={async () => { if (await onRerun(feedback.trim() || undefined)) { setRerunOpen(false); setFeedback(""); } }}>重跑</Btn>
                <Btn size="sm" v="ghost" onClick={() => setRerunOpen(false)}>算了</Btn>
              </div>
            ) : (
              <Btn size="sm" disabled={!!busy} onClick={() => setRerunOpen(true)}>重跑这一步</Btn>
            )
          ) : null}
          {canSkip ? (
            <Btn size="sm" v="ghost" disabled={!!busy} onClick={onSkip} title={lane.critical ? "关键步骤被跳过后，结论会标记为需要你确认" : undefined}>
              跳过{lane.critical ? "（关键）" : ""}
            </Btn>
          ) : null}
          {canRemove ? <Btn size="sm" v="ghost" disabled={!!busy} onClick={onRemove}>移出计划</Btn> : null}
        </div>
      ) : null}
    </li>
  );
}

function FragmentKV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <i>{label}</i>
      <span>{children}</span>
    </>
  );
}

function qaPeek(text: string) {
  try {
    const raw = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { verdict?: string; summary?: string; issues?: unknown[] };
    return `QA ${qaLabel(raw.verdict)}${raw.summary ? "：" + raw.summary : ""}${raw.issues?.length ? `（${raw.issues.length} 个问题）` : ""}`;
  } catch {
    return firstLine(text);
  }
}

function firstLine(text: string) {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const body = lines.find((l) => !l.startsWith("#") && !l.startsWith("|")) ?? lines[0] ?? "";
  const clean = body.replace(/^#+\s*|^[-*\d.]+\s+|\*\*|`/g, "");
  return clean.length > 110 ? clean.slice(0, 110) + "…" : clean;
}

const ADDABLE_AGENTS = ["research_agent", "product_agent", "marketing_agent", "cost_bom_agent", "compliance_agent", "tech_architect_agent", "ops_agent"];

function InterventionPanel({
  status,
  busy,
  onInput,
  onAddStep,
}: {
  status: MissionStatusView;
  busy: string | null;
  onInput: (text: string) => Promise<boolean>;
  onAddStep: (node: { key: string; agentCode: string; objective: string; dependsOn: string[] }) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [agent, setAgent] = useState(ADDABLE_AGENTS[0]);
  const [objective, setObjective] = useState("");
  const qaStarted = status.nodes.some((n) => (n.kind === "QA" || n.kind === "SYNTHESIS") && n.status !== "PENDING");
  const pending = status.nodes.filter((n) => n.status === "PENDING").length;

  return (
    <section className="m-ws-sec m-intervene">
      <h3>插一句</h3>
      <div className="m-intervene-row">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder={pending ? `补充信息或约束，会带入之后的 ${pending} 个步骤` : "所有步骤都已开始，补充的信息只会用于重跑的步骤"}
        />
        <Btn
          v="primary"
          size="sm"
          disabled={!text.trim() || !!busy}
          onClick={async () => { if (await onInput(text.trim())) setText(""); }}
        >
          补充
        </Btn>
      </div>
      {!qaStarted ? (
        adding ? (
          <div className="m-addstep">
            <select value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="成员">
              {ADDABLE_AGENTS.map((a) => <option key={a} value={a}>{AGENT_LABEL[a]}</option>)}
            </select>
            <input value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="这一步要做什么" maxLength={300} />
            <Btn
              size="sm"
              v="primary"
              disabled={objective.trim().length < 4 || !!busy}
              onClick={async () => {
                const key = `extra-${Date.now().toString(36).slice(-5)}`;
                if (await onAddStep({ key, agentCode: agent, objective: objective.trim(), dependsOn: [] })) {
                  setAdding(false);
                  setObjective("");
                }
              }}
            >
              加入
            </Btn>
            <Btn size="sm" v="ghost" onClick={() => setAdding(false)}>算了</Btn>
          </div>
        ) : (
          <button type="button" className="m-link" onClick={() => setAdding(true)}>
            <I.plus /> 加一个步骤
          </button>
        )
      ) : null}
    </section>
  );
}

function OutputTab({ status, lanes, usage }: { status: MissionStatusView; lanes: Lane[]; usage: { calls: number; latencyMs: number } }) {
  const synth = lanes.find((l) => l.kind === "SYNTHESIS");
  const conclusion = synth?.attempts.at(-1)?.output ?? status.nodes.find((n) => n.kind === "SYNTHESIS")?.summary ?? null;
  const members: Lane[] = [];
  for (const l of lanes) if (l.kind !== "SYNTHESIS" && !members.some((m) => m.agentCode === l.agentCode)) members.push(l);
  return (
    <>
      {status.outcome?.status === "NEEDS_USER" ? (
        <div className="m-ws-banner" data-t="warn">
          <b>需要你处理</b>
          <span>{status.outcome.reasons.map((r) => reasonLabel(r)).join("；")}</span>
        </div>
      ) : null}
      {status.outcome?.status === "CANCELLED" ? <div className="m-ws-banner"><b>已取消</b><span>以下是取消前已经完成的部分。</span></div> : null}
      <section className="m-ws-sec">
        <h3>结论</h3>
        {conclusion ? (
          <div className="m-report"><Prose text={conclusion} /></div>
        ) : (
          <p className="m-quiet">{status.outcome ? "这次没有形成综合结论。" : "综合结论会在所有步骤与 QA 完成后出现。"}</p>
        )}
      </section>
      <section className="m-ws-sec">
        <h3>各步骤产出</h3>
        <ul className="m-outputs">
          {lanes.filter((l) => l.kind !== "SYNTHESIS").map((l) => {
            const out = l.attempts.at(-1)?.output;
            return (
              <li key={l.key}>
                <details>
                  <summary>
                    <Node state={laneState(l.status)} />
                    <b>{l.label}</b>
                    <span>{l.agentLabel}</span>
                  </summary>
                  {out ? <Prose text={out} /> : <p className="m-quiet">{reasonLabel(l.skippedReason) ?? "暂无产出"}</p>}
                </details>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="m-ws-sec">
        <h3>关于这次任务</h3>
        <div className="m-kv">
          <i>为什么是这些成员</i>
          <span>
            <ul className="m-why">
              {members.map((m) => (
                <li key={m.agentCode}><b>{agentLabel(m.agentCode)}</b>：{m.objective.slice(0, 60)}{m.objective.length > 60 ? "…" : ""}</li>
              ))}
            </ul>
          </span>
          <i>为什么需要你决定</i>
          <span>
            {status.humanGates?.length
              ? `Kern 只把这些带给你：${status.humanGates.map((g) => GATE_LABEL[g] ?? g).join("、")}。其余由团队自行推进。`
              : "只有战略取舍、不可逆或受保护的操作才会请你决定。"}
          </span>
          <i>消耗</i>
          <span>
            {status.tasksCreated} 个步骤任务{status.budget ? `（上限 ${status.budget.maxTasks}）` : ""} · {usage.calls} 次模型调用 · 模型累计 {formatMs(usage.latencyMs)}
            {status.demo ? " · 演示不计额度" : ""}
          </span>
          <i>成功标准</i>
          <span>{status.successCriteria?.join("；") ?? "—"}</span>
        </div>
      </section>
    </>
  );
}
