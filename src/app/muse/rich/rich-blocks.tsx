"use client";
/**
 * Renderers for kern-ui rich blocks. Controlled React only — the model supplies data,
 * never markup. Every number shown comes from the block; derived values (totals,
 * shares) are labelled as derived.
 */
import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { inline } from "../components/prose";
import {
  BASIS_LABEL, SOURCE_TRUST_LABEL,
  type Basis, type CompareBlock, type FlowBlock, type MetricsBlock, type NextBlock, type RichBlock,
  type RichCalloutBlock, type RichChartBlock, type RichDecisionBlock, type RichKeypointsBlock, type RichTableBlock,
  type RichTimelineBlock, type RichUnknownBlock, type RisksBlock, type SourcesBlock,
} from "@/modules/artifacts/rich-blocks";
import { useKernHost, useRichScope } from "./reader-context";

const NUM1 = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
const fmt = (n: number) => (Math.abs(n) >= 1000 ? NUM1.format(n) : String(Math.round(n * 100) / 100));

export function BasisTag({ basis }: { basis: Basis }) {
  return <span className="kxr-basis" data-basis={basis} title={basis === "fact" ? "来自用户或已记录资料；本身不等于已独立核实" : basis === "inference" ? "由已知信息推断" : basis === "assumption" ? "为测算设定的假设" : "目前没有依据"}>{BASIS_LABEL[basis]}</span>;
}

function SourceMark({ n }: { n: number }) {
  const scope = useRichScope();
  return (
    <a className="kxr-ref" href={`#kxr-src-${scope}-${n}`} onClick={(e) => {
      const target = document.getElementById(`kxr-src-${scope}-${n}`);
      if (!target) return;
      e.preventDefault();
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }} aria-label={`查看来源 ${n}`}>{n}</a>
  );
}

function Head({ title, aside }: { title?: string; aside?: ReactNode }) {
  if (!title && !aside) return null;
  return <header className="kxr-head">{title ? <h3>{title}</h3> : <span />}{aside}</header>;
}

// ───────── metrics ─────────
function Metrics({ b }: { b: MetricsBlock }) {
  return (
    <section className="kxr-block kxr-metrics" aria-label={b.title ?? "关键指标"}>
      <Head title={b.title} />
      <div className="kxr-metric-grid" data-count={b.items.length}>
        {b.items.map((m, i) => (
          <div className="kxr-metric" key={i} style={{ "--i": i } as CSSProperties}>
            <span className="kxr-metric-label">{m.label}</span>
            <strong className="kxr-metric-value">{m.value}{m.source ? <SourceMark n={m.source} /> : null}</strong>
            {m.note ? <span className="kxr-metric-note">{inline(m.note, `mn${i}`)}</span> : null}
            <BasisTag basis={m.basis} />
          </div>
        ))}
      </div>
    </section>
  );
}

