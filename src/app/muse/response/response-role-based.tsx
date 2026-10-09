"use client";

/**
 * Role-Based Response View - Kern 驱动的智能角色输出
 * 
 * 三种切换：
 * 1. 自动：根据文本/页面/envelope智能识别
 * 2. 手动：用户点击切换，30分钟内优先
 * 3. Kern对话驱动：用户说"切换到销售视角"或 Kern 在 meta.suggestedRole 建议
 * 
 * Kern 是高智能主Agent，统筹一切，此组件是它调用的呈现能力
 */

import { useState, useEffect } from "react";
import { inline, Prose, SourceRefContext } from "@/app/muse/components/prose";
import type { Block, ResponseEnvelope } from "@/modules/response-format/types";
import { CONFIDENCE_LABEL, TRUST_LABEL } from "@/modules/response-format/types";
import { validate } from "@/modules/response-format/validate";
import { labelOf } from "@/shared/status-labels";
import { CLAIM_LABEL } from "@/modules/response-format/types";
import { useRole, useKernRoleIntelligence } from "@/components/role-context";
import { inferRoleFromEnvelope } from "@/components/kern-role-intelligence";
import "./response-role.css";
import "@/components/role-switch.css";

type Role = "leadership" | "product" | "sales";

function Inline({ text, onRef }: { text: string; onRef: (n: number) => void }) {
  return <>{inline(text, "i")}</>;
}

