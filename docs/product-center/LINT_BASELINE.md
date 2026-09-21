---
title: Lint / 类型检查基线（TASK-006）
version: "1.0"
date: 2026-09-20
owner: 执行模型（本批：寇豆码/Kou）
plan: plan/architecture-hermes-product-center-deepseek-v1.md（TASK-006）
scope: 核验 lint/类型检查配置，独立记录既有遗留问题（不改规则值/package.json/业务源码）
status: 完成
---

# Lint / 类型检查基线（TASK-006）

> 本批**只核验与记录**：改 `eslint.config.mjs` 的**注释理由**（不改规则值）；**未改 `package.json`**（含他人未提交改动，属共享文件）；未改任何业务源码。

## 1. 实测命令与结果（本次）

| 检查 | 命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 静态规则 | `npm run lint`（= `eslint .`） | **0** | 无 error、无 warning（输出为空） |
| 类型 | `./node_modules/.bin/tsc --noEmit` | **0** | 0 行输出（0 error） |
| 探针（红） | `npm run lint`（含 `_lint-probe.ts`） | **1** | 1 error：`react-hooks/rules-of-hooks`（见 §2） |

**warning 计数 = 0**（`npm run lint` 输出中 `warning` 出现 0 次）。

### 迁移状态（勿重做）

`package.json` 的 `lint` **已是 `eslint .`**，`eslint.config.mjs` 存在且生效（FlatCompat + `next/core-web-vitals` + `@typescript-eslint` parser/plugin）。**「迁移 next lint」早已完成，本批未重做**。

## 2. 证明 lint 真的在检查（红 → 绿）

**不是"跑完没报错"**。用一个 **error 级**规则（`react-hooks/rules-of-hooks`，来自 `next/core-web-vitals`）造违规：

```ts
// _lint-probe.ts（临时，跑完即删）
import { useState } from "react";
export function lintProbe(flag: boolean) {
  if (flag) { return useState(0); }   // 条件调用 Hook
  return null;
}
```

**红（真实输出）**：

```
> eslint .
/Users/.../hermes-next/_lint-probe.ts
  8:12  error  React Hook "useState" is called in function "lintProbe" that is neither a React Function component nor a custom React Hook function ...  react-hooks/rules-of-hooks

✖ 1 problem (1 error, 0 warnings)
（退出码 = 1）
```

**删除探针后绿（真实输出）**：

```
> eslint .
（无任何输出；退出码 = 0）
```

→ lint **确实在检查**；探针已删除，**业务文件中未留任何违规**。

## 3. 遗留问题（独立登记）

### 3.1 `@typescript-eslint/no-explicit-any` 全局关闭

`eslint.config.mjs:27` `"@typescript-eslint/no-explicit-any": "off"`（历史决定）。**原注释理由不成立**，已订正（见 §5）。

**显式 `any` 按文件 Top 10**（实测 `grep -roE '(: *any\b|as any\b|<any>|any\[\]|any>)' src --include='*.ts' --include='*.tsx'`）：

| # | 文件 | 处数 |
| --- | --- | --- |
| 1 | `src/app/projects/[id]/project-detail-client.tsx` | 42 |
| 2 | `src/app/war-room/war-room-client.tsx` | 25 |
| 3 | `src/app/products/[id]/revision-panel.tsx` | 24 |
| 4 | `src/app/products/[id]/product-overview-client.tsx` | 15 |
| 5 | `src/modules/decisions/service.ts` | 14 |
| 6 | `src/app/knowledge/knowledge-client.tsx` | 13 |
| 7 | `src/app/products/[id]/launch-tab.tsx` | 10 |
| 8 | `src/modules/knowledge/sync.ts` | 9 |
| 9 | `src/app/advisor/advisor-client.tsx` | 9 |
| 10 | `src/modules/advisor/service.ts` | 8 |

**合计 ≈ 268 处 / 47 个文件**（严格模式；宽松 `\bany\b` 词元计数为 269/47，差异极小）。
> 口径说明：以上为**实测**；team-lead 侦查的 246/44 用的是另一模式，两者同量级、Top 文件一致（`project-detail-client` 均为 42）。

### 3.2 `react-hooks/exhaustive-deps = "warn"` → 「exit 0 ≠ 无警告」

`eslint.config.mjs:28` 为 `warn`。**warning 不改变退出码**，故 `npm run lint` 的 `exit 0` **不等于"无警告"**。**当前实测 warning = 0**，但这是**口径风险**：将来新增 warning 不会被 CI 拦住。
→ 建议（**只写文档，未动手**）：`package.json` 加 `--max-warnings 0`，把 warning 也纳入门禁。

### 3.3 `eslint-disable` 位置（全仓 2 处）

- `src/app/consultation/consultation-client.tsx:40` — `// eslint-disable-next-line react-hooks/exhaustive-deps`
- `src/app/knowledge/knowledge-client.tsx:49` — `// eslint-disable-next-line react-hooks/exhaustive-deps`

**本批未新增任何 `eslint-disable`，未新增任何 `off`。**

## 4. 收紧建议（不在本批范围）

把 `no-explicit-any` 由 `off` 改回 `error` 会**一次产生 ~268 条**——**超出本批范围**。正确做法是**单独批次 + 棘轮（ratchet）**：
1. 先保持 `off`，但在 CI 里记录**当前基线**（本文件 §3.1）；
2. 逐步按文件清零，每清一个文件就把该文件加入 `overrides` 的 `error` 列表；
3. 基线**只减不增**（新代码不得新增 `any`）。
**不得**为了某批"变绿"而全局关规则或加 disable（本批已核查：**无此类新增**）。

## 5. 订正的注释（`eslint.config.mjs`）

**只改注释，未改规则值**：

- **旧**：`// These are intentional in the existing server/client boundary code; type safety remains enforced by the TypeScript build.`
- **新**：说明「显式 `any` 既不被本规则检查（规则已 off），也不被 tsc 的 `strict`/`noImplicitAny` 捕获（后者只抓**隐式** any）；关闭是历史决定，收紧须单独批次 + 棘轮」。

## 6. `package.json` 未改动的原因

`package.json` **含他人未提交改动**（`lint`/`test:*` script 等），属**共享文件**。本批**未改**它；「加 `--max-warnings 0`」等建议**只写进本文件**（§3.2），不动手。

## 7. 相称检查

| 项 | 结果 |
| --- | --- |
| 业务源码改动 | 无 |
| `eslint.config.mjs` | **仅注释**（规则值未动） |
| `package.json` | 未改 |
| 新增 `off` / `eslint-disable` | 无 |
| git 操作 / 起服务 / 动库 | 无 |
