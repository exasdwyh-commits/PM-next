"use client";

/**
 * ResponseView —— Kern 回复的唯一排版出口
 * =======================================
 * 输入 ResponseEnvelope，输出排版好的对话内容。对话卡、右侧工作区、导出 PDF 共用它，
 * 保证"同一份结论在三个地方长得一样"。
 *
 * 渲染前必须过 harness：error 级问题存在时不渲染内容，改为显示诚实的失败态。
 * 规范见 docs/KERN_RESPONSE_SPEC.md。
 */

import { useMemo, useState, type ReactNode } from "react";

import { inline, Prose, SourceRefContext } from "@/app/muse/components/prose";

import {
  CLAIM_LABEL,
  CONFIDENCE_LABEL,
  TRUST_LABEL,
  type Block,
  type ResponseEnvelope,
} from "@/modules/response-format/types";
import { validate } from "@/modules/response-format/validate";

/* ── 行内格式：与日常对话回复共用同一个解析器（src/app/muse/components/prose.tsx），
      [n] 角标经 SourceRefContext 跳到对应来源。 ─────────────────── */
function Inline({ text }: { text: string; onRef?: (n: number) => void }) {
  return <>{inline(text, "i")}</>;
}

function Section({ title, full, children }: { title?: string; full?: boolean; children: React.ReactNode }) {
  return (
    <section className={`kr-block${full ? " kr-only-full" : ""}`}>
      {title ? (
        <div className="kr-h">
          <h2>{title}</h2>
        </div>
      ) : null}
      {children}
    </section>
  );
}