// 领导层：直观友好
function LeadershipBlock({ b, onRef }: { b: Block; onRef: (n: number) => void }) {
  switch (b.type) {
    case "prose":
      return <div className="rb-prose"><Prose text={b.body.join("\n\n")} /></div>;
    case "keypoints":
      return (
        <ul className="rb-kp-lead">
          {b.items.map((it, i) => (
            <li key={i} className={it.kind}>
              <span className="icon">{it.kind === "fact" ? "✅" : it.kind === "inference" ? "💡" : "❓"}</span>
              <span><Inline text={it.text} onRef={onRef} /></span>
            </li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div className="rb-table-lead">
          {b.rows.slice(0, 3).map((r, i) => (
            <div key={i} className="rb-card">
              <strong>{r.cells[0]}</strong>
              <span>{r.cells[1]}</span>
              {r.cells[2] && <small>{r.cells[2]}</small>}
            </div>
          ))}
        </div>
      );
    case "chart":
      return (
        <div className="rb-chart-lead">
          <strong>{b.label}</strong>
          <div className="rb-bars-mini">
            {b.series.map((s, i) => (
              <div key={i}><span>{s.label}</span><i style={{ width: `${(s.value / Math.max(...b.series.map(x => x.value))) * 100}%` }} /></div>
            ))}
          </div>
        </div>
      );
    case "decision":
      return (
        <div className="rb-dec-lead">
          <strong>💡 {b.headline}</strong>
          <p>✅ {b.recommend[0]}</p>
          {b.risks[0] && <small>⚠️ 风险：{b.risks[0]}</small>}
        </div>
      );
    default:
      return <div className="rb-other-lead">{b.type} · 领导视图已简化</div>;
  }
}

function ProductBlock({ b, onRef }: { b: Block; onRef: (n: number) => void }) {
  switch (b.type) {
    case "prose":
      return <div className="rb-prose-full"><Prose text={b.body.join("\n\n")} /></div>;
    case "keypoints":
      return (
        <div className="rb-table-wrap">
          <table className="rb-table-full">
            <thead><tr><th>结论</th><th>类型</th><th>可信度</th><th>来源</th></tr></thead>
            <tbody>
              {b.items.map((it, i) => (
                <tr key={i}><td><Inline text={it.text} onRef={onRef} /></td><td><span className={`badge ${it.kind}`}>{labelOf(CLAIM_LABEL, it.kind)}</span></td><td>{it.kind === "fact" ? "A级" : it.kind === "inference" ? "B级" : "UNKNOWN"}</td><td>待追溯</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "table":
      return (
        <div className="rb-table-wrap">
          <table className="rb-table-full">
            <thead><tr>{b.cols.map((c, i) => <th key={i} className={c.num ? "num" : ""}>{c.label}</th>)}</tr></thead>
            <tbody>{b.rows.map((r, i) => <tr key={i} className={r.pick ? "pick" : ""}>{r.cells.map((cell, j) => <td key={j} className={b.cols[j]?.num ? "num" : ""}><Inline text={cell} onRef={onRef} /></td>)}</tr>)}</tbody>
          </table>
          {b.caption && <caption>{b.caption}</caption>}
        </div>
      );
    case "checklist":
      return (
        <div className="rb-checklist-full">
          {b.items.map((it, i) => (
            <div key={i} className="rb-check-item">
              <div className="rb-check-h"><span>{i + 1}</span><strong><Inline text={it.hypothesis} onRef={onRef} /></strong></div>
              <div className="rb-check-grid"><span>方法：{it.method}</span><span>通过线：{it.gate}</span><span>周期：{it.duration}</span><span>预算：{it.budget}</span></div>
            </div>
          ))}
        </div>
      );
    case "timeline":
      return (
        <div className="rb-timeline-full">
          {b.items.map((it, i) => (
            <div key={i} className="rb-tl-item"><span className="when">{it.when}</span><strong>{it.phase}</strong><span><Inline text={it.deliverable} onRef={onRef} /></span></div>
          ))}
        </div>
      );
    case "qa":
      return (
        <div className="rb-qa-full">
          {b.trail.map((t, i) => (
            <div key={i} className={`rb-qa-row ${t.verdict}`}><span>{t.verdict === "pass" ? "✓" : t.verdict === "rej" ? "✕" : "↻"}</span><div><small>{t.who} 第{t.round}轮</small><p><Inline text={t.message} onRef={onRef} /></p></div></div>
          ))}
        </div>
      );
    case "evidence":
      return (
        <div className="rb-ev-full">
          {b.items.map((it) => (
            <div key={it.n} className="rb-ev-item"><span className="n">{it.n}</span><div><strong>{it.title}</strong><small>{TRUST_LABEL[it.trust]} · {it.fetchedAt}</small><a href={it.url} target="_blank">打开来源</a></div></div>
          ))}
        </div>
      );
    case "progress":
      return (
        <div className="rb-progress-full">
          <div className="rb-progress-h"><span>{b.done}/{b.total}</span><div className="track"><i style={{ transform: `scaleX(${b.done / Math.max(b.total, 1)})` }} /></div></div>
          {b.steps.map((s) => <div key={s.key} className={`step ${s.state}`}><span className="dot" /><div><b>{s.label}</b><small>{s.agent}</small>{s.delta && <Prose text={s.delta} variant="compact" />}</div></div>)}
        </div>
      );
    default:
      return <div className="rb-block-full"><strong>{b.title || b.type}</strong><Prose text={JSON.stringify(b).slice(0, 200)} /></div>;
  }
}

function SalesBlock({ b, onRef }: { b: Block; onRef: (n: number) => void }) {
  switch (b.type) {
    case "prose":
      return (
        <div className="rb-sales-prose">
          <span className="rb-sales-badge">🔥 卖点</span>
          <Prose text={b.body.join("\n\n")} />
        </div>
      );
    case "keypoints":
      return (
        <div className="rb-sales-kp">
          {b.items.filter(it => it.kind === "fact").map((it, i) => (
            <div key={i} className="rb-sales-card">
              <span className="rb-sales-icon">💎</span>
              <strong><Inline text={it.text} onRef={onRef} /></strong>
              <small>客户价值：可直接用于销售话术</small>
            </div>
          ))}
        </div>
      );
    case "table":
      return (
        <div className="rb-sales-table">
          <span className="rb-sales-badge">⚔️ 竞品对比 · 我们的优势</span>
          <div className="rb-table-wrap">
            <table className="rb-table-sales">
              <thead><tr>{b.cols.map((c, i) => <th key={i}>{c.label}</th>)}</tr></thead>
              <tbody>{b.rows.map((r, i) => <tr key={i} className={r.pick ? "pick" : ""}>{r.cells.map((cell, j) => <td key={j}>{j === 0 ? <strong>{cell}</strong> : <Inline text={cell} onRef={onRef} />}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </div>
      );
    case "chart":
      return (
        <div className="rb-sales-chart">
          <span className="rb-sales-badge">📈 市场机会</span>
          <strong>{b.label}</strong>
          <div className="rb-bars-sales">
            {b.series.map((s, i) => (
              <div key={i} className="bar"><span>{s.label}</span><div className="track"><i style={{ width: `${(s.value / Math.max(...b.series.map(x => x.value))) * 100}%` }} /></div><strong>{s.display || s.value}{b.unit}</strong></div>
            ))}
          </div>
          <small>💡 销售话术：{b.label}增长明显，可强调市场趋势</small>
        </div>
      );
    case "decision":
      return (
        <div className="rb-sales-dec">
          <span className="rb-sales-badge">🎯 销售决策</span>
          <strong>{b.headline}</strong>
          <div className="rb-sales-recommend">
            <strong>✅ 主推理由（销售话术）：</strong>
            <ul>{b.recommend.map((x, i) => <li key={i}><Inline text={x} onRef={onRef} /></li>)}</ul>
          </div>
          <div className="rb-sales-tools">
            <button>📄 生成销售PPT</button>
            <button>📝 销售话术</button>
            <button>⚔️ 竞品话术</button>
          </div>
        </div>
      );
    case "callout":
      return (
        <div className="rb-sales-callout">
          <span>💡 销售提示</span>
          <strong>{b.title}</strong>
          <p><Inline text={b.body} onRef={onRef} /></p>
        </div>
      );
    default:
      return <div className="rb-sales-other"><span className="rb-sales-badge">工具</span><strong>{b.title || b.type}</strong><p>此内容可转化为销售工具</p></div>;
  }
}

export function ResponseRoleBased({ 
  envelope, 
  role: propRole,
  defaultDensity = "summary",
  fallback,
  onAsk,
  askState,
}: { 
  envelope: ResponseEnvelope; 
  role?: Role;
  defaultDensity?: "summary" | "full";
  fallback?: React.ReactNode;
  onAsk?: (label: string) => void;
  askState?: { busy?: boolean; disabled?: boolean; selected?: string; error?: string };
}) {
  const [density, setDensity] = useState<"summary" | "full">(defaultDensity);
  const { role: intelligentRole, source, reason, confidence, setManualRole, setKernRole } = useRole();
  const { onEnvelope } = useKernRoleIntelligence();

  // 自动从 envelope 推断角色，让 Kern 驱动切换
  useEffect(() => {
    const inf = onEnvelope(envelope);
    // 如果 envelope 明确建议角色，自动应用为 Kern 建议（仅当置信度高且不是手动锁定）
    if (envelope.meta?.suggestedRole && envelope.meta.suggestedRole !== "auto") {
      const r = envelope.meta.suggestedRole as Role;
      if (["leadership", "product", "sales"].includes(r)) {
        setKernRole(r, envelope.meta.roleReason || `Kern建议: ${envelope.meta.suggestedRole}`);
      }
    }
  }, [envelope, onEnvelope, setKernRole]);

  // 有效角色：prop 优先（用于演示页固定），否则用智能角色
  const activeRole = propRole || intelligentRole;

  const jumpToRef = (n: number) => {
    setDensity("full");
    requestAnimationFrame(() => document.getElementById(`ref-${n}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  const issues = validate(envelope);
  const blocked = issues.filter((i) => i.level === "error");
  if (blocked.length) return <div className="rb-failed">回复不符合规范，已拦截</div>;

  return (
    <SourceRefContext.Provider value={jumpToRef}>
      <article className="rb-response" data-role={activeRole} data-density={density}>
        <div className="rb-role-switch intelligent">
          <div className="role-switch">
            <button className={activeRole === "leadership" ? "is-active" : ""} onClick={() => setManualRole("leadership")}>👔 领导层</button>
            <button className={activeRole === "product" ? "is-active" : ""} onClick={() => setManualRole("product")}>🔬 产品研发</button>
            <button className={activeRole === "sales" ? "is-active" : ""} onClick={() => setManualRole("sales")}>💼 销售营销</button>
          </div>
          <span className="spacer" />
          <div className="rb-density">
            <button aria-pressed={density === "summary"} onClick={() => setDensity("summary")}>摘要</button>
            <button aria-pressed={density === "full"} onClick={() => setDensity("full")}>完整</button>
          </div>
        </div>
        
        {source !== "manual" && source !== "default" && (
          <div className="rb-auto-hint">
            <span className={`dot ${source}`} />
            <small>
              {source === "kern" ? "🤖 Kern 已自动切换" : "🔍 自动识别"}: {reason} {confidence > 0 && `(${Math.round(confidence * 100)}%)`}
            </small>
          </div>
        )}

        <div className="rb-header">
          <h1>{envelope.lede}</h1>
          <div className="rb-meta">
            <span className={`badge ${envelope.confidence.toLowerCase()}`}>可信度 {CONFIDENCE_LABEL[envelope.confidence]}</span>
            <span>{envelope.meta.steps}步 · {envelope.meta.sources}来源 · {(envelope.meta.elapsedMs / 1000).toFixed(1)}s</span>
            {activeRole === "leadership" && <span className="role-hint">👔 领导层：直观一页看懂</span>}
            {activeRole === "product" && <span className="role-hint">🔬 研发：专业严谨，可信度第一</span>}
            {activeRole === "sales" && <span className="role-hint">💼 销售：卖点突出，工具支撑</span>}
            {envelope.meta.suggestedRole && <span className="role-hint kern">🤖 Kern建议: {envelope.meta.suggestedRole}</span>}
          </div>
        </div>

        <div className="rb-blocks">
          {envelope.blocks.map((b, i) => (
            <div key={i} className="rb-block">
              {activeRole === "leadership" && <LeadershipBlock b={b} onRef={jumpToRef} />}
              {activeRole === "product" && <ProductBlock b={b} onRef={jumpToRef} />}
              {activeRole === "sales" && <SalesBlock b={b} onRef={jumpToRef} />}
            </div>
          ))}
        </div>

        {envelope.ask && (
          <div className="rb-ask">
            <p className="q">{envelope.ask.question}</p>
            <p className="why">{envelope.ask.why_you}</p>
            <div className="opts">
              {envelope.ask.options.map((o) => (
                onAsk ? (
                  <button key={o.label} className="opt" disabled={askState?.disabled || askState?.busy || Boolean(askState?.selected)} onClick={() => onAsk(o.label)}>
                    <strong>{o.label}</strong><small>{o.consequence}</small>
                  </button>
                ) : (
                  <button key={o.label} className="opt"><strong>{o.label}</strong><small>{o.consequence}</small></button>
                )
              ))}
            </div>
            {askState?.busy && !askState.selected ? <p style={{ fontSize: 12, color: "#6b7280", marginTop: 8 }}>正在提交选择…</p> : null}
            {askState?.selected ? <p style={{ fontSize: 12, color: "#0b7a4f", marginTop: 8 }}>已选择：{askState.selected}</p> : null}
            {askState?.error ? <p style={{ fontSize: 12, color: "#b32b23", marginTop: 8 }}>{askState.error}</p> : null}
          </div>
        )}
      </article>
    </SourceRefContext.Provider>
  );
}

export default ResponseRoleBased;
