"use client";

/**
 * Kern 前端组件库（kx）。以后新页面优先从这里取，说明与用法见 docs/mcp-kx-ui.md。
 *
 *   import { Tag, Count, Dot, EmptyLine, Meter, Drawer, PublicFooter, SidebarStatus,
 *            StoryRail, Notch, Terminal, Beats } from "@/components/kx";
 *
 * 约束（§4 工艺守则 / §5 动效规范）：只用 theme 令牌；动画只动合成层属性；
 * 单次 ≤ 600ms；循环只表示「进行中」；降动画时信息完整；状态只来自真实数据。
 */

import * as React from "react";
import { createPortal } from "react-dom";
import Icon from "@/components/icons";
import { useDialog } from "@/components/use-dialog";
import { MOTION, play } from "@/components/motion/motion";
import "./kx.css";

export type Tone = "ok" | "warn" | "bad" | "brand" | "";

/* ── 小件 ── */

export function Tag({ tone, children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`kx-tag${tone ? ` is-${tone}` : ""}`}>{children}</span>;
}

export function Count({ n, bad }: { n: number; bad?: boolean }) {
  return <span className={`kx-count${bad && n > 0 ? " is-bad" : ""}`}>{n}</span>;
}

export function Dot({ tone }: { tone?: Tone }) {
  return <i className={`kx-dot${tone ? ` is-${tone}` : ""}`} aria-hidden />;
}

export function EmptyLine({ tone, children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <div className="kx-empty">
      <Dot tone={tone} />
      <span>{children}</span>
    </div>
  );
}

/* ── 用量条：limit 为 null 表示不限 ── */

export function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const ratio = limit ? Math.min(1, used / limit) : 0;
  const hot = limit !== null && used >= limit;
  return (
    <div className="kx-meter">
      <div className="kx-meter-h">
        <span>{label}</span>
        <b>
          {used}
          {limit === null ? " · 不限" : ` / ${limit}`}
        </b>
      </div>
      <div className="kx-meter-bar" aria-hidden>
        <i style={{ transform: `scaleX(${Math.max(0.02, ratio)})` }} data-hot={hot ? "" : undefined} />
      </div>
    </div>
  );
}

/* ── 右侧抽屉：Esc / 点遮罩关闭，打开时聚焦关闭按钮，关闭后焦点回到触发者 ──
   KX-28：关闭时先播放退出（面板向右轻移淡出、遮罩同步淡出），结束后才卸载；
   退出途中又被打开时，从当前位置回到打开态，不闪、不残留遮罩。退出期间内容保持关闭前的样子。 */

export function Drawer({
  title,
  open,
  onClose,
  children,
}: {
  title: React.ReactNode;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const layerRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => { setMounted(true); }, []);
  const [present, setPresent] = React.useState(open);
  if (open && !present) setPresent(true);
  const closing = present && !open;
  const lastContent = React.useRef({ title, children });
  if (open) lastContent.current = { title, children };
  useDialog(dialogRef, onClose, open && mounted);
  React.useLayoutEffect(() => {
    if (!closing) return;
    const panel = dialogRef.current;
    const layer = layerRef.current;
    const opts = { key: "drawer", duration: MOTION.base, easing: MOTION.easePress, fill: "forwards" as const };
    const animations = [
      play(panel, [{ opacity: 0, transform: "translateX(24px)" }], opts),
      play(layer, [{ opacity: 0 }], opts),
    ].filter((a): a is Animation => a !== null);
    if (animations.length === 0) {
      setPresent(false);
      return;
    }
    let alive = true;
    void Promise.all(animations.map((a) => a.finished.catch(() => undefined))).then(() => { if (alive) setPresent(false); });
    return () => {
      alive = false;
      // 退出途中重新打开：从当前的中间状态回到打开态。
      for (const el of [panel, layer]) {
        if (!el) continue;
        const style = getComputedStyle(el);
        const from = { opacity: style.opacity, transform: style.transform };
        el.getAnimations().forEach((a) => a.cancel());
        play(el, [from, { opacity: 1, transform: "none" }], { key: "drawer", duration: MOTION.base });
      }
    };
  }, [closing]);
  if (!present || !mounted) return null;
  const content = open ? { title, children } : lastContent.current;
  return createPortal(
    <div ref={layerRef} className="kx-drawer" data-dialog-layer data-closing={closing || undefined} onMouseDown={(e) => !closing && e.target === e.currentTarget && onClose()}>
      <div ref={dialogRef} className="kx-drawer-pn" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="kx-drawer-h">
          <h2 id={titleId}>{content.title}</h2>
          <button type="button" className="hermes-ghost-btn kx-drawer-close" onClick={onClose} aria-label="关闭" disabled={closing}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="kx-drawer-b">{content.children}</div>
      </div>
    </div>, document.body
  );
}

/* ── 公共页页脚（登录等未登录页面）：只放真实信息，不放空链接 ── */

