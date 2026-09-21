import React from "react";
import Link from "next/link";
import Icon from "./icons";
import { cx } from "./ui";

/**
 * 驾驶舱版式组件（对齐 hermes-frontend-v2 的页面 composition）。
 *
 * 与既有组件的分工：
 * - `ui.tsx` 管跨页原语（面板 / 徽章 / 空态 / 模态）；
 * - `viz.tsx` 管数据可视化（阶段步进 / 门槛线 / 环形进度 / 气泡图 / 时间线）；
 * - 本文件只放**驾驶舱专有**的版式块：品牌带、KPI 行、决策板、状态药丸、缩略行、发现卡。
 *
 * 硬约束：
 * 1. 无 hook，SSR 安全 —— 首页是客户端组件，但这些块要能被任意页面复用；
 * 2. 零内联色值 —— 颜色一律走 quiet-enterprise 令牌，否则颜色收敛守卫变红；
 * 3. 不编造数据 —— 调用方传空即渲染空态，组件自身不补占位数字或默认文案。
 */

/** 品牌带右侧的山脊装饰：纯 CSS 令牌着色，不引入外部图片资源。 */
function HeroRidge() {
  return (
    <div className="hermes-hero-art" aria-hidden="true">
      <svg className="hermes-hero-ridge" viewBox="0 0 600 168" preserveAspectRatio="none">
        <path
          className="hermes-hero-ridge-fill"
          d="M0 122 L88 74 L158 104 L248 50 L330 100 L408 64 L498 108 L600 76 L600 168 L0 168 Z"
        />
        <path
          className="hermes-hero-ridge-line"
          d="M0 122 L88 74 L158 104 L248 50 L330 100 L408 64 L498 108 L600 76"
        />
        {/* 近景山脊：用 accent-bg 实色，比远山更实，保证水印在浅底上真的看得见 */}
        <path
          className="hermes-hero-ridge-near"
          d="M0 152 L118 118 L212 140 L318 106 L432 138 L540 114 L600 134 L600 168 L0 168 Z"
        />
      </svg>
      <div className="hermes-hero-veil" />
    </div>
  );
}

/** 首页品牌带：日期 → 字标 → 主张 → 说明 + 右下角品牌语。 */
export function HeroBand({
  eyebrow,
  mark,
  tagline,
  intro,
  quote,
}: {
  eyebrow: React.ReactNode;
  mark: React.ReactNode;
  tagline: React.ReactNode;
  intro?: React.ReactNode;
  quote?: React.ReactNode;
}) {
  return (
    <header className="hermes-hero">
      <HeroRidge />
      <div className="hermes-hero-copy">
        <div className="hermes-hero-eyebrow">{eyebrow}</div>
        <div className="hermes-hero-mark">{mark}</div>
        <h1 className="hermes-hero-tagline">{tagline}</h1>
        {intro ? <p className="hermes-hero-intro">{intro}</p> : null}
      </div>
      {quote ? (
        <div className="hermes-hero-quote">
          {quote}
        </div>
      ) : null}
    </header>
  );
}

/** 单个 KPI 格。`tone` 只允许 alert（阻塞红）/ good（正常绿），其余走默认墨色。 */
export function Kpi({
  label,
  value,
  note,
  tone,
  emphasis,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  note?: React.ReactNode;
  tone?: "alert" | "good";
  /** 只给真正的产品主线指标使用，避免所有 KPI 都争抢注意力。 */
  emphasis?: "primary" | "decision";
}) {
  return (
    <div className={cx("hermes-kpi", tone && `is-${tone}`, emphasis && `is-${emphasis}`)}>
      <strong>{value}</strong>
      <span>{label}</span>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

export function KpiRow({ children }: { children: React.ReactNode }) {
  return <div className="hermes-kpi-row">{children}</div>;
}

/** 状态药丸。tone 与 Badge 同义，但用于「列表行右侧」这类更轻的场合。 */
export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "info" | "ok" | "warn" | "danger";
  children: React.ReactNode;
}) {
  return <span className={cx("hermes-pill", `is-${tone}`)}>{children}</span>;
}

export interface DecisionColumn {
  label: string;
  text: React.ReactNode;
}

/**
 * 决策板：把排序第一的事项展开成「现状 / 建议 / 风险」三栏 + 行动按钮。
 * 序号由调用方按全队列位置传入（1 起），不在此处自行计数，避免与列表序号错位。
 */
export function DecisionBoard({
  index,
  title,
  summary,
  columns,
  actions,
  meta,
}: {
  index: number;
  title: React.ReactNode;
  summary?: React.ReactNode;
  columns: DecisionColumn[];
  actions?: React.ReactNode;
  meta?: React.ReactNode;
}) {
  return (
    <section className="hermes-decision-board">
      <div className="hermes-decision-top">
        <span>需要你决定</span>
        {meta ? <span>{meta}</span> : null}
      </div>
      <div className="hermes-decision-body">
        <div className="hermes-decision-num">{String(index).padStart(2, "0")}</div>
        <div>
          <h2 className="hermes-decision-name">{title}</h2>
          {summary ? <p className="hermes-decision-sum">{summary}</p> : null}
        </div>
      </div>
      {/* 只渲染调用方给到的栏位：缺依据时宁可不显示该栏，也不写「暂无风险」式结论 */}
      {columns.length > 0 && (
        <div className="hermes-decision-cols">
          {columns.map((c) => (
            <div className="hermes-decision-col" key={c.label}>
              <b>{c.label}</b>
              <p>{c.text}</p>
            </div>
          ))}
        </div>
      )}
      {actions ? <div className="hermes-decision-foot">{actions}</div> : null}
    </section>
  );
}

/** 推进行：首字母块 + 名称/副题 + 右侧状态药丸，整行可点。 */
export function ProgressRow({
  name,
  sub,
  href,
  pill,
  monogram,
}: {
  name: React.ReactNode;
  sub?: React.ReactNode;
  href: string;
  pill?: React.ReactNode;
  /** 首字母块的字；缺省取 name 的首字符。产品没有图片资源，首字母块比灰方块清楚。 */
  monogram?: string;
}) {
  const mark = monogram ?? (typeof name === "string" ? name.trim().slice(0, 1) : "");
  return (
    <Link href={href} className="hermes-progress-row">
      <span className="hermes-progress-main">
        <span className="hermes-thumb" aria-hidden="true">
          {mark}
        </span>
        <span className="hermes-progress-text">
          <span className="hermes-progress-name">{name}</span>
          {sub ? <span className="hermes-progress-sub">{sub}</span> : null}
        </span>
      </span>
      {pill ?? null}
    </Link>
  );
}

/** 侧栏动态行：左标题/副题，右药丸；`done` 为真时左侧换成完成勾。 */
export function FeedRow({
  title,
  sub,
  href,
  pill,
  done = false,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  href?: string | null;
  pill?: React.ReactNode;
  done?: boolean;
}) {
  const body = (
    <>
      {done ? (
        <span className="hermes-feed-done">
          <span className="hermes-feed-check" aria-hidden="true">
            <Icon name="check" size={14} />
          </span>
          <span>
            <span className="hermes-feed-title">{title}</span>
            {sub ? <span className="hermes-feed-sub">{sub}</span> : null}
          </span>
        </span>
      ) : (
        <span>
          <span className="hermes-feed-title">{title}</span>
          {sub ? <span className="hermes-feed-sub">{sub}</span> : null}
        </span>
      )}
      {pill ?? null}
    </>
  );
  return href ? (
    <Link href={href} className="hermes-feed-row">
      {body}
    </Link>
  ) : (
    <div className="hermes-feed-row">{body}</div>
  );
}
