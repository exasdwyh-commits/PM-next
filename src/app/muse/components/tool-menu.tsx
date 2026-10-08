"use client";
import { useEffect, useRef, type ReactNode } from "react";

/** Low frequency tools stay available without crowding the conversation header. */
export function ToolMenu({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) ref.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !ref.current?.open) return;
      event.preventDefault();
      ref.current.open = false;
      ref.current.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, []);
  return <details className="m-tool-menu" ref={ref}>
    <summary aria-label="更多工具"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg><span>更多</span></summary>
    <div className="m-tool-menu-panel" onClick={event => {
      if ((event.target as Element).closest("button") && ref.current) {
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus({ preventScroll: true });
      }
    }}>{children}</div>
  </details>;
}