export function PublicFooter({ version, note }: { version: string; note?: React.ReactNode }) {
  return (
    <footer className="kx-footer">
      <span className="kx-footer-brand">
        <span className="kx-footer-mark" aria-hidden>K</span>
        Kern
      </span>
      {note ? <span>{note}</span> : null}
      <span className="kx-footer-sp" />
      <span>版本 {version}</span>
      <span>© {new Date().getFullYear()} Kern</span>
    </footer>
  );
}

/* ── App 侧栏底部状态区：系统状态 + 用量入口 + 版本（放在壳层状态圆点旁；窄屏只剩圆点） ── */

export function SidebarStatus({ label, detail, version }: { label: string; detail: string; version: string }) {
  return (
    <div className="kx-sidestat">
      <strong>{label}</strong>
      <span>{detail}</span>
      <small className="kx-sidestat-meta">
        <a href="/settings#usage">用量</a>
        <i aria-hidden>·</i>
        <a href="/settings#account">账户</a>
        <i aria-hidden>·</i>
        <em>v{version}</em>
      </small>
    </div>
  );
}

/* ── 故事轨（KX-23）：固定几站，当前站的圆点长成带文字的 pill；其余站文字只给读屏 ── */

export interface StoryStep {
  key: string;
  label: string;
}

export function StoryRail({
  steps,
  current,
  tone,
  label = "进展",
}: {
  steps: StoryStep[];
  current: string;
  tone?: "warn" | "bad";
  label?: string;
}) {
  const at = Math.max(0, steps.findIndex((s) => s.key === current));
  return (
    <ol className="kx-rail" aria-label={`${label}：第 ${at + 1} / ${steps.length} 步，${steps[at]?.label ?? ""}`}>
      {steps.map((s, i) => (
        <li
          key={s.key}
          className={`${i < at ? "is-done" : ""}${i === at ? ` is-now${tone ? ` is-${tone}` : ""}` : ""}`}
          aria-current={i === at ? "step" : undefined}
        >
          <i className="kx-rail-dot" aria-hidden />
          <span className="kx-rail-t">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

/* ── 动态岛（KX-24）：K 标 + 此刻在做什么；文字变化时新文字从下方升起 ── */

export function Notch({
  text,
  state,
}: {
  text: string;
  state: "live" | "warn" | "done" | "idle";
}) {
  return (
    <div className={`kx-notch is-${state}`} data-morph role="status" aria-live="polite">
      <span className="kx-notch-mark" aria-hidden>K</span>
      <span key={text} className="kx-notch-t is-enter">{text}</span>
      <i className="kx-notch-live" aria-hidden />
    </div>
  );
}

/* ── 执行日志（KX-24）：只渲染传入的真实事件；最新一条升起 ── */

export interface TerminalLine {
  id: string;
  at: string;
  text: string;
  bad?: boolean;
}

export function Terminal({ title, lines, max = 5 }: { title: string; lines: TerminalLine[]; max?: number }) {
  const shown = lines.slice(-max);
  if (!shown.length) return null;
  return (
    <div className="kx-term" role="log" aria-label={title}>
      <div className="kx-term-h">
        <span aria-hidden>›</span>
        <span>{title}</span>
      </div>
      <ol>
        {shown.map((l, i) => (
          <li key={l.id} className={`${i === shown.length - 1 ? "is-enter" : ""}${l.bad ? " is-bad" : ""}`}>
            <time>{l.at}</time>
            <span>{l.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ── Bento（KX-24）：不等宽的示例任务阵列；第一块占满一行，其余各占一半 ── */

export interface BentoTile {
  id: string;
  title: string;
  hint?: string;
}

export function Bento({
  tiles,
  onPick,
  label,
}: {
  tiles: BentoTile[];
  onPick: (id: string) => void;
  label: string;
}) {
  if (!tiles.length) return null;
  return (
    <div className="kx-bento" role="group" aria-label={label}>
      {tiles.map((t, i) => (
        <button
          key={t.id}
          type="button"
          className="kx-bento-i"
          data-span={tiles.length >= 3 && i === 0 ? "wide" : undefined}
          onClick={() => onPick(t.id)}
        >
          <b>{t.title}</b>
          {t.hint ? <small>{t.hint}</small> : null}
        </button>
      ))}
    </div>
  );
}

/* ── 诚实节拍：假设 / 证伪 / 收回 ── */

export interface Beat {
  id: string;
  kind: "hypothesis" | "refuted" | "retracted";
  text: string;
}

const BEAT_TAG: Record<Beat["kind"], { tone: Tone; label: string }> = {
  hypothesis: { tone: "warn", label: "推断" },
  refuted: { tone: "bad", label: "被推翻" },
  retracted: { tone: "", label: "已收回" },
};

export function Beats({ beats, max = 3 }: { beats: Beat[]; max?: number }) {
  const shown = beats.slice(-max);
  if (!shown.length) return null;
  return (
    <ul className="kx-beats" aria-label="假设与复核">
      {shown.map((b, i) => (
        <li key={b.id} className={i === shown.length - 1 ? "is-enter" : ""}>
          <Tag tone={BEAT_TAG[b.kind].tone}>{BEAT_TAG[b.kind].label}</Tag>
          <span>{b.text}</span>
        </li>
      ))}
    </ul>
  );
}
