# 大健康开品数据底座（Health-Pack Data）

> 本目录是「真数据不是感觉」的落点：一切进入报告的事实，必须能从这里的某一行追溯到一条证据。
> 本文件描述规则；`schema.json` 是机器可读版本；`scripts/health-pack/validate-pack.mjs` 强制执行。

---

## 1. 六张表

| 表 | 文件 | 一行代表什么 | 谁写 |
|---|---|---|---|
| 原料 | `ingredients.json` | 一种可采购的原料/配料及其规格 | 研究/供应链 |
| 宣称 | `claims.json` | 一句可写进包装或详情页的话，及其合规判定 | 合规 |
| 法规 | `regulatory_rules.json` | 一条生效中的法规/标准/公告及影响面 | regwatch 抓取 + 人工登记 |
| 竞品 | `competitor_skus.json` | 一个在售竞品 SKU 及其配方/宣称摘要 | 研究 |
| 价格 | `price_points.json` | 某对象在某渠道某时点的价格 | 监控 |
| 评价 | `reviews.json` | 一条平台评价及其聚类标签 | 监控 |

案例（`cases/`）不是表，是"跑一遍开品主线"的容器：八个阶段 + 门禁状态 + 产物清单 + 待决策项。

## 2. 证据分级（硬约束）

| 级 | 来源 | 能否支撑功效类结论 |
|---|---|---|
| L1 | 法规原文 / 国标 / 公告 | ✅ 直接支撑 |
| L2 | 官方数据库（原料目录、检测方法、查询平台） | ✅ 直接支撑 |
| L3 | 同行评审文献 | ✅ 需注明样本与剂量 |
| L4 | 供应商 / 工厂一手文件 | ⚠️ 只作事实来源，不作功效依据 |
| L5 | 媒体 / 自媒体 | ❌ 只作线索，必须回溯到 L1–L3 |

**功效类宣称（`claims.json` 中 `efficacy: true`）只有 L1–L3 才能判 `allowed`**；L4/L5 一律 `pending_evidence`。缺证据时**保留「待验证」**，不得润色成肯定句——这与 `supervisor/report-quality.ts` 的三态（DELIVERABLE / DRAFT_UNVERIFIED / BLOCKED）直接对齐。

## 3. 行必须带什么

每行必填（校验脚本会拒绝）：

- `id`（表内唯一）、`name`/`text`/`subject` 等业务字段；
- `source`：人可读的来源名（如「食品安全国家标准数据检索平台」）；
- `evidenceUrl`：可点开的链接（http/https）；
- `evidenceGrade`：`L1`–`L5`；
- `verifiedAt`：ISO 日期（`YYYY-MM-DD`），**没人工核对过就填 `null` 并把 `status` 设为 `unverified`**；
- `status`：`unverified` / `verified` / `pending_evidence` / `rejected`。

## 4. 怎么往里加数据（三条路）

1. **人工登记**：按 schema 手写一行 → 跑 `node scripts/health-pack/validate-pack.mjs`；
2. **监控抓取**：`node scripts/health-pack/regwatch.mjs --only samr`（抓取→快照→diff→变更报告），
   变更**不自动**变成法规行，人工确认后再登记（先人工确认，再谈自动化）；
3. **导入**：后续接入的电商/投放导出，按同样字段映射，同样过校验。

## 5. 现在有什么 / 没有什么

- **有**：schema、来源登记（`sources.json`，含 2026-10-17 实测可达性）、六张空表、一个案例骨架、校验脚本、监控脚本。
- **没有**：任何一条"我凭记忆写的"法规或功效结论。空表是刻意的——**第一批真数据应该由人核对或由监控带回来**，不是由模型回忆。

