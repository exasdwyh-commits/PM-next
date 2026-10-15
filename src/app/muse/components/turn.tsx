"use client";
/** 会话与就地卡片：Kern 的回答是可读的散文 + 少量结构化卡片，不是仪表盘。 */
import type { Decision, Employee, EvidenceRef, Message, MessageBlock, PlanStep } from "../types";
import { fmtDate, fmtTime } from "@/shared/datetime";
import { KernGraphCard } from "./graph";
import { MissionCard } from "./mission";
import { BriefCard } from "./brief";
import { MissionConclusion } from "./mission-conclusion";
import { RichText } from "../rich/rich-text";
import { ReportCard } from "../rich/report-card";
import { CopyBtn } from "./controls";
import { useKernHost } from "../rich/reader-context";
import { Btn, Card, CardHead, CONF, I, Node, StateTag, Tag, TONE } from "./kit";
import { HoldToConfirm } from "@/components/motion/hold-to-confirm";
import { useEnterOnce } from "@/components/motion/react";
import { describeMarkers } from "@/modules/artifacts/protocol";
import { richTextToMarkdown } from "@/modules/artifacts/rich-blocks";
import { executiveReportPath } from "@/shared/executive-report-citation";
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
    // 单列网格必须用 minmax(0,1fr)：默认 auto 轨道会被行内 min-width:auto 的项撑宽，
    // 长标题（如 Obsidian 的深度标题路径）会顶破卡片而不是省略号截断。
    <div style={{ display: "grid", gap: 8, gridTemplateColumns: "minmax(0, 1fr)" }}>
      {refs.map((r) => {
        const c = CONF[r.confidence];
        return (
          <button key={r.id} type="button" className="m-src" title={r.title} onClick={() => onOpen(r)}>
            <Tag tone={c.tone}>{c.label}</Tag>
            <span>{r.title}</span>
            <small>{r.verified ? "已复核" : "未复核"}</small>
          </button>
        );
      })}
    </div>
  );
}

/**
 * 审批 check-in。Kern 只在这种时刻打断人，所以它必须是页面上最重的东西。
 *
 * 本轮补齐的四条交互约束：
 * - 批准前必须看得见内容：`d.summary` 列出将要写入的字段，光有标题等于让用户盲批。
 * - 请求在途（`busy`）时所有按钮禁用：在途再点一次就是重复提交。
 * - 失败时卡片留在原处、给错误与「重试」：失败既不能隐藏卡片，更不能显示成成功。
 *   重试沿用父级保存的同一个幂等键，因此不会二次写入。
 * - 「稍后处理」= 折叠为待办提示（`deferred`）：推迟既不是批准也不是拒绝，
 *   服务端状态仍是待确认，一个字节的业务数据都没写。
 */
