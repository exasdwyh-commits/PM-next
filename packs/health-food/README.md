# Health-Pack · 大健康开品与营销（packs/health-food）

这是 Kern 的第一个行业包：把「大健康开品 + 营销」从提示词层面做到**数据层面**。
原有的 `SOUL.md`（公司身份层）、`tenant.json`、`domain/*.json`（词表）保留不动，本包在此之上加三样东西：

| 目录 | 是什么 | 权威文件 |
|---|---|---|
| `data/` | 数据底座：六张表 + 来源登记 + 案例容器 | `data/README.md`（规则）、`data/schema.json`（机器可读） |
| `playbooks/` | 六类标准交付文档模板（立项卡 → 复盘报告） | 各 `.md` 文件头的 front-matter（阶段 / seat / 门禁 / 证据策略） |
| `../../scripts/health-pack/` | 两个零依赖脚本：校验 + 法规监控 | `validate-pack.mjs`、`regwatch.mjs` |

## 怎么用

```bash
# 1. 校验数据底座（任一规则不通过则非零退出）
node scripts/health-pack/validate-pack.mjs

# 2. 看监控会抓什么（不抓不写）
node scripts/health-pack/regwatch.mjs --dry-run

# 3. 真抓一次：快照 + 比对 + 变更报告（不自动改数据）
node scripts/health-pack/regwatch.mjs
```

## 三条硬规矩（与 Kern 现有门禁同源）

1. **一切事实带证据**：每行必须有 `evidenceUrl` + `evidenceGrade`(L1–L5) + `verifiedAt`；
   没核对过就 `status: unverified` 且 `verifiedAt: null`——**留白是合法状态，编造不是**。
2. **功效类结论只有 L1–L3 能判 allowed**（L4 供应商文件、L5 媒体只能作线索），
   与 `supervisor/report-quality.ts` 的三态（DELIVERABLE / DRAFT_UNVERIFIED / BLOCKED）对齐。
3. **监控不自动改数据**：regwatch 只产快照与变更报告；把变更登记成
   `regulatory_rules` 需要人打开 L1 原文核对后再写。

## 现状（2026-10-17）

- ✅ schema + 六张空表 + 来源登记（含当日实测可达性）+ 一个案例骨架（低糖高蛋白零食）
- ✅ 六类文档模板 + 两个脚本
- ⬜ 第一批真数据（**刻意留空**：应由人核对或监控带回，不由模型回忆）
- ⬜ 与 `schedule` 模块接线（法规日更 / 价格监控 / 内容日历）——先跑通人工确认流程再自动化
- ⬜ 标准图表（机会矩阵 / 成本瀑布 / 合规红黄绿 / 内容日历…共 10 张）与案例驾驶舱

