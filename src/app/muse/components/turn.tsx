"use client";
/** 会话与就地卡片：Kern 的回答是可读的散文 + 少量结构化卡片，不是仪表盘。 */
import type { Decision, Employee, EvidenceRef, Message, MessageBlock, PlanStep } from "../types";
import { Btn, Card, CardHead, CONF, I, Node, StateTag, Tag, TONE } from "./kit";

export function Plan({ steps, employees }: { steps: PlanStep[]; employees: Employee[] }) {
  return (
    <ol className="m-plan">
      {steps.map((s) => {
        const who = employees.find((e) => e.id === s.ownerId);
        return (
          <li key={s.id} className="m-step">
            <Node state={s.state} />
            <div className="m-step-main">
              <b>{s.title}</b>
              {s.detail ? <span>{s.detail}</span> : null}
            </div>
            <span className="m-step-by">{who ? who.name : "待分派"}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function Working({ text }: { text: string }) {
  return (
    <div className="m-working" aria-live="polite">
      <span className="m-orb" aria-hidden />
      {text}
    </div>
  );
}

export function Sources({ refs, onOpen }: { refs: EvidenceRef[]; onOpen: (r: EvidenceRef) => void }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {refs.map((r) => {
        const c = CONF[r.confidence];
        return (
          <button key={r.id} type="button" className="m-src" onClick={() => onOpen(r)}>
            <Tag tone={c.tone}>{c.label}</Tag>
            <span>{r.title}</span>
            <small>{r.verified ? "已复核" : "未复核"}</small>
          </button>
        );
      })}
    </div>
  );
}

/** 审批 check-in。Kern 只在这种时刻打断人，所以它必须是页面上最重的东西。 */
export function CheckIn({ d, onOpenSource, onResolve }: { d: Decision; onOpenSource: (r: EvidenceRef) => void; onResolve: (d: Decision, choice: Decision["options"][number]) => void }) {
  const tone = TONE[d.tone] === "bad" ? "bad" : "warn";
  return (
    <div className="m-checkin" data-t={tone}>
      <div className="m-checkin-strip">
        <I.shield />
        需要你确认 · {d.dueLabel}
      </div>
      <div className="m-checkin-body">
        <h3>{d.title}</h3>
        <p className="m-because">{d.because}</p>
        <p className="m-else">继续放着：{d.ifIgnored}</p>
        {d.evidence.length > 0 ? <Sources refs={d.evidence} onOpen={onOpenSource} /> : (
          <p className="m-else" style={{ color: "var(--m-warn)", background: "var(--m-warn-wash)" }}>
            这件事目前没有可追溯的依据，确认前可以让 Kern 先去补。
          </p>
        )}
        <div className="m-btn-row">
          {d.options.map((o, i) => (
            <Btn key={o.id} v={i === 0 ? "primary" : o.kind === "reject" ? "danger" : "default"} title={o.hint} onClick={() => onResolve(d, o)}>
              {o.label}
            </Btn>
          ))}
        </div>
        <p className="m-hint">{d.raisedBy} 提出{d.gate ? ` · ${d.gate}` : ""}。确认后 Kern 会自己继续，不用你盯着。</p>
      </div>
    </div>
  );
}

function Block({ b, employees, onOpenSource }: { b: MessageBlock; employees: Employee[]; onOpenSource: (r: EvidenceRef) => void }) {
  switch (b.kind) {
    case "text":
      return <p className="m-prose">{b.text}</p>;
    case "plan":
      return (
        <Card>
          <CardHead icon={<I.plan />} title={b.title} />
          <div className="m-card-body"><Plan steps={b.steps} employees={employees} /></div>
        </Card>
      );
    case "evidence":
      return (
        <Card>
          <CardHead icon={<I.source />} title={b.title} />
          <div className="m-card-body"><Sources refs={b.refs} onOpen={onOpenSource} /></div>
        </Card>
      );
    case "runtime":
      return (
        <Card>
          <CardHead icon={<I.mac />} title={b.title} aside={<StateTag state={b.state} />} />
          <div className="m-card-body">
            <pre className="m-term"><b>$ {b.command}</b>{"\n"}{b.output}</pre>
            <p className="m-hint">在你自己的 Mac 上执行，回执已存档。</p>
          </div>
        </Card>
      );
    case "proposal":
      return (
        <Card>
          <CardHead icon={<I.shield />} title={b.title} />
          <div className="m-card-body">
            <p className="m-quiet" style={{ margin: 0 }}>{b.summary}</p>
            <div className="m-diff">
              {b.diff.map((d) => (
                <div key={d.field} className="m-diff-row">
                  <i>{d.field}</i>
                  <span className="m-was">{d.from}</span>
                  <span aria-hidden style={{ color: "var(--m-ink-4)" }}>→</span>
                  <span className="m-now">{d.to}</span>
                </div>
              ))}
            </div>
            <div className="m-btn-row">
              <Btn v="primary">批准写入</Btn>
              <Btn>先不改</Btn>
            </div>
            <p className="m-hint">Kern 不直接改业务数据，改动一律先给你看。</p>
          </div>
        </Card>
      );
    case "verdict": {
      const map = { pass: { t: "ok" as const, l: "通过" }, fail: { t: "bad" as const, l: "未通过" }, unknown: { t: "warn" as const, l: "无法判定" } };
      const v = map[b.verdict];
      return (
        <Card>
          <CardHead icon={<I.check />} title={b.title} aside={<Tag tone={v.t}>{v.l}</Tag>} />
          <div className="m-card-body"><ul className="m-list">{b.notes.map((n) => <li key={n}>{n}</li>)}</ul></div>
        </Card>
      );
    }
    case "unknown":
      return (
        <Card>
          <CardHead icon={<I.spark />} title="缺口：Kern 不替你猜" />
          <div className="m-card-body">
            <p className="m-prose" style={{ fontSize: "var(--m-t-body)" }}>{b.question}</p>
            <ul className="m-list">{b.missing.map((m) => <li key={m}>{m}</li>)}</ul>
          </div>
        </Card>
      );
  }
}

export function Turn({ m, employees, onOpenSource }: { m: Message; employees: Employee[]; onOpenSource: (r: EvidenceRef) => void }) {
  if (m.author === "user") {
    return (
      <article className="m-turn" data-who="me">
        {m.blocks.map((b, i) => <p key={i} className="m-said">{b.kind === "text" ? b.text : ""}</p>)}
      </article>
    );
  }
  const by = employees.find((e) => e.id === m.byEmployeeId);
  return (
    <article className="m-turn">
      <div className="m-who">
        <span className="m-who-av" aria-hidden>{by?.mark ?? "M"}</span>
        <b>{by?.name ?? "Kern"}</b>
        <span>{by?.role ?? "你的助理"}</span>
        <span aria-hidden>·</span>
        <span>{m.at}</span>
        {m.state !== "success" ? <StateTag state={m.state} /> : null}
      </div>
      {m.blocks.map((b, i) => <Block key={i} b={b} employees={employees} onOpenSource={onOpenSource} />)}
    </article>
  );
}
