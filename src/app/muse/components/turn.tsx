"use client";
/** 会话与就地卡片：Kern 的回答是可读的散文 + 少量结构化卡片，不是仪表盘。 */
import type { Decision, Employee, EvidenceRef, Message, MessageBlock, PlanStep } from "../types";
import { fmtDate, fmtTime } from "@/shared/datetime";
import { KernGraphCard } from "./graph";
import { MissionCard } from "./mission";
import { BriefCard } from "./brief";
import { MissionConclusion } from "./mission-conclusion";
import { RichText } from "../rich/rich-text";
import { useKernHost } from "../rich/reader-context";
import { Btn, Card, CardHead, CONF, I, Node, StateTag, Tag, TONE } from "./kit";
import { HoldToConfirm } from "@/components/motion/hold-to-confirm";
import { useEnterOnce } from "@/components/motion/react";
import { useEffect, useRef, useState } from "react";

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

/** 等待回复：只在请求真实进行中时出现；不模拟逐字生成，也不编造进度。灰条只是中性占位，不代表进度。 */
export function Working({ text, since }: { text: string; since?: string | null }) {
  const [visible, setVisible] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    if (!since || !visible) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [since, visible]);
  const started = since ? Date.parse(since) : NaN;
  const elapsed = Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1000)) : null;
  const waiting = text.includes("等待");
  return (
    <div className="m-working" data-motion={visible && !waiting ? "running" : "still"} role="status" aria-live="polite">
      <span className="m-working-network" aria-hidden="true">
        <span className="m-working-point"><I.source /></span>
        <svg viewBox="0 0 72 24"><path d="M0 12h72" /><path className="m-working-signal" d="M0 12h72" /></svg>
        <span className="m-working-core"><I.spark /></span>
      </span>
      <span className="m-working-copy"><strong>Kern</strong><span>{text}</span></span>
      {elapsed !== null ? (
        // Only the label is announced on change; the ticking number is hidden from the live region.
        <span className="m-working-elapsed" aria-hidden="true">{waiting ? "已等待" : "已用时"} {fmtElapsed(elapsed)}</span>
      ) : null}
    </div>
  );
}

function fmtElapsed(seconds: number) {
  if (seconds < 60) return `${seconds} 秒`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m} 分 ${String(s).padStart(2, "0")} 秒`;
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
          {d.options.map((o, i) =>
            // 触及受保护动作（gate）的批准不可撤回：用长按确认防误触。
            d.gate && o.kind === "approve" ? (
              <HoldToConfirm key={o.id} v="primary" hint={`按住${o.label}`} onConfirm={() => onResolve(d, o)}>
                {o.label}
              </HoldToConfirm>
            ) : (
              <Btn key={o.id} v={i === 0 ? "primary" : o.kind === "reject" ? "danger" : "default"} title={o.hint} onClick={() => onResolve(d, o)}>
                {o.label}
              </Btn>
            ),
          )}
        </div>
        <p className="m-hint">{d.raisedBy} 提出{d.gate ? ` · ${d.gate}` : ""}。确认后 Kern 会自己继续，不用你盯着。</p>
      </div>
    </div>
  );
}

/** Mission report in the stream + one click into the shared reading pane (same surface as artifacts). */
function ConclusionBlock({ missionId, text }: { missionId: string; text: string }) {
  const host = useKernHost();
  return (
    <div className="kxr-conclusion">
      <MissionConclusion missionId={missionId} text={text} />
      {host ? (
        <div className="kxr-fold">
          <button type="button" className="kxr-fold-btn" data-v="read" onClick={(e) => host.openReader({ kind: "mission", missionId, text, title: "任务报告" }, e.currentTarget)}>
            阅读模式
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Block({ b, employees, onOpenSource, missionAttached = false, messageId }: { b: MessageBlock; employees: Employee[]; onOpenSource: (r: EvidenceRef) => void; missionAttached?: boolean; messageId: string }) {
  switch (b.kind) {
    case "text":
      // Plain replies render as Prose (RichText falls through); kern-ui blocks and artifacts get rich renderers.
      return <RichText text={b.text} artifacts={b.artifacts ?? []} messageId={messageId} />;
    case "conclusion":
      return <ConclusionBlock missionId={b.ref} text={b.text} />;
    case "graph":
      return <KernGraphCard graph={b.graph} />;
    case "mission":
      return <MissionCard missionId={b.ref} />;
    case "brief":
      return <BriefCard messageId={b.ref} missionAttached={missionAttached} />;
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
            {/* 批准只有一个入口：对话里的确认卡 / 顶栏「需要你」（有真实提议 id 与审计）。这里只做预览，不放无效按钮。 */}
            <p className="m-hint">Kern 不直接改业务数据。这项改动已放进「需要你」，在那里批准或拒绝。</p>
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

export function friendlyTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // 一律按业务时区计算「今天 / 昨天」与时分：服务端（UTC）与浏览器渲染结果一致，不会 hydration 失败。
  const hm = fmtTime(d).slice(0, 5);
  const day = fmtDate(d);
  const now = Date.now();
  if (day === fmtDate(now)) return hm;
  if (day === fmtDate(now - 86_400_000)) return `昨天 ${hm}`;
  const [, month, date] = day.split("-");
  return `${Number(month)}月${Number(date)}日 ${hm}`;
}

export function Turn({ m, employees, onOpenSource, onRetry, enter = false }: { m: Message; employees: Employee[]; onOpenSource: (r: EvidenceRef) => void; onRetry?: () => void; enter?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  // 新消息整条轻微上移淡入一次；历史消息、轮询刷新不重播。
  useEnterOnce(ref, enter);
  if (m.author === "user") {
    return (
      <article ref={ref} className="m-turn" data-who="me">
        {m.blocks.map((b, i) => <p key={i} className="m-said">{b.kind === "text" ? b.text : ""}</p>)}
      </article>
    );
  }
  const by = employees.find((e) => e.id === m.byEmployeeId);
  return (
    <article ref={ref} className="m-turn">
      <div className="m-who">
        <span className="m-who-av" aria-hidden>{by?.mark ?? "K"}</span>
        <b>{by?.name && !/^Kern\b/.test(by.name) ? by.name : "Kern"}</b>
        <span aria-hidden>·</span>
        <time dateTime={m.at} title={m.at}>{friendlyTime(m.at)}</time>
        {m.state !== "success" ? <StateTag state={m.state} /> : null}
      </div>
      {m.blocks.map((b, i) => enter ? (
        <span key={i} className="m-block-in" style={{ animationDelay: `${Math.min(i, 8) * 90}ms` }}>
          <Block b={b} messageId={m.id} employees={employees} onOpenSource={onOpenSource} missionAttached={m.blocks.some(block => block.kind === "mission")} />
        </span>
      ) : (
        <Block key={i} b={b} messageId={m.id} employees={employees} onOpenSource={onOpenSource} missionAttached={m.blocks.some(block => block.kind === "mission")} />
      ))}
      {m.state === "error" && onRetry ? (
        <div className="m-turn-retry"><Btn size="sm" v="ghost" onClick={onRetry}>重试</Btn></div>
      ) : null}
    </article>
  );
}
