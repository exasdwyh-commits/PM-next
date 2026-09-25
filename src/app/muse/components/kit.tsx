/** Muse 原语层：状态语义、按钮、标签、卡片、图标。语义只在这里定义一次。 */
import type { AiState, Confidence, Tone } from "../types";

type T = "accent" | "ok" | "warn" | "bad" | "neutral";

export const TONE: Record<Tone, T> = { accent: "accent", ok: "ok", warn: "warn", block: "bad", neutral: "neutral" };

export const STATE: Record<AiState, { label: string; tone: T; glyph: string }> = {
  idle: { label: "待命", tone: "neutral", glyph: "·" },
  working: { label: "正在推进", tone: "accent", glyph: "" },
  "needs-review": { label: "等你确认", tone: "warn", glyph: "!" },
  success: { label: "已完成", tone: "ok", glyph: "✓" },
  error: { label: "出错了", tone: "bad", glyph: "×" },
  cancelled: { label: "已取消", tone: "neutral", glyph: "–" },
};

export const CONF: Record<Confidence, { label: string; tone: T }> = {
  high: { label: "来源可靠", tone: "ok" },
  medium: { label: "一般可靠", tone: "accent" },
  low: { label: "证据偏弱", tone: "warn" },
  unknown: { label: "UNKNOWN", tone: "bad" },
};

export function Tag({ tone = "neutral", live, children }: { tone?: T; live?: boolean; children: React.ReactNode }) {
  return (
    <span className="m-tag" data-t={tone} data-live={live ? "true" : undefined}>
      {tone !== "neutral" ? <i aria-hidden /> : null}
      {children}
    </span>
  );
}

export function StateTag({ state }: { state: AiState }) {
  const s = STATE[state];
  return <Tag tone={s.tone} live={state === "working"}>{s.label}</Tag>;
}

export function Btn({
  v = "default", size, children, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { v?: "default" | "primary" | "danger" | "ghost"; size?: "sm" }) {
  return <button type="button" className="m-btn" data-v={v} data-size={size} {...rest}>{children}</button>;
}

export function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <section className={`m-card ${className}`}>{children}</section>;
}

export function CardHead({ icon, title, aside }: { icon?: React.ReactNode; title: string; aside?: React.ReactNode }) {
  return (
    <header className="m-card-head">
      {icon ? <span className="m-ico" aria-hidden>{icon}</span> : null}
      <b>{title}</b>
      {aside}
    </header>
  );
}

/** 计划节点：形状 + 字符 + 色三重编码，不只靠颜色。 */
export function Node({ state }: { state: AiState }) {
  return (
    <span className="m-node" data-s={state} role="img" aria-label={STATE[state].label}>
      {state === "working" ? null : STATE[state].glyph}
    </span>
  );
}

const svg = (d: string, size = 17) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
export const I = {
  plus: () => svg("M12 5v14M5 12h14"),
  plan: () => svg("M5 7h14M5 12h9M5 17h12"),
  trail: () => svg("M12 8V4M12 20v-4M6.3 6.3 4 4M20 20l-2.3-2.3M4 12h4M16 12h4"),
  shield: () => svg("M12 3l7 3v6c0 4.2-2.8 7.4-7 9-4.2-1.6-7-4.8-7-9V6z"),
  source: () => svg("M8 4h7l4 4v12H8zM15 4v4h4M11 13h5M11 17h3"),
  mac: () => svg("M4 5h16v11H4zM10 20h4M12 16v4"),
  send: () => svg("M6 12h11M12 6l6 6-6 6", 18),
  close: () => svg("M6 6l12 12M18 6 6 18"),
  menu: () => svg("M4 7h16M4 12h16M4 17h16"),
  spark: () => svg("M12 4v3M12 17v3M4 12h3M17 12h3M6.8 6.8 8.9 8.9M15.1 15.1l2.1 2.1M17.2 6.8 15.1 8.9M8.9 15.1 6.8 17.2"),
  search: () => svg("M11 18.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM20 20l-3.8-3.8"),
  check: () => svg("M5 13l4.5 4.5L19 7"),
};
