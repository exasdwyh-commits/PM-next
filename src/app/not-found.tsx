import Link from "next/link";

/**
 * 404 页（App Router 约定，服务端组件即可）。
 * 风格与 error.tsx 一致：居中毛玻璃卡片，给出两个明确去处。
 */
export default function NotFound() {
  return (
    <main className="hermes-shell">
      <div className="hermes-center-page">
        <div className="hermes-glass hermes-center-card">
          <span className="hermes-section-label">KERN · 404</span>
          <h2>这个地址不存在或已被移动</h2>
          <p className="hermes-note" style={{ marginTop: 4 }}>
            请检查链接是否完整；也可以从下面重新进入常用的工作区。
          </p>

          <div className="hermes-center-actions">
            <Link href="/" className="hermes-primary-btn">
              返回工作总览
            </Link>
            <Link href="/products" className="hermes-outline-btn">
              产品开发
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
