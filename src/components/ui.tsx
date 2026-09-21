import React from "react";
import Icon from "./icons";

/**
 * HERMES UI 原语层。
 * 全部沿用 globals.css 中既有的 paper / teal / 毛玻璃设计语言，
 * 供各页面复用，避免每页各写一套 slate 裸样式。
 */

type Tone = "ok" | "warn" | "danger" | "info" | "neutral" | "brand";

export function cx(...parts: unknown[]) {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(" ");
}

/** 毛玻璃卡片 */
export function GlassCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cx("hermes-glass", className)}>{children}</div>;
}

/** 内容面板：卡片 + 标题区。`icon` 给定时，标题左侧带一个强调色图标块（区块锚点）。 */
export function Panel({
  eyebrow,
  icon,
  title,
  titleSmall,
  sub,
  actions,
  className,
  children,
}: {
  eyebrow?: string;
  /** icons.tsx 中的图标名。给定时渲染 `.hermes-panel-icon` 方块。 */
  icon?: string;
  title?: React.ReactNode;
  titleSmall?: React.ReactNode;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  const hasHead = eyebrow || icon || title || sub || actions;
  // 无 icon 时保持与旧版完全相同的 DOM（仍是裸 <div>），避免影响既有面板的排版与断言。
  const heading = (
    <>
      {eyebrow && <span className="hermes-section-label">{eyebrow}</span>}
      {title && (
        <h2 className="hermes-panel-title">
          {title}
          {titleSmall && <small>{titleSmall}</small>}
        </h2>
      )}
      {sub && <p className="hermes-panel-sub">{sub}</p>}
    </>
  );
  return (
    <GlassCard className={cx("hermes-panel", className)}>
      {hasHead && (
        <div className={cx("hermes-panel-head", sub && !actions && "is-stacked")}>
          {icon ? (
            <div className="hermes-panel-heading">
              <span className="hermes-panel-icon" aria-hidden="true">
                <Icon name={icon} size={17} />
              </span>
              <div>{heading}</div>
            </div>
          ) : (
            <div>{heading}</div>
          )}
          {actions && <div className="hermes-inline-end">{actions}</div>}
        </div>
      )}
      {children}
    </GlassCard>
  );
}

/** 页面标题区（沿用首页 .hermes-page-heading 外观） */
export function PageHeading({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="hermes-page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function StatGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx("hermes-stat-grid", className)}>{children}</div>;
}

export function Stat({
  label,
  value,
  small,
  hint,
  tone,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  small?: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "alert" | "good";
  className?: string;
}) {
  return (
    <GlassCard className={cx("hermes-stat", tone && `is-${tone}`, className)}>
      <span>{label}</span>
      <strong>
        {value}
        {small && <small style={{ fontSize: 13, color: "var(--ink-faint)", marginLeft: 4 }}>{small}</small>}
      </strong>
      {hint && <small>{hint}</small>}
    </GlassCard>
  );
}

/** 状态徽章：自动把常见业务枚举映射到色调 */
export function Badge({
  tone,
  status,
  children,
  className,
}: {
  tone?: Tone;
  status?: string | null;
  children?: React.ReactNode;
  className?: string;
}) {
  const t = tone ?? toneOf(status);
  return <span className={cx("hermes-badge", `is-${t}`, className)}>{children ?? status}</span>;
}

export function toneOf(status?: string | null): Tone {
  switch ((status || "").toUpperCase()) {
    case "VERIFIED":
    case "ACCEPTED":
    case "APPROVED":
    case "ACCEPT":
    case "REAL":
    case "CONFIRMED":
    case "VERIFIED_BY_LEAD":
    case "DELIVERED":
    case "SUCCESS":
      return "ok";
    case "REJECTED":
    case "REJECT":
    case "BLOCKED":
    case "FAILED":
    case "DEMO":
      return "danger";
    case "UNVERIFIED":
    case "PENDING":
    case "OPEN":
    case "NEEDS_INFO":
    case "IN_REVIEW":
    case "CHANGES_REQUESTED":
    case "REQUEST_CHANGES":
    case "DEFER":
    case "DEFERRED":
    case "IN_PROGRESS":
    case "SUBMITTED":
      return "warn";
    case "DRAFT":
    case "WITHDRAWN":
    case "UNAPPLIED":
    case "NONE":
      return "neutral";
    default:
      return "info";
  }
}

/**
 * 空态。三件套可选（移植自老版 cockpit-truth 的 `EmptyState`）：
 *   `title` 一句说清「这里为什么是空的」→ `children` 说明 → `action` 给出下一步入口。
 * 只传 children 时渲染形态与旧版逐字节一致（既有调用点无需改动）。
 * 注意语义边界：**空态 ≠ 加载中**，加载中一律用 `Thinking`。
 */
export function Empty({
  title,
  action,
  children,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="hermes-empty">
      {title ? <p className="hermes-empty-title">{title}</p> : null}
      {children}
      {action ? <div className="hermes-empty-action">{action}</div> : null}
    </div>
  );
}

/**
 * 思考中/等待中的**进行态**指示（秘塔式动画）。
 * 语义与 Empty 明确区分：Empty 表示「这里没有内容」，Thinking 表示「内容还在路上」。
 *
 * 无障碍：外层 role="status" + aria-live="polite"，可被读屏播报；
 * 圆点容器为纯装饰，标 aria-hidden，可访问名只来自 label 文本。
 *
 * `steps`：AI UX 的「状态透明」——不只说「在思考」，而是如实说明**这次会做什么**。
 * 步骤写在 live region **之外**，避免读屏把整张步骤表当状态变更反复播报。
 * 步骤只陈述「会执行什么」，**不表示完成进度**：不画百分比、不标已完成，
 * 因为过程是否走完由服务端结果决定，客户端无从得知。
 */
export function Thinking({
  label = "正在思考…",
  steps,
  hint,
  className,
}: {
  label?: string;
  /** 如实列出本次会执行的步骤；缺省时不渲染步骤区，保持既有单行形态。 */
  steps?: string[];
  /** 步骤区抬头，默认「正在执行的步骤」。 */
  hint?: string;
  className?: string;
}) {
  const head = (
    <div role="status" aria-live="polite" className={cx("hermes-thinking", className)}>
      <span className="hermes-thinking-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="hermes-thinking-label">{label}</span>
    </div>
  );

  if (!steps || steps.length === 0) return head;

  return (
    <div className="hermes-thinking-block">
      {head}
      <div className="hermes-thinking-steps">
        <span className="hermes-thinking-steps-label">{hint ?? "正在执行的步骤"}</span>
        <ol>
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** 键值对列表 */
export function KV({ items }: { items: { k: React.ReactNode; v: React.ReactNode }[] }) {
  return (
    <dl className="hermes-kv">
      {items.map((it, i) => (
        <React.Fragment key={i}>
          <dt>{it.k}</dt>
          <dd>{it.v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** 模态框：沿用既有 .hermes-modal 外观 */
export function Modal({
  eyebrow,
  title,
  sub,
  onClose,
  wide,
  children,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  sub?: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="hermes-modal-backdrop" onMouseDown={onClose}>
      <div
        className={cx("hermes-modal", "hermes-glass", wide && "is-wide")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button type="button" className="modal-close" onClick={onClose} aria-label="关闭">
          <Icon name="close" size={17} />
        </button>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h3>{title}</h3>
        {sub && <p>{sub}</p>}
        {children}
      </div>
    </div>
  );
}

/** 标签页 */
export function Tabs<T extends string>({
  items,
  active,
  onChange,
}: {
  items: { key: T; label: React.ReactNode }[];
  active: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="hermes-tabs" role="tablist">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          role="tab"
          aria-selected={active === it.key}
          className={active === it.key ? "is-active" : ""}
          onClick={() => onChange(it.key)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  disabled,
  onClick,
  type = "button",
  children,
  className,
}: {
  variant?: "primary" | "secondary" | "ghost" | "outline";
  size?: "sm" | "md";
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  children: React.ReactNode;
  className?: string;
}) {
  const cls = variant === "primary" ? "hermes-primary-btn" : "hermes-outline-btn";
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cx(cls, size === "sm" && "text-xs py-1 px-3", className)}
    >
      {children}
    </button>
  );
}
