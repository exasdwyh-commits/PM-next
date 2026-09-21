---
title: PC-0 能力基线（复验台账）
version: "1.7"
status: 已交付；PC-0 Final Security Patch 完成，并追加验证可信度修复 D-008/D-009（v1.3）、写路由入参健壮性收口 D-011/D-012 + 验收假绿修复 D-014（v1.4）、调用方错误中央收口 D-015/D-016/D-017/D-018（v1.5）、前端交互反馈层 + 路线级 loading 回归修复 D-019/D-020（v1.6，2026-09-17）、Quiet Enterprise 视觉迁移 + 点击区口径裁定 + G1/G2/G3/G5/G6/H1/H2 守卫（v1.7，2026-09-18，最终放行点 `41c0ac1`）
date: 2026-09-18
owner: 实施负责人
task: TASK-001（PC-0）
scope: hermes-next 主工程现状复验
---

# PC-0 能力基线

> 本文件记录 `hermes-next/` **当前真实可用程度**，供 PC-0 放行判断使用。
>
> 状态词只有五档，含义固定：**源码存在**（文件/符号在）＜**静态确认**（读过代码并追通逻辑）＜**运行已验证**（实际执行并观察到结果）＜**业务已验收**（真实业务人员确认）＜**阻塞**。
>
> **本文不继承任何历史"已完成"结论。** 业务已验收一档在 PC-0 阶段**全部为未开始**，因为没有真实试点数据。

## 0. 基线与工作区

| 项目 | 值 | 证据 |
| --- | --- | --- |
| 主工程 | `hermes-next/` | 仓库根 `plan/process-product-center-roadmap-v1.md` §8.2 |
| Git HEAD | `7ce88af0cb705932349a1b99733ff4cdbe591de7`（branch `main`） | `git rev-parse HEAD` |
| 未提交变更 | 111 条（其中 `hermes-next/` 内 92 条） | `git status --porcelain` |
| 技术栈 | Next.js 15.5.25 · Prisma 6.19.3 · PostgreSQL 17.10 · React | `node_modules/*/package.json` |
| 数据库端口 | 5433（Postgres.app `var-17-hermes`） | `pgrep -fl postgres` |
| 数据模型 | **41 model / 36 enum / 7 migration**（本轮 +1 model +1 enum +1 migration） | `prisma/schema.prisma`；`find prisma/migrations -name migration.sql` |
| 开发库 | `hermes_next_dev` / 角色 `hermes_app` / **41 表** | `psql` 实测 |
| 测试库 | `hermes_next_test` / 角色 `hermes_test` / **41 表** | `psql` 实测 |
| 组织成员回填 | dev 库 4 行（`ORG_ADMIN` 2 / `MEMBER` 2） | `select role, count(*) from "OrganizationMember" group by role` |

**重要发现（RISK-001 实证）**：复验前 `.next` 构建产物（2026-09-15 18:18）**落后源码 42 个文件**。该构建不能作为当前代码的运行证据。此后每次 HTTP 验收前均重建，本轮重建耗时 14s、无错误。

**测试环境隔离已实测有效**：`scripts/run-test.ts` 强制 `TEST_DATABASE_URL` 且库名必须以 `_test` 结尾；`tests/test-safety.ts` 三层校验中第三层用测试账号实际连开发库，实测被拒（`User does not have CONNECT privilege.`）。测试不会污染开发库。

## 1. 交付面能力清单

### 1.1 已具备并被运行验证

| 能力 | 位置 | 状态 | 证据 |
| --- | --- | --- | --- |
| 事务原子性与失败回滚 | `src/shared/db.ts` + 各 service | 运行已验证 | `test:db` 全绿 |
| 幂等键存储与重放 | `src/shared/idempotency.ts` | 运行已验证 | 同键重放 `wasReplayed:true`；同键**不同载荷**返回 409 |
| 版本一致性（旧成果/旧版本阻断） | `src/modules/decisions/scope-hash.ts`、`service.ts` | 运行已验证 | `test:revision` D1/D1b/D2 均 409/422 阻断；D3 确认后放行 |
| 局部修订与历史保留 | `src/modules/product-development/revision.ts` | 运行已验证 | `test:partial` 3 场景 × 5 断言；历史批次/成果原始基线未被就地改写 |
| 证据结构（FACT/INFERENCE/ASSUMPTION） | `src/modules/research/evidence-claims.ts` | 运行已验证 | `test:evidence`：价格类 FACT 缺单位/机制被拒；仅已核实 FACT 参与事实 |
| 机会分析与市场验证 | `src/modules/research/opportunity-analysis.ts` | 运行已验证 | `test:opportunity`：无证据→PENDING；有核实→FOLLOW_HIT；缺销量不编造 |
| 关键证据缺口阻断打样提交 | `src/modules/products/product-suggestion.ts` | 运行已验证 | 缺 `price` 已核实 FACT 时提交返回 422（P1-02 规则生效） |
| 确定性六层成本引擎 | `src/modules/cost-engine/`（12 文件纯函数） | 运行已验证 | `test:p1` F18/F19：总成本 ¥55.84、毛利率 74.57%、保底供货价 ¥72.59，机械可复算 |
| **成本引擎接入产品页（经济性计算器）** | `src/app/products/[id]/cost-calculator.tsx` + `product-overview-client.tsx`（成本与供应页签） | 运行已验证 | **PC-1 首批实施**：产品页可直接录单件成本输入，由同一 `calcCost` 实时算单件成本/毛利率/供货价。浏览器实测（辛选/零售价69）：单件总成本(L1–L5) ¥45.13、BOM 毛利率 77.84%、净利率 44.22%、保底=建议 ¥58.67，与引擎逐值一致；`tests/cost-calculator.test.ts` 4/4 |
| 需求语义解析 | `src/modules/research/requirement-parser.ts` | 运行已验证 | `test:p1` F13：价格带/成本红线/周期/否定项识别准确 |
| 建议包 → 不可变版本 → 打样门 | `src/modules/products/product-suggestion.ts` | 运行已验证 | `test:p1` F16/F17/F33 全通过 |
| **产品读授权（组织内可读）** | `src/modules/identity/product-access.ts` `requireProductRead` | 运行已验证 | **本轮实施**：读路径仅校验组织归属，不要求项目角色；跨组织/不存在统一 404（`test:product-center` 4.12–4.13、`test:authz` 矩阵） |
| 产品写授权（项目角色） | `src/modules/identity/product-access.ts` `requireProductRole` | 运行已验证 | 写路径按项目角色；VIEWER/非成员 403、跨组织 404、匿名 401（`test:product-center` 场景 1/4） |
| **组织级角色（最小 OrganizationMember）** | `src/modules/identity/org-membership.ts`、`admin.ts` | 运行已验证 | **本轮实施**：`isOrgAdmin` **只**看 `OrganizationMember.role`，无项目角色兜底；`test:authz` 场景 5（5.1–5.9）证明"建项目不再自升管理员" |
| **信号组织内唯一性与跨组织不可见** | `src/modules/signal/manual-signal.ts`、`signal-collection.ts` | 运行已验证 | **本轮实施**：唯一约束含 `organizationId`，存在性泄漏措辞已移除；`test:signal` + `test:authz` 场景 6（6.1–6.10） |
| **成果三字段（组织 / 产品版本 / schema 版本）** | `src/modules/work/artifact-schema.ts`、`work/service.ts`、`products/product-suggestion.ts` | 运行已验证 | **本轮实施**：新写入的 Artifact 携带 `organizationId` / `productVersionId` / `schemaVersion`；存量行按 `WorkItem→Project` 回填前两项，`schemaVersion` 有意留空（旧自由文本无版本语义） |
| 跨组织隔离与角色边界（HTTP） | 43 条 API 路由 / 60 个方法 | 运行已验证 | `test:http` 52 断言全绿（跨组织 404、角色 403、登出失效、cookie/bearer 双通道） |
| 全路由 × 角色 × 组织穷举矩阵 | `tests/authz-matrix.ts` + `tests/acceptance-authz-matrix.test.ts` | 运行已验证 | **558/558 通过，连续两遍一致**（434 → 455 安全补丁批次；455 → 465 验证可信度批次；465 → 529 写路由入参健壮性批次；529 → 558 调用方错误中央收口批次。含登记覆盖 / 逐格状态码 / 跨租户响应体 / 内部字段 / 零写入 + 场景 5/6/7/8 反向回归 + 「有权身份段无任何 5xx」汇总断言 + F 段 `caught === 0` 静态守卫） |
| 项目详情下发字段白名单 | `src/modules/projects/project-view.ts` | 运行已验证 | SSR 与 `GET /api/projects/[id]` 共用同一 `select`；`members`、负责人邮箱、内部 Json 不下发（`test:product-center` 33 断言全绿） |
| 租户与越权穿透拦截 | 多处 | 运行已验证 | `test:blueprint` 门槛 8：跨机构产品/知识切片/公司事实均不可达 |
| DEMO 证据不得进入 REAL 决策 | `src/modules/evidence/` | 运行已验证 | A10、R07 通过 |
| 生产环境禁用免密身份开关 | `src/shared/runtime-status.ts` | 运行已验证 | A12、R2 probe：`x-user-id` 头在生产态 403；本轮实测 `/api/health` 匿名仅回 `{"status":"UP"}` |
| 审计留痕与费用未知标未知 | `AgentRun` / `ToolCall` / `Message` | 运行已验证 | 蓝图门槛 7：运行留痕落库，`costStatus=unknown` 不伪造账单 |

### 1.2 源码存在但**尚未接线**（PC-1 主要缺口）

