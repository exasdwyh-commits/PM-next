import type { ReactNode } from "react";
import { fmtDateTime, type DateInput } from "@/shared/datetime";

/**
 * HERMES 可视化原语层：四组机制共享的无状态展示组件。
 *
 * 设计约束（见 docs/plans/2026-09-17-quiet-enterprise-migration.md）：
 *  - **无 `"use client"`、无 hook、无副作用**：与 `ui.tsx` 同构，服务端页面可直接 SSR，
 *    客户端组件也可 import —— 不制造客户端边界、不引入 Suspense；
 *  - **三态退化**：降动画（prefers-reduced-motion）静止可读 / 空数据 / 无来源数据；
 *  - **证据契约**：无来源一律显示「未建档 / 待补证」，**绝不**显示硬编码数字或虚假评分；
 *  - **枚举中文化**：调用方必须传入已经过 `status-labels.ts` 的中文 label，
 *    或传入原始枚举给 `labelOf()` —— 组件本身不打印任何数据库枚举常量。
 */

export type VizTone = "accent" | "ok" | "warn" | "block" | "neutral";

function cx(...parts: unknown[]): string {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(" ");
}

/* ==========================================================================
   StepTrack —— 产品 / 项目阶段步进条
   降动画：连接段用静态背景色表示「已完成」，不用 width 动画。
   ========================================================================== */

export type StepState = "done" | "current" | "pending" | "unknown";

export interface StepItem {
  key: string;
  /** 必须已过 status-labels（如 PROJECT_STAGE_LABELS / PRODUCT_LIFECYCLE_STAGE_LABELS）。 */
  label: string;
  state: StepState;
  note?: string;
}

export interface StepTrackProps {
  steps: StepItem[];
  ariaLabel?: string;
  className?: string;
}

export function StepTrack({ steps, ariaLabel = "阶段进度", className }: StepTrackProps): ReactNode {
  const empty = steps.length === 0;
  return (
    <div className={cx("viz-steps", className)} data-empty={empty ? "true" : undefined} role="list" aria-label={ariaLabel}>
      {empty
        ? [0, 1, 2, 3].map((i) => (
            <span key={i} className="viz-step is-unknown" role="listitem">
              <i />
            </span>
          ))
        : steps.map((s) => (
            <span key={s.key} className={cx("viz-step", `is-${s.state}`)} role="listitem" data-state={s.state}>
              <i />
              <span className="viz-step-body">
                <span className="viz-step-label">{s.label}</span>
                {s.note && <span className="viz-step-note">{s.note}</span>}
              </span>
            </span>
          ))}
    </div>
  );
}

/* ==========================================================================
   GateLine —— 门槛线（G1/G2/G3）
   两套放行机制**如实并列、来源可见**：G1/G2 依据决策包、G3 依据上市计划。
   无来源 / 未建档 → 空心点 + 「未建档」，绝不显示通过状态或分数。
   ========================================================================== */

export type GateState = "passed" | "pending" | "blocked" | "not-created";
export type GateSource = "decision-packet" | "launch-plan" | "none";

export interface GateNode {
  key: "G1" | "G2" | "G3";
  /** 中文门名，如「研发打样门」。 */
  label: string;
  state: GateState;
  /** 机制来源，如实标注（两套机制不合并）。 */
  source: GateSource;
  detail?: string;
  refId?: string | null;
}

export interface GateLineProps {
  gates: GateNode[];
  ariaLabel?: string;
  className?: string;
}

const GATE_STATE_TEXT: Record<GateState, string> = {
  passed: "已通过",
  pending: "待审批",
  blocked: "受阻",
  "not-created": "未建档",
};

const GATE_SOURCE_TEXT: Record<GateSource, string> = {
  "decision-packet": "依据：决策包",
  "launch-plan": "依据：上市计划",
  none: "依据：无",
};

export function GateLine({ gates, ariaLabel = "放行门槛线", className }: GateLineProps): ReactNode {
  const empty = gates.length === 0;
  const list: GateNode[] = empty
    ? ([
        { key: "G1", label: "研发打样门", state: "not-created", source: "none" },
        { key: "G2", label: "生产门", state: "not-created", source: "none" },
        { key: "G3", label: "上市放行", state: "not-created", source: "none" },
      ] as GateNode[])
    : gates;
  return (
    <div className={cx("viz-gate-line", className)} data-empty={empty ? "true" : undefined} role="list" aria-label={ariaLabel}>
      {list.map((g, i) => {
        // 无来源 / 未建档：一律按「未建档」呈现（空心点 + 未建档），绝不显示通过状态。
        const notCreated = g.source === "none" || g.state === "not-created";
        const state: GateState = notCreated ? "not-created" : g.state;
        return (
          <span key={g.key} className="viz-gate-row" role="listitem">
            <div className="viz-gate" data-state={state} data-source={g.source} title={g.detail || undefined}>
              <span className="viz-gate-key">{g.key}</span>
              <span className="circle" aria-hidden="true" />
              <span className="viz-gate-state">{notCreated ? "未建档" : GATE_STATE_TEXT[state]}</span>
              <span className="viz-gate-label">{g.label}</span>
              {g.detail && !notCreated && <span className="viz-gate-detail">{g.detail}</span>}
              <span className="viz-gate-source">{GATE_SOURCE_TEXT[g.source]}</span>
            </div>
            {i < list.length - 1 && <span className={cx("viz-gate-seg", state === "passed" && "is-done")} aria-hidden="true" />}
          </span>
        );
      })}
    </div>
  );
}

