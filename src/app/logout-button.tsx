"use client";

import { useState } from "react";

export default function LogoutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function logout() {
    setBusy(true);
    setError(false);
    try {
      const response = await fetch("/api/auth/session", { method: "DELETE" });
      if (!response.ok) throw new Error("Logout failed");
      // A full navigation drops cached authenticated page state.
      window.location.replace("/login");
    } catch {
      setError(true);
      setBusy(false);
    }
  }
  return <div className="flex items-center justify-end gap-3 px-4 py-2">
    {error && <span role="alert" className="text-sm text-red-600">退出失败，请重试</span>}
    <button onClick={logout} disabled={busy} className="rounded border px-3 py-1 text-sm disabled:opacity-50">
      {busy ? "退出中…" : "退出登录"}
    </button>
  </div>;
}
