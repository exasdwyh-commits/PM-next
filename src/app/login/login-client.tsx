"use client";

import "./login.css";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PublicFooter } from "@/components/kx";
import { APP_VERSION } from "@/shared/app-version";

/**
 * 登录页：正式账号密码登录。
 * 账号由管理员通过 scripts/create-user.ts 创建，无公共注册入口。
 * 视觉（KX-21 方案 B）：左侧表单、右侧一句话定位；窄屏只保留表单。
 * 颜色 / 圆角 / 字号全部取自 Kern Design Foundation（theme/kern-design.css），
 * 背景与 Muse 是同一张画布 + 光晕，进入应用后视觉不断档。
 */
export default function LoginClient({ localTestLogin }: { localTestLogin: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function enterLocalTest() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ localTest: true }),
      });
      if (!res.ok) throw new Error("本地测试登录不可用，请重新启动本地测试模式。");
      router.push("/muse");
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "进入失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

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
    <main className="kx-login">
      <section className="kx-login-main">
        <header className="kx-login-brand">
          <span className="kx-login-mark" aria-hidden>K</span>
          <b>Kern</b>
        </header>
        <div className="kx-login-body">
          <form onSubmit={onSubmit} className="kx-login-form">
            <h1>欢迎回来</h1>
            <p className="kx-login-lead">使用管理员创建的账号登录。系统不提供公共注册。</p>

            {localTestLogin && (
              <>
                <button type="button" disabled={submitting} className="kx-btn" onClick={enterLocalTest}>
                  {submitting ? "进入中…" : "本地测试一键进入"}
                </button>
                <p className="kx-login-lead">独立测试工作区，无需密码，登录保持 30 天。</p>
              </>
            )}

            <label className="kx-field">
              <span>邮箱</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                className="kx-input"
                placeholder="name@company.com"
              />
            </label>

            <label className="kx-field">
              <span>密码</span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="kx-input"
              />
            </label>

            {error && (
              <p role="alert" className="kx-alert">
                <i aria-hidden />
                <span>{error}</span>
              </p>
            )}

            <button type="submit" disabled={submitting} className="kx-btn">
              {submitting ? "登录中…" : "登录"}
            </button>
          </form>
        </div>
        <PublicFooter version={APP_VERSION} note="账号由管理员创建 · 不提供公共注册" />
      </section>

      <aside className="kx-login-aside">
        <p className="kx-login-claim">
          <span>交代一句话，</span>
          <span>Kern 交回一份能直接用的</span>
          <span>办公成果。</span>
        </p>
        <p className="kx-login-claim-sub">过程看得见，关键动作先问你。</p>
      </aside>
    </main>
  );
}