/* ==========================================================================
   ProgressRing —— 环形进度
   静态 conic-gradient，**明令不加动画**（加动画会在降动画下冻结在 0% ≈ 空环）。
   value === null → 中性空环 + 「未建档」，不显示任何百分比。
   valueText 给定时，环心显示该文本（如比率「0/12 已核实」）而非裸百分比，环线仍按 value 画。
   ========================================================================== */

export interface ProgressRingProps {
  value: number | null;
  label?: string;
  caption?: string;
  tone?: VizTone;
  size?: number;
  /**
   * 覆盖环心主显示文本（例如比率「0/12 已核实」）。缺省显示 `{pct}%`。
   * 当依据只给得出比率、而裸百分比会被误读时使用（此时环心字号自动收窄 + 允许换行）。
   */
  valueText?: string;
}

export function ProgressRing({ value, label, caption, tone = "accent", size = 126, valueText }: ProgressRingProps): ReactNode {
  const hasData = typeof value === "number" && Number.isFinite(value);
  const pct = hasData ? Math.max(0, Math.min(100, Math.round(value as number))) : 0;
  // 有数据时才可能用自定义文本；给定 valueText 则走「比率」显示（data-display 触发缩放兜底）
  const mainText = hasData ? valueText ?? `${pct}%` : null;
  const isRatio = hasData && typeof valueText === "string";
  return (
    <div
      className="progress-ring"
      data-empty={hasData ? undefined : "true"}
      data-display={isRatio ? "ratio" : undefined}
      data-tone={tone}
      style={{ ["--p" as string]: String(pct), width: size, height: size }}
      role="img"
      aria-label={hasData ? `${label ?? "进度"} ${mainText}` : `${label ?? "进度"}：未建档`}
    >
      <div className="progress-ring-body">
        {hasData ? (
          <span className="progress-ring-value">{mainText}</span>
        ) : (
          <span className="viz-unrecorded">未建档</span>
        )}
        {(label || caption) && <span className="progress-ring-caption">{caption || label}</span>}
      </div>
    </div>
  );
}

/* ==========================================================================
   ScoreBar —— 单个评分维度条（移植自老版 cockpit-truth 的 ScoreSummary 维度条）
   两态：
     · 有分值 → 画条 + 显示分值；
     · 分值为 null → **不画条、不显示 0**，只写「未知」。
   老版把每个维度都按 0..10 归一化后画条（缺数据也照画），本仓按证据契约收紧：
   没有依据的维度不给条、不给 0 —— 空白就是空白，不是低分。
   ========================================================================== */

export interface ScoreBarProps {
  /** 必须已过 status-labels 的维度中文名。 */
  label: string;
  /** 0..100；null = 未知（不画条、不显示 0）。 */
  value: number | null;
  /** 右侧附加说明，如权重「25%」。 */
  note?: string;
  tone?: VizTone;
}

export function ScoreBar({ label, value, note, tone = "accent" }: ScoreBarProps): ReactNode {
  const has = typeof value === "number" && Number.isFinite(value);
  const pct = has ? Math.max(0, Math.min(100, Math.round(value as number))) : 0;
  return (
    <div className="viz-scorebar" data-empty={has ? undefined : "true"} data-tone={tone}>
      <div className="viz-scorebar-head">
        <span className="viz-scorebar-label">{label}</span>
        <span className="viz-scorebar-value">{has ? pct : "未知"}</span>
      </div>
      {/* 纯装饰：数值已在上一行以文本给出，读屏不必再念一遍条 */}
      <div className="viz-scorebar-track" aria-hidden="true">
        {has ? <i style={{ width: `${pct}%` }} /> : null}
      </div>
      {note ? <span className="viz-scorebar-note">{note}</span> : null}
    </div>
  );
}

