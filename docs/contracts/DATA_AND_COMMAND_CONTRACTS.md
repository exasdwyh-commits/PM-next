# HERMES Next 数据与命令契约（任务包 A）

日期：2026-09-13
依据：`docs/plans/2026-09-13-hermes-next-product-and-advisor-blueprint.md` §4–§7
状态：**本轮已落地 schema 与迁移**；命令接口按此契约实现，未实现的部分在文末「未实现清单」中显式标注。

本文件是任务包 A 的交付物，供 B–G 各包共用。**共享 schema 的改动必须经本文件的所有者整合**，其他包不得各自加表。

---

## 1. 本轮 schema 变更（迁移 `20260913220000_add_product_dev_advisor_knowledge_launch`）

新增 15 张表、13 个枚举；对既有表仅「加列 + 加外键」，无删列、无改类型、无 TRUNCATE。

### 1.1 对既有表的修改

| 表 | 变更 | 理由 |
| --- | --- | --- |
| `Project` | 新增 `productId TEXT?` + FK → `Product(id)` `ON DELETE SET NULL` | 蓝图 §4.1：显式产品关联，不再只能通过 `productVersionId` 反查；保留「无产品的探索项目」 |
| `Product` | 新增 `coreIdea` `coreSellingPoints` `targetChannels` `ownerId` `lifecycleStage` `targetLaunchDate` `actualLaunchDate` `priceExpectation` `formSpec` `forbiddenItems` `sourceKind` | 蓝图 §4.2 入库首屏 + §4.5 生命周期。**全部可空**（`lifecycleStage` 默认 `IDEA`），先兼容为空，按真实关系回填后再收紧 |
| `SignalSource` | 新增 `organizationId TEXT?` | 蓝图 §7：`NULL` = 公共来源配置（所有组织可见）；非空 = 组织私有来源配置 |
| `SignalItem` | 新增 `organizationId TEXT?` | 信号是公司私有内容。**先兼容为空以完成迁移，服务层写入强制要求**；回填后再收紧为 NOT NULL |

### 1.2 新增表

| 领域 | 表 | 关键约束 |
| --- | --- | --- |
| 产品分析 | `AnalysisRun` | 固定 `productVersionId` + `inputSnapshot` + `evidenceFingerprint` + `ruleVersion` + `provider/modelId`；`supersedesRunId` 指向被替代的上一轮；**历史结果不可被最新结果覆盖** |
| | `AnalysisDimension` | `@@unique([runId, dimension])`；`score Int?` —— **未知项保持 null，不默认 0**；`basis` 与 `assumptions` 分离 |
| | `Scorecard` | `runId @unique`；`coverageRatio` + `provisional` + `weightedScore` —— 覆盖不足标「暂评」，不得进入可排序完整榜 |
| AI 顾问 | `Conversation` / `Message` | `Message.citations Json?` 存引用卡；`Message.runId` 关联产生它的运行 |
| | `AgentRun` | 状态机 `QUEUED/RUNNING/WAITING_CONFIRMATION/SUCCEEDED/FAILED/CANCELLED`；`runMode` 默认 `TEST_STUB`；`leaseOwner` + `heartbeatAt` 支持 worker 租约/心跳/崩溃恢复；`costStatus` 默认 `"unknown"`（**费用未知即标未知**） |
| | `ToolCall` | 工具白名单执行留痕 |
| | `ActionProposal` | `idempotencyKey @unique` 保证重复点击/重试幂等；`baseVersionHash` 支持旧版本提议重新校验；**模型不直接写库，必须经此提议** |
| 公司知识 | `KnowledgeSource` | `rootPath` 指定目录，`readOnly` 默认 true（首版只读导入） |
| | `KnowledgeDocument` | `@@unique([sourceId, relativePath])`；`contentHash` 判重；`deletedAt` 支持删除后从新检索移除 |
| | `KnowledgeChunk` | `headingPath` 保留标题层级，用于来源引用 |
| | `KnowledgeSyncRun` | 记录批次 `scanned/created/updated/deleted/failed` + `failures Json`（失败文件与原因） |
| | `CompanyFact` | `@@unique([organizationId, key])`；`status PENDING/CONFIRMED/SUPERSEDED` —— **聊天记录不自动变成公司事实** |
| 上市 | `LaunchPlan` / `LaunchMilestone` | `targetDate` / `ownerId` / `status` / `blockerReason` / `actualLaunchedAt`；`workItemId` 复用既有 WorkItem，**不建第二套任务系统** |

---

## 2. 命令契约（命名待契约冻结后统一，此处为已实现的接口）