// ───────── compare ─────────
function Compare({ b }: { b: CompareBlock }) {
  const [focus, setFocus] = useState<number | null>(null);
  return (
    <section className="kxr-block kxr-compare" aria-label={b.title ?? "方案比较"}>
      <Head title={b.title} aside={<span className="kxr-sub">{b.options.length} 个方案</span>} />
      <div className="kxr-options" data-count={b.options.length} role="list">
        {b.options.map((o, i) => (
          <article key={i} role="listitem" className="kxr-option" data-pick={o.pick || undefined} data-dim={focus !== null && focus !== i ? true : undefined}
            onMouseEnter={() => setFocus(i)} onMouseLeave={() => setFocus(null)}>
            <div className="kxr-option-top">
              <span className="kxr-option-index" aria-hidden>{String.fromCharCode(65 + i)}</span>
              <h4>{o.name}</h4>
              {o.pick ? <span className="kxr-pill" data-tone="brand">推荐</span> : null}
            </div>
            {o.tagline ? <p className="kxr-option-tag">{inline(o.tagline, `ot${i}`)}</p> : null}
            {o.pros.length ? <ul className="kxr-pros" aria-label="优点">{o.pros.map((p, j) => <li key={j}>{inline(p, `p${i}${j}`)}</li>)}</ul> : null}
            {o.cons.length ? <ul className="kxr-cons" aria-label="顾虑">{o.cons.map((p, j) => <li key={j}>{inline(p, `c${i}${j}`)}</li>)}</ul> : null}
          </article>
        ))}
      </div>
      {b.criteria.length ? (
        <div className="kxr-matrix-wrap">
          <table className="kxr-matrix">
            <caption className="m-sr">逐项比较</caption>
            <thead><tr><th scope="col">维度</th>{b.options.map((o, i) => <th scope="col" key={i} data-pick={o.pick || undefined} data-focus={focus === i || undefined}>{o.name}</th>)}</tr></thead>
            <tbody>
              {b.criteria.map((c, r) => (
                <tr key={r}><th scope="row">{c.label}</th>{c.values.map((v, i) => <td key={i} data-pick={b.options[i]?.pick || undefined} data-focus={focus === i || undefined} data-unknown={UNKNOWN_CELL.test(v.trim()) || undefined}>{inline(v, `cv${r}${i}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

// ───────── charts ─────────
function ChartFoot({ b, derived }: { b: RichChartBlock; derived?: string }) {
  return (
    <figcaption className="kxr-chart-foot">
      <BasisTag basis={b.basis} />
      <span>来源：{inline(b.source, "src")}</span>
      {derived ? <span className="kxr-derived">{derived}</span> : null}
    </figcaption>
  );
}

function SrTable({ b }: { b: RichChartBlock }) {
  return (
    <table className="m-sr">
      <caption>{b.title ?? "图表数据"}（单位：{b.unit || "无"}）</caption>
      <tbody>{b.series.map((s, i) => <tr key={i}><th scope="row">{s.label}</th><td>{s.display ?? fmt(s.value)}</td></tr>)}</tbody>
    </table>
  );
}

function BarChart({ b }: { b: RichChartBlock }) {
  const min = Math.min(0, ...b.series.map((s) => s.value));
  const max = Math.max(0, ...b.series.map((s) => s.value));
  const span = max - min || 1;
  const zero = ((0 - min) / span) * 100;
  return (
    <div className="kxr-bars" aria-hidden>
      {b.series.map((s, i) => {
        const left = s.value >= 0 ? zero : ((s.value - min) / span) * 100;
        const width = (Math.abs(s.value) / span) * 100;
        return (
          <div className="kxr-bar" key={i} data-hi={s.hi || undefined} data-neg={s.value < 0 || undefined} style={{ "--i": i } as CSSProperties}>
            <span className="kxr-bar-label">{s.label}</span>
            <span className="kxr-bar-track">
              {min < 0 ? <i className="kxr-bar-zero" style={{ left: `${zero}%` }} /> : null}
              <i className="kxr-bar-fill" style={{ left: `${left}%`, width: `${Math.max(width, s.value === 0 ? 0 : 0.8)}%` }} />
            </span>
            <span className="kxr-bar-value">{s.display ?? fmt(s.value)}</span>
          </div>
        );
      })}
    </div>
  );
}

function Waterfall({ b }: { b: RichChartBlock }) {
  const steps = useMemo(() => {
    let run = 0;
    const out = b.series.map((s) => { const from = run; run += s.value; return { ...s, from, to: run }; });
    return { items: out, total: run };
  }, [b.series]);
  const all = [0, ...steps.items.flatMap((s) => [s.from, s.to])];
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const W = 760, H = 210, pad = 28, n = steps.items.length + 1, gap = 10;
  const bw = (W - pad * 2 - gap * (n - 1)) / n;
  const y = (v: number) => H - pad - ((v - lo) / span) * (H - pad * 2);
  const [active, setActive] = useState<number | null>(null);
  return (
    <div className="kxr-waterfall">
      <svg viewBox={`0 0 ${W} ${H + 34}`} role="img" aria-label={`${b.title ?? "瀑布图"}：合计 ${fmt(steps.total)}${b.unit}`}>
        <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} className="kxr-axis" />
        {steps.items.map((s, i) => {
          const x = pad + i * (bw + gap);
          const top = Math.min(y(s.from), y(s.to)), h = Math.max(2, Math.abs(y(s.from) - y(s.to)));
          return (
            <g key={i} className="kxr-wf-step" data-neg={s.value < 0 || undefined} data-active={active === i || undefined} style={{ "--i": i } as CSSProperties}
              tabIndex={0} onFocus={() => setActive(i)} onBlur={() => setActive(null)} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}
              aria-label={`${s.label} ${s.display ?? fmt(s.value)}${b.unit}`}>
              <rect x={x} y={top} width={bw} height={h} rx={6} />
              {i < steps.items.length - 1 ? <line x1={x + bw} x2={x + bw + gap} y1={y(s.to)} y2={y(s.to)} className="kxr-wf-link" /> : null}
              <text x={x + bw / 2} y={top - 6} textAnchor="middle" className="kxr-wf-val">{s.display ?? fmt(s.value)}</text>
              <text x={x + bw / 2} y={H + 8} textAnchor="middle" className="kxr-wf-lab">{s.label.length > 6 ? s.label.slice(0, 6) + "…" : s.label}</text>
            </g>
          );
        })}
        {(() => {
          const x = pad + steps.items.length * (bw + gap);
          const top = Math.min(y(0), y(steps.total)), h = Math.max(2, Math.abs(y(0) - y(steps.total)));
          return (
            <g className="kxr-wf-total" style={{ "--i": steps.items.length } as CSSProperties}>
              <rect x={x} y={top} width={bw} height={h} rx={6} />
              <text x={x + bw / 2} y={top - 6} textAnchor="middle" className="kxr-wf-val">{fmt(steps.total)}</text>
              <text x={x + bw / 2} y={H + 8} textAnchor="middle" className="kxr-wf-lab">合计</text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

const DONUT_TONES = ["var(--kxr-c1)", "var(--kxr-c2)", "var(--kxr-c3)", "var(--kxr-c4)", "var(--kxr-c5)", "var(--kxr-c6)"];
function Donut({ b }: { b: RichChartBlock }) {
  const total = b.series.reduce((a, s) => a + s.value, 0) || 1;
  const [active, setActive] = useState<number | null>(null);
  let acc = 0;
  const R = 52, C = 2 * Math.PI * R;
  return (
    <div className="kxr-donut">
      <svg viewBox="0 0 140 140" aria-hidden>
        <circle cx="70" cy="70" r={R} className="kxr-donut-track" />
        {b.series.map((s, i) => {
          const len = (s.value / total) * C;
          const el = <circle key={i} cx="70" cy="70" r={R} className="kxr-donut-seg" data-active={active === i || undefined}
            style={{ stroke: DONUT_TONES[i % DONUT_TONES.length], strokeDasharray: `${Math.max(len - 2, 0.5)} ${C}`, strokeDashoffset: -acc, "--i": i } as CSSProperties} />;
          acc += len;
          return el;
        })}
        <text x="70" y="66" textAnchor="middle" className="kxr-donut-n">{active !== null ? `${Math.round((b.series[active].value / total) * 100)}%` : fmt(total)}</text>
        <text x="70" y="84" textAnchor="middle" className="kxr-donut-l">{active !== null ? b.series[active].label.slice(0, 6) : `合计${b.unit ? ` · ${b.unit}` : ""}`}</text>
      </svg>
      <ul className="kxr-legend">
        {b.series.map((s, i) => (
          <li key={i}>
            <button type="button" onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}>
              <i style={{ background: DONUT_TONES[i % DONUT_TONES.length] }} aria-hidden />
              <span>{s.label}</span>
              <b>{s.display ?? fmt(s.value)}</b>
              <small>{Math.round((s.value / total) * 100)}%</small>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Chart({ b }: { b: RichChartBlock }) {
  const derived = b.chart === "waterfall" ? "“合计”由上方数值相加得出" : b.chart === "donut" ? "百分比由数值换算" : undefined;
  return (
    <figure className="kxr-block kxr-chart" data-chart={b.chart}>
      <Head title={b.title} aside={b.unit ? <span className="kxr-sub">单位：{b.unit}</span> : null} />
      {b.chart === "waterfall" ? <Waterfall b={b} /> : b.chart === "donut" ? <Donut b={b} /> : <BarChart b={b} />}
      <SrTable b={b} />
      <ChartFoot b={b} derived={derived} />
    </figure>
  );
}

// ───────── timeline / plan ─────────
const STATUS_LABEL = { done: "已完成", active: "进行中", todo: "未开始", blocked: "受阻" } as const;
function Timeline({ b }: { b: RichTimelineBlock }) {
  const counts = b.items.reduce<Record<string, number>>((a, it) => { if (it.status) a[it.status] = (a[it.status] ?? 0) + 1; return a; }, {});
  const hasStatus = Object.keys(counts).length > 0;
  return (
    <section className="kxr-block kxr-timeline" aria-label={b.title ?? "时间线"}>
      <Head title={b.title} aside={hasStatus ? (
        <span className="kxr-status-sum">{(["done", "active", "blocked", "todo"] as const).filter((k) => counts[k]).map((k) => <span key={k} data-s={k}>{STATUS_LABEL[k]} {counts[k]}</span>)}</span>
      ) : <span className="kxr-sub">{b.items.length} 个阶段</span>} />
      {hasStatus ? (
        <div className="kxr-phasebar" aria-hidden>{b.items.map((it, i) => <i key={i} data-s={it.status ?? "todo"} title={`${it.phase} · ${STATUS_LABEL[it.status ?? "todo"]}`} />)}</div>
      ) : null}
      <ol className="kxr-tl">
        {b.items.map((it, i) => (
          <li key={i} data-s={it.status ?? (hasStatus ? "todo" : undefined)} style={{ "--i": i } as CSSProperties}>
            <span className="kxr-tl-node" aria-hidden>{it.status === "done" ? "✓" : it.status === "blocked" ? "!" : i + 1}</span>
            <div className="kxr-tl-body">
              <div className="kxr-tl-top">
                <b>{it.phase}</b>
                {it.when ? <span className="kxr-tl-when">{it.when}</span> : null}
                {it.status ? <span className="kxr-pill" data-s={it.status}>{STATUS_LABEL[it.status]}</span> : null}
              </div>
              {it.deliverable ? <p>{inline(it.deliverable, `tl${i}`)}</p> : null}
              {it.depends?.length ? <p className="kxr-tl-dep">依赖：{it.depends.join("、")}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ───────── flow (cause/effect, structure) ─────────
function layers(b: FlowBlock): string[][] {
  const depth = new Map<string, number>(b.nodes.map((n) => [n.id, 0]));
  for (let k = 0; k < b.nodes.length; k++) {
    let changed = false;
    for (const [a, c] of b.edges) { const d = (depth.get(a) ?? 0) + 1; if (d > (depth.get(c) ?? 0) && d < b.nodes.length) { depth.set(c, d); changed = true; } }
    if (!changed) break;
  }
  const out: string[][] = [];
  for (const n of b.nodes) { const d = depth.get(n.id) ?? 0; (out[d] ??= []).push(n.id); }
  return out.filter(Boolean);
}

function Flow({ b }: { b: FlowBlock }) {
  const cols = useMemo(() => layers(b), [b]);
  const box = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const uid = useId().replace(/:/g, "");
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const draw = () => {
      const base = el.getBoundingClientRect();
      const vertical = el.dataset.vertical === "true" || getComputedStyle(el).flexDirection === "column";
      setPaths(b.edges.map(([a, c]) => {
        const A = el.querySelector<HTMLElement>(`[data-node="${uid}-${a}"]`)?.getBoundingClientRect();
        const B = el.querySelector<HTMLElement>(`[data-node="${uid}-${c}"]`)?.getBoundingClientRect();
        if (!A || !B) return "";
        if (vertical) {
          const x1 = A.left + A.width / 2 - base.left, y1 = A.bottom - base.top, x2 = B.left + B.width / 2 - base.left, y2 = B.top - base.top;
          const m = (y1 + y2) / 2;
          return `M${x1},${y1} C${x1},${m} ${x2},${m} ${x2},${y2}`;
        }
        const x1 = A.right - base.left, y1 = A.top + A.height / 2 - base.top, x2 = B.left - base.left, y2 = B.top + B.height / 2 - base.top;
        const m = (x1 + x2) / 2;
        return `M${x1},${y1} C${m},${y1} ${m},${y2} ${x2},${y2}`;
      }));
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [b.edges, cols, uid]);
  const linked = (id: string) => hover !== null && (id === hover || b.edges.some(([a, c]) => (a === hover && c === id) || (c === hover && a === id)));
  return (
    <section className="kxr-block kxr-flow" aria-label={b.title ?? "关系图"}>
      <Head title={b.title} />
      <div className="kxr-flow-canvas" ref={box}>
        <svg className="kxr-flow-links" aria-hidden>
          <defs><marker id={`${uid}-arrow`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" /></marker></defs>
          {paths.map((d, i) => d ? <path key={i} d={d} markerEnd={`url(#${uid}-arrow)`} data-on={hover !== null && (b.edges[i][0] === hover || b.edges[i][1] === hover) || undefined} /> : null)}
        </svg>
        {cols.map((col, ci) => (
          <div className="kxr-flow-col" key={ci}>
            {col.map((id) => {
              const n = b.nodes.find((x) => x.id === id)!;
              return (
                <div key={id} className="kxr-flow-node" data-node={`${uid}-${id}`} tabIndex={0} data-lit={linked(id) || undefined} data-dim={hover !== null && !linked(id) || undefined}
                  onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(id)} onBlur={() => setHover(null)}
                  aria-label={`${n.label}${n.detail ? `：${n.detail}` : ""}`}>
                  <b>{n.label}</b>
                  {n.detail ? <span>{n.detail}</span> : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <ul className="m-sr">{b.edges.map(([a, c], i) => <li key={i}>{b.nodes.find((n) => n.id === a)?.label} 导向 {b.nodes.find((n) => n.id === c)?.label}</li>)}</ul>
    </section>
  );
}

// ───────── risks ─────────
const IMPACT = { high: "高", medium: "中", low: "低" } as const;
function Risks({ b }: { b: RisksBlock }) {
  const items = [...b.items].sort((x, y) => ["high", "medium", "low"].indexOf(x.impact) - ["high", "medium", "low"].indexOf(y.impact));
  return (
    <section className="kxr-block kxr-risks" aria-label={b.title ?? "风险"}>
      <Head title={b.title ?? "风险与应对"} aside={<span className="kxr-status-sum">{(["high", "medium", "low"] as const).filter((k) => b.items.some((i) => i.impact === k)).map((k) => <span key={k} data-impact={k}>{IMPACT[k]} {b.items.filter((i) => i.impact === k).length}</span>)}</span>} />
      <ul>
        {items.map((r, i) => (
          <li key={i} data-impact={r.impact}>
            <span className="kxr-impact" aria-label={`影响${IMPACT[r.impact]}`}>{IMPACT[r.impact]}</span>
            <div>
              <p className="kxr-risk-text">{inline(r.risk, `r${i}`)} <BasisTag basis={r.basis} /></p>
              {r.mitigation ? <p className="kxr-risk-fix"><span>应对</span>{inline(r.mitigation, `rm${i}`)}</p> : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ───────── sources ─────────
function Sources({ b }: { b: SourcesBlock }) {
  const scope = useRichScope();
  return (
    <section className="kxr-block kxr-sources" aria-label={b.title ?? "来源"}>
      <Head title={b.title ?? "来源"} aside={<span className="kxr-sub">标签说明来源性质，不代表已独立核实</span>} />
      <ol>
        {b.items.map((s) => (
          <li key={s.n} id={`kxr-src-${scope}-${s.n}`} tabIndex={-1}>
            <span className="kxr-src-n">{s.n}</span>
            <div>
              <p>{s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer nofollow">{s.title}</a> : s.title}</p>
              <p className="kxr-src-meta"><span className="kxr-pill" data-trust={s.trust}>{SOURCE_TRUST_LABEL[s.trust]}</span>{s.note ? <span>{s.note}</span> : null}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ───────── next actions ─────────
function Next({ b }: { b: NextBlock }) {
  const host = useKernHost();
  const [done, setDone] = useState<string | null>(null);
  return (
    <section className="kxr-block kxr-next" aria-label={b.title ?? "下一步"}>
      <span className="kxr-next-label">{b.title ?? "下一步"}</span>
      <div className="kxr-next-row">
        {b.items.map((n, i) => (
          <button key={i} type="button" className="kxr-chip-btn" disabled={!host} onClick={() => { host?.prefill(n.prompt); setDone(n.label); }}>
            {n.label}<span aria-hidden>↗</span>
          </button>
        ))}
      </div>
      {done ? <p className="kxr-next-note" role="status">已放进输入框，确认后发送：{done}</p> : null}
    </section>
  );
}

// ───────── table / callout / unknown / decision / keypoints ─────────
const UNKNOWN_CELL = /^(未知|待确认|待核实|无数据|unknown)/i;
function Table({ b }: { b: RichTableBlock }) {
  return (
    <section className="kxr-block kxr-table-block" aria-label={b.title ?? b.caption ?? "表格"}>
      <Head title={b.title} />
      <div className="kxr-matrix-wrap" data-flat>
        <table className="kxr-matrix">
          {b.caption ? <caption className="kxr-caption">{b.caption}</caption> : null}
          <thead><tr>{b.cols.map((c, i) => <th key={i} scope="col" data-num={c.num || undefined}>{c.label}</th>)}</tr></thead>
          <tbody>
            {b.rows.map((r, ri) => (
              <tr key={ri} data-pick={r.pick || undefined}>
                {r.cells.map((cell, ci) => ci === 0
                  ? <th key={ci} scope="row">{inline(cell, `t${ri}${ci}`)}</th>
                  : <td key={ci} data-num={b.cols[ci]?.num || undefined} data-unknown={UNKNOWN_CELL.test(cell.trim()) || undefined}>{inline(cell, `t${ri}${ci}`)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const CALLOUT_LABEL = { info: "说明", ok: "已确认", warn: "注意", blocked: "受阻" } as const;
function Callout({ b }: { b: RichCalloutBlock }) {
  return (
    <aside className="kxr-callout" data-tone={b.tone} role="note">
      <span className="kxr-callout-tag">{CALLOUT_LABEL[b.tone]}</span>
      <div><b>{inline(b.title, "ct")}</b>{b.body ? <p>{inline(b.body, "cb")}</p> : null}</div>
    </aside>
  );
}

function Unknowns({ b }: { b: RichUnknownBlock }) {
  return (
    <section className="kxr-block kxr-unknowns" aria-label={b.title ?? "还缺的信息"}>
      <Head title={b.title ?? "还缺的信息"} aside={<span className="kxr-sub">Kern 不替你猜</span>} />
      <ul>
        {b.items.map((u, i) => (
          <li key={i}>
            <span className="kxr-unknown-mark" aria-hidden>?</span>
            <div><p className="kxr-unknown-q">{inline(u.question, `uq${i}`)}</p><p className="kxr-unknown-n"><span>需要</span>{inline(u.needs, `un${i}`)}</p></div>
          </li>
        ))}
      </ul>
    </section>
  );
}

const CONF_LABEL = { HIGH: "把握较高", MEDIUM: "把握中等", LOW: "把握较低" } as const;
function Decision({ b }: { b: RichDecisionBlock }) {
  return (
    <section className="kxr-block kxr-decision" aria-label={b.title ?? "判断"}>
      <Head title={b.title ?? "判断"} aside={<span className="kxr-pill" data-conf={b.confidence}>{CONF_LABEL[b.confidence]}</span>} />
      <p className="kxr-decision-head">{inline(b.headline, "dh")}</p>
      <div className="kxr-decision-cols">
        {b.recommend.length ? <div><span className="kxr-decision-k" data-k="for">支持</span><ul className="kxr-pros">{b.recommend.map((x, i) => <li key={i}>{inline(x, `dr${i}`)}</li>)}</ul></div> : null}
        {b.against.length ? <div><span className="kxr-decision-k" data-k="against">反对</span><ul className="kxr-cons">{b.against.map((x, i) => <li key={i}>{inline(x, `da${i}`)}</li>)}</ul></div> : null}
        {b.risks.length ? <div><span className="kxr-decision-k" data-k="risk">风险</span><ul className="kxr-cons">{b.risks.map((x, i) => <li key={i}>{inline(x, `dk${i}`)}</li>)}</ul></div> : null}
      </div>
    </section>
  );
}

const KP_BASIS = { fact: "fact", inference: "inference", unknown: "unknown" } as const;
function Keypoints({ b }: { b: RichKeypointsBlock }) {
  return (
    <section className="kxr-block kxr-keypoints" aria-label={b.title ?? "要点"}>
      <Head title={b.title ?? "要点"} />
      <ul>{b.items.map((k, i) => <li key={i} data-kind={k.kind}><BasisTag basis={KP_BASIS[k.kind]} /><span>{inline(k.text, `kp${i}`)}</span></li>)}</ul>
    </section>
  );
}

// ───────── dispatcher ─────────
export function RichBlockView({ block }: { block: RichBlock }) {
  switch (block.type) {
    case "metrics": return <Metrics b={block} />;
    case "compare": return <Compare b={block} />;
    case "chart": return <Chart b={block} />;
    case "timeline": return <Timeline b={block} />;
    case "flow": return <Flow b={block} />;
    case "risks": return <Risks b={block} />;
    case "sources": return <Sources b={block} />;
    case "next": return <Next b={block} />;
    case "table": return <Table b={block} />;
    case "callout": return <Callout b={block} />;
    case "unknown": return <Unknowns b={block} />;
    case "decision": return <Decision b={block} />;
    case "keypoints": return <Keypoints b={block} />;
  }
}
