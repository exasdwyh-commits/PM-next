"use client";

import React from "react";
import { Modal } from "./ui";

/**
 * 可复用的「理由输入对话框」——替代原生 window.prompt()。
 *
 * 为什么单开文件而不塞进 ui.tsx：
 *   ui.tsx 是**无状态原语层**（GlassCard / Modal / Badge …），而本模块是一个
 *   带内部状态的「控制器」组合件（Promise 化的 ask + 受控对话框节点）。
 *   把它独立出来，既让原语层保持纯粹，又让「命令式调用」的语义集中在一处，
 *   后续需要复用（波 2 已覆盖 8 处）时只引这一个模块。
 *
 * 语义与原生 prompt 对齐（这是硬约束，调用方的 `if (!reason) return;` 依赖它）：
 *   - 取消 / Esc / 点遮罩 → resolve(null)
 *   - 确认（内容非空）     → resolve(去空白后的理由)
 * 与 prompt 的差异：空内容时确认按钮 disabled（这些理由都会写入留痕，不允许空）。
 */

export interface ReasonOptions {
  /** 对话框标题 */
  title: string;
  /** 输入项标签（沿用原 prompt 的提示原文语义） */
  label: string;
  /**
   * 说明文字。默认「理由为必填，将写入留痕。」
   * 注意：**不与 label 拼接**——label 是字段名/指令句，拼进说明句会变成病句
   * （例如「请输入批准理由为必填，将写入留痕。」）。如需专属说明，在各调用点显式传 note。
   */
  note?: string;
  placeholder?: string;
  confirmText?: string;
  tone?: "primary" | "danger";
  initialValue?: string;
}

export function useReasonDialog(): [(opts: ReasonOptions) => Promise<string | null>, React.ReactNode] {
  const resolverRef = React.useRef<((value: string | null) => void) | null>(null);
  const [opts, setOpts] = React.useState<ReasonOptions | null>(null);
  const [value, setValue] = React.useState("");
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  /** 结束本次询问：result 为 null 表示取消，否则为最终理由 */
  const finish = React.useCallback((result: string | null) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setOpts(null);
    setValue("");
    resolver?.(result);
  }, []);

  /** 命令式调用：返回 Promise<string | null>，调用方 await 后照旧 `if (!reason) return;` */
  const ask = React.useCallback((next: ReasonOptions) => {
    // 极端情况下若上一次询问尚未结束，先按取消结清，避免 Promise 悬挂。
    resolverRef.current?.(null);
    resolverRef.current = null;
    setValue(next.initialValue ?? "");
    setOpts(next);
    return new Promise<string | null>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  // 打开后自动聚焦输入框
  React.useEffect(() => {
    if (!opts) return;
    const t = setTimeout(() => textareaRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [opts]);

  // Esc 取消（挂在 document 上，保证焦点不在 textarea 时也能取消）
  React.useEffect(() => {
    if (!opts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [opts, finish]);

  const trimmed = value.trim();
  const canConfirm = trimmed.length > 0;

  const node = opts ? (
    <Modal
      eyebrow="REASON REQUIRED"
      title={opts.title}
      onClose={() => finish(null)}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canConfirm) finish(trimmed);
        }}
      >
        <label className="hermes-label" style={{ display: "grid", gap: 7 }}>
          <span>{opts.label}</span>
          <textarea
            ref={textareaRef}
            className="hermes-textarea"
            rows={3}
            value={value}
            placeholder={opts.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              // Cmd/Ctrl + Enter 提交（Esc 由上面的 document 监听统一处理）
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                if (canConfirm) finish(trimmed);
              }
            }}
          />
        </label>
        <p className="hermes-note" style={{ marginTop: 8 }}>
          {opts.note ?? "理由为必填，将写入留痕。"}
        </p>
        <div className="hermes-modal-actions">
          <button type="button" className="hermes-outline-btn" onClick={() => finish(null)}>
            取消
          </button>
          <button
            type="submit"
            className={opts.tone === "danger" ? "hermes-danger-btn" : "hermes-primary-btn"}
            disabled={!canConfirm}
          >
            {opts.confirmText || "确认"}
          </button>
        </div>
      </form>
    </Modal>
  ) : null;

  return [ask, node];
}