export function CheckIn({
  d,
  onOpenSource,
  onResolve,
  busy = false,
  error = null,
  onRetry,
  deferred = false,
  onRestore,
}: {
  d: Decision;
  onOpenSource: (r: EvidenceRef) => void;
  onResolve: (d: Decision, choice: Decision["options"][number]) => void;
  /** 本卡片有请求在途 */
  busy?: boolean;
  /** 上一次处理失败的原因；非空时展示错误与重试入口 */
  error?: string | null;
  onRetry?: () => void;
  /** 已被「稍后处理」折叠 */
  deferred?: boolean;
  onRestore?: () => void;
}) {
  const tone = TONE[d.tone] === "bad" ? "bad" : "warn";
  if (deferred) {
    return (
      <div className="m-checkin" data-t={tone} data-testid="checkin-deferred" data-decision-id={d.id}>
        <div className="m-checkin-body">
          <h3>{d.title}</h3>
          <p className="m-hint">
            已推迟处理：这条提议仍是「待你确认」，不会自动执行，也不等于拒绝；业务数据一个都没写。
          </p>
          <div className="m-btn-row">
            <Btn v="default" onClick={onRestore} disabled={busy} data-testid="checkin-restore">
              继续处理
            </Btn>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div
      className="m-checkin"
      data-t={tone}
      data-testid="checkin"
      data-decision-id={d.id}
      data-busy={busy ? "" : undefined}
      aria-busy={busy}
    >
      <div className="m-checkin-strip">
        <I.shield />
        需要你确认 · {d.dueLabel}
      </div>
      <div className="m-checkin-body">
        <h3>{d.title}</h3>
        <p className="m-because">{d.because}</p>
        {d.summary && d.summary.length > 0 ? (
          <div data-testid="checkin-summary" style={{ marginTop: 8 }}>
            <p className="m-hint" style={{ margin: 0 }}>将要写入的内容：</p>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {d.summary.map((line) => (
                <li key={line} className="m-hint">{line}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="m-else">继续放着：{d.ifIgnored}</p>
        {d.evidence.length > 0 ? <Sources refs={d.evidence} onOpen={onOpenSource} /> : (
          <p
            className="m-else"
            data-testid="checkin-empty-evidence"
            style={{ color: "var(--m-warn)", background: "var(--m-warn-wash)" }}
          >
            {d.emptyEvidenceHint ?? "这件事目前没有可追溯的依据，确认前可以让 Kern 先去补。"}
          </p>
        )}
        <div className="m-btn-row">
          {d.options.map((o, i) =>
            // 触及受保护动作（gate）的批准不可撤回：用长按确认防误触（默认 600ms）。
            d.gate && o.kind === "approve" ? (
              <HoldToConfirm key={o.id} testId="checkin-approve" v="primary" hint={`按住${o.label}`} disabled={busy} onConfirm={() => onResolve(d, o)}>
                {o.label}
              </HoldToConfirm>
            ) : (
              <Btn
                key={o.id}
                v={i === 0 ? "primary" : o.kind === "reject" ? "danger" : "default"}
                title={o.hint}
                disabled={busy}
                data-testid={o.kind === "reject" ? "checkin-reject" : o.kind === "defer" ? "checkin-defer" : undefined}
                onClick={() => onResolve(d, o)}
              >
                {o.label}
              </Btn>
            ),
          )}
        </div>
        {error ? (
          <div data-testid="checkin-error" style={{ marginTop: 8 }}>
            <p className="m-else" style={{ color: "var(--m-bad)", background: "var(--m-bad-wash)" }}>
              处理失败：{error}（提议仍是待确认，没有写入任何业务数据。）
            </p>
            {onRetry ? (
              <div className="m-btn-row">
                <Btn v="default" onClick={onRetry} disabled={busy} data-testid="checkin-retry">
                  {busy ? "重试中…" : "重试"}
                </Btn>
              </div>
            ) : null}
          </div>
        ) : null}
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
    case "report":
      // 产品研发 Executive Report：对话里只给方块缩略图 + headline，点开才进排版完整的报告页。
      return <ReportCard citation={b.citation} />;
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

/** 复制用的纯文本：把消息里的结构化块还原成 Markdown / 链接，不带任何渲染细节。 */
function messageMarkdown(m: Message): string {
  const parts: string[] = [];
  for (const b of m.blocks) {
    if (b.kind === "text") {
      const text = b.artifacts?.length
        ? richTextToMarkdown(b.text, (id, v) => describeMarkers(`[[kern-artifact:${id}@${v}]]`, b.artifacts ?? []))
        : b.text;
      if (text.trim()) parts.push(text.trim());
    } else if (b.kind === "conclusion") {
      if (b.text.trim()) parts.push(b.text.trim());
    } else if (b.kind === "report") {
      const origin = typeof window === "undefined" ? "" : window.location.origin;
      parts.push(`${b.citation.title}\n${origin}${executiveReportPath(b.citation.ref)}`);
    }
  }
  return parts.join("\n\n").trim();
}

/** 每条消息的通用操作：复制；用户消息额外可编辑后重发。 */
function MessageActions({ text, onEdit, editing }: { text: string; onEdit?: () => void; editing?: boolean }) {
  if (!text && !onEdit) return null;
  return (
    <div className="m-msg-actions">
      {text ? (
        <CopyBtn text={text} v="ghost" title="复制这条消息">
          复制
        </CopyBtn>
      ) : null}
      {onEdit ? (
        <button type="button" className="m-msg-action" aria-pressed={editing || undefined} onClick={onEdit}>
          {editing ? "取消编辑" : "编辑"}
        </button>
      ) : null}
    </div>
  );
}

/** 用户消息的内联编辑：保存后按编辑后的内容重新发一轮（对话本身是追加式的）。 */
function UserEditor({ text, busy, onCancel, onResend }: { text: string; busy: boolean; onCancel: () => void; onResend: (next: string) => void }) {
  const [value, setValue] = useState(text);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, []);
  const submit = () => {
    const next = value.trim();
    if (!next || next === text.trim()) {
      onCancel();
      return;
    }
    onResend(next);
  };
  return (
    <div className="m-edit">
      <textarea
        ref={taRef}
        className="m-edit-input"
        value={value}
        rows={Math.min(10, Math.max(2, Math.ceil(value.length / 40)))}
        aria-label="编辑这条消息"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="m-edit-actions">
        <Btn v="primary" size="sm" disabled={busy || !value.trim()} onClick={submit}>
          重新发送
        </Btn>
        <Btn v="ghost" size="sm" onClick={onCancel}>
          取消
        </Btn>
        <span className="m-edit-hint">对话按时间追加：保存后会以编辑后的内容发出新的一条（⌘/Ctrl + Enter）</span>
      </div>
    </div>
  );
}

export function Turn({ m, employees, onOpenSource, onRetry, onResend, busy = false, enter = false }: { m: Message; employees: Employee[]; onOpenSource: (r: EvidenceRef) => void; onRetry?: () => void; onResend?: (text: string) => void; busy?: boolean; enter?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState(false);
  // 新消息整条轻微上移淡入一次；历史消息、轮询刷新不重播。
  useEnterOnce(ref, enter);
  const copyText = messageMarkdown(m);

  if (m.author === "user") {
    const plain = m.blocks.flatMap((b) => (b.kind === "text" ? [b.text] : [])).join("\n");
    return (
      <article ref={ref} className="m-turn" data-who="me">
        {editing ? (
          <UserEditor
            text={plain}
            busy={busy}
            onCancel={() => setEditing(false)}
            onResend={(next) => {
              setEditing(false);
              onResend?.(next);
            }}
          />
        ) : (
          <>
            {m.blocks.map((b, i) => <p key={i} className="m-said">{b.kind === "text" ? b.text : ""}</p>)}
            <MessageActions text={copyText} onEdit={onResend ? () => setEditing(true) : undefined} editing={false} />
          </>
        )}
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
      <MessageActions text={copyText} />
    </article>
  );
}
