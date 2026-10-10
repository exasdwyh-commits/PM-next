"use client";

import { useEffect, useId, useRef } from "react";
import { I } from "./kit";

export type ConversationTool = "memory" | "vault" | "connectors" | "schedules" | "trail";

const TOOLS = [
  { kind: "memory", label: "记忆", hint: "已记录的偏好与上下文", icon: I.spark },
  { kind: "vault", label: "凭证", hint: "查看密钥授权与保管状态", icon: I.shield },
  { kind: "connectors", label: "连接", hint: "外部系统与工具授权", icon: I.source },
  { kind: "schedules", label: "定时", hint: "周期任务与提醒", icon: I.clock },
  { kind: "trail", label: "轨迹", hint: "回看执行记录与来源", icon: I.trail },
] as const;

/** 使用原生 disclosure + 普通按钮，不伪装成缺少方向键行为的 ARIA menu。 */
export function ConversationTools({ onOpen, onCopy, copied = false }: {
  onOpen: (tool: ConversationTool) => void;
  onCopy?: () => void;
  copied?: boolean;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const id = useId();

  useEffect(() => {
    const close = (restoreFocus: boolean) => {
      if (!ref.current) return;
      ref.current.open = false;
      if (restoreFocus) ref.current.querySelector("summary")?.focus();
    };
    const outside = (event: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(event.target as Node)) close(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !ref.current?.open) return;
      event.preventDefault();
      close(true);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  return (
    <details className="m-top-more" ref={ref}>
      <summary className="m-tool-trigger" aria-label="更多工具" aria-controls={id}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="currentColor"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
        <span>更多</span>
      </summary>
      <nav id={id} className="m-tool-popover" aria-label="对话辅助工具">
        <p>工具与设置</p>
        {TOOLS.map(({ kind, label, hint, icon: Glyph }) => (
          <button key={kind} type="button" onClick={() => {
            if (ref.current) {
              ref.current.open = false;
              // 抽屉关闭后恢复到始终可见的入口，而不是已藏进 disclosure 的按钮。
              ref.current.querySelector("summary")?.focus();
            }
            onOpen(kind);
          }}>
            <Glyph />
            <span><strong>{label}</strong><small>{hint}</small></span>
            <span className="m-tool-arrow" aria-hidden>›</span>
          </button>
        ))}
        {onCopy ? <button type="button" onClick={() => {
          if (ref.current) {
            ref.current.open = false;
            ref.current.querySelector("summary")?.focus();
          }
          onCopy();
        }}>
          {copied ? <I.check /> : <I.copy />}
          <span><strong>{copied ? "已复制全文" : "复制对话"}</strong><small>将当前对话复制为 Markdown</small></span>
        </button> : null}
      </nav>
    </details>
  );
}
