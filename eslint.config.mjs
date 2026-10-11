import { FlatCompat } from "@eslint/eslintrc";
import { defineConfig, globalIgnores } from "eslint/config";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default defineConfig([
  ...compat.extends("next/core-web-vitals"),
  globalIgnores([
    // Next 的构建产物目录。这里必须用通配而不是逐个枚举 ——
    // 本项目同时存在 .next / .next-verify / .next-acc / .next-v2 / .next-v3 /
    // .next-fixed / .next-local-test / .next-report-warm 等多个 dist 目录
    // （多套验收与预热脚本各用各的），逐个列会持续漏项：
    // 漏掉的那个会把打包产物当源码 lint，报一堆「Component definition is missing
    // display name」之类的假红，把 `npm run lint` 变成不可信信号。
    ".next*/**",
    "node_modules/**",
    ".tmp-pg/**",
    ".uploads/**",
    "outputs/**",
    // Independently checked, read-only CI fixture package with Next shims.
    "tools/ux-preview/**",
  ]),
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parser: tsParser },
    plugins: { "@typescript-eslint": tsPlugin },
  },
  {
    rules: {
      // ⚠️ 理由订正（TASK-006）：原注释称 "type safety remains enforced by the TypeScript build"，
      // 对 `no-explicit-any` **不成立** —— 显式 `any` 既不被本规则检查（规则已 off），
      // 也不被 tsc 的 `strict`/`noImplicitAny` 捕获（后者只抓**隐式** any）。
      // 关闭是历史决定；收紧会一次产生 ~268 处，须单独批次 + 棘轮（ratchet），
      // 见 docs/product-center/LINT_BASELINE.md。
      "@typescript-eslint/no-explicit-any": "off",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
]);
