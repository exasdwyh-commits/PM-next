import type { NextConfig } from "next";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// KX-25：版本号在构建时注入（客户端只拿到这一个字符串，不打包 package.json）
const APP_VERSION = (JSON.parse(readFileSync("./package.json", "utf8")) as { version: string }).version;

/**
 * 规避 `next build` 在 Windows 上的启动崩溃：distDir/trace 的并发创建竞态。
 *
 * 现象：构建在打印 "Creating an optimized production build ..." 之后立刻退出，
 * 报 `uncaughtException [Error: EPERM: operation not permitted, open '...\.next\trace']`。
 *
 * 原因：Next 的 trace reporter（next/dist/trace/report/to-json.js）在同一个
 * main 进程内会被多个模块实例各自建一条 { flags: "a" } 的写入流，且都指向
 * distDir/trace。文件尚不存在时，多个句柄会同时以 OPEN_ALWAYS 去“创建”它，
 * 失败方拿到 Windows 的 ERROR_ACCESS_DENIED，被 libuv 映射为 EPERM。
 * 这是打开阶段（而非写入阶段）的竞态，与项目代码无关。
 *
 * 实测（Node 22.22.2，本机）：对同一路径并发 20 / 40 个 append 流，
 * 文件不存在时各 5 轮共触发 15 次 EPERM；文件预先存在时 0 次。
 *
 * 为什么放在这里：next.config 在 distDir / phase 这两个 trace 全局量写入之前
 * 被加载（next/dist/build/index.js 中 load-next-config 早于 setGlobal），
 * 此时 trace reporter 还没有真正打开文件。所以在这里预建一个空文件，
 * 后续所有打开都会走“文件已存在”的分支，竞态不再出现。
 *
 * 该操作是尽力而为：失败不影响构建，只回落到原生行为。
 */
function prepareTraceFile(distDir: string): void {
  try {
    const dir = distDir.startsWith("/") || /^[A-Za-z]:/.test(distDir) ? distDir : join(process.cwd(), distDir);
    mkdirSync(dir, { recursive: true });
    const traceFile = join(dir, "trace");
    if (!existsSync(traceFile)) writeFileSync(traceFile, "");
  } catch {
    // 忽略：读只读目录等场景，保持与官方默认行为一致
  }
}

const DIST_DIR = process.env.NEXT_DIST_DIR || ".next";
prepareTraceFile(DIST_DIR);

/**
 * 默认输出到 .next。
 *
 * 允许通过 NEXT_DIST_DIR 指定另一输出目录，用途是：
 * 当本机同时有一个 `next dev` 在跑（它持续读写 .next）时，
 * 再执行 `next build` 会与 dev server 争用同一个 .next 目录，
 * 表现为构建长时间卡在 "Creating an optimized production build"。
 *
 * 需要在不打扰 dev server 的前提下做验收构建时：
 *   NEXT_DIST_DIR=.next-verify npm run build
 *   NEXT_DIST_DIR=.next-verify npx next start -p 3101
 *
 * 不设置该变量时行为与官方默认完全一致（.next）。
 */
const nextConfig: NextConfig = {
  distDir: DIST_DIR,
  env: { NEXT_PUBLIC_APP_VERSION: APP_VERSION },
  // P0 安全优化：由需求方授权自主决定，不改业务语义，首包优化
  compress: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  experimental: {
    optimizePackageImports: ["docx", "exceljs", "pptxgenjs", "jszip", "@prisma/client"],
  },
};

export default nextConfig;