| 能力 | 位置 | 实际状态 |
| --- | --- | --- |
| 顾问真实模型对话 | `src/modules/advisor/service.ts:434` `sendMessage` | **无任何模型 HTTP 调用**。函数内写死 `runMode: RunMode.TEST_STUB`，自述"当前尚未接入语言模型"，仅做确定性意图路由 + 知识检索 |
| 模型客户端与配置层 | `src/modules/llm/` | **目录不存在**（TASK-006 计划新增） |
| ~~成本引擎接产品页~~ | — | ✅ **已接线**（PC-1 首批，2026-09-16）：产品详情「成本与供应」页签直接复用 `calcCost`，零新增 API 面；见 §1.1 与 §5.5 |
| 供应/样品/报价 | `src/modules/supply/index.ts` | `SUPPLY_MODULE_STATUS = "BOUNDARY_ONLY"`（空壳） |
| 规则与合规检查项 | `src/modules/rules/index.ts` | `RULES_MODULE_STATUS = "BOUNDARY_ONLY"`（空壳） |
| 经营复盘 | `src/modules/reviews/` | **目录不存在**（TASK-015 计划新增） |
| 品牌与营销 | `src/modules/brand-marketing/` | **目录不存在**（TASK-014 计划新增） |
| 产品组合 | `src/modules/portfolio/` | **目录不存在**（TASK-018 计划新增） |
| 受控后台执行 | `src/modules/agent-runtime/`、`scripts/agent-worker.ts` | **均不存在**（TASK-020 计划新增） |
| 经济性 | `src/modules/economics/index.ts` | `BOUNDARY_ONLY` |
| 情报 | `src/modules/intelligence/index.ts` | `BOUNDARY_ONLY` |
| 决策读约定 | `src/modules/jarvis/index.ts` | `READ_CONVENTION_ONLY` |

### 1.3 命令入口核验（路线图点名项）

全部**源码存在 + 静态确认**，未逐一单独运行（其覆盖能力已由 1.1 的回归套件间接验证）：

| 命令 | 位置 | 状态 |
| --- | --- | --- |
| `createDevelopmentProduct` | `products/service.ts:127` | 源码存在 |
| `createWorkItem` | `work/service.ts:16` | 源码存在 |
| `applyProposal` | `advisor/proposals.ts:498` | 源码存在 |
| `createDecisionPacketDraft` / `submitDecisionPacket` / `decideDecisionPacket` | `decisions/service.ts:33/95/183` | 源码存在 |
| `upsertCompanyFact` / `confirmCompanyFact` | `knowledge/facts.ts:24/76` | 源码存在 |
| `analyzeProductVersion` | `product-development/analysis.ts:66` | 源码存在 |
| `calcCost` | `cost-engine/index.ts:48` | 源码存在 |
| `createRevision` | `product-development/revision.ts:325` | 源码存在 |
| `computeLaunchGate` / `prepareLaunch` / `upsertMilestone` / `approveLaunch` / `revokeLaunchApproval` / `confirmLaunchExecution` | `launch/service.ts:167/243/394/497/533/561` | 源码存在 |
| `requireProductRole` | `identity/product-access.ts:86` | 源码存在（**写路径专用**） |
| `requireProductRead` | `identity/product-access.ts` | **本轮新增**，读路径专用 |
| `ensureOrganizationMember` / `getOrganizationRole` | `identity/org-membership.ts` | **本轮新增** |

新增回归入口：`npm run test:product-center`（项目详情白名单 33 断言）、`npm run test:authz`（表驱动权限矩阵 558 断言）、`npm run test:signal`（信号组织隔离）、`npm run test:http-errors`（调用方错误状态码，31 断言）、`npm run test:api-errors`（`handleApiError` 中央映射纯函数，26 断言）。

## 2. 权限与安全基线（Phase 3 任务书 B1–B8 逐项复验）

| 编号 | 原缺口 | 现状 | 依据 |
| --- | --- | --- | --- |
| B1 | `GET /api/knowledge/facts` 缺管理员校验 | ✅ **已修**（运行已验证） | 匿名 → 401；改为与页面共用 `projectCompanyFacts()` 按身份脱敏；代码含修复注释 |
| B2 | `settings` 审计查询缺组织过滤 | ✅ **已修**（静态确认） | `settings/page.tsx:42` 已加 `where: { actor: { organizationId } }` |
| B3 | `/api/health` 无鉴权且回传内部信息 | ✅ **已修**（运行已验证） | 本轮复测：匿名 `{"status":"UP"}`（无库名/版本/原始错误）；详情拆至 `/api/health/details`，匿名 401 |
| B4 | 10 个产品写路由有身份无授权 | ✅ **写路径已收口；读口径已定并实施** | **写**：`publishProductVersion`、`getProductOverview`、`analyzeProductVersion`、`createRevision`/`listAnalysisHistory`、launch 写权限均走 `requireProductRole`（403/404/401 如预期）。**读**：2026-09-15 拍板"产品读权限先定为**组织内可读**，写权限继续按项目角色控制"——Hermes 是公司内部产品中心，不是对外客户隔离的 SaaS，组织成员可读本组织产品。已实施：读路径改走 `requireProductRead`，不再要求项目成员身份；`test:product-center` 2.2 与 `test:authz` 矩阵同步为"组织内非成员读 → 200" |
| B5 | 请求体直写外部 id 未校验归属 | ✅ **已修**（静态确认） | 新增 `identity/ownership.ts` 的 `assertOrgUser`/`assertWorkItemRef`/`assertKnowledgeDocumentRef`/`assertCompanyFactRef`，已接入 `launch/service.ts:268,286,288,367,411,414` 与 `knowledge/facts.ts:46,108` |
| B6 | RSC 整对象下发与内部字段泄露 | ✅ **已修（残余已闭合）** | ✅ `research-run.ts` 改用 `RUN_PUBLIC_SELECT`（剔除 `runnerPid`/`runnerBootId`/`inputJson`）；✅ 登录响应体不再回传 `token`（只走 httpOnly Cookie）；✅ `suggestions` 路由改走 `handleApiError`；✅ 项目页 Evidence 用 `EVIDENCE_PUBLIC_SELECT`。**收尾**：`src/modules/projects/project-view.ts` 作为项目详情字段白名单**唯一来源**（`PROJECT_DETAIL_SELECT` + `APPROVAL_META_SELECT`），SSR 页与 `GET /api/projects/[id]` 共用；`workItems.artifacts/receipts/submissions` 由整行 `include` 改为白名单 `select`；`members` 仅服务端用于鉴权、**返回前显式剥离**；dev 免密身份下的成员列表改为仅 `mockAuth` 时查询。运行验证：`test:product-center` 33 断言全绿。**仍保留（有意的口径，非缺陷）**：`RUN_TASK_PUBLIC_SELECT` 的任务级 `resultJson` 保持下发 —— 它是任务结果本身，非进程内部信息；已登记为待产品确认项 |
| B7 | 组织级角色（需业务拍板） | ✅ **已实施** | 2026-09-15 拍板：建**最小** `OrganizationMember`（`organizationId` / `userId` / `role = ORG_ADMIN \| MEMBER` / `createdAt`），`isOrgAdmin()` **只**看该表。**明确不建 HR 体系**——无部门、职位、汇报线、职级。理由：B8 矩阵实测证明"任何成员创建项目即自升管理员"（可读知识源配置含服务器 `rootPath`），这是越权而非便利。实施后 `test:authz` 场景 5 证明该路径已断 |
| B8 | 自动化越权矩阵 | ✅ **已实施** | `tests/authz-matrix.ts`（43 路由 / 60 方法**全登记**，含 `validationFirst` 与 `ownerGate` 标记）+ `tests/acceptance-authz-matrix.test.ts`。五类断言：① 登记覆盖（文件系统存在而未登记 → 失败；已消失的登记项 → 失败）② 逐格状态码 ③ 跨租户 2xx 响应体不得含他组织夹具标记 ④ 内部字段（`fileKey`/`runnerPid`/`runnerBootId`/`verifiedByUserId`/`submittedById`/`reviewedById`/`confirmedById`）不得下发 ⑤ **零写入断言**。（另加 C 段「有权身份段无任何 5xx」汇总断言，合计六类。）**反向回归**：场景 5 = org-admin 自举（D-003），场景 6 = 跨组织信号存在性泄漏（D-002），**场景 7 = 缺必填字段的写请求必须回 4xx（D-008）**，**场景 8 / F 段 = 写路由入参健壮性全量探测（D-011 / D-016）**：按方法切源码把写路由分为 `raw`（裸 `await req.json()`）/ `helper`（`readJsonObjectBody`）/ `caught`（`.catch(() => ({}))`，**缺陷形态，断言必须为 0 条**）/ `none` 四态，对 `raw` 探两种载荷、对 `helper` 只探畸形 JSON（其空 body 是合法写入请求），并新增 `caught === 0` 静态守卫防复发。**558/558 通过 × 连续两遍**。⚠️ **判据已修正**：`ownerGate: "NOT_DENIED"` 旧实现为「非 401/403/404」，**会把 500 当成门禁已开**（60 条登记中 30 条用该门禁，即半张矩阵分不清"正常"与"崩溃"），现收紧为「非 401/403/404 **且非 5xx**」，并新增独立于逐条门禁的汇总断言「有权身份段无任何 5xx」。另以 `test:http`（52）+ `test:product-center`（33）+ `test:http-errors`（31）作为场景化补充。⚠️ **已知覆盖盲点**：`authz-matrix.ts:382` 的 `POST /api/products` 用 `{{IDENTITY}}` 模板、各身份**异码**，故 `foreign: [201]` **永不触发**唯一键冲突 —— D-001 在矩阵里撞不上，已改由 `test:http-errors` 戊段特征化锁定。｜⚠️ **2026-09-20 更新**：D-001 已由 **TASK-008** 修复；矩阵新增**场景 6b**（6b.0–6b.9，跨组织同码 201 / 同组织重复 409 / 列表不可见），戊段由「特征化锁定 409」改为「断言 201 + 同组织仍 409」。矩阵单次断言数 568 → **578** |

