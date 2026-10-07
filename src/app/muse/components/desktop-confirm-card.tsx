"use client";
/**
 * KX-35 本机命令确认卡：完整命令 + 原因 + 「允许一次」（长按）/「不允许」。
 * 允许只对这一次有效：服务端签发绑定该命令指纹的单次凭据，执行端领取时核验并消耗。
 */
import { useState } from "react";
import { HoldToConfirm } from "@/components/motion/hold-to-confirm";

export function DesktopConfirmCard({
  taskId, label, detail, reason, onDone,
}: {
  taskId: string;
  label: string;
  detail: string;
  reason: string;
  onDone?: (decision: "ALLOW" | "DENY") => void;
}) {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const decide = async (decision: "ALLOW" | "DENY") => {
    setBusy(true);
    setState(null);
    try {
      const res = await fetch(`/api/desktop-runtime/tasks/${encodeURIComponent(taskId)}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) throw new Error(data.message || data.error || `确认失败（${res.status}）`);
      setState({
        tone: "ok",
        text: decision === "ALLOW" ? "已允许这一次，你的 Mac 会自动领取执行。" : "已取消，这条命令不会执行。",
      });
      onDone?.(decision);
    } catch (error) {
      setState({ tone: "err", text: error instanceof Error ? error.message : "确认失败" });
      setBusy(false);
    }
  };

  const decided = state?.tone === "ok";
  return (
    <div className="m-confirm" role="group" aria-label={`等你确认：${label}`}>
      <div className="m-confirm-head">
        <i className="m-row-dot" aria-hidden />
        <b>等你确认 · {label}</b>
      </div>
      <pre className="m-confirm-cmd">{detail}</pre>
      <p className="m-confirm-why">{reason}</p>
      {state ? <p className={`m-confirm-state is-${state.tone}`} role="status">{state.text}</p> : null}
      {decided ? null : (
        <div className="m-confirm-actions">
          <HoldToConfirm v="primary" size="sm" hint="按住允许这一次" disabled={busy} onConfirm={() => void decide("ALLOW")}>
            允许一次
          </HoldToConfirm>
          <button type="button" className="m-btn" data-v="ghost" data-size="sm" disabled={busy} onClick={() => void decide("DENY")}>
            不允许
          </button>
        </div>
      )}
    </div>
  );
}
