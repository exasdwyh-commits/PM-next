"use client";

import { useState } from "react";
import Icon from "./icons";

/** 顶栏退出按钮：沿用壳层图标按钮外观，保底完整跳转以清掉已认证页面缓存。 */
export default function LogoutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function logout() {
    setBusy(true);
    setError(false);
    try {
      const response = await fetch("/api/auth/session", { method: "DELETE" });
      if (!response.ok) throw new Error("Logout failed");
      window.location.replace("/login");
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={busy}
      className="hermes-ghost-btn"
      title={error ? "退出失败，请重试" : "退出登录"}
      // 可见文字只有「退出」（图标按钮的宽度约束）。无障碍名默认取自内容，
      // 于是屏幕阅读器只会念出「退出」，按完整名匹配的 UI 验收也找不到它
      // （tests/ui-b01-evidence.ts 曾因此卡在最后一步）。显式给出完整名。
      aria-label={error ? "退出失败，请重试" : "退出登录"}
    >
      <Icon name="logout" size={15} />
      {busy ? "退出中…" : "退出"}
    </button>
  );
}