## 3. 历史 Phase 3 缺口分类

### 3.1 已修，保留回归

B1、B2、B3、B5，B6 的四个子项（research-run 白名单 / 登录 token / suggestions 错误收口 / Evidence 白名单）与残余（项目详情字段白名单 + `members` 剥离），**B8 表驱动越权矩阵**。
**本轮新增**：B4 读口径（组织内可读）、B7 最小 `OrganizationMember`、D-002 信号跨组织泄漏、D-003 组织权限自举、I-001/I-002/I-003 成果三字段。

### 3.2 仍需处置

| 项 | 内容 | 影响 |
| --- | --- | --- |
| B6 · 1 项待产品确认 | 任务级 `resultJson` 仍下发 | 低。它是任务结果本身，非进程内部信息；已登记为待确认口径，非缺陷 |
| D-001（工程债） | `Product.identityCode` 全局唯一 → 跨组织同名返回 **500** | 中低。组织 B 无法建与组织 A 同名的产品。**本轮拍板：不阻塞 PC-0/PC-1**，方向为映射为 **409 CONFLICT**（而非改复合唯一键），登记为工程债待后续批次处理。<br>⚠️ **2026-09-20 更新（本项已关闭）**：先由 D-015 把 500 映射为 409（映射半边），再由 **TASK-008** 落地 `@@unique([organizationId, identityCode])` + 迁移 `20260920235500`（约束半边）。本行「本轮拍板」只描述 2026-09-16 当时的取舍 |
| D-005 | 详见 `docs/contracts/PRODUCT_CENTER_CONTRACTS.md` §7.3 | 未修，未阻塞 |
| D-006（新登记） | **`prisma/migrations` 链不可回放**：`SignalSource`/`SignalItem`/`ResearchRun`/`ResearchRunTask`/`ResearchRunSnapshot` 无任何 `CREATE TABLE` 迁移，而 `20260913220000_*` 却对其 `ALTER TABLE`；两个本地库均以 `db push` 建成，故 `migrate deploy` 在空库上失败 | 中。**不阻塞本地开发**（两个库均已实测与 schema 等价，`migrate diff` 输出为空）。阻塞的是"从零重放建库"与新环境/正式环境迁移。需单独一个批次补齐基线迁移 |
| D-007 | 已知取舍，详见契约 §7.3 | 有意的口径，非缺陷 |

### 3.3 不适用

`src/modules/economics/`、`intelligence/`、`jarvis/` 属边界占位模块，本轮不启动；旧版 `hermes-pm-hub-cockpit-truth/`、`hermes-pm-hub-repo/` 仅作候选资产，不在本轮删除或迁移。

## 4. "文档说谎"清单复验（Phase 3 任务书 §7）

| # | 断言 | 复验结果 |
| --- | --- | --- |
| 1 | 目标成本 ¥55.84 不可复现 | **可复现**。`test:p1` F18/F19 实测输出六层总成本 ¥55.84，来源是确定性成本引擎，非 seed 常量 |
| 2 | 门槛 4 用临时目录冒充真实 Vault | 未复验（本轮未跑该断言细节） |
| 3 | `src/lib/obsidian-review-sync.ts` 不存在 | ✅ 确认：`src/lib/` 目录仍**不存在** |
| 4 | 全仓无 `runAgent` | ✅ 确认：仍**无** `runAgent`；顾问自述未接入模型 |
| 5 | 设置页列了从未被读取的 `ADVISOR_BASE_URL`/`ADVISOR_API_KEY` | ✅ **已消除**：`src/` 内已搜不到这两个变量名；实际读取的是 `ADVISOR_MODEL_PROVIDER`/`ADVISOR_MODEL_ID` |
| 6 | 注释称对应 `CostRecord` 表 | ✅ 确认：**无** `model CostRecord` |
| 7 | `Message.citations` 含 `path`/`hash` | 未复验 |
| 8 | `AnalysisDimension.evidenceRefs` 结构与注释不符 | 未复验 |
| 9 | "成本与供应/验证与风险 不呈现任何数字" | **部分复验**：成本与供应页**已呈现真实数字**（浏览器实测单件成本 ¥45.13、毛利率、供货价区间，见 §5.5）；验证与风险页本轮未单独复验 |

## 5. 本轮实测命令与结果（完整证据见 `ACCEPTANCE.md`）

全部在 `hermes-next/` 下执行，`NODE_OPTIONS=` 清空宿主注入。

### 5.1 PC-0 初验批次（2026-09-15）

| 套件 | 结果 |
| --- | --- |
| `tests/db-transaction-verification.ts` | ✅ 全绿 |
| `tests/regression-revision-consistency.ts` | ✅ 全绿（A1–A4 / D1–D4） |
| `tests/regression-partial-revision.ts` | ✅ 全绿 |
| `tests/regression-evidence-structure.ts` | ✅ 全绿 |
| `tests/regression-opportunity.ts` | ✅ 全绿 |
| `tests/regression-fixture-isolation.ts` | ✅ 全绿（两次运行夹具自清不互相污染） |
| `tests/acceptance-a01-a12.test.ts` | ✅ 全绿（A01–A12） |
| `tests/acceptance-p1.test.ts` | ✅ 全绿 |
| `tests/acceptance-blueprint-journey.test.ts` | ✅ 全绿（10 项发布门槛） |
| `tests/acceptance-b01-r1.test.ts` | ✅ 全绿（R07–R09） |
| `tests/review-r2-probes.ts` | ✅ 全绿 |
| `tests/review-r3-probes.ts` | ✅ 全绿 |
| `tests/review-version-consistency.ts` | ✅ 退出码 0（输出为缺口阻断提示） |
| `tests/acceptance-b01-http.ts` | ✅ 52 断言全绿（**修复测试漂移后**，见 §6） |
| `tests/acceptance-product-center.test.ts` | ✅ 33 断言全绿 |
| `tests/acceptance-authz-matrix.test.ts` | ✅ 434 断言全绿 × 连续两次 |
| `tsc --noEmit` / `next build` | ✅ 无错误 / ✅ 成功（14s） |

### 5.2 PC-0 Final Security Patch 批次（2026-09-16，**本轮**）

构建与类型：`next build` 14s 无错误；`tsc --noEmit` 退出码 0。
HTTP 验收服务：`NODE_ENV=production DEV_MOCK_AUTH=false DATABASE_URL=$TEST_DATABASE_URL next start -p 3110`，匿名 `/api/health` → `{"status":"UP"}`。

| 套件 | 结果 |
| --- | --- |
| `tests/acceptance-authz-matrix.test.ts` | ✅ **455/455 全绿 × 连续两遍**（434 → 455：新增场景 5 自举回归 9 项、场景 6 跨组织泄漏 10 项，扣减两条被口径变更替换的旧断言） |
| `tests/acceptance-product-center.test.ts` | ✅ **33/33 全绿**（2.2 由"组织内非成员读 → 403"改为"→ 200"，与 B4 新口径一致） |
| `tests/acceptance-b01-http.ts` | ✅ **52/52 全绿**（B4 读口径变更后未回归） |
| `tests/acceptance-b01-r1.test.ts` | ✅ **R01–R10 全绿**（夹具补 `OrganizationMember`；无遗留产品的版本发布改走组织管理员，不再依赖已断的自举路径） |
| `tests/regression-signal.ts` | ✅ **全绿**（5 组：源注册表 / 采集去重 / **组织隔离：同标题信号在 A/B 各自成立** / 信号→证据封装 / **跨组织不可封装 → 404**） |
| `tests/regression-revision-consistency.ts`、`regression-partial-revision.ts` | ✅ 全绿（回归未受影响） |

### 5.3 验证可信度批次（2026-09-16，D-008 / D-009）

**触发方式**：不是按计划发起，是从一次 41 分钟的生产模式服务日志里读出来的（日志中 2 个 `[API Error]` 块）。追下去先查出三条写路由缺必填字段返回 500，再查出**矩阵判据本身把 500 当成"门禁已开"**。

| 套件 | 结果 |
| --- | --- |
| `tests/acceptance-authz-matrix.test.ts` | ✅ **465/465 全绿 × 连续两遍**（455 → 465：新增场景 7「缺必填字段的写请求必须回 4xx」9 项 + 独立汇总断言「有权身份段无任何 5xx」1 项）。**判据修正**：`ownerGate: "NOT_DENIED"` 由「非 401/403/404」收紧为「**且非 5xx**」——60 条登记中 30 条用该门禁，即半张矩阵此前分不清"正常"与"崩溃" |
| `tests/acceptance-product-center.test.ts` | ✅ **33/33 全绿** |
| `tests/acceptance-b01-http.ts` | ✅ **52/52 全绿** |
| `tests/ui-b01-evidence.ts` | ✅ **13/13 全绿**（修复前为「9 项通过 + 末步 30s 超时不可达」，故整套非绿。根因：退出按钮可见文字为「退出」，完整短语仅在 `title`，无障碍名取自内容 → 精确名匹配 0 命中。修组件补 `aria-label`，不放宽测试选择器） |
| 其余 12 套服务级回归 | ✅ 全绿（a01-a12 / b01-r1 / p1 / blueprint-journey / signal / revision / partial / evidence-structure / opportunity / r2 / r3 / db-transaction） |
| 类型与构建 | ✅ `tsc --noEmit` 0 错；`next build` 通过 |
| 服务端日志（修复后重跑） | ✅ `[API Error]` **0** 条、`prisma:error` **0** 条（修复前三条 500 均在日志留有正文） |

