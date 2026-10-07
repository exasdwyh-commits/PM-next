"use client";
/**
 * 交互控件（KX-12）：复制按钮、分段按钮。
 * 与 kit.tsx 的 Btn / StatefulBtn 同一套外观；有状态的放在这里，kit.tsx 保持无 hook。
 */
import { useRef } from "react";
import { useBtnState } from "@/components/motion/react";
import { StatefulBtn } from "./kit";

async function writeClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // 旧浏览器 / 非安全上下文兜底：隐藏 textarea + execCommand。
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(el);
  if (!ok) throw new Error("复制失败");
}

/**
 * 复制按钮：text 可以是字符串，也可以是异步取值（例如先拉取导出的 Markdown）。
 * 成功显示「已复制」，失败显示「复制失败」，然后自动回到初始文案。
 */
export function CopyBtn({
  text,
  children = "复制",
  size = "sm",
  v = "default",
  title,
}: {
  text: string | (() => Promise<string>);
  children?: React.ReactNode;
  size?: "sm";
  v?: "default" | "primary" | "ghost";
  title?: string;
}) {
  const [state, run] = useBtnState({ doneMs: 1400 });
  const label = state === "done" ? "已复制" : state === "error" ? "复制失败" : children;
  return (
    <StatefulBtn
      size={size}
      v={v}
      state={state}
      title={title}
      onClick={() => {
        run(async () => writeClipboard(typeof text === "string" ? text : await text())).catch(() => undefined);
      }}
    >
      {label}
    </StatefulBtn>
  );
}

/**
 * 分段按钮：单选的小范围切换（如「摘要 / 完整」）。
 * 语义为 radiogroup；左右方向键切换，只有当前项在 Tab 序列里。
 */
export function Segmented<V extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: V;
  options: { value: V; label: React.ReactNode; title?: string }[];
  onChange: (v: V) => void;
  label: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number, delta: number) => {
    const next = (from + delta + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div className="m-seg" role="radiogroup" aria-label={label}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            title={o.title}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                move(i, 1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                move(i, -1);
              }
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