/* ==========================================================================
   BubbleChart —— 机会气泡图
   两轴：价值轴 / 匹配度轴。本仓当前**无可靠连续数值来源**（详见迁移文档 §四）：
     · 匹配度轴：SignalItem.relevance 无任何写入（唯一写入点恒为 null）；
     · 价值轴：仅人工序数 valueTier，importance 恒为 1（非业务打分）。
   因此：source!=="verified-real" 或 data 为空 → **不画任何点**，只渲染坐标框 + 「未建档」。
   ========================================================================== */

export interface BubbleDatum {
  id: string;
  label: string;
  /** 价值轴 0..100（仅当 resolveAxis ok 才会出现在此）。 */
  x: number;
  /** 匹配度轴 0..100。 */
  y: number;
  weight?: number;
  tone?: VizTone;
}

export interface BubbleChartProps {
  /** 调用方必须已过滤为「有来源」的点。 */
  data: BubbleDatum[];
  xLabel: string;
  yLabel: string;
  source: "verified-real" | "demo" | "none";
  height?: number;
  className?: string;
}

/** 轴解析结果：无来源 / 未核实 / 演示 —— 三态都不可画点。 */
export interface AxisResult {
  ok: boolean;
  value?: number;
  reason?: "no-source" | "unverified" | "demo";
}

/**
 * 轴解析：只有当存在「有明确依据的连续数值」时才 ok=true。
 *  - 序数（high/normal/low）不得线性映射成数值（那是虚假精确）；
 *  - 未校准的 importance（默认值 1）不算数据源；
 *  - 演示数据（DEMO）不参与真实绘制。
 */
export function resolveAxis(input: {
  value?: number | null;
  hasReason?: boolean;
  calibrated?: boolean;
  nature?: "REAL" | "DEMO" | null;
}): AxisResult {
  if (input.nature === "DEMO") return { ok: false, reason: "demo" };
  if (typeof input.value !== "number" || !Number.isFinite(input.value)) {
    return { ok: false, reason: "no-source" };
  }
  if (!input.hasReason || input.calibrated === false) {
    return { ok: false, reason: "unverified" };
  }
  return { ok: true, value: input.value };
}

export function BubbleChart({ data, xLabel, yLabel, source, height = 340, className }: BubbleChartProps): ReactNode {
  const drawable = source === "verified-real" && data.length > 0;
  return (
    <div className={cx("bubble-scroll", className)}>
      {source === "demo" && <p className="bubble-warn">演示数据，不得作为决策依据。</p>}
      <div className="bubble-chart" style={{ height }}>
        <span className="bubble-axis-y">{yLabel}</span>
        <span className="bubble-axis-x">{xLabel}</span>
        {drawable ? (
          <div className="bubble-plot">
            {data.map((d) => {
              const size = Math.max(28, Math.min(58, 30 + (d.weight ?? 1) * 6));
              return (
                <span
                  key={d.id}
                  className="bubble-dot"
                  data-tone={d.tone ?? "accent"}
                  style={{ left: `${d.x}%`, bottom: `${d.y}%`, width: size, height: size }}
                  title={d.label}
                >
                  {d.label}
                </span>
              );
            })}
          </div>
        ) : (
          <div className="bubble-empty">
            <span>
              {source === "demo" ? "演示数据，不绘制。" : "未建档 / 待补证"}
              <br />
              价值轴与匹配度轴当前无可靠连续数值来源，暂不绘制。
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ==========================================================================
   Timeline —— 决策 / 审计时间线
   时间一律走 datetime.ts（固定 Asia/Shanghai + 显式 locale），杜绝 hydration 错配。
   空数据 → 用 Empty 语义（真空缺口），不是 Thinking（加载中）。
   ========================================================================== */

export interface TimelineItem {
  id: string;
  at: DateInput;
  title: string;
  body?: string;
  tone?: VizTone;
  actor?: string;
  refId?: string | null;
}

export interface TimelineProps {
  items: TimelineItem[];
  emptyText?: string;
  ariaLabel?: string;
  className?: string;
}

export function Timeline({ items, emptyText = "暂无记录。", ariaLabel = "时间线", className }: TimelineProps): ReactNode {
  if (items.length === 0) {
    return (
      <div className={cx("hermes-empty", className)} aria-label={ariaLabel}>
        {emptyText}
      </div>
    );
  }
  return (
    <ul className={cx("viz-timeline", className)} aria-label={ariaLabel}>
      {items.map((it) => (
        <li key={it.id} data-tone={it.tone ?? "accent"}>
          <div className="viz-tl-at">{fmtDateTime(it.at)}</div>
          <div className="viz-tl-title">{it.title}</div>
          {it.body && <div className="viz-tl-body">{it.body}</div>}
          {it.actor && <div className="viz-tl-actor">{it.actor}</div>}
        </li>
      ))}
    </ul>
  );
}
