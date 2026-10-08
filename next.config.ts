import type { NextConfig } from "next";
import { readFileSync } from "node:fs";

// KX-25：版本号在构建时注入（客户端只拿到这一个字符串，不打包 package.json）
const APP_VERSION = (JSON.parse(readFileSync("./package.json", "utf8")) as { version: string }).version;

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
  distDir: process.env.NEXT_DIST_DIR || ".next",
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