**新增设施**：`hermes-next/scripts/acc-server.sh`（缺 `BUILD_ID` 自动重建 → 腾端口 → `nohup` 起 3110/3111 → 探活通过才跑套件）。此前手动操作踩坑三次，每次报错文案都指向错误方向（`Could not find a production build` / `fetch failed`）。

**⚠️ 未关闭**：只修了实测暴露的三条写路由；其余 POST/PATCH 路由是否存在同类「缺字段 → 500」**未做系统扫描**。据此**不得**声称"写路由入参校验已全面收口"。

### 5.4 未执行项

| 项 | 原因 |
| --- | --- |
| `tests/ui-b01-evidence.ts`（Playwright UI） | 未执行；需浏览器运行时 |
| 真实模型调用 | 不存在模型客户端，无端点可调 |
| 真实业务验收 | PC-0 阶段无真实试点资料 |
| `migrate deploy` 在空库上重放 | **已知失败**（D-006 迁移链不可回放）；本轮改为用"迁移文件纯增量 + 两库 `migrate diff` 输出为空"双向证明等价 |

### 5.5 PC-1 首批 · 成本页接线与 D-010 修复（2026-09-16）

PC-0 收口后进入 PC-1。首批做的是**不依赖业务输入 / 外部凭证**的项（成本页接线 + 一次对既有验收结论的复核）。

| 套件 / 检查 | 结果 |
| --- | --- |
| `tests/cost-calculator.test.ts`（纯函数，无 DB） | ✅ **4/4**（含新增「L6 月固定成本不计入单件总成本」口径锁定） |
| 浏览器：产品详情「成本与供应」页签（`next start` + 真实 Chromium） | ✅ 单件总成本(L1–L5) ¥45.13、BOM 毛利率 77.84%、净利率 44.22%、保底=建议 ¥58.67，**与引擎逐值一致** |
| `tests/ui-b01-evidence.ts` | ✅ **13/13**（**修复前 9/13**，见 §6.5 / D-010） |
| `tests/acceptance-product-center.test.ts` | ✅ 33/33 |
| `tests/acceptance-b01-http.ts` | ✅ 52/52 |
| `tests/acceptance-authz-matrix.test.ts` | ✅ 465/465（复核 §10 的结论，独立重跑一致） |
| `tsc --noEmit` / `next build` | ✅ 0 错 / ✅ 成功 |

**复核说明**：§10 记录的「ui 13/13」在本次独立重跑中**未复现**（实为 9/13），据此查出 D-010；修复后重新达到 13/13。其余三套（authz / product-center / http）独立重跑与 §10 记录一致。

### 5.6 写路由入参健壮性收口批次（2026-09-16，D-011 / D-012 / D-014）

承接 §5.5 的复验结论：**「缺字段 → 500」这一整类缺陷当时只修了实测撞到的 3 条路由，其余从未探测**。本批次按缺陷的"类"做全量收口。

暴露面（按**方法级**统计，非文件级）：

| 分类 | 条数 | 含义 |
| --- | --- | --- |
| 裸解析 `await req.json()`（无 catch） | **21** | 畸形 JSON / 空 body **各 21 条全部 500**，是本类缺陷的影响面 |
| 自兜底 `await req.json().catch(() => ({}))` | **14**（13 个文件） | 吞掉解析异常继续跑业务，属"静默容错"，非崩溃（见 §6.8） |
| 未读 body | **4** | 不涉及 |
| 合计（写路由登记项） | **39** | 一个 `route.ts` 可同时导出 POST/DELETE，故方法级多于文件级 |

| 套件 / 检查 | 结果 |
| --- | --- |
| `tests/acceptance-authz-matrix.test.ts` | ✅ **529/529**（修复前 **487/529**，42 条失败） |
| 21 条裸解析路由 × 2 种畸形载荷 | ✅ **全部 400 / 400**（修复前 **500 / 500**），冒 5xx **0** 条 |
| `tests/api-error-mapping.test.ts`（本批新增） | ✅ **11/11** —— `handleApiError` 的 400/422/500 语义、判定窄化、生产不泄漏 |
| `tests/acceptance-product-center.test.ts` | ✅ 33/33 |
| `tests/acceptance-b01-http.ts` | ✅ 52/52 |
| `tests/ui-b01-evidence.ts` | ✅ 13/13 |
| `tests/cost-calculator.test.ts` | ✅ 4/4（未回归） |
| `tsc --noEmit` / `next build` | ✅ 0 错 / ✅ 成功 |

断言数 465 → 529 的构成：本批新增 **F 段 = 1（重新登录）+ 21 × 3 = 64**；非 F 段落逐场景复算仍为 465，**465 + 64 = 529**。

**回归锁的"会红"验证（关键）**：把新增的两条映射临时移除后重跑，矩阵**确实变红为 42 失败**（21 路由 × 2 载荷），证明该锁不是"永远不会红的摆设"；恢复后 `diff -u` 为空、sha256 与备份一致，重跑回到 529/529。⚠️ 该验证还暴露出一个更危险的问题——见 §6.7。

### 5.7 调用方错误中央收口批次（2026-09-16，D-015 / D-016 / D-017 / D-018）

**主题**：把「**调用方发错了**」从「**服务端崩了（5xx）**」里彻底分离出来。前两批只修了"实测撞到"的少数路由，本批改为**按缺陷的类**收口，并新增**实证穷举**作为"面是否穷尽"的判据。

| 项 | 修复前实测 | 修复后实测 |
| --- | --- | --- |
| `POST /api/products` 重复 `identityCode`（D-015） | **500**（连发两次均 500） | **409** `CONFLICT` |
| `POST /api/products/{id}/versions` 重复 `versionTag: "v1"`（D-015） | **500** | **409** |
| `POST /api/evidences/{id}/verify` 发畸形 JSON `"{"`（D-016） | **200**，且证据被翻成 `VERIFIED`、审计 `EVIDENCE_VERIFIED` **0→1**（fail-open） | **400**，证据保持 `UNVERIFIED`，审计 **0→0** |
| 同路由 body 字面量 `null` | **500** | **422** |
| 同路由 body 字面量 `[]` | **200** | **422** |
| `POST /api/products` 缺 `targetAudience`/`marketPath`/`devMode`（D-017） | **500** | **422**，message 点名缺失字段 |
| `POST /api/projects/{id}/decision-packets` 缺 `artifactVersions`/`evidenceVersions`（D-018） | **500** | **422**，message 点名缺失字段 |
| 跨组织身份复用他组织已占用 `identityCode`（D-001 特征化） | —（映射前为 500） | **409**，且不泄露他组织名称/ID（**已知取舍，见 D-001**） | ｜⚠️ **2026-09-20 更新**：TASK-008 修复后本行行为应变为 **201**（跨组织同码允许）；同组织重复仍 **409**。回归见 `acceptance-http-errors.ts` 戊段与 `acceptance-authz-matrix.test.ts` 场景 6b |

**矩阵 F 段四态分类（按方法切源码，自动枚举，不硬编码清单）**：

| 形态 | 修复前 | 修复后 | 说明 |
| --- | --- | --- | --- |
| `raw`（裸 `await req.json()`） | 21 | 21 | 两种载荷都探（解析失败发生在业务逻辑之前 → 非破坏性） |
| `helper`（`readJsonObjectBody`） | 0 | **14** | **只探畸形 JSON**；其空 body 是**合法写入请求**，探它会写数据 |
| `caught`（`.catch(() => ({}))`） | **14** | **0** | 缺陷形态，新增守卫断言 `caught === 0` 防复发 |
| `none`（不读 body） | 4 | 4 | 跳过并打印清单（不"默默略过"） |
| 合计（写路由登记项） | 39 | 39 | 一个 `route.ts` 可同时导出 POST/DELETE，故方法级多于文件级 |

| 套件 / 检查 | 结果 |
| --- | --- |
| `tests/acceptance-authz-matrix.test.ts` | ✅ **558/558 全绿 × 连续两遍**（529 → 558；修复前 `caught` 守卫 1 条红） |
| `tests/acceptance-http-errors.ts`（本批新增，真实 HTTP） | ✅ **31/31**（修复前 26 通过 / 5 红） |
| `tests/api-error-mapping.test.ts` | ✅ **26/26**（11 → 26：新增 Prisma 已知请求错误映射、判定收窄反例、非对象 body） |
| `tests/acceptance-product-center.test.ts` | ✅ 33/33 |
| `tests/acceptance-b01-http.ts` | ✅ 52/52 |
| `tests/ui-b01-evidence.ts` | ✅ 13/13 |
| `tests/cost-calculator.test.ts` | ✅ 4/4（未回归） |
| `tsc --noEmit` | ✅ 0 错 |

断言数 529 → 558 的构成：**F 段新增 = 1（`caught === 0` 守卫）+ 14（`helper` 路由）× 2（畸形 JSON 的「不得 5xx」与「不得 2xx」）= 29**，**529 + 29 = 558**。

**回归锁的"会红"验证（两个方向，均现场实测）**：
1. 摘掉 D-015 的 409 分支 → `http-errors` **4 条红**（甲2 / 甲2b / 甲3 / 甲5b），18 通过。
2. 把 `evidences/{id}/verify` 退回 `.catch(() => ({}))` → 矩阵 **8.0b 红**，`helper` 14→13、`caught` 0→1。
两次均以 `sha256` + `diff -u` 证明**恢复后逐字节一致**，重跑回全绿；且每次都**确认构建真的被触发**（打印「源码比构建产物新」）——上一批 D-014 的假绿坑未再犯。

**"面是否穷尽"的判据（本批方法论，值得单独记）**：D-017 是**静态扫描**发现的（`params.X.method()` 对 `undefined` 调 `.trim()`）；D-018 是**实证穷举**发现的（对全部写路由发 `{}` 与部分 body，统计 5xx）——它的形态是「**数组迭代未兜底**」（`[...input.artifactVersions]`），静态正则扫不到，导致"只有一处"的结论**是错的**。**结论：凡声称"某类缺陷已穷尽"，必须给出实证穷举的覆盖数。**

