"use client";

import React from "react";
import Link from "next/link";
import Icon from "./icons";
import { cx } from "./ui";
import { useRole } from "./role-context";
import "./cockpit-rich.css";

const CATEGORY_INFO: Record<string, { icon: string; name: string; color: string; gradient: string }> = {
  regular_food: { icon: "🍪", name: "普通食品", color: "#f59e0b", gradient: "linear-gradient(135deg,#fffbeb,#fef3c7)" },
  health_food: { icon: "💊", name: "保健食品", color: "#7c3aed", gradient: "linear-gradient(135deg,#f5f3ff,#ede9fe)" },
  cross_border_food: { icon: "🌍", name: "跨境食品", color: "#0891b2", gradient: "linear-gradient(135deg,#ecfeff,#cffafe)" },
  cosmetics: { icon: "💄", name: "化妆品", color: "#db2777", gradient: "linear-gradient(135deg,#fdf2f8,#fce7f3)" },
};

function HeroRidgeRich({ color }: { color: string }) {
  return (
    <div className="hero-art-rich" aria-hidden="true">
      <svg className="hero-ridge-rich" viewBox="0 0 600 168" preserveAspectRatio="none">
        <path fill={color} opacity={0.15} d="M0 122 L88 74 L158 104 L248 50 L330 100 L408 64 L498 108 L600 76 L600 168 L0 168 Z" />
        <path fill="none" stroke={color} strokeWidth={2} opacity={0.4} d="M0 122 L88 74 L158 104 L248 50 L330 100 L408 64 L498 108 L600 76" />
      </svg>
    </div>
  );
}

export function HeroBandRich({ eyebrow, mark, tagline, intro, quote, category = "health_food" }: any) {
  const catInfo = CATEGORY_INFO[category] || CATEGORY_INFO.health_food;
  const { role } = useRole();
  return (
    <header className="hermes-hero-rich" data-role={role} style={{ background: catInfo.gradient, borderColor: catInfo.color } as any}>
      <HeroRidgeRich color={catInfo.color} />
      <div className="hero-copy-rich">
        <div className="hero-eyebrow-rich"><span style={{ background: catInfo.color, color: "white", padding: "2px 8px", borderRadius: 99, fontSize: 10 }}>{catInfo.icon} {catInfo.name} · {role}视角 · 富可视化</span> {eyebrow}</div>
        <div className="hero-mark-rich">{mark}</div>
        <h1 className="hero-tagline-rich">{tagline}</h1>
        {intro ? <p className="hero-intro-rich">{intro} · {catInfo.name}专用 · Kern智能统筹</p> : null}
      </div>
      {quote ? <div className="hero-quote-rich">{quote}</div> : null}
    </header>
  );
}

export function KpiRich({ label, value, note, tone, emphasis, category = "health_food", idx = 0 }: any) {
  const catInfo = CATEGORY_INFO[category] || CATEGORY_INFO.health_food;
  return (
    <div className={cx("hermes-kpi-rich", tone && `is-${tone}`, emphasis && `is-${emphasis}`)} style={{ animationDelay: `${idx * 80}ms`, borderColor: tone ? undefined : `${catInfo.color}20` } as any}>
      <strong>{value}</strong>
      <span>{label} · {catInfo.icon}</span>
      {note ? <small>{note}</small> : null}
      <div className="kpi-bar"><div className="fill" style={{ background: catInfo.color, width: "70%" }}></div></div>
    </div>
  );
}

export function KpiRowRich({ children, category = "health_food" }: any) {
  const catInfo = CATEGORY_INFO[category] || CATEGORY_INFO.health_food;
  return <div className="hermes-kpi-row-rich" style={{ borderColor: `${catInfo.color}20` } as any}>{children}</div>;
}

export function DecisionBoardRich({ index, title, summary, columns, actions, meta, category = "health_food" }: any) {
  const catInfo = CATEGORY_INFO[category] || CATEGORY_INFO.health_food;
  const { role } = useRole();

  if (role === "leadership") {
    return (
      <section className="hermes-decision-board-rich leadership" style={{ borderColor: catInfo.color }}>
        <div className="decision-top-rich" style={{ background: catInfo.gradient }}><span>需要你决定 · {catInfo.icon} {catInfo.name}</span>{meta ? <span>{meta}</span> : null}</div>
        <div className="decision-body-rich"><div className="decision-num-rich" style={{ background: catInfo.color, color: "white" }}>{String(index).padStart(2, "0")}</div><div><h2>{title}</h2>{summary ? <p>{summary}</p> : null}</div></div>
        <div className="boss-summary-rich" style={{ borderLeft: `3px solid ${catInfo.color}` }}><strong>💡 一句话结论</strong><p>{summary || "需决策"} · {catInfo.name}专用</p></div>
        {actions ? <div className="decision-foot-rich">{actions}</div> : null}
      </section>
    );
  }

  if (role === "sales") {
    return (
      <section className="hermes-decision-board-rich sales" style={{ background: catInfo.gradient, borderColor: catInfo.color }}>
        <div className="decision-top-rich"><span>💼 销售决策 · {catInfo.icon} {catInfo.name}</span></div>
        <div className="decision-body-rich"><h2>{title}</h2><p>{summary}</p></div>
        <div className="selling-card-rich" style={{ borderLeft: `3px solid ${catInfo.color}` }}><strong>💎 销售卖点</strong><p>{columns?.[0]?.text || "卖点突出"} · {catInfo.name}专用</p></div>
        {actions ? <div className="decision-foot-rich">{actions}</div> : null}
      </section>
    );
  }

  return (
    <section className="hermes-decision-board-rich product" style={{ borderColor: catInfo.color }}>
      <div className="decision-top-rich"><span>需要你决定 · {catInfo.icon} {catInfo.name} · 专业严谨</span>{meta ? <span>{meta}</span> : null}</div>
      <div className="decision-body-rich"><div className="decision-num-rich">{String(index).padStart(2, "0")}</div><div><h2>{title}</h2>{summary ? <p>{summary}</p> : null}</div></div>
      {columns.length > 0 && (
        <div className="decision-cols-rich">{columns.map((c: any) => <div className="decision-col-rich" key={c.label}><b>{c.label}</b><p>{c.text}</p></div>)}</div>
      )}
      {actions ? <div className="decision-foot-rich">{actions}</div> : null}
    </section>
  );
}

export function ProgressRowRich({ name, sub, href, pill, monogram, category = "health_food", idx = 0 }: any) {
  const catInfo = CATEGORY_INFO[category] || CATEGORY_INFO.health_food;
  const mark = monogram ?? (typeof name === "string" ? name.trim().slice(0, 1) : "");
  return (
    <Link href={href} className="hermes-progress-row-rich" style={{ animationDelay: `${idx * 60}ms`, borderLeft: `3px solid ${catInfo.color}` } as any}>
      <span className="progress-main-rich"><span className="thumb-rich" style={{ background: catInfo.color, color: "white" }}>{mark}</span><span className="progress-text-rich"><span className="progress-name-rich">{name} · {catInfo.icon}</span>{sub ? <span className="progress-sub-rich">{sub}</span> : null}</span></span>{pill ?? null}
    </Link>
  );
}