所有命令统一携带：服务端 `actor`（来自 session，**不接受客户端传入**）、`organizationId`、`requestId`/`idempotencyKey`；更新类命令带 `expectedRevision`。

错误分类（`src/shared/errors.ts`）：无权限 `ForbiddenError` / 版本冲突 `ConflictError` / 缺少输入 `UnprocessableEntityError` / 未找到 `NotFoundError` / 模型与来源不可用见 §6 运行状态。

### 2.1 产品开发

| 接口 | 位置 | 语义 |
| --- | --- | --- |
| `createDevelopmentProduct(session, params)` | `src/modules/products/service.ts` | **原子**创建 `Product` + 初始 `ProductVersion(v1)` + 首次开发 `Project` + `ProjectMember` + `AuditEvent`，并写 `Project.productId` |
| `getProductOverview(session, productId)` | 同上 | 产品详情首屏聚合：定义、最新判断、评分与证据完整度、前三风险、下一步、最近变更、里程碑 |
| `analyzeProductVersion(session, params)` | `src/modules/product-development/analysis.ts` | 生成 `AnalysisRun`（含六维度与 `Scorecard`）。**规则合成，不引入 LLM**；未接真实模型时 `runMode=MANUAL` |
| `listOrganizationProducts` / `publishProductVersion` | `src/modules/products/service.ts` | 保留既有实现 |

### 2.2 顾问 / 知识 / 上市

| 接口 | 位置 | 语义 |
| --- | --- | --- |
| `sendMessage` / `getRun` / `cancelRun` / `applyProposal` | `src/modules/advisor/` | 见文末未实现清单 |
| `syncSource` / `searchKnowledge` | `src/modules/knowledge/` | 见文末未实现清单 |
| `prepareLaunch` | `src/modules/launch/` | 见文末未实现清单 |

---

## 3. 权限与组织隔离

- 所有新增表均带 `organizationId` 并有索引；跨组织外键关联在**业务命令中校验**，不依赖数据库约束。
- 页面不得直接拼装多表业务规则；跨模块查询走受权限保护的聚合接口。
- 知识检索、模型上下文组装**先按组织与用户权限过滤，再检索/组装**。
- `ActionProposal`、`AgentRun`、`AnalysisRun` 均不接受客户端伪造 `actor`。

## 4. 迁移策略（本轮实际执行）

蓝图 §7 要求：新增字段先兼容为空 → 按真实关系回填 → 检查孤立/跨组织数据 → 再收紧约束。

本轮执行记录：

1. **备份**：`prisma/_backups/dev-20260913-215943.dump`（pg_dump custom 格式，84KB）。
2. **生成增量**：`prisma migrate diff --from-url <dev> --to-schema-datamodel`，产出纯增量 SQL（605 行）。
3. **审查**：确认 44 条 `ALTER TABLE` 全为 `ADD COLUMN`/`ADD CONSTRAINT`；零 `DROP`/`TRUNCATE`/`DELETE`/改类型。
4. **应用**：psql 直连开发库执行，表数 25 → 40；`Product`/`ProductVersion`/`Project`/`User` 行数不变。
5. **建立迁移基线**：既有 5 个迁移从未应用过（该库此前由 `db push` 建表），用 `migrate resolve --applied` 标记为已应用，`migrate status` 现为 `Database schema is up to date!`。

**未做（需在正式环境补）**：隔离库演练与回滚步骤；`SignalItem.organizationId` 回填后收紧为 NOT NULL。

## 5. 待回填与待收紧

| 项 | 当前 | 目标 | 触发条件 |
| --- | --- | --- | --- |
| `SignalItem.organizationId` | 可空 | NOT NULL | 现有行回填完毕（当前 0 行） |
| `SignalSource.organizationId` | 可空 | 保持可空 | 有意：`NULL` 表示公共配置 |
| `Product.ownerId` / `lifecycleStage` 等 | 可空 / 默认 `IDEA` | 按真实数据回填 | 存量产品补录 |
| `Project.productId` | 可空 | 保持可空 | 有意：允许无产品的探索项目 |

## 6. 未实现清单（不得当作已完成）

以下为本轮**未实现**，蓝图 §11 门槛中依赖它们的条目**尚未达标**：

- `src/modules/advisor/`（会话、真实模型调用、动作提议落地）
- `src/modules/knowledge/`（Obsidian 只读导入、中文检索、来源引用）
- `src/modules/launch/`（上市计划命令）
- 后台 worker（租约/心跳/崩溃恢复仅有表结构，无运行进程）
- 市场机会 `/opportunities` 入口（Signal 表已就绪，UI 未接）
- 真实模型端点接入：**本轮未验证任何可用端点或免费额度**，顾问能力如需演示必须标 `TEST_STUB`
