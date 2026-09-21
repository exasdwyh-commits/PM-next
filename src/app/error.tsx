"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

/**
 * 全站错误边界（客户端组件，Next.js App Router 约定）。
 *
 * 此前无 error.tsx：服务端取数异常会把用户直接丢到原始报错或白屏。
 * 这里把它换成「说人话 + 可操作」的居中卡片：
 * - 不把 error.message 原样当主文案（可能含内部信息）；
 * - 展示 error.digest 便于排查；技术细节只在非生产环境放入默认闭合的 details。
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 预留：可在此接入前端错误上报。当前仅记录，避免静默失败。
    if (typeof console !== "undefined") {
      console.error("[HERMES] 页面渲染失败:", error);
    }
  }, [error]);

  const showDetail = process.env.NODE_ENV !== "production";

  const router = useRouter();
  const [isRetrying, startRetrying] = useTransition();

  /**
   * 重试。
   *
   * 只调 `reset()` 是**不够**的：它只重渲染当前客户端子树，服务端组件的数据不会重新取，
   * 于是对「服务端取数失败」这类错误，点重试不会有任何新请求、内容也不恢复。
   * 正确姿势是先 `router.refresh()` 重新拉取服务端数据，再 `reset()` 重置错误边界；
   * 用 `useTransition` 承接 pending —— refresh 期间保持「重试中…」并禁用按钮防止连点。
   */
  const retry = () => {
    if (isRetrying) return;
    startRetrying(() => {
      router.refresh();
      reset();
    });
  };

  return (
    <main className="hermes-shell">
      <div className="hermes-center-page">
        <div className="hermes-glass hermes-center-card">
          <span className="hermes-section-label">HERMES · 出错了</span>
          <h2>这一页没能读出来</h2>
          <p className="hermes-note" style={{ marginTop: 4 }}>
            你可以重试；若反复出现，把下面这串编号发给管理员。
          </p>

          {error.digest && (
            <p className="hermes-note" style={{ marginTop: 12, letterSpacing: ".5px" }}>
              错误编号：{error.digest}
            </p>
          )}

          <div className="hermes-center-actions">
            <button
              type="button"
              className="hermes-primary-btn"
              onClick={retry}
              disabled={isRetrying}
              aria-busy={isRetrying}
            >
              {isRetrying ? (
                <span className="hermes-thinking">
                  <span className="hermes-thinking-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  重试中…
                </span>
              ) : (
                "重试"
              )}
            </button>
            <Link href="/" className="hermes-outline-btn">
              返回工作总览
            </Link>
          </div>

          {showDetail && (
            <details className="hermes-details" style={{ marginTop: 20, textAlign: "left" }}>
              <summary>技术细节（仅非生产环境可见）</summary>
              <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 11, margin: "8px 0 0" }}>
                {error.message}
              </pre>
            </details>
          )}
        </div>
      </div>
    </main>
  );
}
