import { FlatCompat } from "@eslint/eslintrc";
import { defineConfig, globalIgnores } from "eslint/config";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default defineConfig([
  ...compat.extends("next/core-web-vitals"),
  globalIgnores([
    ".next/**",
    ".next-verify/**",
    "node_modules/**",
    ".tmp-pg/**",
    ".uploads/**",
    "outputs/**",
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
