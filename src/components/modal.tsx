"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Icon from "./icons";
import { useDialog } from "./use-dialog";

export function Modal({ eyebrow, title, sub, onClose, wide, children }: {
  eyebrow?: string;
  title: ReactNode;
  sub?: ReactNode;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const titleId = useId();
  const subId = useId();
  useDialog(ref, onClose, mounted);
  if (!mounted) return null;
  return createPortal(
    <div className="hermes-modal-backdrop" data-dialog-layer onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div ref={ref} className={`hermes-modal hermes-glass${wide ? " is-wide" : ""}`}
        role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={sub ? subId : undefined} tabIndex={-1}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="关闭">
          <Icon name="close" size={17} />
        </button>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h3 id={titleId}>{title}</h3>
        {sub ? <p id={subId}>{sub}</p> : null}
        {children}
      </div>
    </div>, document.body
  );
}
