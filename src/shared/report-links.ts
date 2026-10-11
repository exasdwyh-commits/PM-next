/**
 * 报告 HTML 页链接构造 —— 纯函数，只在服务端调用。
 *
 * 背景：Kern 对话渲染（src/app/muse/components/prose.tsx）只把 http(s)/mailto
 * 绝对链接渲染成可点击，相对路径会原样显示为文本。因此对话里给报告链接时
 * 必须拼绝对 URL，基址由 KERN_PUBLIC_BASE_URL 提供。
 *
 * 为什么本文件**不用** `server-only`（曾经用过，已撤销）：
 * 本模块被 capability 直接引用
 * （`modules/assistant-runtime/capabilities/product-rnd.ts`），而 capability 会被
 * **裸 Node / tsx 进程**加载 —— `scripts/pm-worker.ts`（以及 supervisor、
 * kx73-demos 等构建期脚本）都不是 React Server 构建。`server-only` 的默认导出
 * 路径是「抛错版」，这些进程一 import 就崩
 * （`Error: This module cannot be imported from a Client Component module`），
 * 而 `--conditions=react-server` 是**进程级**开关，只能靠每个入口自己记得加，
 * 漏一个就静默复发。本模块只是拼 URL、不含任何密钥，不值得让整个工具链承担这个约束。
 *
 * 因此改成两层表达同一条约束：
 *   1. 运行时自检 —— 在浏览器里调用直接抛错（见 `assertServerRuntime`）；
 *   2. 静态守卫 —— `tests/report-links.test.ts` 断言没有任何 "use client"
 *      模块 import 本文件。
 */

/**
 * 服务端自检：浏览器里读不到 `KERN_PUBLIC_BASE_URL`（非 NEXT_PUBLIC_ 前缀不会被内联），
 * 拼出来的一定是 `http://localhost:3100` 这种打不开的链接。
 * 宁可当场失败，也不要把坏链接静默发到对话里。
 */
function assertServerRuntime(): void {
  if (typeof window !== "undefined") {
    throw new Error(
      "report-links 只能在服务端使用：浏览器读不到 KERN_PUBLIC_BASE_URL，" +
        "会拼出打不开的报告链接。"
    );
  }
}

/**
 * 报告页基址：优先环境变量。
 * 生产环境未配置直接抛错 —— 绝不静默拼出 localhost 坏链接让用户点不开。
 * 开发/测试环境回退到本地 PORT，方便本机联调。
 */
export function getReportBaseUrl(): string {
  assertServerRuntime();
  const configured = process.env.KERN_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "KERN_PUBLIC_BASE_URL 未配置：生产环境必须设置报告页对外基址" +
        "（例如 https://kern.example.com），否则对话里的报告链接会指向打不开的地址。"
    );
  }
  const port = process.env.PORT?.trim() || "3100";
  return `http://localhost:${port}`;
}

/** 某份 Executive Report 成果的 HTML 页完整链接。 */
export function buildReportUrl(artifactId: string): string {
  return `${getReportBaseUrl()}/reports/${encodeURIComponent(artifactId)}`;
}
