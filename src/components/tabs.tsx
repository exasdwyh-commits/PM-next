"use client";

import React, { useRef } from "react";
import { useTabInk } from "./motion/tabs";

/**
 * 标签页（KX-28）：选中底板在标签之间滑动，← → Home End 切换。
 * 从 ui.tsx 拆出为客户端组件，ui.tsx 继续 re-export，调用方不用改。
 */
export function Tabs<T extends string>({
  items,
  active,
  onChange,
  listRef,
}: {
  items: { key: T; label: React.ReactNode }[];
  active: T;
  onChange: (key: T) => void;
  /** 给内容区的 useTabSwap 当锚点用。 */
  listRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const ownRef = useRef<HTMLDivElement | null>(null);
  const ref = listRef ?? ownRef;
  useTabInk(ref, active);
  const move = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = items.length - 1;
    const next = event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault();
    onChange(items[next].key);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  return (
    <div ref={ref} className="hermes-tabs" role="tablist" data-morph="tabs">
      {items.map((it, index) => (
        <button
          key={it.key}
          type="button"
          role="tab"
          aria-selected={active === it.key}
          tabIndex={active === it.key ? 0 : -1}
          className={active === it.key ? "is-active" : ""}
          onClick={() => onChange(it.key)}
          onKeyDown={(event) => move(event, index)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