### 5.8 前端交互反馈层批次（2026-09-16/17，UI 波 1 / 波 2 + 返工）

**本批性质与前几批不同**：前面的批次都在收口服务端缺陷，本批是**表现层**改造 —— 用户提出"优化 UI/UX 前端操作效果""要那个秘塔的思考动画""其他整体优化自己找不舒服的地方，要人性化"。因此本批的暴露面不是路由，而是**前端的"瞬时状态"**：等待 / 加载 / 出错 / 找不到 / 理由输入。

**本批新增能力**（状态均达**运行已验证**：工程师与 QA 各用真实浏览器独立跑过）：

| 能力 | 落点 | 状态 |
| --- | --- | --- |
| 秘塔式思考动画原语 | `components/ui.tsx` 的 `Thinking`（3 点错峰 + 扫光标签），`role=status` + `aria-live=polite`，装饰圆点 `aria-hidden` | 运行已验证 |
| 等待态替换死文字 | `advisor-client.tsx` 的「正在查询…」→ `<Thinking>` | 运行已验证 |
| 纠正「`<Empty>` 冒充加载态」 | `revision-panel.tsx` / `launch-tab.tsx` 两处加载分支改用 `Thinking`；**真空状态 `<Empty>` 原样保留**（由锁守卫） | 运行已验证 |
| 原生弹窗治理 | `components/reason-dialog.tsx` 的 `useReasonDialog()`：Promise 化，取消 / Esc / 点遮罩 → `null`，空内容确认禁用 | 运行已验证（取消路径 0 写请求，实测） |
| 结果反馈改名 | 4 处 `alert()` → 页内横幅（`role`/`aria-live` 按类型区分）；war-room 补建横幅容器 | 运行已验证 |
| 整页刷新治理 | 8 处 `window.location.reload()` → `router.refresh()` + props→state 同步 | 运行已验证（哨兵未丢且列表确实更新） |
| 导航反馈（替代路线级 loading） | `components/nav-progress.tsx`：顶部进度条 + `NavProgressLink`；纯客户端，零服务端语义代价 | 运行已验证（含 `reduce` 下静态替代） |
| 错误边界 / 404 | `app/error.tsx`（重试 = `router.refresh()` + `reset()`）、`app/not-found.tsx` | 运行已验证（重试真的重新发起服务端请求） |

**本批数字（现场实测，非累计）**：

| 套件 | 结果 |
| --- | --- |
| `acceptance-authz-matrix` | **558** × 连续两遍 |
| `acceptance-product-center` | **33** |
| `acceptance-b01-http` | **52** |
| `ui-b01-evidence` | **13** |
| `acceptance-http-errors` | **31** |
| `api-error-mapping` | **26** |
| `cost-calculator` | **4** |
| `tests/ui-feedback-layer.ts`（本批新增回归锁） | **73** |
| `tsc --noEmit` / `next build` | 0 error / 通过 |

**本批最重要的产出不是功能，而是一条可复用的架构约束**（已由回归锁 2b 固定，见 §6.10）：

> **本项目禁止路级 `loading.tsx`。** App Router 一旦给某段路由加 `loading.tsx`，该段改走流式渲染，响应头 200 会在页面渲染完成前发出，于是后代 `notFound()` **改不了状态码**、`redirect()` **落到 hydrate 之后**。本仓 `projects/[id]` 有 404 硬验收（4.18），另有 **13 个源文件**靠 `redirect("/login")` 跳转 —— 两者都对状态码与时序敏感。导航反馈改由客户端进度条承担。

**与 §6.8/D-013 同源的方法学教训（第二次命中）**：本批的 P0 是**领队在波 1 规格里指挥工程师加根 `loading.tsx`** 造成的，且**当时所有自验都是全绿**——因为自验只跑了 `ui-b01-evidence` 与浏览器目视，没跑 `acceptance-product-center`。**"新加一个看起来无害的框架文件"必须跑全量基线**，而不是只跑与该功能"相关"的那几套。这条与 D-014（改了源码没重建得到假绿）属于同一类：**结论正确而证据面不足**。

### 5.9 Quiet Enterprise 视觉迁移批次（2026-09-17/18，令牌层 / 壳层 / 四组机制 / 逐页 + 回归守卫）

**本批性质**：与 §5.8 同为**表现层**，但主题不同 —— 用户要求把视觉从旧的 paper/teal 系统迁移到「Quiet Enterprise」，并**自己找出不舒服的地方**，随后追加「小屏**电脑**自适应」。本批的暴露面是**视觉一致性**（令牌 / 色值 / 类名契约）与**可度量的小屏表现**（溢出 / 点击区），因此验收方式 = **源码守卫 + 真实浏览器矩阵走查**双轨。**最终放行点 `41c0ac1`。**

**本批新增能力**（状态均达**运行已验证**：工程师与 QA 各用真实浏览器独立跑过）：

| 能力 | 落点 | 状态 |
| --- | --- | --- |
| 令牌层（语义命名 `:root` 令牌集合） | `src/app/globals.css` + `src/app/theme/quiet-enterprise.css` | 运行已验证 |
| 壳层与新原语视觉落地 | 侧栏 / 顶栏 / `components/ui.tsx` | 运行已验证 |
| 四组机制共享组件 | `src/components/viz.tsx`（`StepTrack` / `BubbleChart` / `ProgressRing` / `GateLine` / `Timeline`，各含三态退化） | 运行已验证 |
| 逐页落地（14 页）+ 窄屏断点阶梯 | `src/app/**` | 运行已验证（8 档走查矩阵） |
| 全档点击区 ≥24px（**不放媒体查询里**） | `globals.css`（含 `.modal-close` 28×28） | 运行已验证 |
| 死 CSS 清理 + 类名契约反转 | `globals.css`（清理 52 + 9 个死类；scanner `--product-scope`） | 运行已验证（行为中性） |
| 回归守卫 G1/G2/G3/G5/G6 + H1 豁免表元校验 + H2 服务器归属校验 | `tests/ui-quiet-enterprise.ts` · `scripts/verify-ui-walkthrough.ts` · `scripts/acc-server.sh` · `scripts/ui-walk.sh` | 运行已验证（八项变异全红） |
| `status-labels` / `datetime` 零依赖单一来源 | `src/shared/status-labels.ts`、`src/shared/datetime`（模块统一消费） | 运行已验证 |

**本批数字（权威基线，终检在 `41c0ac1` 上）**：

| 套件 | 结果 |
| --- | --- |
| `tsc --noEmit` | **0 error** |
| `tests/acceptance-authz-matrix.test.ts` | **558** × 连续两遍 |
| `tests/acceptance-product-center.test.ts` | **33** |
| `tests/acceptance-b01-http.ts` | **52** |
| `tests/ui-b01-evidence.ts` | **13** |
| `tests/ui-feedback-layer.ts` | **73** |
| `tests/ui-quiet-enterprise.ts`（本批新增回归锁） | **146**（起点 136 → 141 → 146） |
| `tests/acceptance-http-errors.ts` | **31** |
| `tests/api-error-mapping.test.ts` | **26** |
| `tests/cost-calculator.test.ts` | **4** |
| `tests/status-labels.test.ts`（本批新增） | **12** |
| `tests/datetime-format.test.ts`（本批新增） | **6** |
| `next build` | 通过 |

**浏览器走查（`scripts/ui-walk.sh --full`，真实 Chromium）**：

| 项 | 实测 |
| --- | --- |
| 屏幕数 | **152**（8 档 × **19** 个路由入口） |
| R1 横向溢出 / R2 点击区 <24 / R3 / R4 文案 | 8 档**全 0** |
| 弹窗态（打开「新产品入库」） | **8/8 打开**，R1=0、R2=0 |
| 分母（当前分母声明被检元素数） | 可点元素 **3626** / 文本叶子 **11895** / 图片 **0** |
| 断图检查 | ⚠️ 全仓无 `<img>`（`images=0`）→ **该检查天然空跑，当前不具备督察力**，经 H1 登记为「允许的空分母」（非假绿）；引入 `<img>` 后须恢复硬断言 |

**点击区门槛口径裁定：24×24 CSS px**（**44px 不采纳**）：

- 本产物是**内部桌面工具**，输入设备是鼠标 / 键盘，用户原话是「小屏幕**电脑**自适应」。
- 取 **24×24 CSS px**，即 WCAG 2.2 **Target Size (Minimum)** 对指针输入的要求。结论：点击区实现**不改**（现有门槛本就是 24px）。
- ⚠️ **更正记录**：44px 曾误入派单口径（44/48 是手指触屏规范，本项目不适用），现更正为 **24px**；§10.5 的 H2 与全局 `CLICK_MIN` 均以 **24** 为准。

**本批回归守卫 + 变异证明（八项变异全红，均现场实测后原样恢复）**：

