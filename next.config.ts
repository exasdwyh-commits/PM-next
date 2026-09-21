import type { NextConfig } from "next";

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
};

export default nextConfig;
