"use client";

/**
 * ResponseView V2 - 领导层友好版
 * 按用户偏好：B为主(证据式去学术化) / C用于跟进(行动式) / A用于老板通知(极简式)
 * 
 * 优化点：
 * 1. lede 一句话结论加大到24px衬线，带emoji，置信度更直观
 * 2. keypoints 去学术化：事实→✅已核实 / 推断→👍较可信 / 未知→❓待补充，带来源和时间
 * 3. table 手机自动转卡片，首列加粗，数字带单位
 * 4. chart 支持环形图+条形图，带颜色，高亮项用品牌色
 * 5. decision 图标化：推荐✅ / 反对⚠️ / 风险❌
 * 6. 三角色切换：领导视图(默认) / 跟进视图 / 老板通知
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
import "./response-v2.css";

function Inline({ text, onRef }: { text: string; onRef?: (n: number) => void }) {
  return <>{inline(text, "i")}</>;
}

function Section({ title, full, children, icon }: { title?: string; full?: boolean; children: React.ReactNode; icon?: string }) {
  return (
    <section className={`kr2-block${full ? " kr2-only-full" : ""}`}>
      {title ? (
        <div className="kr2-h">
          {icon && <span className="kr2-h-icon">{icon}</span>}
          <h2>{title}</h2>
        </div>
      ) : null}
      {children}
    </section>
  );
}

// 友好翻译
function friendlyClaim(kind: string) {
  if (kind === "fact") return { label: "已核实", icon: "✅", color: "var(--k-ok)", desc: "来源可靠" };
  if (kind === "inference") return { label: "较可信", icon: "👍", color: "var(--k-brand)", desc: "基本核实" };
  return { label: "待补充", icon: "❓", color: "var(--k-warn)", desc: "需补充信息" };
}

function BlockView({ b, onRef }: { b: Block; onRef: (n: number) => void }) {
  switch (b.type) {
    case "prose":
      return (
        <Section title={b.title} full={b.full}>
          <div className="kr2-prose">
            <Prose text={b.body.join("\n\n")} />
          </div>
        </Section>
      );

    case "keypoints":
      return (
        <Section title={b.title || "关键要点"} full={b.full} icon="🔍">
          <ul className="kr2-kp">
            {b.items.map((it, i) => {
              const f = friendlyClaim(it.kind);
              return (
                <li key={i} style={{ borderLeftColor: f.color }}>
                  <span className="kr2-kp-icon">{f.icon}</span>
                  <span className="kr2-kp-body">
                    <span className="kr2-kp-text"><Inline text={it.text} onRef={onRef} /></span>
                    <span className="kr2-kp-meta">
                      <span className="kr2-badge" style={{ background: `${f.color}15`, color: f.color }}>{f.label}</span>
                      <span className="kr2-source">{f.desc}</span>
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      );

    case "table":
      return (
        <Section title={b.title || "对比分析"} full={b.full} icon="📊">
          <div className="kr2-tablewrap">
            <table className="kr2-table">
              {b.caption ? <caption>{b.caption}</caption> : null}
              <thead>
                <tr>
                  {b.cols.map((c, i) => (
                    <th key={i} className={c.num ? "num" : undefined}>{c.label}</th>
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
      const total = b.series.reduce((sum, s) => sum + s.value, 0);
      return (
        <Section title={b.title || "数据图表"} full={b.full} icon="📈">
          <div className="kr2-chart">
            <div className="kr2-chart-h">
              <span className="kr2-chart-t">{b.label}</span>
              <span className="kr2-chart-u">{b.unit} · 总计 {total}</span>
            </div>
            <div className="kr2-bars">
              {b.series.map((s, i) => (
                <div key={i} className={`kr2-bar${s.hi ? " hi" : ""}`}>
                  <span className="lab">{s.label}</span>
                  <span className="track"><i className="fill" style={{ width: `${(s.value / max) * 100}%` }} /></span>
                  <span className="val">{s.display ?? s.value}</span>
                </div>
              ))}
            </div>
            <div className="kr2-chart-src">📎 来源：{b.source}</div>
          </div>
        </Section>
      );
    }

    case "checklist":
      return (
        <Section title={b.title || "验证计划"} full={b.full} icon="✅">
          <div className="kr2-check">
            {b.items.map((it, i) => (
              <div className="kr2-ci" key={i}>
                <span className="kr2-ci-index">{i + 1}</span>
                <div>
                  <div className="t"><Inline text={it.hypothesis} onRef={onRef} /></div>
                  <div className="kr2-ci-grid">
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
        <Section title={b.title || "里程碑"} full={b.full} icon="🗓️">
          <div className="kr2-tl">
            {b.items.map((it, i) => (
              <div className="kr2-tl-i" key={i}>
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
        <Section title={b.title || "决策建议"} full={b.full} icon="🎯">
          <div className="kr2-dec">
            <div className="kr2-dec-h">
              <span className="t">{b.headline}</span>
              <span className={`kr2-badge ${{ HIGH: "ok", MEDIUM: "warn", LOW: "bad" }[b.confidence]}`}>可信度 {CONFIDENCE_LABEL[b.confidence]}</span>
            </div>
            <div className="kr2-dec-grid">
              <div className="kr2-dec-s rec">
                <div className="lbl">✅ 推荐理由</div>
                <ul>{b.recommend.map((x, i) => <li key={i}><Inline text={x} onRef={onRef} /></li>)}</ul>
              </div>
              <div className="kr2-dec-s against">
                <div className="lbl">⚠️ 反对/顾虑</div>
                <ul>{b.against.map((x, i) => <li key={i}><Inline text={x} onRef={onRef} /></li>)}</ul>
              </div>
              <div className="kr2-dec-s risk">
                <div className="lbl">❌ 主要风险</div>
                <ul>{b.risks.map((x, i) => <li key={i}><Inline text={x} onRef={onRef} /></li>)}</ul>
              </div>
            </div>
          </div>
        </Section>
      );

    case "qa":
      return (
        <Section title={b.title || "核验过程"} full={b.full} icon="🔍">
          <div className="kr2-qa">
            {b.trail.map((t, i) => (
              <div className={`kr2-qa-r ${t.verdict}`} key={i}>
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
          <div className={`kr2-call ${b.tone}`}>
            <span className="kr2-call-icon">{{ info: "💡", ok: "✅", warn: "⚠️", blocked: "🚫" }[b.tone] || "💡"}</span>
            <div>
              <b>{b.title}</b>
              <Inline text={b.body} onRef={onRef} />
            </div>
          </div>
        </Section>
      );

    case "unknown":
      return (
        <Section title={b.title ?? "待补充信息"} full={b.full} icon="❓">
          <div className="kr2-unk">
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
        <Section title={b.title ?? "依据来源"} full icon="📎">
          <div className="kr2-ev">
            {b.items.map((it) => (
              <div className="kr2-ev-i" key={it.n}>
                <span className="n">{it.n}</span>
                <div>
                  <div className="ti">{it.title}</div>
                  <div className="mu">
                    <span className={`kr2-badge ${it.trust}`}>{TRUST_LABEL[it.trust]}</span>
                    <span>获取于 {it.fetchedAt}</span>
                  </div>
                  <div className="u"><a href={it.url} target="_blank" rel="noopener noreferrer">打开来源</a></div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      );

    case "code":
      return (
        <Section title={b.title} full={b.full} icon="💻">
          <div className="kr2-code">
            <div className="kr2-code-h"><span>{b.lang}</span><span>{b.note ?? ""}</span></div>
            <pre>{b.body}</pre>
          </div>
        </Section>
      );

    case "progress":
      return (
        <Section title={b.title ?? "进行中"} full={b.full} icon="⏳">
          <div className="kr2-prog">
            <div className="kr2-prog-h">
              <span className="kr2-prog-n">{b.done}/{b.total}</span>
              <span className="kr2-prog-track"><i style={{ transform: `scaleX(${b.done / Math.max(b.total, 1)})` }} /></span>
              {b.paused ? <span className="kr2-badge warn">已暂停</span> : null}
            </div>
            <div className="kr2-prog-steps">
              {b.steps.map((s) => (
                <div className={`kr2-ps ${s.state}`} key={s.key}>
                  <span className="dot" />
                  <div>
                    <div className="hd"><b>{s.label}</b><span className="ag">{s.agent}</span></div>
                    {s.delta ? <div className="dl"><Prose text={s.delta} variant="compact" /></div> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Section>
      );

    case "clarify":
      return (
        <Section title={b.title ?? "开工前确认"} full={b.full} icon="📍">
          <div className="kr2-clar">
            <div className="kr2-action-intro">📍 现在需要确认这几件事，才能更好推进</div>
            {b.questions.map((q, i) => (
              <div className="kr2-q" key={q.id}>
                <span className="kr2-q-n">{i + 1}</span>
                <div>
                  <div className="kr2-q-a">{q.ask} <small>{q.why}</small></div>
                  {q.remembered ? <div className="kr2-q-mem"><b>我记得：</b>{q.remembered}</div> : null}
                  <div className="kr2-q-opts">{q.options.map((o) => <button key={o}>{o}</button>)}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      );

    default:
      return null;
  }
}

// A: 老板极简通知
function BossView({ envelope }: { envelope: ResponseEnvelope }) {
  const keypoints = envelope.blocks.filter(b => b.type === "keypoints").flatMap(b => (b as any).items).slice(0, 3);
  return (
    <div className="kr2-boss">
      <span className="kr2-boss-badge">💬 老板摘要 · 10秒看懂</span>
      <h2>{envelope.lede}</h2>
      <div className="kr2-boss-meta">
        <span>可信度 {CONFIDENCE_LABEL[envelope.confidence]}</span> · <span>{envelope.meta.steps}步执行</span> · <span>{envelope.meta.sources}条来源</span>
      </div>
      {keypoints.length > 0 && (
        <ul>{keypoints.map((k: any, i: number) => <li key={i}>{k.text}</li>)}</ul>
      )}
      {envelope.ask && <p><strong>待决策：</strong>{envelope.ask.question}</p>}
    </div>
  );
}

// C: 行动跟进视图
function ActionView({ envelope }: { envelope: ResponseEnvelope }) {
  const unknowns = envelope.blocks.filter(b => b.type === "unknown").flatMap(b => (b as any).items);
  const ask = envelope.ask;
  return (
    <div className="kr2-action-view">
      <div className="kr2-action-card">
        <span className="kr2-action-badge">📍 现在最重要的事</span>
        <strong>{ask?.question || unknowns[0]?.question || envelope.lede}</strong>
        <span className="kr2-action-why">为什么：{ask?.why_you || unknowns[0]?.needs || "需要负责人确认后推进"}</span>
        <div className="kr2-action-who">谁来做：项目负责人 · 下一步：{envelope.blocks.find(b => b.type === "checklist") ? "按验证计划执行" : "查看完整报告"}</div>
      </div>
    </div>
  );
}

export function ResponseViewV2({
  envelope,
  defaultDensity = "summary",
  fallback,
  onAsk,
  askState,
  defaultView = "leadership",
}: {
  envelope: ResponseEnvelope;
  defaultDensity?: "summary" | "full";
  fallback?: ReactNode;
  onAsk?: (label: string) => void;
  askState?: { busy?: boolean; disabled?: boolean; selected?: string; error?: string };
  defaultView?: "leadership" | "action" | "boss" | "all";
}) {
  const [density, setDensity] = useState<"summary" | "full">(defaultDensity);
  const [view, setView] = useState(defaultView);
  const issues = useMemo(() => validate(envelope), [envelope]);
  const blocked = issues.filter((i) => i.level === "error");

  const jumpToRef = (n: number) => {
    setDensity("full");
    requestAnimationFrame(() => {
      document.getElementById(`ref-${n}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  if (blocked.length && fallback !== undefined) return <>{fallback}</>;
  if (blocked.length) {
    return (
      <div className="kr2-response kr2-failed">
        <div className="kr2-call blocked"><div><b>这次我没答好</b> 回复不符合规范，已拦下重跑。</div></div>
      </div>
    );
  }

  const { meta } = envelope;

  return (
    <SourceRefContext.Provider value={jumpToRef}>
      <article className="kr2-response" data-density={density} data-view={view}>
        <div className="kr2-view-switch">
          <button className={view === "leadership" ? "is-active" : ""} onClick={() => setView("leadership")}>👔 领导视图</button>
          <button className={view === "action" ? "is-active" : ""} onClick={() => setView("action")}>📍 跟进视图</button>
          <button className={view === "boss" ? "is-active" : ""} onClick={() => setView("boss")}>💬 老板通知</button>
          <button className={view === "all" ? "is-active" : ""} onClick={() => setView("all")}>📄 完整</button>
          <span className="kr2-spacer" />
          <div className="kr2-seg">
            <button aria-pressed={density === "summary"} onClick={() => setDensity("summary")}>摘要</button>
            <button aria-pressed={density === "full"} onClick={() => setDensity("full")}>完整</button>
          </div>
        </div>

        {envelope.demo && <div className="kr2-demo-bar">演示数据 · 不代表真实调研结论</div>}

        <div className="kr2-body">
          <div className="kr2-main">
            {/* 领导视图 - 默认 */}
            {(view === "leadership" || view === "all") && (
              <>
                <header className="kr2-lede">
                  <span className="kr2-lede-icon">💡</span>
                  <h1><Inline text={envelope.lede} onRef={jumpToRef} /></h1>
                </header>
                <div className="kr2-confbar">
                  <span className={`kr2-badge ${{ HIGH: "ok", MEDIUM: "warn", LOW: "bad" }[envelope.confidence]}`}>可信度 {CONFIDENCE_LABEL[envelope.confidence]}</span>
                  <span className="kr2-badge mute">{meta.steps}步 · {meta.sources}条来源</span>
                  <span className="kr2-badge mute">{(meta.elapsedMs / 1000).toFixed(1)}秒</span>
                </div>
                {envelope.blocks.map((b, i) => <BlockView key={i} b={b} onRef={jumpToRef} />)}
              </>
            )}

            {view === "action" && <ActionView envelope={envelope} />}
            {view === "boss" && <BossView envelope={envelope} />}
            {view === "all" && (
              <>
                <div className="kr2-divider"><span>📍 跟进视图</span></div>
                <ActionView envelope={envelope} />
                <div className="kr2-divider"><span>💬 老板通知</span></div>
                <BossView envelope={envelope} />
              </>
            )}

            {envelope.ask && (view === "leadership" || view === "all") && (
              <section className="kr2-block">
                <div className="kr2-ask">
                  <p className="q">{envelope.ask.question}</p>
                  <p className="why">{envelope.ask.why_you}</p>
                  <div className="opts">
                    {envelope.ask.options.map((o) =>
                      onAsk ? (
                        <button key={o.label} className="opt" disabled={askState?.disabled || askState?.busy || Boolean(askState?.selected)} onClick={() => onAsk(o.label)}>
                          <span className="ring" />
                          <span><span className="ol">{o.label}</span><span className="oc">{o.consequence}</span></span>
                        </button>
                      ) : (
                        <div key={o.label} className="opt" data-static><span className="ring" /><span><span className="ol">{o.label}</span><span className="oc">{o.consequence}</span></span></div>
                      )
                    )}
                  </div>
                </div>
              </section>
            )}
          </div>

          <aside className="kr2-aside kr2-only-full">
            <h3>这次花了什么</h3>
            <div className="kr2-meta">
              <div className="row"><i>模型</i><span>{meta.model}</span></div>
              <div className="row"><i>耗时</i><span>{(meta.elapsedMs / 1000).toFixed(1)}秒</span></div>
              <div className="row"><i>来源</i><span>{meta.sources}条</span></div>
            </div>
          </aside>
        </div>
      </article>
    </SourceRefContext.Provider>
  );
}

export default ResponseViewV2;