| 守卫 | 内容 | 落点 | 变异证明 |
| --- | --- | --- | --- |
| **G1** | 令牌不得自引用成环（**含带 fallback 的 `--x:var(--x,#fff)`**） | `ui-quiet-enterprise.ts` 源码守卫 4b / `findTokenCycles` | **M3a** `--probe:var(--probe)` 命中 1；**M3b** `--x:var(--x,#fff)` 命中 1（`--ink:var(--ink-muted)` 不误伤） |
| **G2** | `src/**/*.ts(x)` 内联色值 = 0（hex ∪ 函数式 `rgb\|hsl\|hwb\|lab\|lch\|oklab\|oklch\|color(`） | 源码守卫 4c / `INLINE_COLOR_RE` | **M4a** `#ff0000`+`rgba()` 命中 2；**M4b** `hsl()` 命中 1；**M4c** `oklch()` / `color()` 命中 1 |
| **G3** | 可见文本含「无来源评分」→ 违规（**并集口径**：关键词锚定整数 ∪ 裸小数，登记制） | `verify-ui-walkthrough.ts` R4 + 判定 §8 / `unsourcedScoreSamples` | **M5** 插「机会评分 **87.5** 分」变红；**M6** 插「机会评分 **88** 分」（整数）变红 |
| **G5** | 走查须进**弹窗态**重测 R1 溢出 / R2 点击区（D1 回归锁） | `visitModalState` | 把 `.modal-close` 改回 17×17 → 弹窗态 R2 变红 |
| **G6** | 四类检查分母（被检可点元素数 / 文本块数 / 图片数）必须 > 0，否则抛错（防「检查了 0 个元素」假绿） | `verify-ui-walkthrough.ts` + `inpage-probe.js` | 探针返回空 → 分母 0 → 失败 |
| **H1** | G6 豁免表元校验：豁免表键集合 === 登记清单 `VACUOUS_DENOM_REGISTERED=["images"]`，且每条 `reason` 非空 | `verify-ui-walkthrough.ts` `evaluateGuards()` | **M7** 往 `VACUOUS_DENOM_ALLOWED` 塞真实分母 → 变红 |
| **H2** | 服务器归属校验：**端口启动前空闲** + **监听进程 cwd == 本仓库根（物理路径）**；`acc-server.sh` 导出 `BASE_URL/UI_BASE_URL` 指向本轮端口；端口被占**明确失败不静默杀** | `acc-server.sh`（3180/3181）/ `ui-walk.sh`（3182） | 负向：外来进程占端口 → `acc-server.sh` **exit 3 且 0 套件**；非本仓 cwd 被拒；`ui-walk.sh` 侧 **exit 4** |
| 既有守卫 | **M1** 路线级 `loading.tsx` 不得回归（§6.10 D-019）；**M2** `/trace` 裸枚举泄漏不得回归 | `ui-feedback-layer.ts` 2b / 模块层文案守卫 | 既有 |

**H2 不用血统判据的理由**：`next start` 父进程常驻、`next dev` 会 **daemonize**（父 `$!` 退出、监听进程被 init 收养），血统（`$!` 后代）恒不成立；若以它为主判据会对 dev 场景**假拒绝**（另一种危险）。故血统**仅作打印佐证**，「端口启动前空闲 + cwd==本仓库」为确定性判据。

**本批交付的提交链（最终放行点 `41c0ac1`）**：

```
3552928  对齐 Quiet Enterprise 视觉系统（令牌层 / 壳层 / 四组机制 / 逐页落地）        ← 视觉基线
c302679  小屏电脑自适应（§10 rev2）——媒体阶梯下行 + 分档规则 + 点击区全档
ed34977  清理 52 个死 CSS 类 + 反转型类名契约 + 修 R4 误报
eb072cd  清理 9 个残留死类 + scanner --product-scope + 归档一次性脚本
20cfb76  /trace 审计文案裸枚举中文化 + 模块层文案守卫 + 历史行回填
eef999e  backfill 审计文案脚本加安全防护（默认 dry-run + 显式 --apply）
40c5df1  ui-walk 并发守卫改为识别『本仓 dev server』（/api/health 签名）
3ee006d  首页 h1 文案「现在的情况」→「工作总览」（方案 A · 消歧）
bbfc4e4  D1 弹窗关闭键命中区 17×17→28×28 并补 G1/G2/G3/G5/G6 守卫
41c0ac1  关 6 项残留 —— G6 豁免表元校验 + G3 收紧到整数 + G2 函数式色值 + G1 fallback + 端口归属校验/占用策略   ← 最终放行点
```

**已知残留 / 未覆盖（诚实登记，非「全绿」）**：

| 项 | 现状 | 局限 / 说明 |
| --- | --- | --- |
| **G2 · 具名色** | `color:"white"` 等具名色**可逃** | 不做正则（会误伤正文普通英文词如 "white"）；如需覆盖，应基于【受限上下文】（`style=` / 对象字面量 `color:` 键）做语法级解析，而非全仓文本正则 |
| **G6/H1 元校验** | 豁免表与断言**同文件** | 改两处即可绕过 —— 其作用是「让绕过必须留下**可见 diff**」，**非密码学封锁** |
| **信号层（console 错误）** | console 错误当前**只报告、不判定** | **可能掩盖真实缺陷**：某页签整页加载失败仍可 exit 0。QA 建议改为登记制（新 console 错误拒绝、已知漂移白名单）—— 本轮**未做**，登记为 TODO |
| **端口归属校验边界** | cwd=身份**被信任**；**真正的残余是 env/DB 不匹配** —— cwd 判据不约束 `DATABASE_URL` / `NODE_ENV`，复用「同源码但连不同库」的 dev 会在**错误数据面**上判绿 | **不存在「复用陈旧构建」风险**（原口径已更正）：`ui-walk.sh` 复用的一定是 `next dev`，按源码实时编译、不吃 `.next` 产物；`acc-server.sh` 走 `next start` 时**从不复用**（被占即 exit 3，永远自起自建）。血统**刻意排除**；端口冲突只是**移到 3180+，未根除** → 建议叠加**仓库 + env 唯一签名**或端口完全可配置 |
| **`COLOR_GUARD_EXCLUDE`** | `/advisor/` `/consultation/` `/api/conversations/` `/research/` 临时排除 | 因并行 agent 修改这些模块；**待其合入后应移除排除、重新纳入 G2**（守卫生效时会打印被排除文件清单） |
| **G4（`globals.css` 函数式色值）** | **已裁定不做**（非 TODO） | `globals.css` 是令牌定义文件，函数式色值（`oklch()` 等）可能是**合法令牌取值**；若引入须按「令牌值白名单」另议 |
| **双放行机制未统一** | **本批未做** | `GateType.PRODUCTION_GATE` 空门 + G1/G2 走 `DecisionPacket`、G3 走 `LaunchPlan` —— 两套放行机制**如实并列**，登记为「未统一」状态 |

**跨团队耦合（真实边界，如实记录）**：

1. **`globals.css` 工作区的他人改动**：并行 agent 在 `globals.css` 工作区追加了 **149 行** `.hermes-challenge-*`（含内联 hex）。我方色彩收敛守卫读的是**磁盘上的 `globals.css`** → **一旦对方那 149 行落盘，守卫会变红**（他们违反了同一契约）。本批提交经 `git diff --numstat` 实测为 **`149 0`**（纯增、零删），**未破坏对方任何字节**。
2. **`ui-feedback-layer` 对 `/consultation` 页的结构性依赖**：该套件（73 断言）依赖 `textarea.hermes-textarea`，其落点在 `src/app/advisor/advisor-client.tsx:396` 与 `src/app/consultation/consultation-client.tsx:176`；对方正在改该模块，期间我方回归**可能被动变红** —— **口径待用户裁定**（谁改谁保绿 / 或该套件不再覆盖 advisor 页）。**本轮未裁定，仅登记**。

**一条数据事实（非本批代码缺陷）**：走查中 **16 屏**被信号层标为「signaled」，全部为 `console: Failed to load resource: 422`，集中在 `/products/<id>?tab=analysis|version`。QA 定性：产品 `25c14092「AKG 半年套餐」` 的 `versions=0`（21 个产品中**唯一无版本**者，今日由并行 agent 写入共享 dev 库），两个页签都挂 `RevisionPanel` → `GET /revisions` → 按既有契约对非法域数据抛 422。正常创建必然建 v1（`products/service.ts:80`）。**零 `src/` 改动 → 非本批代码缺陷**，登记为「**共享库数据漂移**」，持续观察。

## 6. 本轮发现并处置的问题

### 6.1 `tests/acceptance-b01-http.ts` 存在两处**测试漂移**（已修）

`test:http` 在复验中失败，定位为**测试套件落后于已合入的安全与业务规则**，而非应用回归：

1. **登录断言漂移**：B6 修复后登录响应体**不再回传 `token`**（改为只走 httpOnly Cookie，防 XSS 窃取），但测试仍读 `res.json.token`，导致 1.3/1.6 级联失败。已改为从 `Set-Cookie` 提取真实令牌。
2. **证据夹具漂移**：P1-02 起服务端要求关键证据缺口闭合（`price` 必须有已核实 FACT）才放行建议包提交，但测试只传自由文本证据，导致 1.8 返回 422。已按 P1-01 断言规格补齐结构化 `price`/`salesVolume` FACT。

**处置原则**：修正测试以对齐**正确的**应用行为，未为了迁就旧测试而回退安全修复（遵守 CON-002）。

### 6.2 构建漂移（已处置 → 机制层面已于 §6.7 / D-014 根治）

`.next` 构建落后源码 42 个文件，已重建。当时以"每批开始前确认构建与源码一致"作为**人工纪律**记录。
该纪律在 §6.7 被证明**不可靠**（改源码不重建会假绿），现已改为由 `acc-server.sh` 按源码新鲜度**自动重建**。

### 6.3 测试漂移（本轮，已修）

B4 读口径由"需项目角色"改为"组织内可读"后，`acceptance-product-center.test.ts` 2.2 与 `authz-matrix.ts` 的 `products/{id}/revisions` 登记项同步更新（`403` → `200`）。同类修正遵循同一原则：改测试对齐已拍板的**正确**口径，而非为迁就旧断言放弃决策。

### 6.4 成本页首轮接线的口径缺陷（C-001–C-003，已修）

PC-1 首批把 `calcCost` 接到产品页时，首轮实现有三处**口径 / 样式**错误，本轮自查（对照引擎源码与契约）发现并修正：