/* ── 单个 Block 的渲染 ─────────────────────────────────────── */
function BlockView({ b, onRef }: { b: Block; onRef: (n: number) => void }) {
  switch (b.type) {
    case "prose":
      return (
        <Section title={b.title} full={b.full}>
          <div className="kr-prose">
            {/* ProseBlock = 一段 Kern 回复格式的 Markdown（docs/KERN_REPLY_FORMAT.md） */}
            <Prose text={b.body.join("\n\n")} />
          </div>
        </Section>
      );

    case "keypoints":
      return (
        <Section title={b.title} full={b.full}>
          <ul className="kr-kp">
            {b.items.map((it, i) => (
              <li key={i}>
                <span className={`k-dot ${it.kind}`} />
                <span className="k-text">
                  <Inline text={it.text} onRef={onRef} />
                  <span className={`k-kind ${it.kind}`}>{CLAIM_LABEL[it.kind]}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      );

    case "table":
      return (
        <Section title={b.title} full={b.full}>
          <div className="kr-tablewrap">
            <table className="kr-table">
              {b.caption ? <caption>{b.caption}</caption> : null}
              <thead>
                <tr>
                  {b.cols.map((c, i) => (
                    <th key={i} scope="col" className={c.num ? "num" : undefined}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, ri) => (
                  <tr key={ri} className={r.pick ? "is-pick" : undefined}>
                    {r.cells.map((cell, ci) => (
                      <td key={ci} data-th={b.cols[ci]?.label} className={`${b.cols[ci]?.num ? "num" : ""}${ci === 0 ? " lead" : ""}`}>
                        <Inline text={cell} onRef={onRef} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      );

    case "chart": {
      const max = Math.max(...b.series.map((s) => s.value), 1);
      return (
        <Section title={b.title} full={b.full}>
          <div className="kr-chart">
            <div className="kr-chart-h">
              <span className="kr-chart-t">{b.label}</span>
              <span className="kr-chart-u">{b.unit}</span>
            </div>
            <div className="kr-bars">
              {b.series.map((s, i) => (
                <div key={i} className={`kr-bar${s.hi ? " hi" : ""}`}>
                  <span className="lab">{s.label}</span>
                  <span className="track"><i className="fill" style={{ width: `${(s.value / max) * 100}%` }} /></span>
                  <span className="val">{s.display ?? s.value}</span>
                </div>
              ))}
            </div>
            <div className="kr-chart-src"><Inline text={b.source} onRef={onRef} /></div>
          </div>
        </Section>
      );
    }

    case "checklist":
      return (
        <Section title={b.title} full={b.full}>
          <div className="kr-check">
            {b.items.map((it, i) => (
              <div className="kr-ci" key={i}>
                <span className="box" />
                <div>
                  <div className="t"><Inline text={it.hypothesis} onRef={onRef} /></div>
                  <div className="grid">
                    <span><b>方法</b> {it.method}</span>
                    <span><b>通过线</b> {it.gate}</span>
                    <span><b>周期</b> {it.duration}</span>
                    <span><b>预算</b> {it.budget}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      );

    case "timeline":
      return (
        <Section title={b.title} full={b.full}>
          <div className="kr-tl">
            {b.items.map((it, i) => (
              <div className="kr-tl-i" key={i}>
                <div className="w">{it.when}</div>
                <div className="t">{it.phase}</div>
                <div className="d"><Inline text={it.deliverable} onRef={onRef} /></div>
              </div>
            ))}
          </div>
        </Section>
      );

    case "decision":
      return (
        <Section title={b.title} full={b.full}>
          <div className="kr-dec">
            <div className="kr-dec-h">
              <span className="t">{b.headline}</span>
              <span className={`kr-badge ${{ HIGH: "ok", MEDIUM: "warn", LOW: "bad" }[b.confidence]}`}>
                置信度 {CONFIDENCE_LABEL[b.confidence]}
              </span>
            </div>
            {([["rec", "推荐", b.recommend], ["against", "反对理由", b.against], ["risk", "风险", b.risks]] as const).map(
              ([cls, label, list]) => (
                <div className={`kr-dec-s ${cls}`} key={cls}>
                  <div className="lbl">{label}</div>
                  <ul>{list.map((x, i) => <li key={i}><Inline text={x} onRef={onRef} /></li>)}</ul>
                </div>
              )
            )}
          </div>
        </Section>
      );

    case "qa":
      return (
        <Section title={b.title} full={b.full}>
          <div className="kr-qa">
            {b.trail.map((t, i) => (
              <div className={`kr-qa-r ${t.verdict}`} key={i}>
                <span className="ic">{{ rej: "✕", fix: "↻", pass: "✓" }[t.verdict]}</span>
                <div>
                  <div className="who">{t.who} · 第 {t.round} 轮</div>
                  <div className="msg"><Inline text={t.message} onRef={onRef} /></div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      );

    case "callout":
      return (
        <Section full={b.full}>
          <div className={`kr-call ${b.tone}`}>
            <div>
              <b>{b.title}</b>
              <Inline text={b.body} onRef={onRef} />
            </div>
          </div>
        </Section>
      );

    case "unknown":
      return (
        <Section title={b.title ?? "还不知道的事"} full={b.full}>
          <div className="kr-unk">
            <ul>
              {b.items.map((it, i) => (
                <li key={i}><span className="need">{it.question}</span> — 需要：{it.needs}</li>
              ))}
            </ul>
          </div>
        </Section>
      );

    case "evidence":
      return (
        <Section title={b.title ?? "来源"} full>
          <div className="kr-ev">
            {b.items.map((it) => (
              <div className="kr-ev-i" id={`ref-${it.n}`} key={it.n}>
                <span className="n">{it.n}</span>
                <div>
                  <div className="ti">{it.title}</div>
                  <div className="mu">
                    <span className={`kr-badge ${{ trusted: "ok", untrusted: "warn", internal: "brand", demo: "demo" }[it.trust]}`}>
                      {TRUST_LABEL[it.trust]}
                    </span>
                    <span>获取于 {it.fetchedAt}</span>
                  </div>
                  <div className="u"><a href={it.url} target="_blank" rel="noopener noreferrer">打开来源</a></div>
                  {it.snapshot ? <details>
                    <summary>查看获取内容{it.truncated ? "（已截断）" : ""}</summary>
                    <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{it.snapshot}</p>
                  </details> : null}
                </div>
              </div>
            ))}
          </div>
        </Section>
      );

    case "code":
      return (
        <Section title={b.title} full={b.full}>
          <div className="kr-code">
            <div className="kr-code-h"><span>{b.lang}</span><span>{b.note ?? ""}</span></div>
            <pre>{b.body}</pre>
          </div>
        </Section>
      );

    case "progress":
      return (
        <Section title={b.title ?? "进行中"} full={b.full}>
          <div className="kr-prog">
            <div className="kr-prog-h">
              <span className="kr-prog-n">{b.done}/{b.total}</span>
              <span className="kr-prog-track">
                <i style={{ transform: `scaleX(${b.done / Math.max(b.total, 1)})` }} />
              </span>
              {b.paused ? <span className="kr-badge warn">已暂停</span> : null}
            </div>
            <div className="kr-prog-steps">
              {b.steps.map((s) => (
                <div className={`kr-ps ${s.state}`} key={s.key}>
                  <span className="dot" />
                  <div>
                    <div className="hd">
                      <b>{s.label}</b>
                      <span className="ag">{s.agent}</span>
                      {s.elapsedMs != null ? <span className="el">{(s.elapsedMs / 1000).toFixed(1)}s</span> : null}
                    </div>
                    {s.delta ? <div className={`dl${s.state === "running" ? " typing" : ""}`}><Prose text={s.delta} variant="compact" /></div> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Section>
      );

    case "clarify":
      return (
        <Section title={b.title ?? "开工前确认几件事"} full={b.full}>
          <div className="kr-clar">
            {b.questions.map((q, i) => (
              <div className="kr-q" key={q.id}>
                <span className="kr-q-n">{i + 1}</span>
                <div>
                  <div className="kr-q-a">{q.ask} <small>{q.why}</small></div>
                  {q.remembered ? (
                    <div className="kr-q-mem"><b>我记得：</b>{q.remembered}</div>
                  ) : null}
                  <div className="kr-q-opts">
                    {q.options.map((o) => (
                      <button type="button" key={o}>{o}</button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      );

    case "html":
      return (
        <Section title={(b as any).title || "🎨 富可视化Artifact"} full={(b as any).full}>
          <div className="kr-html-artifact" style={{ border: "1px solid #e7e9ef", borderRadius: "12px", overflow: "hidden", background: "white" }}>
            {(b as any).artifact ? (
              <div style={{ padding: "8px 12px", background: "#fafbfc", borderBottom: "1px solid #e7e9ef", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <small style={{ fontSize: "11px", color: "#6b7280" }}>🎨 富可视化 · 通过harness R17 · {(b as any).html?.length || 0}字符</small>
                <span style={{ background: "#0f1116", color: "white", padding: "2px 8px", borderRadius: "99px", fontSize: "10px" }}>Artifact</span>
              </div>
            ) : null}
            <iframe
              srcDoc={(b as any).html}
              title={(b as any).title || "富可视化"}
              sandbox="allow-same-origin allow-scripts"
              style={{ width: "100%", height: `${(b as any).height || 600}px`, border: 0, background: "white" }}
            />
          </div>
        </Section>
      );

    default:
      return null;
  }
}

/* ── 顶层 ──────────────────────────────────────────────────── */
export function ResponseView({
  envelope,
  defaultDensity = "summary",
  fallback,
  onAsk,
  askState,
}: {
  envelope: ResponseEnvelope;
  defaultDensity?: "summary" | "full";
  /** 校验不通过时的替代内容（例如原始 Markdown 结论）；缺省显示诚实失败态。 */
  fallback?: ReactNode;
  /** 用户选了 ask 的某个选项；缺省时选项只展示、不可点。 */
  onAsk?: (label: string) => void;
  askState?: { busy?: boolean; disabled?: boolean; selected?: string; error?: string };
}) {
  const [density, setDensity] = useState<"summary" | "full">(defaultDensity);
  const issues = useMemo(() => validate(envelope), [envelope]);
  const blocked = issues.filter((i) => i.level === "error");

  const jumpToRef = (n: number) => {
    setDensity("full");
    requestAnimationFrame(() => {
      document.getElementById(`ref-${n}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  // 诚实失败态：宁可承认没答好，也不渲染一个不合规的结论。
  if (blocked.length && fallback !== undefined) return <>{fallback}</>;
  if (blocked.length) {
    return (
      <div className="kr-response kr-failed">
        <div className="kr-call blocked">
          <div>
            <b>这次我没答好，没有给你看</b>
            回复不符合内部质量规范（{blocked.map((i) => i.id).join("、")}），已拦下重跑。
          </div>
        </div>
        <ul className="kr-fail-list">
          {blocked.map((i) => <li key={i.id}>{i.desc} — {i.detail}</li>)}
        </ul>
      </div>
    );
  }

  const { meta } = envelope;
  return (
    <SourceRefContext.Provider value={jumpToRef}>
    <article className="kr-response" data-density={density}>
      {envelope.demo ? (
        <div className="kr-demo-bar">演示数据 · 不代表真实调研结论，不写入业务数据，不消耗额度</div>
      ) : null}

      <div className="kr-body">
        <div className="kr-main">
          <header className="kr-lede">
            <h1><Inline text={envelope.lede} onRef={jumpToRef} /></h1>
          </header>
          <div className="kr-confbar">
            <span className={`kr-badge ${{ HIGH: "ok", MEDIUM: "warn", LOW: "bad" }[envelope.confidence]}`}>
              置信度 {CONFIDENCE_LABEL[envelope.confidence]}
            </span>
            <span className="kr-badge mute">{meta.steps} 次步骤执行</span>
            {envelope.demo ? <span className="kr-badge demo">演示数据</span> : null}
            <span className="kr-spacer" />
            <div className="kr-seg" role="group" aria-label="信息密度">
              <button type="button" aria-pressed={density === "summary"} onClick={() => setDensity("summary")}>摘要</button>
              <button type="button" aria-pressed={density === "full"} onClick={() => setDensity("full")}>完整</button>
            </div>
          </div>

          {envelope.blocks.map((b, i) => <BlockView key={i} b={b} onRef={jumpToRef} />)}

          {envelope.ask ? (
            <section className="kr-block">
              <div className="kr-ask">
                <p className="q">{envelope.ask.question}</p>
                <p className="why">{envelope.ask.why_you}</p>
                <div className="opts">
                  {envelope.ask.options.map((o) =>
                    onAsk ? (
                      <button type="button" className="opt" key={o.label}
                        disabled={askState?.disabled || askState?.busy || Boolean(askState?.selected)}
                        aria-pressed={askState?.selected === o.label}
                        onClick={() => onAsk(o.label)}>
                        <span className="ring" />
                        <span>
                          <span className="ol">{o.label}</span>
                          <span className="oc">{o.consequence}</span>
                        </span>
                      </button>
                    ) : (
                      // 没有接上处理函数时不渲染成按钮：点了没反应的按钮比没有更糟。
                      <div className="opt" data-static key={o.label}>
                        <span className="ring" />
                        <span>
                          <span className="ol">{o.label}</span>
                          <span className="oc">{o.consequence}</span>
                        </span>
                      </div>
                    )
                  )}
                </div>
                {askState?.busy && !askState.selected ? <p className="choice-status" role="status">正在提交选择…</p> : null}
                {askState?.selected ? <p className="choice-status" role="status">{envelope.demo ? "演示选择" : "已发送到本对话"}：{askState.selected}{envelope.demo ? "（未启动真实任务）" : ""}</p> : null}
                {askState?.error ? <p className="choice-status" role="alert">{askState.error}</p> : null}
              </div>
            </section>
          ) : null}

          {issues.length ? (
            <section className="kr-block kr-only-full">
              <div className="kr-call warn">
                <div>
                  <b>{issues.length} 条规范提醒</b>
                  {issues.map((i) => `${i.id} ${i.desc}`).join("；")}
                </div>
              </div>
            </section>
          ) : null}
        </div>

        <aside className="kr-aside kr-only-full">
          <h3>这次花了什么</h3>
          <div className="kr-meta">
            <div className="row"><i>模型</i><span>{meta.model}</span></div>
            <div className="row"><i>步骤执行</i><span>{meta.steps} 次（含重跑）</span></div>
            <div className="row"><i>耗时</i><span>{(meta.elapsedMs / 1000).toFixed(1)} 秒</span></div>
            <div className="row"><i>来源</i><span>{meta.sources} 条</span></div>
            <div className="row">
              <i>额度</i>
              <span>{envelope.demo || !meta.quota ? "不计额度" : `${meta.quota.used}/${meta.quota.limit ?? "∞"}`}</span>
            </div>
            {!envelope.demo && meta.quota?.limit ? (
              <div className="kr-quota"><i style={{ width: `${(meta.quota.used / meta.quota.limit) * 100}%` }} /></div>
            ) : null}
          </div>
          <h3>用到的记忆</h3>
          <div className="kr-mem">
            {meta.memoriesUsed.length
              ? meta.memoriesUsed.map((m) => <div className="m" key={m}>{m}</div>)
              : <div className="m is-empty">这次没有用到你的记忆</div>}
          </div>
        </aside>
      </div>
    </article>
    </SourceRefContext.Provider>
  );
}

export default ResponseView;
