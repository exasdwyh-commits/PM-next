"use client";

import "./login.css";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PublicFooter } from "@/components/kx";
import { APP_VERSION } from "@/shared/app-version";

/**
 * 登录页 = **角色即登录**（局域网模式）。
 *
 * 局域网内不做账号密码：选一个角色就直接进——后端按角色签发该角色的常驻测试账号
 * （见 src/modules/identity/local-test-policy.ts），个性（视角、使用偏好）由浏览器侧
 * role-context 存储，不依赖账号区分。
 *
 * 账号密码登录**保留**在「使用账号登录」折叠区：外网部署或需要真实权限时仍要用它。
 */

type EntryRole = "leadership" | "product" | "sales";

const ROLES: { key: EntryRole; label: string; icon: string; desc: string }[] = [
  { key: "leadership", label: "管理者", icon: "👔", desc: "只看结论，一页看懂全局" },
  { key: "product", label: "产品经理", icon: "🔬", desc: "专业严谨，工具流程完整" },
  { key: "sales", label: "运营销售", icon: "💼", desc: "卖点突出，销售工具箱" },
];

const ROLE_STORAGE_KEY = "kern.user-role.v1";

export default function LoginClient({ localTestLogin }: { localTestLogin: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<EntryRole | "password" | null>(null);
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  /** 选角色即登录：免密进入，并把视角偏好写进本地存储，进入后即为该角色视角。 */
  async function enterAs(role: EntryRole) {
    setError(null);
    setSubmitting(role);
    try {
      // 落本地偏好，让 role-context 首屏就用这个角色（免去进去后再手选一次）
      try {
        localStorage.setItem(ROLE_STORAGE_KEY, role);
        localStorage.setItem("kern.user-role-at.v1", new Date().toISOString());
      } catch {
        /* 隐私模式下 localStorage 不可写，忽略即可——登录本身不依赖它 */
      }

      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ localTest: true, role }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(
          typeof payload?.message === "string"
            ? payload.message
            : "进入失败，请确认服务以局域网测试模式启动（KERN_LOCAL_TEST_LOGIN=true）",
        );
      }
      router.push("/muse");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "进入失败，请稍后重试。");
    } finally {
      setSubmitting(null);
    }
  }

  async function onPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting("password");
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
      setSubmitting(null);
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
          {localTestLogin ? (
            <div className="kx-role-entry">
              <h1>选择你的角色</h1>
              <p className="kx-login-lead">内网使用无需密码，选一个角色直接进入。进入后可在右上角随时切换。</p>

              <div className="kx-role-grid" role="group" aria-label="选择角色">
                {ROLES.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    className="kx-role-card"
                    disabled={submitting !== null}
                    onClick={() => enterAs(r.key)}
                  >
                    <span className="kx-role-icon" aria-hidden>{r.icon}</span>
                    <span className="kx-role-label">{r.label}</span>
                    <span className="kx-role-desc">{r.desc}</span>
                    {submitting === r.key && <span className="kx-role-hint">进入中…</span>}
                  </button>
                ))}
              </div>

              {error && (
                <p role="alert" className="kx-alert">
                  <i aria-hidden />
                  <span>{error}</span>
                </p>
              )}

              <button
                type="button"
                className="kx-login-link"
                onClick={() => setShowPasswordForm((v) => !v)}
                aria-expanded={showPasswordForm}
              >
                {showPasswordForm ? "收起账号登录" : "使用账号登录（外网 / 需要真实权限时）"}
              </button>

              {showPasswordForm && (
                <form onSubmit={onPasswordSubmit} className="kx-login-form kx-login-form--nested">
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
                  <button type="submit" disabled={submitting !== null} className="kx-btn">
                    {submitting === "password" ? "登录中…" : "登录"}
                  </button>
                </form>
              )}
            </div>
          ) : (
            /* 局域网免密未启用：只保留正式账号登录 */
            <form onSubmit={onPasswordSubmit} className="kx-login-form">
              <h1>欢迎回来</h1>
              <p className="kx-login-lead">使用管理员创建的账号登录。系统不提供公共注册。</p>

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

              <button type="submit" disabled={submitting !== null} className="kx-btn">
                {submitting === "password" ? "登录中…" : "登录"}
              </button>
            </form>
          )}
        </div>

        <PublicFooter
          version={APP_VERSION}
          note={localTestLogin ? "内网免密 · 选角色即进入 · 不记录个人档案" : "账号由管理员创建 · 不提供公共注册"}
        />
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