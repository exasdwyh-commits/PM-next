"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * B01-01 登录页：正式账号密码登录。
 * 账号由管理员通过 scripts/create-user.ts 创建，无公共注册入口。
 * 视觉：沿用 hermes 壳层的纸感背景与毛玻璃卡片，但不挂全局侧栏（未登录态）。
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        router.push("/");
        router.refresh();
        return;
      }
      const payload = await res.json().catch(() => ({}));
      const message = typeof payload?.message === "string" ? payload.message : "";
      // 服务端对凭据错误统一返回英文技术文案（UnauthorizedError "Invalid credentials"），
      // 直接透出会让中文界面出现英文。此处按状态码/语义映射为面向使用者的说法，
      // 其余情况保留服务端原文（可能是带业务含义的中文提示），最后兜底为通用文案。
      const isCredentialFailure = res.status === 401 || /invalid credentials|unauthor/i.test(message);
      setError(
        isCredentialFailure
          ? "邮箱或密码不正确，请重新输入。连续失败请确认账号是否已由管理员创建。"
          : message || "登录失败，请稍后重试。",
      );
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="hermes-login">
      <form onSubmit={onSubmit} className="hermes-login-card hermes-glass">
        <div className="hermes-login-brand">
          <div className="hermes-monogram">H</div>
          <div className="hermes-wordmark">HERMES</div>
          <div className="hermes-submark">AI PRODUCT OS</div>
        </div>

        <h1>欢迎回来</h1>
        <p className="hermes-note">使用管理员创建的账号登录。系统不提供公共注册。</p>

        <div className="hermes-form-grid">
          <label className="hermes-label">
            <span>邮箱</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              className="hermes-input"
              placeholder="name@company.com"
            />
          </label>

          <label className="hermes-label">
            <span>密码</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="hermes-input"
              placeholder="••••••••"
            />
          </label>

          {error && (
            <p role="alert" className="hermes-banner is-danger" style={{ margin: 0 }}>
              {error}
            </p>
          )}

          <button type="submit" disabled={submitting} className="hermes-primary-btn is-block">
            {submitting ? "登录中…" : "登录"}
          </button>
        </div>
      </form>
    </main>
  );
}
