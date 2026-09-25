"use client";
/**
 * Muse 前端蓝图。所有数据来自 mock-data，唯一的后端接入点是 send()。
 * 语义约束：状态用文字+形状+颜色三重编码；UNKNOWN 保持 UNKNOWN；业务数据改动一律走确认卡片。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Decision, EvidenceRef, Message, StudioModel } from "./types";
import { Btn, I, StateTag } from "./components/kit";
import { CheckIn, Plan, Sources, Turn, Working } from "./components/turn";
import { Palette, SourceSheet, TrailSheet, TrustSheet } from "./components/sheets";
import { Blank, Dock, Rail } from "./components/shell";

type SheetState = { kind: "trail" } | { kind: "trust" } | { kind: "source"; ref: EvidenceRef } | null;

export default function MuseClient({ model }: { model: StudioModel }) {
  const { brief, employees, runtime } = model;
  const [goalId, setGoalId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>(model.messages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [palette, setPalette] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [resolved, setResolved] = useState<Record<string, string>>({});

  const goal = useMemo(() => brief.missions.find((m) => m.id === goalId) ?? null, [brief.missions, goalId]);
  const pending = brief.decisions.filter((d) => !resolved[d.id]);
  const goalDecisions = pending.filter((d) => (goal ? d.missionId === goal.id : false));

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const openSource = useCallback((ref: EvidenceRef) => setSheet({ kind: "source", ref }), []);

  /** 唯一的传输点：接后端时把这里换成 POST，其余视图不用动。 */
  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft("");
    const mine: Message = {
      id: `local-${Date.now()}`,
      author: "user",
      at: "刚刚",
      state: "success",
      blocks: [{ kind: "text", text }],
    };
    const ack: Message = {
      id: `local-${Date.now()}-a`,
      author: "hermes",
      byEmployeeId: "e-hermes",
      at: "刚刚",
      state: "working",
      blocks: [{ kind: "text", text: "收到。我先拆成可执行的步骤，缺关键信息会回来问你，不会自己编。" }],
    };
    setMessages((prev) => [...prev, mine, ack]);
    setSending(false);
  }, [draft, sending]);

  const resolve = useCallback((d: Decision, choice: string) => {
    setResolved((p) => ({ ...p, [d.id]: choice }));
    setMessages((prev) => [
      ...prev,
      { id: `r-${d.id}`, author: "user", at: "刚刚", state: "success", blocks: [{ kind: "text", text: `${d.title}：${choice}` }] },
      {
        id: `r-${d.id}-a`, author: "hermes", byEmployeeId: "e-hermes", at: "刚刚", state: "working",
        blocks: [{ kind: "text", text: `已记录你的选择（${choice}），我按这个继续推进，有结果会回来说。` }],
      },
    ]);
  }, []);

  return (
    <div className="muse" data-rail={railOpen ? "open" : undefined}>
      <Rail
        user={model.user}
        missions={brief.missions}
        activeId={goalId}
        pendingCount={pending.length}
        runtime={runtime}
        onPick={(id) => { setGoalId(id); setRailOpen(false); }}
        onNew={() => { setGoalId(null); setRailOpen(false); setDraft(""); }}
        onTrust={() => setSheet({ kind: "trust" })}
        onClose={() => setRailOpen(false)}
      />

      <main className="m-main">
        <header className="m-top">
          <div className="m-top-in">
          <button type="button" className="m-btn m-rail-open" data-v="ghost" data-size="sm" onClick={() => setRailOpen(true)} aria-label="展开侧栏">
            <I.menu />
          </button>
          <h1 className="m-top-title">{goal ? goal.title : "今天"}</h1>
          {goal ? <StateTag state={goal.state} /> : null}
          <div className="m-top-acts">
            <Btn size="sm" onClick={() => setPalette(true)}><I.search />跳转</Btn>
            <Btn size="sm" onClick={() => setSheet({ kind: "trail" })}><I.trail />轨迹</Btn>
          </div>
          </div>
        </header>

        <div className="m-scroll">
          <div className="m-lane">
            {goal === null ? (
              <>
                <p className="m-prose">
                  {brief.greeting}，{model.user.name}。{pending.length > 0
                    ? `有 ${pending.length} 件事需要你点头，其余我在自己推进。`
                    : "没有需要你点头的事，我继续推进手上的目标。"}
                </p>
                {pending.map((d) => <CheckIn key={d.id} d={d} onOpenSource={openSource} onResolve={resolve} />)}
                {brief.missions.some((m) => m.state === "working") ? (
                  <Working text="正在推进：" />
                ) : null}
                {brief.missions.filter((m) => m.state === "working").map((m) => (
                  <section key={m.id} className="m-card">
                    <header className="m-card-head">
                      <span className="m-ico"><I.plan /></span>
                      <h3>{m.title}</h3>
                      <StateTag state={m.state} />
                    </header>
                    <div className="m-card-body">
                      <p className="m-quiet" style={{ margin: 0 }}>{m.goal}</p>
                      <Plan steps={m.steps} employees={employees} />
                      <Btn size="sm" onClick={() => setGoalId(m.id)}>进去看</Btn>
                    </div>
                  </section>
                ))}
                {messages.length === 0 ? (
                  <Blank seeds={brief.suggestions} onSeed={setDraft} />
                ) : (
                  <p className="m-hint">想开新的一件事，直接在下面说。</p>
                )}
              </>
            ) : (
              <>
                <p className="m-prose">{goal.goal}</p>
                <section className="m-card">
                  <header className="m-card-head">
                    <span className="m-ico"><I.plan /></span>
                    <h3>我的推进计划</h3>
                    <span className="m-hint" style={{ margin: 0 }}>
                      {goal.progress === null ? "进度 UNKNOWN" : `已完成 ${goal.progress}%`}
                    </span>
                  </header>
                  <div className="m-card-body"><Plan steps={goal.steps} employees={employees} /></div>
                </section>
                {goalDecisions.map((d) => <CheckIn key={d.id} d={d} onOpenSource={openSource} onResolve={resolve} />)}
                {goal.evidence.length > 0 ? (
                  <section className="m-card">
                    <header className="m-card-head">
                      <span className="m-ico"><I.source /></span>
                      <h3>这件事的依据</h3>
                    </header>
                    <div className="m-card-body"><Sources refs={goal.evidence} onOpen={openSource} /></div>
                  </section>
                ) : null}
                {messages.map((m) => <Turn key={m.id} m={m} employees={employees} onOpenSource={openSource} />)}
              </>
            )}
          </div>
        </div>

        <Dock
          value={draft}
          onChange={setDraft}
          onSend={send}
          sending={sending}
          capabilities={runtime.capabilities}
          onTrust={() => setSheet({ kind: "trust" })}
        />
      </main>

      {sheet?.kind === "trail" ? <TrailSheet activity={model.activity} missions={brief.missions} onClose={() => setSheet(null)} /> : null}
      {sheet?.kind === "trust" ? <TrustSheet runtime={runtime} onClose={() => setSheet(null)} /> : null}
      {sheet?.kind === "source" ? <SourceSheet ref_={sheet.ref} onClose={() => setSheet(null)} /> : null}
      {palette ? <Palette missions={brief.missions} onClose={() => setPalette(false)} onPick={setGoalId} /> : null}
    </div>
  );
}
