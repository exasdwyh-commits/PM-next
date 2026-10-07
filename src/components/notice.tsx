"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import Icon from "./icons";
import { MOTION, play } from "./motion/motion";

export type NoticeTone = "ok" | "danger" | "info" | "warn";
export type NoticeMessage = { tone: NoticeTone; text: string };

const AUTO_HIDE_MS = 5000;

/**
 * 页面内提示（KX-28）。
 * - 成功 / 信息：淡入，5 秒后自动淡出；鼠标停在提示上或键盘焦点在提示里时暂停计时；
 * - 失败 / 警告：一直显示（role=alert），直到用户点关闭，或下一次操作把它替换掉；
 * - 消失时先淡出 140ms 再移除；同一条提示重复渲染不会重播入场；
 * - 减少动态效果时直接出现 / 消失，计时与关闭行为不变。
 * 调用方只管 `msg` 和 `onClose`（通常是 setMsg(null)）。
 */
export function Notice({
  msg,
  onClose,
  autoHideMs,
  className,
  style,
}: {
  msg: NoticeMessage | null;
  onClose: () => void;
  /** 覆盖自动关闭时长；0 表示不自动关闭。缺省：成功 / 信息 5 秒，失败 / 警告不自动关闭。 */
  autoHideMs?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const sig = msg ? `${msg.tone}\u0000${msg.text}` : null;
  const [shown, setShown] = useState<NoticeMessage | null>(msg);
  const [seen, setSeen] = useState(sig);
  if (sig !== seen) {
    setSeen(sig);
    if (msg) setShown(msg);
  }
  const leaving = msg === null && shown !== null;
  const ref = useRef<HTMLDivElement>(null);
  const held = useRef(false);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  // 新提示：淡入下移 4px。
  useLayoutEffect(() => {
    if (sig) play(ref.current, [{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], { key: "notice" });
  }, [sig]);

  // 提示被清空：先淡出，结束后才移除；淡出途中又来了新提示就取消淡出。
  useLayoutEffect(() => {
    if (!leaving) return;
    const animation = play(ref.current, [{ opacity: 1 }, { opacity: 0, transform: "translateY(-4px)" }], {
      key: "notice",
      duration: MOTION.fast,
      fill: "forwards",
    });
    if (!animation) {
      setShown(null);
      return;
    }
    let alive = true;
    animation.finished.then(() => { if (alive) setShown(null); }, () => undefined);
    return () => {
      alive = false;
      animation.cancel();
    };
  }, [leaving]);

  const tone = msg?.tone ?? shown?.tone;
  const delay = autoHideMs ?? (tone === "ok" || tone === "info" ? AUTO_HIDE_MS : 0);
  useEffect(() => {
    if (!sig || !delay) return;
    let left = delay;
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      if (!held.current) left -= now - last;
      last = now;
      if (left <= 0) {
        clearInterval(timer);
        close.current();
      }
    }, 200);
    return () => clearInterval(timer);
  }, [sig, delay]);

  const view = msg ?? shown;
  if (!view) return null;
  const urgent = view.tone === "danger" || view.tone === "warn";
  return (
    <div
      ref={ref}
      className={["hermes-banner", "hermes-notice", `is-${view.tone}`, className].filter(Boolean).join(" ")}
      role={urgent ? "alert" : "status"}
      aria-live={urgent ? "assertive" : "polite"}
      data-closing={leaving || undefined}
      style={style}
      onMouseEnter={() => { held.current = true; }}
      onMouseLeave={() => { held.current = false; }}
      onFocus={() => { held.current = true; }}
      onBlur={() => { held.current = false; }}
    >
      <span className="hermes-notice-text">{view.text}</span>
      <button type="button" className="hermes-notice-close" aria-label="关闭提示" onClick={() => close.current()}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
