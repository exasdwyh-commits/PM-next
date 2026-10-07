"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { MOTION, play } from "./motion";

/**
 * 长按确认（KX-12）：只用于触及受保护动作（governance/protected-actions 的 gate）的按钮。
 *
 * - 按住 0.6 秒触发；中途松开、移出或失焦即取消。
 * - 键盘同样可以完成：按住空格或回车。
 * - 判定靠计时器，不靠动画：「减少动态效果」下不播放填充动画，但确认逻辑与文字提示不变。
 */
export function HoldToConfirm({
  children,
  onConfirm,
  v = "danger",
  size,
  disabled,
  holdMs = MOTION.maxDuration,
  hint = "按住确认",
}: {
  children?: React.ReactNode;
  onConfirm: () => void;
  v?: "default" | "primary" | "danger";
  size?: "sm";
  disabled?: boolean;
  holdMs?: number;
  hint?: string;
}) {
  const fill = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [holding, setHolding] = useState(false);
  const hintId = useId();
  const seconds = (holdMs / 1000).toFixed(1).replace(/\.0$/, "");

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
    play(fill.current, [{ transform: "scaleX(0)" }], { key: "hold", duration: MOTION.fast, fill: "forwards" });
  }, []);

  const start = useCallback(() => {
    if (disabled || timer.current) return;
    setHolding(true);
    play(fill.current, [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
      key: "hold",
      duration: holdMs,
      easing: "linear",
      fill: "forwards",
    });
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      play(fill.current, [{ transform: "scaleX(0)" }], { key: "hold", duration: MOTION.base, fill: "forwards" });
      onConfirm();
    }, holdMs);
  }, [disabled, holdMs, onConfirm]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const isHoldKey = (k: string) => k === " " || k === "Enter";

  return (
    <button
      type="button"
      className="m-btn m-hold"
      data-v={v}
      data-size={size}
      data-holding={holding ? "" : undefined}
      disabled={disabled}
      aria-describedby={hintId}
      onPointerDown={(e) => {
        if (e.button === 0) start();
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onBlur={cancel}
      onKeyDown={(e) => {
        if (!isHoldKey(e.key)) return;
        e.preventDefault();
        if (!e.repeat) start();
      }}
      onKeyUp={(e) => {
        if (isHoldKey(e.key)) cancel();
      }}
      onClick={(e) => e.preventDefault()}
    >
      <span ref={fill} className="m-hold-fill" aria-hidden />
      <span className="m-hold-label">{holding ? `${hint}…` : children}</span>
      <span id={hintId} className="hermes-sr-only">{`${hint}：按住 ${seconds} 秒（键盘按住空格或回车）`}</span>
    </button>
  );
}