| 编号 | 现象 | 处置 |
| --- | --- | --- |
| C-001 | 明细表把引擎的 **L6 月固定成本**（`layer6Allocation` = `monthlyFixed` 原值，**不是单件分摊**）当作单件成本列出，并把 L1–L5 之和标成「六层总成本」 | 单件成本表只列 **L1–L5**；L6 单列并注明「仅用于盈亏平衡，不计入单件成本」 |
| C-002 | 预算对照用了含渠道费的 `totalCost`（L1–L5） | `targetCost` 是**产品成本上限**口径（契约「成本口径」；由竞品价扣佣金/售后反推），改对照 **BOM 成本（L1–L4）** |
| C-003 | 引用了不存在的 CSS 类 `hermes-row-strong`；`hermes-note.is-alert` 亦无对应规则 | 新增 `.hermes-table tbody tr.is-sum` 与 `.hermes-note.is-alert` 两条规则 |

新增回归：`tests/cost-calculator.test.ts` 第 4 例锁定「L6 不计入单件总成本」。

### 6.5 D-010：审核提示按 `createdAt` 取「最新批次」不可靠（已修）

**发现方式**：独立重跑 `tests/ui-b01-evidence.ts` 得到 **9/13**（§10 记为 13/13，未复现）；截图显示审核块标题为「**第 1 批**审核提示」，而夹具最新批次是 attempt 2。

**根因**：`PROJECT_DETAIL_SELECT` 的 `workItems.submissions` 原按 `createdAt: "desc"` 排序。`createdAt` 为**毫秒精度**，同一工作项内连续两次提交可能落在同一毫秒 → 排序平局 → 取到**上一批**。后果不止标题号错：`carried` 以 `ap.submissionId === latestSubmission.id` 过滤，取错批次会使**整块「沿用成果 / 尚未确认」提示不渲染** —— 正是 B01-03 要交付的内容。

**修复**：改为 `orderBy: { attempt: "desc" }`（`attempt` 是批次序号，确定且语义正确）。SSR 与 API 共用同一白名单，一处即两处。

**验证**：修复后 `ui-b01-evidence` **13/13**；截图确认标题为「第 2 批审核提示」并呈现「沿用成果（未重新生成）：MARKET_RESEARCH_REPORT v1，原始输入基线 r2 → 适用于当前基线 r3（待负责人确认）」。同时 `product-center` 33/33、`b01-http` 52/52、`authz` 465/465 均未回归。

### 6.6 D-011 / D-012：把「调用方发错了」误报成「服务端崩了」（已修）

`src/shared/api-handler.ts` 的 `handleApiError` 把**任何非 `AppError`** 一律映射成 **500**，于是两类**纯属调用方载荷问题**的错误被报成服务端崩溃：

| 编号 | 触发 | 处置 |
| --- | --- | --- |
| D-011 | 写路由 `await req.json()` 收到**空 body / 非法 JSON** → 原生 `SyntaxError`（"Unexpected end of JSON input" 等） | 中央映射为 **400 `INVALID_JSON`**，判定**刻意收窄**：只认 message 含 `json` 的 `SyntaxError`，业务里其它来源的 `SyntaxError` 仍走 500 |
| D-012 | 缺必填字段 / 类型不符冒到 Prisma → `PrismaClientValidationError` | 中央映射为 **422 `UNPROCESSABLE_ENTITY`**（`instanceof` + `error.name` 兜底） |

**为什么用中央映射而不是逐条补校验**：两类缺陷成因在**框架/ORM 层**，逐条补必然漏（本批证明：上一轮只补了 3 条，仍有 21 条裸露）。中央映射一次覆盖全部 21 条，且**只做 5xx → 4xx 收敛**，`AppError` 分支与 500 兜底的语义逐字未变。

**生产不泄漏**（端到端实测，非仅单测）：生产模式下发畸形 JSON 得到
`400 {"code":"INVALID_JSON","message":"Request body is not valid JSON","requestId":"…"}`；
关键字 `prisma:error` / `SyntaxError` / `Unexpected` / `/Users/` / `node_modules` / `at Object` **0 命中**。

**回归护栏**：`tests/acceptance-authz-matrix.test.ts` 新增 **F 段**（"场景 8"），自动枚举矩阵中 `method !== "GET"` 的条目、**按方法切分函数体**读源码判定该方法是否解析 JSON（避开"同文件另一个方法读了 body 就误判"——实测 `DELETE /api/auth/session` 正是如此），对"裸解析"路由各发两种畸形载荷，断言 `< 500` 且**非法 JSON 不得得到 2xx**。新增路由未登记仍会判失败（既有机制）。

### 6.7 D-014：「改了源码但没重建」会导致验收**假绿**（已修，本批最危险的一条）

**发现方式**：验证回归锁"是否会红"时，把修复注释掉后矩阵**仍报 529 全绿**。原因是 `scripts/acc-server.sh` 只在 `.next/BUILD_ID` **缺失**时才构建，而 `next start` 服务的是 `.next` **构建产物而非源码** —— 于是改源码不重建时，验收跑的是**旧代码**。

**危害高于缺陷本身**：失败会让人去查问题，假绿会让人得出**与事实相反**的结论。本仓此前所有"改源码 → 跑验收 → 全绿"的记录都受此威胁（§6.2 曾手工记过一次"`.next` 落后源码 42 个文件"，当时只作为一次偶发处理，未识别为机制问题）。

**修复**：`acc-server.sh` 增加**源码新鲜度判定** —— `BUILD_ID` 缺失，**或**任一被监视源文件（`src` / `prisma` / `package.json` / `tsconfig.json` / `next.config.*`，按源码类后缀）比 `BUILD_ID` 新 → 自动重建。已实测：`touch src/shared/api-handler.ts` 后运行，打印「需要重新构建：源码比构建产物新（例：src/shared/api-handler.ts）」且 `BUILD_ID` 变化（`haLCKDyo…` → `-WjZWlbH…`），套件在真实重建产物上通过。

**顺带纠正一处错误归因**：构建行的 `NODE_ENV=production` 是**必要**的，但机制极易判错。实测四场景：

| 场景 | 结果 |
| --- | --- |
| 裸跑 `next build`（不导出 NODE_ENV），保留/清空 `.next` | 均 **exit 0**（Next 内部强制 production，且不采用 `.env` 里的 NODE_ENV） |
| **导出** `NODE_ENV=development`（`set -a; . ./.env`，即本脚本第 28 行的做法） | **exit 1**，报 `<Html> should not be imported outside of pages/_document`（×2） |
| `NODE_ENV=production` | exit 0 |

因此"我手动单独构建一次是好的"**不能**证明该 pin 多余；失败只在变量被**导出进进程环境**时发生。曾有一版注释据裸跑得出"该失败无法复现"并改写成"加固"，**该结论是错的**，已按上表订正。

### 6.8 D-013 / D-016：`req.json().catch(() => ({}))` 的静默容错（**上一批判为"非缺陷"——该判断已更正**）

**14 处 / 13 个文件**的写路由用 `await req.json().catch(() => ({}))`：畸形 JSON 被**吞掉**当作空 body 继续执行。实测 `POST /api/conversations` 发畸形 JSON → **HTTP 201 并真的建立 1 条会话**（探测后已清理，残留 0）。

**⚠️ 判断更正（2026-09-16 第二批）**：上一批的结论是「**可接受的设计取舍，非缺陷**」，并给 F 段加了"只登记不探测"的处理。**该判断是错的**，理由：

- 上一批只看了 `conversations`（危害确实温和：标题丢默认值后仍建会话），**因此把整类判成了非缺陷**。但同类写法在 `POST /api/evidences/{id}/verify` 上是**实打实的 fail-open**：
  ```ts
  const body = await req.json().catch(() => ({}));
  const newStatus = body.status === "REJECTED" ? REJECTED : VERIFIED;  // 条件不成立 → 通过
  ```
  调用方本意「**驳回**证据」，body 一旦畸形就被当作空 body → **执行成"通过"并写 `EVIDENCE_VERIFIED` 审计事件**。证据核实是 G4 打样门槛的前置。实测修复前：畸形 JSON → **200**、证据 `UNVERIFIED→VERIFIED`、审计 **0→1**。
- **根因是"只登记不探测"**：既然不探测，就永远看不到那 13 个站点各自的真实后果，于是用一个温和样本推断了一整类。**这一条与 §6.7（假绿）、D-014 是同一类错误：验证方式本身挡住了事实。**

**✅ 已修复**：统一改用 `readJsonObjectBody`（三态语义见契约 §2.5：空 body → `{}`、畸形 → 400、非对象 → 422），14 处全部替换，全仓 `req.json().catch` 已清零。矩阵 F 段新增**守卫断言 `caught === 0`** 防复发；`http-errors` 乙段做 fail-open 反向回归（畸形 body 后证据仍 `UNVERIFIED`、审计 0→0）。修复后：畸形 → **400**；body `null` → **422**（修复前 500）；body `[]` → **422**（修复前 200）。

### 6.9 D-017 / D-018：缺必填字段冒到**原生 `TypeError`** → 500（同一主题，两种形态）

**D-017（静态扫描发现）**：`products/service.ts` 的 `createProduct` 只校验 `name`/`identityCode`，却直接 `params.targetAudience.trim()` → 缺 `targetAudience`/`marketPath`/`devMode` 即 500。是 D-008 的同类尾巴，只是抛错方从 Prisma 换成原生 TypeError。已按其同文件 `createDevelopmentProduct` 的既有范式修复（收集缺失项 → 一次 422 点名字段）。

**D-018（实证穷举发现）**：`POST /api/projects/{id}/decision-packets` 发 `{}` 或部分 body → **500**，栈为 `a.artifactVersions is not iterable`。根因在 `scope-hash.ts` 的 `[...input.artifactVersions]`：**数组迭代未兜底**，与 D-017 的"属性上调用方法"是**不同形态**。

