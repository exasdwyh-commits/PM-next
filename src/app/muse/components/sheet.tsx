"use client";

import { useRef, type ReactNode } from "react";
import { useDialog } from "@/components/use-dialog";
import { MOTION, play } from "@/components/motion/motion";
import { useExitAnimation } from "@/components/motion/react";
import { I } from "./kit";

const UTILITY_ICONS = { memory: I.spark, vault: I.shield, connectors: I.plan, library: I.source, schedules: I.clock, trail: I.trail };

/** 与 muse.css 的手机断点一致：手机从底部进出，桌面从右侧进出。 */
const MOBILE_SHEET = "(max-width: 620px)";

export function Sheet({ title, sub, onClose, wide, aside, children, utility }: {
  title: string; sub?: string; onClose: () => void; wide?: boolean; aside?: ReactNode; children: ReactNode;
  utility?: keyof typeof UTILITY_ICONS;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  // 关闭：面板与遮罩同步退出（从当前位置接着走，打开到一半就关也不跳），结束后才卸载。
  const { closing, requestClose } = useExitAnimation(onClose, () => {
    const mobile = window.matchMedia(MOBILE_SHEET).matches;
    const opts = { key: "exit", duration: MOTION.base, easing: MOTION.easePress, fill: "forwards" as const };
    return [
      play(dialogRef.current, [{ opacity: 0, transform: mobile ? "translateY(24px)" : "translateX(18px) scale(.99)" }], opts),
      play(scrimRef.current, [{ opacity: 0 }], opts),
    ];
  });
  useDialog(dialogRef, requestClose);
  const Icon = utility ? UTILITY_ICONS[utility] : null;
  return <>
    <div ref={scrimRef} className="m-scrim" data-dialog-scrim data-closing={closing || undefined} onClick={requestClose} />
    <aside ref={dialogRef} tabIndex={-1} className="m-sheet" data-wide={wide ? "true" : undefined} data-utility={utility}
      data-closing={closing || undefined} role="dialog" aria-modal="true" aria-label={title}>
      <header className="m-sheet-head">
        <div className="m-sheet-heading">
          {Icon ? <span className="m-sheet-icon" aria-hidden><Icon /></span> : null}
          <div><h2>{title}</h2>{sub ? <p>{sub}</p> : null}</div>
        </div>
        {aside}
        <button type="button" className="m-btn" data-v="ghost" data-size="sm" onClick={requestClose} aria-label="关闭"><I.close /></button>
      </header>
      <div className="m-sheet-body">{children}</div>
    </aside>
  </>;
}