**⚠️ 这一条推翻了本批的一个中间结论**：领队与工程师都曾用静态正则（`params\.[a-zA-Z_]+\.`）扫出"只有 `createProduct` 一处裸点"，并把 D-017 的面报成 1 条。QA 改用**实证穷举**（39 条写路由发 `{}` + 10 条部分 body = 50 条探测）才撞出 D-018。**静态扫描对"数组迭代未兜底"天然失明**。已确立判据：**声称某类缺陷已穷尽，必须给出实证穷举的覆盖数**。

**✅ 已修复**：① 服务层边界校验（`Array.isArray` 判定缺省与错类型 → 422 点名字段，**允许空数组**——空范围是否该被业务允许是另一问题，本批不改）；② `computeScopeHash` 开头加不变量守卫，**刻意响亮失败而非静默当 `[]`**：静默兜底会产出"覆盖空范围"的指纹，而 `scopeHash` 是批准有效性的绑定依据，指纹错了会让批准被错误复用。反向回归：`http-errors` 丁段。

**共享面已实测**：`computeScopeHash` 另被两处**读路径**共用（`projects/service.ts:179`、`decisions/service.ts:481`）。开发库（1 行）与测试库（25 行）**均无** NULL 或非数组的存量行；且即便有，此前也是 `[...null]` 抛 TypeError → 500（若值是字符串则 `[..."abc"]` 会静默按字符迭代出**错误指纹**）→ 现在 422，属改善而非回归。

### 6.10 D-019 / D-020：表现层改造引入的回归（本批唯一真回归，**由领队规格造成**）

#### D-019：根 `src/app/loading.tsx` 破坏 `notFound()` 的 404 与 `redirect()` 的时序（**已修，已上锁**）

**怎么被发现的**：这道题**不是自验发现的**。波 1 交付时工程师的浏览器目视与 `ui-b01-evidence` 都是绿的；是 QA 按"每批必须对标全量基线"的纪律跑全部八套，才暴露 **`acceptance-product-center` 33→32**、**`ui-b01-evidence` 13→11**。

**机制**（本节最该记住的一条）：App Router 中一段路由只要有了 `loading.tsx`，该段就走流式渲染 —— **响应头 200 在页面渲染完成前就已发出**，于是：

1. 页面内后置的 `notFound()` **只能改渲染内容、改不了状态码** → 断言 `acceptance-product-center.test.ts:4.18`（要求 `outsiderSsr.status === 404`）实拿 **200**。该断言的注释早就写明「页面 notFound 404 / 接口 403」，是硬验收项。全仓 `notFound()` 只在 `projects/[id]/page.tsx:42,47` 两处。
2. `redirect("/login")` 被推迟到 hydrate 之后 → `ui-b01-evidence.ts:247-250` 在 `domcontentloaded` 与 `reload()` 之后取 URL，拿不到 `/login`。全仓 **13 个源文件**含 `redirect("/login")`（几乎每个受保护页）。

**隔离实验（QA 做，我采信）**：移除两个 `loading.tsx` → 33+13 全绿；只留 `login/loading.tsx` → 33+13 全绿；恢复根 `loading.tsx` → 32+11 复现。**根因钉死。**

**✅ 已修**：删除 `src/app/loading.tsx` 与 `src/app/login/loading.tsx`；同一 UX 目标（点侧栏导航后零反馈）改由**纯客户端**顶部进度条承担（`components/nav-progress.tsx`，模块级 store + `useSyncExternalStore`，`getServerSnapshot` 恒 `false`，`usePathname` 变化即熄灭 + 8s 超时兜底）。**未动 `notFound()`、未动任何鉴权代码** —— 404 是靠删掉根 loading 恢复的，不是放宽逻辑换来的。死代码（`.hermes-skeleton` / `.hermes-skel-*`）同步清除。

**✅ 已上锁，且锁被证明会红**：`tests/ui-feedback-layer.ts` 守卫 2b 断言 `src/app/**` 下 `loading.tsx` **数量为 0**（`walk()` 递归，覆盖任意层级，因此比"只点名根位点"更强）+ 两个历史位点不存在。断言文案内嵌后果与动态算出的 `redirect` 文件数，背离时红色信息自带解释。

- **会红验证（两个方向，均实测后原样恢复）**：放回最小根 `loading.tsx` → **2 项红**，报错指认 `src/app/loading.tsx`，而 `login` 位点那条**正确地保持绿**（定位精准）；移出后 **73/73** 全绿。
- **后果复验（把"锁红"与"业务坏"连起来）**：同一跑里 `acceptance-product-center` = **32/33**，唯一失败即 4.18（HTTP 200）；移出后回到 **33/33**。**守卫红 ⟺ 业务坏，两头都有实测**，不是推断。
- 附带证据（工程师侧独立撞出同一现象）：他一次构建时该探针仍在盘上，同样得 32/33、唯一失败 4.18。两条独立路径互相印证。

#### D-020：`error.tsx` 的「重试」对服务端错误无效（**已修，已实证**）

**现象**：触发服务端错误时错误页正常出现（200 + digest），但**点「重试」不产生任何新请求、内容不恢复** —— 即"重试"是个假按钮。

**根因**：`reset()` 只重新渲染当前**客户端**子树，服务端组件的数据不会重新取。

**✅ 已修**：`startTransition(() => { router.refresh(); reset(); })`，并用 `useTransition` 承接 pending（按钮 `disabled` + `aria-busy` + 「重试中…」防连点）。

**✅ 已实证**：工程师用磁盘标记探针触发错误页 → 移除标记后点重试 → `/probe-error` 请求数 **1→2**（真的新增一次服务端请求）且内容恢复为「探针恢复成功」。这直接推翻了缺陷报告期的现象。**注意：QA 报告缺陷、工程师证明已修，两条独立证据互相印证，该缺陷才算闭环。**

**本批的方法学补充**：QA 初次为此项**降级成源码守卫**（只断言 `reset()` 接在重试上）。**这类降级会掩盖缺陷** —— 源码里"接上了"不等于"点下去有用"。凡"用户点一下应该有反应"的行为，判据必须是**运行时真点 + 观察外部可见变化（请求数 / DOM / 状态）**，不能用"源码存在"替代。

#### 顺带登记的两条环境性事实（非缺陷，但会制造假结论）

1. **`tests/**` 会被 `next build` 一起编译**：`tsconfig.json` 的 `include` 含 `**/*.ts`。本批中 QA 的锁文件引用了刚被删除的 `src/app/loading` 模块 → **不只是该测试变红，`next build` 直接 exit 1**，连带把 `acc-server.sh` 与全部服务级套件卡死。**故锁文件引用被测模块时必须谨慎；本批已要求改用 `fs` 源码文本断言（不 import 路由模块），从机制上断开这条耦合。**
2. **`next dev` 与 `acc-server` 共用同一个 `.next` 目录**：并行会互相踩出 `ENOENT: mkdir .next/server/app`。跑基线前必须停 dev，或给 dev 配独立 `distDir`。
3. **`acc-server.sh` 是单占资源**：脚本开头 `kill 3110 3111`，两路并发必然互杀（本批实际发生一次，白跑一轮），且共用测试库。**同一时刻只允许一路。**

## 7. PC-0 放行判定

对照路线图放行条件：

| 放行条件 | 判定 | 说明 |
| --- | --- | --- |
| TASK-001–004 有交付 | ✅ **已交付** | TASK-001 本文；TASK-003 `docs/contracts/PRODUCT_CENTER_CONTRACTS.md`；TASK-004 `ACCEPTANCE.md`；TASK-002 登记表已交付、待业务填写 |
| 模型将接触的读取与写入路径无未关闭安全阻断 | ✅ **已满足** | B1/B2/B3/B5 已修并验证；B6 残余已闭合；**B8 穷举矩阵 558 断言 × 两遍全绿**；**B4 读口径已拍板并实施**（组织内可读）；**B7 已建成最小 `OrganizationMember`**，自举路径已断（场景 5）。**零未关闭安全阻断** |
| 版本与幂等关键回归通过 | ✅ 通过 | 版本一致性、局部修订、幂等重放/冲突、隔离夹具、信号组织隔离全部全绿 |
| TASK-002 至少明确试点、负责人、决策人和可用资料 | ❌ **未满足** | 需业务负责人提供，见 `PILOT_BRIEF.md` |

**结论：PC-0 的工程侧（TASK-001 / 003 / 004）与安全侧（B1–B8 及 Final Security Patch）已全部收口，无未关闭安全阻断；仅业务侧（TASK-002）待输入 —— 这是 PC-0 唯一的放行阻塞。**

按 2026-09-15 拍板，**Final Security Patch 完成后即停止一切工程底座建设**，不再新增架构性改动。PC-0 剩余事项只有两项，且都来自业务侧：

1. **一个真实进行中的产品**（不是为验收临时造的产品）
2. **真实模型端点、`modelId` 与费用口径**

**需要业务方回答的事项（不阻塞文档，但阻塞对应放行）**：

1. 试点产品、品牌、地区、销售路径与主要渠道（TASK-002）
2. 项目日常负责人、决策人、专业确认资源（TASK-002）
3. 可用模型端点、真实 `modelId`、费用口径（决定 PC-1 Batch B 能否做真实智能验收）

**已不需要业务方回答的事项（本轮拍板，从待办移除）**：

- ~~产品读可见范围（B4）~~ → 已定：组织内可读，写按项目角色
- ~~是否新建组织级角色模型（B7）~~ → 已定：建最小 `OrganizationMember`，不建 HR 体系
- ~~是否提前引入独立 Worker / 队列运行时~~ → 已定：**延期**，PC-0 不做 TASK-020
