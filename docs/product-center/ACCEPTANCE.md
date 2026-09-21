---
title: 产品中心验收记录（PC-0 批次）
version: "1.8"
status: 本批次已执行；结论见文末（v1.8：追加「Quiet Enterprise 视觉迁移」批次 §15，含点击区口径裁定 + G1/G2/G3/G5/G6/H1/H2 守卫，2026-09-18）
date: 2026-09-18
owner: 实施/验收负责人
task: TASK-004（PC-0）
---

# 产品中心验收记录

> 记录方式遵循 TEST-010：写**逐项实测结果**，不手填"全绿"。每项含命令、范围、时间、证据与限制。
> 工程验收与真实业务验收**分开**记录（`docs/产品愿景.md` §9）。本批次**没有**真实业务验收。
>
> **本文件按批次追加。** §4 为 PC-0 初验批次（2026-09-15），§9 为 Final Security Patch 批次（2026-09-16），§10 为验证可信度批次（D-008/D-009，2026-09-16），§11 为 PC-1 首批批次（成本页接线 + D-010 + 对 §10 的独立复核，2026-09-16），§12 为写路由入参健壮性收口（D-011/D-012/D-013/D-014），§13 为调用方错误中央收口（D-015/D-016/D-017/D-018），§14 为前端交互反馈层批次（含 P0 回归 D-019 / D-020，2026-09-17），§15 为 Quiet Enterprise 视觉迁移批次（点击区口径裁定 + G1/G2/G3/G5/G6/H1/H2 守卫，2026-09-17/18）。
>
> **当前有效数字以 §15 为准**（§4/§9/§10/§14 的数字是各自批次的历史记录，未回改）。

## 1. 本批次目标

PC-0 / TASK-004：针对身份与权限、版本一致性、幂等与失败恢复做回归，并建立产品中心的安全与版本验收用例。

范围限定为**只修复本次仍可复现的问题**（不按旧任务书重复修复）。

## 2. 基线与环境

| 项目 | 值 |
| --- | --- |
| Git HEAD | `7ce88af0cb705932349a1b99733ff4cdbe591de7`（branch `main`） |
| 工作区 | 111 条未提交变更（`hermes-next/` 内 92 条）；本批次**不重置、不覆盖**任何无关变更 |
| 生产构建 | 复验前构建落后源码 42 个文件，已 `next build` 重建（BUILD_ID 更新）；本批次每次 HTTP 验收前均重建 |
| 数据库 | 开发库 `hermes_next_dev`（hermes_app / 41 表）；测试库 `hermes_next_test`（hermes_test / 41 表）；PostgreSQL 17.10 @ 5433 |
| 隔离校验 | 每套测试启动时三层校验；第三层用测试账号实际连开发库，实测被拒（`User does not have CONNECT privilege.`） |
| 运行方式 | 服务级测试：`./node_modules/.bin/tsx scripts/run-test.ts <file>`；HTTP 测试另需生产服务：`NODE_ENV=production DEV_MOCK_AUTH=false DATABASE_URL=$TEST_DATABASE_URL next start -p 3110` |
| 执行时间 | 初验批次 2026-09-15 22:38–22:52；安全补丁批次 2026-09-16（GMT+8） |
| 环境注意 | 本机代理会劫持 localhost，`curl` 需 `--noproxy '*'`；宿主 `NODE_OPTIONS` 需清空 |

## 3. 本批次改动（初验批次，2026-09-15）

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `tests/acceptance-b01-http.ts` | 修改 | 修复两处测试漂移（见 §5）。**未回退任何安全修复** |
| `tests/acceptance-product-center.test.ts` | 新增 | 产品中心安全与版本验收用例（**33 断言 / 4 场景**，走真实 HTTP） |
| `tests/authz-matrix.ts` | 新增 | 43 路由 / 60 方法的权限矩阵登记表（含 `validationFirst` 与 `ownerGate` 标记） |
| `tests/acceptance-authz-matrix.test.ts` | 新增 | 表驱动穷举越权回归 |
| `src/modules/projects/project-view.ts` | 新增 | 项目详情下发字段白名单唯一来源（B6 收尾） |
| `src/modules/projects/service.ts` | 修改 | `getProjectDetail` 由 `include` 改 `select`；批准漂移检查改独立 `findFirst`；返回前剥离 `members` |
| `src/app/projects/[id]/page.tsx` | 修改 | 改用 `PROJECT_DETAIL_SELECT`；成员列表仅在 `mockAuth` 时查询 |
| `package.json` | 修改 | 新增 `test:product-center`、`test:authz` 入口 |
| `docs/contracts/PRODUCT_CENTER_CONTRACTS.md` | 新增 | TASK-003 业务契约（九类成果映射、G0–G3、失效关系） |
| `docs/product-center/CAPABILITY_BASELINE.md` | 新增 | TASK-001 能力基线台账 |
| `docs/product-center/PILOT_BRIEF.md` | 新增 | TASK-002 试点登记表（待业务填写） |
| `docs/product-center/ACCEPTANCE.md` | 新增 | 本文件 |
| `.next/` | 重新生成 | 生产构建重建（生成目录） |

**未改动**：业务源码、Prisma schema、迁移、凭证、部署配置。

## 4. 逐项执行结果（初验批次，2026-09-15）

### 4.1 服务级回归（测试库，夹具自建自清）

| # | 命令（`run-test.ts` 后接） | 范围 | 结果 |
| --- | --- | --- | --- |
| 1 | `tests/db-transaction-verification.ts` | PostgreSQL 连接、隔离校验、多实体事务原子性、失败回滚、幂等键重放与冲突 | ✅ 通过 |
| 2 | `tests/regression-revision-consistency.ts` | 旧产品版本/旧成果引用阻断（409）、未审成果阻断（422）、确认后放行、重复提交不产生新记录 | ✅ 通过（A1–A4 / D1–D4） |
| 3 | `tests/regression-partial-revision.ts` | 局部修订三类场景 × 五项断言、历史批次与成果完整保留、重复提交 | ✅ 通过 |
| 4 | `tests/regression-evidence-structure.ts` | 断言规范化（价格缺单位/机制被拒）、仅已核实 FACT 入选、缺口保持 UNKNOWN | ✅ 通过 |
| 5 | `tests/regression-opportunity.ts` | 无证据→PENDING、核实后→FOLLOW_HIT、缺销量不判爆品、八要素三态分列 | ✅ 通过 |
| 6 | `tests/regression-fixture-isolation.ts` | 连续两次运行夹具自清、哨兵数据不被破坏 | ✅ 通过 |
| 7 | `tests/acceptance-a01-a12.test.ts` | A01–A12：含指纹变动触发 409、迟到输入不覆盖、DEMO 证据不得进 REAL 决策、崩溃回滚、生产禁用 mock auth | ✅ 通过（12/12） |
| 8 | `tests/acceptance-p1.test.ts` | 需求语义解析、确定性六层成本、A/B/C 路线选型、建议包→不可变版本→打样门 | ✅ 通过 |
| 9 | `tests/acceptance-blueprint-journey.test.ts` | 十项发布门槛，含多租户穿透拦截、AgentRun 留痕、费用未知标 unknown | ✅ 通过 |
| 10 | `tests/acceptance-b01-r1.test.ts` | R07 严格门禁、R08 固定产品版本绑定与租户隔离、R09 提交批次化 | ✅ 通过 |
| 11 | `tests/review-r2-probes.ts` | 未认证生产登录、需求变更后快照过期、空证据研究 | ✅ 通过 |
| 12 | `tests/review-r3-probes.ts` | 未知价格保持 null、幂等复用、未确认假设阻断、正向业务流 | ✅ 通过 |
| 13 | `tests/review-version-consistency.ts` | 版本一致性探针（输出为缺口阻断提示） | ✅ 退出码 0 |

### 4.2 HTTP 层（生产模式服务 + 测试库）

| # | 套件 | 范围 | 结果 |
| --- | --- | --- | --- |
| 14 | `tests/acceptance-b01-http.ts` | 52 断言 / 8 场景：登录与会话、成果提交与打样批准、仅改规格重审与适用性、旧决策包阻断、协作者权限边界、重复提交与同键冲突、跨组织与无凭证、登出后失效（含 cookie-only 与 bearer-only 双通道） | ✅ **52/52 通过**（修复测试漂移后） |
| 15 | `tests/acceptance-product-center.test.ts` | **33 断言 / 4 场景**：① 产品写路径角色与组织边界 ② 读路径与遗留产品语义 ③ 版本不可变与批准/执行分离 ④ **项目详情下发字段白名单**（Artifact/RunReceipt/WorkSubmission/ArtifactApplicability/DecisionPacket/Feedback 各埋 `should-not-leak` 标记，断言不下发） | ✅ **33/33 通过** |
| 16 | `tests/acceptance-authz-matrix.test.ts` | **434 断言**：43 路由 / 60 方法穷举。① 登记覆盖（文件系统有而未登记 → 失败；已消失登记项 → 失败）② 逐格状态码（anon / 跨组织 / 同组织非成员 / 有权）③ 跨租户 2xx 响应体不得含他组织夹具标记 ④ 内部字段不得下发 ⑤ **零写入断言** | ✅ **434/434 通过，连续两次复跑一致** |

### 4.3 构建与类型

| # | 命令 | 结果 |
| --- | --- | --- |
| 17 | `tsc --noEmit` | ✅ 无错误 |
| 18 | `next build` | ✅ 成功（14s，无错误） |

### 4.4 授权边界实测明细（套件 15）

> 下表为**初验批次**实测值。B4 读口径在 2026-09-15 拍板为"组织内可读"后，"组织内非成员读产品修订"一格已在 §9 更新为 200。

| 断言 | 期望 | 实测 |
| --- | --- | --- |
| 产品 OWNER 发布版本 | 201 | 201 ✅ |
| VIEWER 发布版本 | 403 | 403 ✅ |
| 组织内非成员发布版本 | 403 | 403 ✅ |
| 跨组织发布版本（且不泄露存在性） | 404 | 404 ✅ |
| 无凭证发布版本 | 401 | 401 ✅ |
| 不存在的产品 id | 404（与跨组织同码） | 404 ✅ |
| VIEWER 读产品修订 | 200 | 200 ✅ |
| 组织内非成员读产品修订 | 403 → **200**（B4 新口径） | 见 §9.4 |
| 无项目遗留产品的非管理员写入 | 403 | 403 ✅ |
| 版本落库即 `isImmutable=true` | true | true ✅ |
| 发布不等于业务确认（`isConfirmed=false`） | false | false ✅ |

## 5. 初验批次失败项与处置

开始时套件 14（`test:http`）**失败**，逐项定位后确认为**测试套件漂移**，不是应用回归：

| 现象 | 根因 | 处置 |
| --- | --- | --- |
| 1.3 登录断言失败、1.6 级联 401 | B6 修复后登录响应体按设计**不再回传 `token`**（改走 httpOnly Cookie 防 XSS 窃取），测试仍读 `res.json.token` | 改为从 `Set-Cookie` 提取真实令牌；保留"响应体不含 token"这一断言 |
| 1.8 提交建议包返回 422 | P1-02 起服务端要求关键证据缺口闭合（`price` 须有已核实 FACT）才放行，测试只传自由文本证据 | 按 P1-01 断言规格补齐结构化 `price` / `salesVolume` FACT，并带单位与计价机制 |

**处置原则**：对齐**正确的**应用行为，不为了迁就旧测试而回退安全与业务规则（遵守 CON-002）。修复后套件 14 全绿。

## 6. 未执行项

| 项 | 原因 | 影响 |
| --- | --- | --- |
| `tests/ui-b01-evidence.ts`（Playwright 浏览器验收） | 本批次未执行 UI 层 | 浏览器交互（新建、刷新恢复、窄屏、空/失败/无权限态）本轮**无证据** |
| 真实模型调用与专业质量评审（TEST-007） | 无模型客户端、无端点、无费用配置 | PC-1 Batch B 的真实智能验收**不具备条件** |
| 真实业务验收（TEST-008） | 无真实试点资料 | 业务侧全部未开始 |
| ~~B8 表驱动越权矩阵~~ | **已实施** → 见套件 16（后扩至 455） | — |

## 7. 限制与说明

1. 本批次的"运行已验证"**仅代表工程侧行为**，不代表任何产品已可生产、上市或具备商业结论。
2. 测试使用**合成夹具**（带 `RUN_TAG` 前缀），自建自清理，不做无范围清库；不代表真实业务数据通过验证。
3. 套件 14/15/16 的断言基于**当前未提交的工作区代码**（HEAD `7ce88af` + 未提交变更）。提交后如需以提交点复验，应重跑并更新本文。
4. `review-version-consistency.ts` 的退出码为 0，但其输出是缺口阻断提示（探针语义），不宜简单读作"通过"。
5. 部分"文档说谎"条目（#2、#7、#8、#9）本批次未复验，见 `CAPABILITY_BASELINE.md` §4。

## 8. 结论（初验批次）

| 放行条件（PC-0 技术侧） | 结论 |
| --- | --- |
| 版本与幂等关键回归通过 | ✅ **具备**。版本一致性、局部修订、幂等重放/冲突、隔离夹具全绿 |
| 模型将接触的读/写路径无未关闭安全阻断 | ⚠️ **初验时仍有条件具备** → 已在 §9 补丁批次收口为 ✅ |
| 工程可用性 | ✅ 类型检查与生产构建均通过 |

**本批次（TASK-004）判定为：工程侧完成，业务侧未开始。**

### 8.1 套件 16 顺带实测登记的三项缺陷（初验时状态：已登记，未修）

> **本节为历史快照。三项缺陷在 §9 补丁批次已处置，其中 D-002/D-003 已修复、D-001 转为工程债。**

| 编号 | 现象 | 影响 |
| --- | --- | --- |
| D-001 | `Product.identityCode` 为**全局唯一** → 跨组织同名返回 **500**（应 409） | 组织 B 无法建与组织 A 同名的产品。→ **§9.6 定为工程债，方向映射 409** |
| D-002 | 手工 `SignalItem` 的 `hash` 只按 `sourceKey + title` 计算、唯一约束也是全局 → 跨组织同标题返回 **422**「该信号已属于其他组织」 | **泄露他组织存在性**。→ **§9.2 已修复** |
| D-003 | `isOrgAdmin` 近似为"本组织任一项目 `OWNER`" → 成员创建项目即自升管理员，可读知识来源配置（含服务器 `rootPath`） | = B7，需业务拍板。→ **§9.1 已修复** |

---

# PC-0 Final Security Patch 批次（2026-09-16）

## 9. 本批次目标与范围

按 2026-09-15 业务方拍板，PC-0 以一次**收尾安全补丁**结项。本批次**只做已批准的五件事**，不做架构性扩张：

| 序 | 事项 | 拍板依据 |
| --- | --- | --- |
| 1 | 建**最小** `OrganizationMember`，修复"建项目即自升组织管理员" | B7 决策：建最小组织成员模型，`isOrgAdmin` 只看该表；**不建 HR 体系** |
| 2 | `SignalItem` 唯一性加入组织范围，消灭跨组织存在性泄漏 | D-002 决策：**必须在 PC-1 之前修** |
| 3 | B8 矩阵补反向回归（自举 + 跨组织泄漏） | B8 决策：新增能力要有反向回归，不能只靠正向矩阵 |
| 4 | 修全景 PDF §7.3 两处陈旧状态 | 文档漂移修正 |
| 5 | Artifact 落地**已批准**的三项字段（走增量 migration） | I-001/I-002/I-003 已批准；其余未指定字段**不猜** |

**B4 读口径同步落地**：产品读权限定为**组织内可读**（写权限继续按项目角色控制）——理由是 Hermes 是公司内部产品中心，不是对外客户隔离的 SaaS；不为此把读路径全部项目化。

**本批次之后，PC-0 停止一切工程底座建设。** 剩余只有业务侧两项：真实进行中的产品、真实模型端点。

## 9.1 事项 1：最小组织成员模型（修 D-003）

**方案**：新增 `enum OrgRole { ORG_ADMIN, MEMBER }` 与 `OrganizationMember(organizationId, userId, role, createdAt)`，唯一键 `[organizationId, userId]`。
`isOrgAdmin()` 重写为**只**查 `OrganizationMember.role === ORG_ADMIN`，删除"任一项目 OWNER"兜底路径。`ProjectMember` 继续管产品/项目角色，两者职责不混。

**明确不建**：部门、职位、汇报线、职级 —— 无 HR 系统。

**存量数据回填**：把迁移前满足旧 `isOrgAdmin` 口径的人一次性映射为 `ORG_ADMIN`（不让人平白丢能力），其余为 `MEMBER`；并保证每个组织至少 1 名 `ORG_ADMIN`。**这是数据快照，不是运行时规则** —— 若写成运行时规则，等于把"建项目 ⇒ 变管理员"的自举路径原样留下，正是本次要修的洞。

实测（dev 库）：`OrganizationMember` 4 行，`ORG_ADMIN` 2 / `MEMBER` 2。

## 9.2 事项 2：信号唯一性加入组织范围（修 D-002）

- 唯一约束由全局 `[sourceKey, hash]` 改为 `[organizationId, sourceKey, hash]`。
- 删除 `createManualSignal` 中「该信号已属于其他组织」分支（该措辞本身就是存在性泄漏，等于告诉他组织"这个标题有人录过"）。
- 改为 `findFirst({ organizationId, sourceKey, hash })` 做组织内幂等；冲突时按 `P2002` 返回既有行（幂等），不再跨组织比对。
- 顺带关闭一处**潜在跨租户读**：`listSignalItems` 增加 `organizationId` 过滤；`packageSignalToEvidence` 的 `findFirst` 补 `organizationId`。

## 9.3 事项 3：B8 补反向回归

新增两个场景（session 已在早前段落登出，故场景内**重新登录**）：

- **场景 5 · org-admin 自举回归（D-003，9 项断言）**：5.1 无成员记录时读知识源 403 → 5.2 可创建自己的项目 201 → 5.4 在自建项目内确为 `OWNER`（**这正是修复前的自举前提**）→ **5.5 成为 OWNER 后仍读不到知识源配置 403**、**5.7 仍不能写公司事实 403**、5.8 自建项目**未**产生 `OrganizationMember` 记录 → 5.9 反向对照：真正的 `ORG_ADMIN` 可读 200。
- **场景 6 · 跨组织信号存在性不泄漏（D-002，10 项断言）**：6.1 组织 A 录同标题 201 → **6.2 组织 B 录同一标题同样 201** → 6.3 响应中不再出现泄漏措辞、6.4 不含他组织标识、6.5/6.6 两组织各自独立持有、6.7 指纹相同（指纹只描述内容，隔离由组织维度保证）、6.8 id 不同互不覆盖、6.9/6.10 列表不串。

## 9.4 事项 5：Artifact 三项已批准字段（I-001/I-002/I-003）

只落已批准的三项，**不猜**其余未指定字段：`organizationId`、`productVersionId`、`schemaVersion`。
`organizationId` 与 `productVersionId` 是关键项（`ProductVersion` 是版本真源）；`schemaVersion` 由新常量 `ARTIFACT_SCHEMA_VERSION = "1.0"` 提供，写入路径按 `art.schemaVersion ?? null` 落库。

**存量回填**：`organizationId` / `productVersionId` 通过 `UPDATE ... FROM "WorkItem" JOIN "Project"` 由项目推导回填；**`schemaVersion` 有意不回填** —— 存量 Artifact 是自由文本，没有版本语义，编一个 `"1.0"` 是伪造。

**迁移**：`prisma/migrations/20260916010000_org_membership_signal_scope_artifact_fields/migration.sql`
生成方式：`prisma migrate diff --from-url <当前库> --to-schema-datamodel` 取**纯增量**，再手工插入 Prisma 不生成的 DML 回填（顺序有意安排：约束收紧与列新增必须在回填的正确一侧，否则在真实库上会失败）。

## 9.5 本批次逐项执行结果

环境：`next build` 14s 无错误；`tsc --noEmit` 退出码 0。
HTTP 验收服务：`NODE_ENV=production DEV_MOCK_AUTH=false DATABASE_URL=$TEST_DATABASE_URL next start -p 3110`（匿名 `/api/health` → `{"status":"UP"}`，B3 口径仍成立）。

| # | 套件 | 范围 | 结果 |
| --- | --- | --- | --- |
| 19 | `tests/acceptance-authz-matrix.test.ts` | 43 路由 / 60 方法穷举 + **场景 5 自举回归（9）+ 场景 6 跨组织泄漏（10）** | ✅ **455/455 通过，连续两遍一致** |
| 20 | `tests/acceptance-product-center.test.ts` | 33 断言 / 4 场景（2.2 依 B4 新口径由 403 → 200） | ✅ **33/33 通过** |
| 21 | `tests/acceptance-b01-http.ts` | 52 断言 / 8 场景（B4 读口径变更后未回归） | ✅ **52/52 通过** |
| 22 | `tests/acceptance-b01-r1.test.ts` | R01–R10（夹具补 `OrganizationMember`；无遗留产品的版本发布改走组织管理员） | ✅ **全绿**（R01–R10） |
| 23 | `tests/regression-signal.ts` | 源注册表 / 采集去重与源健康 / **组织隔离：同标题信号在 A、B 各自成立** / 信号→证据封装（恒 `UNVERIFIED`、回写 `evidenceId`）/ **跨组织不可封装 → 404 不泄露存在性** | ✅ **全绿**（5 组） |
| 24 | `tests/regression-revision-consistency.ts`、`tests/regression-partial-revision.ts` | 版本一致性、局部修订（确认未受本次权限/模型改动影响） | ✅ 全绿 |

新增回归入口：`npm run test:signal`（与前两项同约定，避免回归只能靠手记命令调起）。

## 9.6 本批次缺陷处置状态

| 编号 | 处置 | 证据 |
| --- | --- | --- |
| **D-002** 跨组织信号存在性泄漏 | ✅ **已修复** | `test:signal` + `test:authz` 场景 6（6.1–6.10） |
| **D-003** org-admin 权限自举 | ✅ **已修复** | `test:authz` 场景 5（5.1–5.9），含 5.5/5.7 两条核心断言 |
| **B4** 产品读可见范围 | ✅ **口径已定并实施** | 读路径改 `requireProductRead`；`test:product-center` 2.2 与矩阵同步为 200 |
| **B7** 组织级角色 | ✅ **已实施（最小解）** | `OrganizationMember` + `isOrgAdmin` 重写 |
| **I-001/I-002/I-003** 成果三字段 | ✅ **已实施** | 迁移 + 写入路径；存量回填前两项 |
| **D-001** `identityCode` 跨组织同名 500 | ⏳ **工程债（不阻塞）** | 拍板：方向为映射 **409 CONFLICT**，不改复合唯一键；不在本批次修 |
| **D-006** 迁移链不可回放（新登记） | ⏳ **工程债（不阻塞本地）** | `SignalSource`/`SignalItem`/`ResearchRun`/`ResearchRunTask`/`ResearchRunSnapshot` 无 `CREATE TABLE` 迁移，`20260913220000_*` 却 `ALTER` 它们；两库以 `db push` 建成，`migrate deploy` 在空库上失败。**已用双向证明等价**：本轮新迁移是纯增量 + 两库 `migrate diff` 输出为空。阻塞"从零重放建库"，需单独批次补基线迁移 |
| D-005 / D-007 | 未修 / 已知取舍 | 见 `docs/contracts/PRODUCT_CENTER_CONTRACTS.md` §7.3 |

## 9.7 迁移等价性的验证方式（说明限制）

因 D-006，本批次**不能**用"空库 `migrate deploy` 成功"来证明迁移正确。改用两条证据：

1. 新迁移文件由 `migrate diff --from-url <当前库> --to-schema-datamodel` 生成，天然只含增量；人工只追加了 DML 回填。
2. 迁移应用于 dev / test 两库后，两库 `migrate diff` **输出均为空** —— 即库结构与 `schema.prisma` 完全一致。

回填后实测：dev 库 `OrganizationMember` 4 行（`ORG_ADMIN` 2 / `MEMBER` 2）；dev 与 test 库均 41 表。

**风险声明**：以上证明的是"当前两库与 schema 等价"，**不证明**"从零重放可建成该 schema"。后者受 D-006 阻塞，必须在正式环境迁移前单独解决。

## 9.8 未执行项（本批次）

| 项 | 原因 |
| --- | --- |
| 空库 `migrate deploy` 重放 | **已知失败**（D-006），见 §9.7 |
| `tests/ui-b01-evidence.ts`（Playwright） | 未执行；需浏览器运行时 |
| 真实模型调用 / 真实业务验收 | 无端点、无试点资料 |

## 9.9 事项 4：全景汇总文档同步

按拍板要求修 `outputs/HERMES产品中心-全景汇总-2026-09-15.html` 并重新生成 PDF（29 页）。实际修的不止拍板点名的两处——同一类漂移在文内还有若干，**只改两处会留下互相矛盾的表述**，故一并同步：

| 位置 | 原表述 | 现表述 |
| --- | --- | --- |
| §4.3 B4 行 | 现状"写路径已收口 / 读路径待定" | **已收口**；读路径 = 组织内可读（已实施） |
| §4.3 B7 行 | "**未实施**，属业务决策，未擅自实施" | **已实施**：最小 `OrganizationMember`，`isOrgAdmin` 只看该表；不建 HR 体系 |
| §4.3 B8 行 | 434 断言；"登记 3 项缺陷未修" | **455 断言 × 两遍**；补场景 5/6 反向回归；D-002/D-003 **已修复**，D-001 转工程债 |
| §7.2 决策 8 | 二选一待定（产品读可见范围） | **已定案**：组织内全员可读 |
| §7.2 决策 9 | 二选一待定（组织级角色模型） | **已定案**：新建最小 `OrganizationMember` 根治 |
| §7.2 决策 10 | 二选一待定（Worker / 队列） | **已定案**：延期至 PC-4，TASK-020 不提前 |
| **§7.3 项目页字段下发** | "部分关联表仍整行序列化下发…超出界面所需" | **已关闭，保留回归**（拍板点名的两处之一） |
| **§7.3 越权矩阵自动化** | "新增 API 路由无自动登记校验，存在回归风险" | **已关闭，保留回归**（拍板点名的两处之一） |
| §4.2 / §7.3 | 穷举矩阵"434 断言" | **455 断言** |
| §3.1 / §3.7 / §8 / §9.1 | 数据模型 40 model / 35 enum | **41 model / 36 enum**（两库各 41 表） |
| §4.1 说明框 | — | 新增"本章状态的来源与更新原则"：**今后从 `CAPABILITY_BASELINE.md` / `ACCEPTANCE.md` / `authz-matrix.ts` 派生，不再手工维护** |
| 封面 / 页脚 | 文档版本 1.0 · 2026-09-15 | **1.1 · 2026-09-15 生成 / 2026-09-16 修订** |

**生成 PDF 时又查出旧 PDF 自身的目录漂移**（与代码无关，是文档内部的错）：

- 第 6 / 7 / 8 / 9 章页码各差 1（目录写 20/23/25/27，实际 21/24/26/28）；
- 3.7 目录写第 13 页，实际与 3.6 同在第 12 页；
- **第 2 章目录条目整体过时**：正文已扩为 2.1–2.6 六个小节，目录仍只列 3 条且标题还是旧的。

已按实测页码重建目录（24 条），并用脚本核对全部 24 条与真实分页一致、PDF 正文含全部修正表述。

**复现命令**（在 `hermes-next/` 下）：

```bash
# 渲染（遵循 HTML 内 @page；本机代理会劫持 localhost，故带 --no-proxy-server）
NODE_OPTIONS= node scripts/render-panorama-pdf.mjs \
  ../outputs/HERMES产品中心-全景汇总-2026-09-15.html \
  ../outputs/HERMES产品中心-全景汇总-2026-09-15.pdf

# 核对目录页码（不通过就回写目录后重渲染，再核对一轮）
/Users/exasdwyh/.workbuddy/binaries/python/envs/default/bin/python \
  scripts/verify-panorama-toc.py
```

备份：`outputs/HERMES产品中心-全景汇总-2026-09-15.html.bak-20260916`（修改前原文）。

**说明**：本节只做到"目录页码与正文状态已被机器核对过"。拍板要求的**根本解法**——状态由基线文档派生、不手工维护——本次只在文档内写明原则，尚未做生成器。全量派生属工程改动，按拍板"Final Security Patch 后停止一切工程底座建设"，**不在此批次实施**。

## 9.10 结论（Final Security Patch 批次）

| 判定项 | 结论 |
| --- | --- |
| 已批准的五项事项 | ✅ **全部完成** |
| 未关闭安全阻断 | ✅ **无**。B1–B8 及本轮 D-002/D-003 全部收口并有反面回归 |
| 权限矩阵 | ✅ 455/455 × 两遍 |
| 类型与生产构建 | ✅ 通过 |

**本批次判定：完成。PC-0 工程侧与安全侧到此收口，停止一切工程底座建设。**

剩余阻塞**只有业务侧两项**：① 一个**真实进行中的产品**（不是为验收临时造的产物）；② 真实模型端点、`modelId` 与费用口径。
工程债（D-001、D-006）**不阻塞 PC-1**，登记在册、待后续批次处置。

---

## 10. 验证可信度批次（D-008 / D-009，2026-09-16）

### 10.1 本批次的触发方式（最值得记的一点）

**这一批不是按计划发起的。** 它来自一次生产模式服务（`next start -p 3110`）连续运行 41 分钟后落下的日志。日志里只有 2 个 `[API Error]` 块，追下去才暴露两件事：

1. 有写路由在缺必填字段时以 **500** 返回（不是 4xx）；
2. 而**验收矩阵自己的判据把 500 当成了"门禁已开"**——所以这套矩阵一直在报绿。

也就是说：缺陷不是被测试抓到的，测试反而在替它遮掩。

### 10.2 缺陷与修复

| # | 现象 | 实测证据（服务日志原文） | 修复 |
| --- | --- | --- | --- |
| D-008a | `POST /api/projects/{id}/attachments` 在 `Content-Type: application/json` 时 500 | `TypeError: Content-Type was not one of "multipart/form-data" or "application/x-www-form-urlencoded"` | `req.formData()` 包 try/catch → **415**（新增 `UnsupportedMediaTypeError`）。鉴权仍在解析之前，未通过角色校验者拿不到 415 |
| D-008b | `POST /api/projects/{id}/feedback` 缺 `targetId` 时 500 | `Invalid prisma.feedback.create() invocation … + targetId: String / Argument 'targetId' is missing` | `createFeedback` 增 `targetType` / `targetId` 校验 → **422**，`fieldErrors` 点名字段 |
| D-008c | `POST /api/work-items/{id}/submissions` 缺 `inputRevision` 时 500 | `Invalid prisma.runReceipt.create() invocation … + inputRevision: Int / Argument 'inputRevision' is missing` | `submitWork` 增 `inputRevision` / `runMode` 校验 → **422**。校验置于**鉴权之后**（前置会把 404 变 422，反而给出资源存在性旁证） |
| D-008d | **矩阵判据本身**：`ownerGate: "NOT_DENIED"` 实现为「非 401/403/404」 | 60 条登记中 **30 条**用该门禁；三个 500 全部判为"通过" | 判据收紧为「非 401/403/404 **且非 5xx**」；另加**独立汇总断言**「有权身份段无任何 5xx」（不依赖逐条门禁写法，防止将来又被放宽） |
| D-009 | `tests/ui-b01-evidence.ts` 末步超时，9 条实质断言全过却始终非绿 | `locator.click: Timeout 30000ms … waiting for getByRole('button', { name: '退出登录', exact: true })` | 根因是组件可见文字为「退出」、完整短语只在 `title`，无障碍名取自内容 → 0 命中。组件补 `aria-label`（**不放宽测试选择器**），顺带修好屏幕阅读器只念「退出」 |

### 10.3 当前有效数字（全部为本次现场重跑）

| 套件 | 结果 | 说明 |
| --- | --- | --- |
| 权限矩阵 `test:authz` | **465/465** | 465 = 456（原 455 + 汇总断言）+ 场景 7 的 9 条 |
| 产品中心 `test:product-center` | **33/33** | |
| HTTP `test:b01-http` | **52/52** | |
| UI `test:ui` | **13/13** | 修复前为「9 项通过 + 末步不可达」，故整套非绿 |
| 类型与构建 | `tsc --noEmit` **0 错**；`next build` 通过 | |
| 服务端日志 | 修复后重跑：`[API Error]` **0** 条、`prisma:error` **0** 条 | 修复前三处 500 均在日志中留有正文 |

**场景 7 的断言明细**（故意发错 body，断言"错得清楚"）：

```
7.0  反向回归前重新登录 owner（HTTP 200）
7.1a/b  POST /projects/{id}/attachments（发 JSON）→ HTTP 415，非 5xx
7.2a/b/c POST /projects/{id}/feedback（缺 targetId）→ HTTP 422，非 5xx，载荷点名 targetId
7.3a/b/c POST /work-items/{id}/submissions（缺 inputRevision）→ HTTP 422，非 5xx，载荷点名 inputRevision
```

### 10.4 服务级套件的服务依赖（踩了三次的坑，已固化）

4 套验收需要真实 HTTP 服务：`authz-matrix` / `product-center` / `b01-http` 需 **3110**，`ui-b01-evidence` 需 **3111**。手动「起服务 → 探活 → 跑套件」有三类**报错文案都指向错误方向**的坑：

1. `.next/BUILD_ID` 会莫名缺失 → `next start` 报 *"Could not find a production build"*（看着像构建问题，实际只缺一个标识文件）。**实测澄清：`build → start → kill` 三步都不删它**，是环境里别的东西删的——本批不追因，改为缺了就重建。
2. 用后台托管 `(cmd &)` 时，任务一结束进程即被回收；下一条命令再跑套件只看到 `fetch failed`，容易被误读成业务失败。
3. 忘记先探活就开跑，失败信息同样是 `fetch failed`。

已固化为 `scripts/acc-server.sh`（缺 BUILD_ID 自动重建 → 腾端口 → `nohup` 起双服务 → 探活通过才跑套件 → 逐套件汇总，任一失败则退出码非 0）。

### 10.5 复现命令

```bash
cd hermes-next
# 4 套需服务的验收（自动起 3110/3111、自动探活、缺构建自动重建）
./scripts/acc-server.sh \
  tests/acceptance-authz-matrix.test.ts \
  tests/acceptance-product-center.test.ts \
  tests/acceptance-b01-http.ts \
  tests/ui-b01-evidence.ts

# 服务级套件（不需服务）
for f in acceptance-a01-a12.test.ts acceptance-b01-r1.test.ts acceptance-p1.test.ts \
         acceptance-blueprint-journey.test.ts regression-signal.ts regression-revision-consistency.ts \
         regression-partial-revision.ts regression-evidence-structure.ts regression-opportunity.ts \
         review-r2-probes.ts review-r3-probes.ts db-transaction-verification.ts; do
  NODE_OPTIONS= ./node_modules/.bin/tsx scripts/run-test.ts "tests/$f"
done
```

原始服务日志在 `/tmp/acc-server-3110.log`（本仓未做日志归档，需要证据时按上面命令重跑即可复现）。

### 10.6 本批次未关闭 / 已知盲区

| 项 | 状态 |
| --- | --- |
| **同类风险未做全仓排查** | 本次只修了**实测暴露**的 3 条写路由。其余 POST/PATCH 路由是否同样"缺字段 → 500"**没有系统扫描**。要系统关闭需遍历全部写路由的必填字段——属工程改动，按"Final Security Patch 后停止工程底座建设"未做。**这是一个已知的验证盲区，不是已关闭项** |
| `src/app/logout-button.tsx` | 无人引用的历史副本（实测全仓仅 `components/logout-button.tsx` 被 `app-shell` 引用）。未删，避免超出本批次范围 |
| D-001 / D-005 / D-006 / I-005 / I-006 | 状态不变，仍为登记在册 |
| 业务侧两项阻塞 | 状态不变：真实进行中的产品 + 真实模型端点/费用口径 |

### 10.7 结论

| 判定项 | 结论 |
| --- | --- |
| D-008 / D-009 | ✅ 已修复，均有反向回归（场景 7 / UI 套件） |
| 验收判据可信度 | ✅ 已收紧（`NOT_DENIED` 不再接受 5xx；新增"无 5xx"汇总断言） |
| 当前套件 | ✅ authz 465/465、product-center 33/33、http 52/52、ui 13/13、其余 12 套全绿、tsc 0 错、build 通过 |
| 同类盲区 | ⚠️ **未系统排查**（见 §10.6），不得据此声称"写路由入参校验已全面收口" |

**本批次判定：四项修复完成并验证。但"入参校验"这一类的覆盖范围仅限于实测暴露的三条路由——这一点必须与结论一起陈述，不能省略。**

---

## 11. PC-1 首批批次 · 成本页接线与 D-010 修复（2026-09-16）

### 11.1 目标与范围

PC-0 收口后进入 PC-1。本批只做**不依赖业务输入 / 外部凭证**的项：① 把已实现但未接产品页的确定性成本引擎 `calcCost` 接到产品详情「成本与供应」页签（TASK-008 的接线部分）；② 对 §10 的结论做一次**独立复核**（逐套重跑）。
**不做**：真实模型接入（无端点）、schema 变更、正式部署。

### 11.2 文件改动

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `src/app/products/[id]/cost-calculator.tsx` | 新增 | 客户端计算器；直接复用 `calcCost`，**零新增 API 面** |
| `src/app/products/[id]/product-overview-client.tsx` | 修改 | 「成本与供应」页签由回显 `targetCost` 文字改为渲染该计算器 |
| `src/app/globals.css` | 修改 | 补 `.hermes-table tbody tr.is-sum`、`.hermes-note.is-alert` 两条规则 |
| `src/modules/projects/project-view.ts` | 修改 | `workItems.submissions` 排序 `createdAt:desc` → `attempt:desc`（D-010） |
| `tests/cost-calculator.test.ts` | 新增 | 4 例纯函数回归（含「L6 不计入单件总成本」口径锁定） |

### 11.3 逐项结果

| # | 检查 | 结果 |
| --- | --- | --- |
| 25 | `tsx tests/cost-calculator.test.ts`（纯函数，无 DB） | ✅ **4/4** |
| 26 | 浏览器：产品详情「成本与供应」页签（`next start` + Chromium） | ✅ 单件总成本(L1–L5) ¥45.13、BOM 毛利率 77.84%、净利率 44.22%、保底=建议 ¥58.67，与引擎逐值一致 |
| 27 | `tsc --noEmit` / `next build` | ✅ 0 错 / ✅ 成功 |
| 28 | `tests/ui-b01-evidence.ts` | ✅ **13/13**（修复前 **9/13**，见 11.4 D-010） |
| 29 | `tests/acceptance-product-center.test.ts` | ✅ 33/33 |
| 30 | `tests/acceptance-b01-http.ts` | ✅ 52/52 |
| 31 | `tests/acceptance-authz-matrix.test.ts` | ✅ 465/465 |

### 11.4 本批发现并修正的缺陷

| 编号 | 现象 | 处置 |
| --- | --- | --- |
| C-001 | 明细表把引擎 **L6 月固定成本**（`monthlyFixed` 原值，非单件分摊）当单件成本列出，并把 L1–L5 之和标成「六层总成本」 | 单件成本表只列 **L1–L5**；L6 单列并注明「仅用于盈亏平衡，不计入单件成本」 |
| C-002 | 预算对照误用含渠道费的 `totalCost`（L1–L5） | `targetCost` 为**产品成本上限**口径，改对照 **BOM 成本（L1–L4）** |
| C-003 | 引用不存在的 CSS 类 `hermes-row-strong`；`hermes-note.is-alert` 无规则 | 新增对应两条 CSS 规则 |
| **D-010** | 审核提示按 `createdAt:desc` 取「最新批次」；毫秒级时间戳平局时取到上一批 → 「第 N 批」显示错误，且**沿用成果 / 尚未确认提示整块不渲染**（B01-03 的核心内容） | 改按 `attempt:desc` 排序（批次序号，确定且语义正确） |

### 11.5 对 §10 的独立复核（逐套重跑）

| 套件 | §10 记录 | 复核（修复前） | 复核（修复后） |
| --- | --- | --- | --- |
| `test:authz` | 465/465 | ✅ 465/465 | ✅ 465/465 |
| `test:product-center` | 33/33 | ✅ 33/33 | ✅ 33/33 |
| `test:b01-http` | 52/52 | ✅ 52/52 | ✅ 52/52 |
| `test:ui` | 13/13 | ❌ **9/13（未复现）** | ✅ 13/13 |

**复核结论**：§10 的四项修复**本身在代码中成立**（authz 判据的 5xx 收紧、attachments 415 / feedback 422 / submissions 422 校验、logout `aria-label` 均已逐项核对并重跑通过）。但 §10 记录的「**ui 13/13 在复核时不可复现**」，实为 9/13，根因 D-010；已修复并重新达到 13/13。

### 11.6 未执行项（本批）

| 项 | 原因 |
| --- | --- |
| 产品版本级成本输入 / 结果**快照持久化** | 需 schema 增量 + 业务口径确认，未做 |
| 高退款 / 组合装 / 缺值 / 重复费用等扩展用例 | 未做 |
| 真实模型调用 / 真实业务验收 | 无端点、无试点资料 |

## 12. 写路由入参健壮性收口批次（D-011 / D-012 / D-013 / D-014，2026-09-16）

### 12.1 目标与范围

承接 §11 的复验结论：D-008 当时**只修了实测撞到的 3 条写路由**（attachments / feedback / submissions），其自述即写明"其余 POST/PATCH 路由是否同类『缺字段 → 500』**未做系统扫描**"。本批就是关掉这个尾巴——不是再补几条校验，而是按缺陷的**类**在框架层收口，并补上"改源码不重建会假绿"这一验证机制缺陷。

### 12.2 暴露面（按**方法级**统计，非文件级）

| 分类 | 条数 | 说明 |
| --- | --- | --- |
| 裸解析 `await req.json()`（无 catch） | **21** | D-011/D-012 的影响面；修复前两种畸形载荷**各 21 条全部 500** |
| 自兜底 `await req.json().catch(() => ({}))` | **14**（13 文件） | 静默容错，非崩溃（§12.6 / D-013） |
| 未读 body | **4** | 不涉及 |
| 写路由登记合计 | **39** | 一个 `route.ts` 可同时导出 POST/DELETE，故方法级 > 文件级 |

`14 vs 13` 的口径：差的那 1 条来自 `src/app/api/launch/plans/[planId]/approve/route.ts` —— 同文件 POST 与 DELETE 两个方法**都**用了 `.catch`。登记粒度是"路由 × 方法"，故 **14** 正确。

### 12.3 文件改动

| 文件 | 改动 |
| --- | --- |
| `src/shared/api-handler.ts` | 新增两条中央映射（`SyntaxError` 含 `json` → 400 `INVALID_JSON`；`PrismaClientValidationError` → 422）；`AppError` 分支与 500 兜底语义**逐字未变**；生产环境固定文案 |
| `tests/acceptance-authz-matrix.test.ts` | 新增 `apiRaw()`（body 原样发送）与 **F 段**（场景 8）自动枚举式探针 |
| `tests/api-error-mapping.test.ts` | **新增**：`handleApiError` 语义单测 11 项（补齐此项此前无耐久护栏的缺口） |
| `package.json` | 新增 `test:api-errors` 入口 |
| `scripts/acc-server.sh` | **D-014**：按源码新鲜度自动重建（原只在 `BUILD_ID` 缺失时构建）；注释订正 `NODE_ENV` 归因 |

### 12.4 逐项结果（修复前 → 修复后）

| 检查 | 修复前 | 修复后 |
| --- | --- | --- |
| `tests/acceptance-authz-matrix.test.ts` | ❌ **487/529**（42 条失败） | ✅ **529/529**（连续两遍、第三遍亦 529） |
| 21 条裸解析路由 × 2 种畸形载荷 | ❌ **500 / 500**（各 21 条） | ✅ **400 / 400**，冒 5xx **0** 条 |
| `tests/api-error-mapping.test.ts` | 不存在 | ✅ **11/11** |
| `tests/acceptance-product-center.test.ts` | 33/33 | ✅ 33/33 |
| `tests/acceptance-b01-http.ts` | 52/52 | ✅ 52/52 |
| `tests/ui-b01-evidence.ts` | 13/13 | ✅ 13/13 |
| `tests/cost-calculator.test.ts` | 4/4 | ✅ 4/4 |
| `tsc --noEmit` / `next build` | ✅ / ✅ | ✅ / ✅ |

**断言数 465 → 529 的构成**：本批新增 **F 段 = 1（重新登录）+ 21 × 3 = 64**；非 F 段落逐场景复算仍为 465，`465 + 64 = 529`。上表全部数字均为**本机现场重跑输出**，非抄录。

### 12.5 回归锁的"会红"验证（本批方法学要点）

一个不会红的回归测试没有价值，因此专门证伪：备份 `api-handler.ts`（sha256 `08ea47f1…`）→ 移除两条映射 → 重跑 → 矩阵**变红为 42 失败**（21 路由 × 2 载荷，均 500，即 F 段 8.1a–8.21b），与暴露面规模相称 → 恢复 → `diff -u` 为空、sha256 与备份一致、`git diff --stat` 仅剩原改动（53+/2-）→ 重跑回到 **529/529**。

⚠️ 该验证暴露出一件比缺陷本身更危险的事：**首次移除后矩阵仍报 529 全绿**。据此查出 **D-014**（§12.6）。

### 12.6 本批发现的缺陷

| 编号 | 缺陷 | 定性 / 处置 |
| --- | --- | --- |
| **D-011** | `req.json()` 遇空 body / 非法 JSON → 原生 `SyntaxError` → **500** | 已修：中央映射 **400 `INVALID_JSON`**，判定**刻意收窄**（只认 message 含 `json` 的 SyntaxError；业务其它 SyntaxError 仍 500，有单测锁定） |
| **D-012** | 缺必填字段 / 类型不符冒到 Prisma → `PrismaClientValidationError` → **500** | 已修：中央映射 **422**（`instanceof` + `error.name` 兜底） |
| **D-013** | 14 处 `req.json().catch(() => ({}))` 静默吞掉畸形 JSON；实测 `POST /api/conversations` 畸形 JSON → **201 且真建 1 条会话**（已清理，残留 0） | **登记，判定为非缺陷**：显式声明"body 可选"，不崩溃。**代价待写入契约**——调用方拿 2xx 却不知 payload 被丢弃；当前无护栏 |
| **D-014** | `acc-server.sh` 只在 `BUILD_ID` 缺失时构建，而 `next start` 服务 `.next` 产物而非源码 → **改源码不重建即假绿** | 已修：增加源码新鲜度自动重建。**危害高于缺陷本身**——失败会促人排查，假绿会得出与事实相反的结论；本仓既往"改源码→跑验收→全绿"的记录均受此威胁 |

**生产不泄漏（端到端实测）**：生产模式发畸形 JSON 得 `400 {"code":"INVALID_JSON","message":"Request body is not valid JSON","requestId":"…"}`；`prisma:error` / `SyntaxError` / `Unexpected` / `/Users/` / `node_modules` / `at Object` **0 命中**。

**另一处归因订正**：构建行 `NODE_ENV=production` 是**必要**的，但机制易判错（四场景实测）：裸跑 `next build` 无论 `.next` 是否清空均 exit 0（Next 内部强制 production、不采用 `.env` 的 NODE_ENV）；只有把 `NODE_ENV=development` **导出进进程环境**（本脚本 `set -a; . ./.env` 正是如此）才 exit 1 并报 `<Html> should not be imported outside of pages/_document`。据此，曾有一版"该失败无法复现、属加固"的注释**是错的**，已订正。

### 12.7 未执行项（本批）

| 项 | 原因 |
| --- | --- |
| D-012 的 422 分支**无 HTTP 夹具触发** | 现有缺字段用例在服务层即被 `AppError(422)` 拦下，走不到 Prisma 抛错；该分支目前为**防御性映射**，仅由 `tests/api-error-mapping.test.ts` 单测锁定，**未被 HTTP 层上锁** |
| 其余 POST/PATCH/PUT 的**业务语义**校验（字段合法性、越权组合等） | 本批只收口"载荷形态/缺字段"，**不等于**写路由入参校验已全面收口 |
| D-013 那 14 处的回归护栏 | 探测它们会产生真实写入，需另设专用夹具；本批只登记 |
| 产品版本级成本快照、真实模型调用、真实业务验收 | 同 §11.6 |

---

## 13. 调用方错误中央收口批次（D-015 / D-016 / D-017 / D-018，2026-09-16）

### 13.1 目标与范围

把「**调用方发错了**」从「**服务端崩了（5xx）**」里分离出来，且**按缺陷的类**收口（不逐条补）。承接 §12 留下的三个尾巴：D-012 的 422 分支无 HTTP 夹具、D-013 那 14 处无护栏、`PrismaClientKnownRequestError` 全类未映射。

**边界（有意不做）**：D-001 的 schema 半边（`identityCode` 改组织内复合唯一）需迁移，而 `prisma/migrations` **不可回放**（D-006）→ **本批禁止改 `prisma/schema.prisma`、禁止加迁移**。只做错误映射半边。

### 13.2 暴露面（两种方法，结果不同——这本身就是本批的结论）

| 方法 | 覆盖 | 结论 |
| --- | --- | --- |
| 静态扫描 `params.[a-zA-Z_]+.` | `src/modules` 全量 | 23 处命中，逐条核对守卫后判"**只有 `createProduct` 是裸的**" → **D-017 面 = 1 条** |
| **实证穷举**（对 39 条写路由发 `{}` + 10 条部分 body = 50 条探测） | 矩阵登记的全部写路由 | **推翻上一条**：另撞出 `POST /api/projects/{id}/decision-packets` 500（**D-018**），形态是「**数组迭代未兜底**」，静态正则扫不到 |

**方法学结论（已写入契约 §7.3）**：凡声称"某类缺陷已穷尽"，**必须给出实证穷举的覆盖数**，不得只凭静态扫描。

### 13.3 文件改动

| 文件 | 改动 |
| --- | --- |
| `src/shared/api-handler.ts` | 新增 `PrismaClientKnownRequestError` 分支：`P2002`/`P2003`/`P2014` → **409 `CONFLICT`**、`P2025` → **404 `NOT_FOUND`**；**其余 Prisma code 保持 500**（刻意收窄）。`instanceof` + `error.name` 兜底；非生产回显 `meta.target`，生产固定文案 |
| `src/shared/request-body.ts`（新增） | `readJsonObjectBody(req)` 三态：空 body → `{}`；畸形 → **原样抛**（刻意不 catch，交中央映射 400）；非对象 → **422** |
| 13 个 `route.ts`（14 处） | `req.json().catch(() => ({}))` → `readJsonObjectBody(req)` |
| `src/modules/products/service.ts` | `createProduct` 补必填校验（收集缺失项 → 一次 422 点名字段） |
| `src/modules/decisions/service.ts` | `createDecisionPacketDraft` 补 `Array.isArray` 边界校验（允许空数组） |
| `src/modules/decisions/scope-hash.ts` | `computeScopeHash` 开头加不变量守卫（**响亮失败，不静默当 `[]`**） |
| `tests/acceptance-authz-matrix.test.ts` | F 段改四态分类 + 新增 `caught === 0` 守卫 |
| `tests/acceptance-http-errors.ts`（新增） | 真实 HTTP 验收 31 断言（甲/乙/丙/丁/戊/己 六段） |
| `tests/api-error-mapping.test.ts` | 11 → 26 断言 |
| `package.json` | 新增 `test:http-errors` |

### 13.4 逐项结果（修复前 → 修复后，均为现场实测）

| # | 项 | 修复前 | 修复后 |
| --- | --- | --- | --- |
| 甲2/甲3 | `POST /api/products` 重复 `identityCode` | **500**（连发两次均 500） | **409** `CONFLICT`（再发仍 409） |
| 甲5b | `POST /api/products/{id}/versions` 重复 `versionTag: "v1"` | **500** | **409** |
| 甲4/甲6 | 换新 `identityCode` / 新 `versionTag` | 201 | **201**（正常路径未误伤） |
| 甲7 | 409 响应体 | — | 不含 `P2002`/`prisma:error`/路径/栈；`requestId` 仍在 |
| 乙9 | `POST /api/evidences/{id}/verify` 发畸形 JSON `"{"` | **200** | **400** |
| 乙10 | 该请求后证据状态 | 被翻成 **`VERIFIED`** | 保持 **`UNVERIFIED`** |
| 乙11 | 该请求后 `EVIDENCE_VERIFIED` 审计 | **0 → 1** | **0 → 0** |
| 乙13 | 同路由 body 字面量 `null` / `[]` | **500** / **200** | **422** / **422** |
| 乙14 | 同路由**不带 body** | 200 | **200**（合法用法未误伤；但见 §2.5 语义说明） |
| 丙15 | `POST /api/products` 缺 `targetAudience`/`marketPath`/`devMode` | **500** | **422**，点名缺失字段 |
| 丁1/丁3/丁5 | `POST /api/projects/{id}/decision-packets` 缺/错类型 `artifactVersions`/`evidenceVersions` | **500** | **422**，点名缺失字段 |
| 丁4 | 同路由完整 body | 201 | **201**（未过度收紧） |
| 戊1 | 跨组织身份复用他组织已占 `identityCode` | （映射前 500） | **409**，不泄露他组织名称/ID |
| 己 | 夹具自建自清 | — | 无整库清理，残留 0 |

**矩阵 F 段四态（按方法切源码自动枚举）**：`raw` 21→21、`helper` **0→14**、`caught` **14→0**、`none` 4→4；合计 39。

| 套件 / 检查 | 结果 |
| --- | --- |
| `tests/acceptance-authz-matrix.test.ts` | ✅ **558/558 × 连续两遍**（修复前 `caught` 守卫 1 条红） |
| `tests/acceptance-http-errors.ts`（新增） | ✅ **31/31**（修复前 26 通过 / 5 红） |
| `tests/api-error-mapping.test.ts` | ✅ **26/26** |
| `tests/acceptance-product-center.test.ts` | ✅ 33/33 |
| `tests/acceptance-b01-http.ts` | ✅ 52/52 |
| `tests/ui-b01-evidence.ts` | ✅ 13/13 |
| `tests/cost-calculator.test.ts` | ✅ 4/4（未回归） |
| `tsc --noEmit` | ✅ 0 错 |

断言数构成：矩阵 **529 → 558**（+1 `caught` 守卫 + 14 `helper` × 2 = +29）；`http-errors` 22 → **31**。

### 13.5 回归锁的"会红"验证（两个方向，均实测后原样恢复）

1. **摘掉 D-015 的 409 分支** → `http-errors` **4 条红**（甲2 / 甲2b / 甲3 / 甲5b），18 通过。
2. **把 `evidences/{id}/verify` 退回 `.catch(() => ({}))`** → 矩阵 **8.0b 红**，`helper` 14→13、`caught` 0→1。

两次均以 `sha256` + `diff -u` 证明**恢复后逐字节一致**，重跑回全绿；且每次都**确认构建确实被触发**（打印「源码比构建产物新」）—— §12 暴露的 D-014 假绿坑未再犯。

### 13.6 本批发现的缺陷

| 编号 | 现象 | 处置 |
| --- | --- | --- |
| **D-015** | `PrismaClientKnownRequestError` 全类未映射（`P2002`/`P2003`/`P2014`/`P2025` 一律 500）。**契约 §2.4 早已写明"唯一键冲突应映射 409"却从未实施** | ✅ 已修（409/404，其余保持 500） |
| **D-016** | 14 处 `req.json().catch(() => ({}))` 把畸形 JSON 静默当空 body；`evidences/{id}/verify` 上是 **fail-open**（驳回被执行为通过 + 写审计） | ✅ 已修（`readJsonObjectBody` 三态 + `caught === 0` 守卫） |
| **D-017** | `createProduct` 缺必填字段 → 原生 `TypeError` → 500（D-008 的同类尾巴） | ✅ 已修 |
| **D-018** | 决策包缺 `artifactVersions`/`evidenceVersions` → 500（**数组迭代未兜底**，静态扫描漏掉） | ✅ 已修（边界校验 + 指纹函数不变量守卫） |
| **D-001 升格** | `identityCode` 全局唯一 → 跨组织试同一编码得 **409**，是**确定的存在性 oracle**（弱）；原登记"它不泄露数据"**已过时** | ⚠️ **半修复，不得关闭**：映射半边已做，约束半边需迁移（D-006 阻断）。已用戊段**特征化断言**锁定，并记录矩阵覆盖盲点（`{{IDENTITY}}` 异码使冲突永不触发） |

**同时更正了 §12.6 对 D-013 的定性**：上一批判其"非缺陷"，是因为只看了 `conversations`（危害温和）就推断了整类；同类写法在 `evidences/{id}/verify` 上是 fail-open。**根因是"只登记不探测"——不探测就永远看不到其余站点的真实后果。**

### 13.7 对 §12 遗留项的关闭情况

| §12.7 遗留项 | 现状 |
| --- | --- |
| D-012 的 422 分支**无 HTTP 夹具触发** | ⚠️ **仍未关闭**：Prisma 入参校验错在服务层就被拦下，走不到 HTTP 层；本批新增的 HTTP 夹具覆盖的是 `P2002`（D-015），**不是** `PrismaClientValidationError`。该分支仍只有单测锁定 |
| 其余 POST/PATCH/PUT 的**业务语义**校验 | ⚠️ 仍未做。本批只收口"载荷形态 / 缺字段 / 冲突码"，**不等于**入参校验已全面收口 |
| D-013 那 14 处的回归护栏 | ✅ **已关闭**：14 处全部改用 `readJsonObjectBody`，并由 F 段 `caught === 0` 守卫 + `http-errors` 乙段双重上锁 |

### 13.8 未执行项（本批）

| 项 | 原因 |
| --- | --- |
| `Product.identityCode` 改组织内复合唯一（I-005 约束半边） | 需 schema 迁移；`prisma/migrations` 不可回放（D-006）→ 本批明令禁止 |
| `helper` 路由**不带 body** 的行为护栏 | 探它会**真的写数据**（`conversations` 201 建会话、`verify` 200 写核实+审计、`analyses` 201 建 run）。已把实测行为写入契约 §2.5，但**无自动化护栏**，属已知留白 |
| 决策包**空范围**（`artifactVersions: []`）是否应被业务允许 | 本批只校验"存在且是数组"，**允许空数组**。空范围指纹的语义正确性需业务确认 |
| 产品版本级成本快照、真实模型调用、真实业务验收 | 同 §11.6 |

---

## 14. 前端交互反馈层批次（2026-09-16/17）

### 14.1 目标与范围

用户提出三项：**① 优化 UI/UX 前端操作效果；② 要"秘塔"那种 AI 思考动画；③ 其他整体优化——由实施方自己找出"用起来不舒服的地方"并改得人性化。**

与前几批的**性质差异**：前 13 节都在收口服务端缺陷（路由 / 鉴权 / 入参），本批是**表现层**，暴露面不是路由而是**前端"瞬时状态"**——等待 / 加载 / 出错 / 找不到 / 理由输入。因此本批的验收方式必须包含**真实浏览器**，不能只靠服务级断言。

范围：`hermes-next/src/`（表现层）。**明令禁止触碰** `src/app/api/**`、`src/modules/**`、`prisma/**`、`tests/**`（工程师侧）。

### 14.2 暴露面（由实施方先勘查后动手，避免"我以为的不舒服"）

| 编号 | 位置 | 问题 | 判别依据 |
| --- | --- | --- | --- |
| U-1 | 全站 | `find src/app -name loading.tsx` **为空**，14 个服务端取数页无任何加载反馈 | 点侧栏导航后界面完全冻结 |
| U-2 / U-3 | 全站 | 无 `error.tsx` / `not-found.tsx` | 服务端异常直接暴露原始报错；404 脱离壳层 |
| U-4 | 全站 | `grep -rn 'aria-live' src/` **零命中** | 读屏用户感知不到异步结果 |
| U-5 | `advisor-client.tsx` | 等待态是**死文字**「正在查询…」 | 用户点名的"秘塔动画"落点 |
| U-6 | `revision-panel.tsx` / `launch-tab.tsx` | **用 `<Empty>正在读取…</Empty>` 冒充加载态** | `.hermes-empty` 是虚线框 + 居中灰字，语义是"这里没内容"，用户分不清"在加载"与"真没有" |
| U-7 | 8 处 `prompt()` + 4 处 `alert()` | 原生浏览器弹窗输入审批理由、弹出结果 | 不可样式化、脱离设计语言、阻塞主线程；在"决策留痕"场景用 `prompt` 输入批准理由质感很差 |
| U-8 | 8 处 `window.location.reload()` | 每个操作后整页刷新 | 丢滚动位置、闪白、丢当前选中项 |

### 14.3 文件改动（四笔交付 + 一笔 P0 返工）

| 提交 | 内容 |
| --- | --- |
| `8dddedc` | 交互反馈层：`globals.css` 追加块 + `Thinking` 原语 + 两处加载态改判 + 新增 `loading.tsx` / `error.tsx` / `not-found.tsx` + 3 处横幅补 `aria-live` |
| `5160814` | 原生弹窗治理：新增 `components/reason-dialog.tsx`；8 处 `prompt` → `useReasonDialog()`；4 处 `alert` → 页内横幅；8 处整页刷新 → `router.refresh()` + props→state 同步 |
| `d6d5583` | 复核缺陷返工：对话框说明不再拼 label（原会拼出「请输入批准理由为必填…」病句）；新增 `src/app/login/loading.tsx` |
| `fbfff0f` / `c3eb83b` / `7200973` | QA 交付并两次改瞄的回归锁 `tests/ui-feedback-layer.ts`（62 → 70 → **73**），入口 `npm run test:ui-feedback` |
| `3f58cec` | **P0 返工**：删除两个路级 `loading.tsx`；新增 `components/nav-progress.tsx` 客户端进度条；`app-shell.tsx` 接入（**保持服务端组件**）；清死骨架 CSS；`error.tsx` 重试改为 `router.refresh()` + `reset()` |

`src/` 下 `window.location.reload(` / `alert(` / `prompt(` **已清零**（残留扫描 + 回归锁守卫双重上锁）。

### 14.4 逐项结果（修复前 → 修复后，均为现场实测）

| 项 | 修复前 | 修复后 | 验证方式 |
| --- | --- | --- | --- |
| 顾问等待态 | 死文字「正在查询…」 | `Thinking` 三点错峰 + 扫光标签 | 运行截图；`getComputedStyle` 断言 |
| 两处加载态 | `<Empty>正在读取…</Empty>` | `Thinking`（真空 `<Empty>` 保留） | 运行 + 源码守卫 |
| 原生弹窗 | 8 `prompt` + 4 `alert` | 应用内对话框 + 页内横幅 | `page.on('dialog')` 跨 4 页 **恒为 0** |
| 取消即安全 | （原为 `prompt`，取消即返回 null） | 对话框取消 / Esc / 遮罩 → **0 写请求** | `page.route` 拦截计数；确认路径恰好 1 次写 |
| 整页刷新 | 8 处 `reload()` | `router.refresh()` + state 同步 | 哨兵 `window.__x` 未丢 **且** 列表确实更新（两条件须并存） |
| 错误页重试 | `reset()`（**假按钮**） | `router.refresh()` + `reset()` | 真点 → 服务端请求 **1→2**、内容恢复 |
| 404 / 错误页 | 无 | `not-found.tsx` / `error.tsx` | 运行可达 |
| 导航反馈 | 无（曾是路级骨架，见 14.5） | 客户端顶部进度条；`reduce` 下静态替代 | 运行 + `getComputedStyle` |
| 降动画可读性 | — | `reduce` 下标签回退**不透明纯色** `rgb(10,79,96)` | `emulateMedia({reducedMotion:'reduce'})` + `getComputedStyle` |
| 管理员路径横幅 | 2 处 `alert()` | 页内横幅（服务端 500 / 网络失败两条路径） | 用 `OrganizationMember.role = ORG_ADMIN` 账号实测 |

### 14.5 本批的 P0：路级 `loading.tsx` 是**错方案**，且由领队规格造成

**这是本批唯一真正的回归，也是本节最该读的一段。**

波 1 中领队为解 U-1 指挥工程师新增了根 `src/app/loading.tsx`。它通过了当批的**全部自验**（浏览器目视 + `ui-b01-evidence` 全绿），直到 QA 按"每批对标**全量**基线"的纪律跑完八套，才发现 **`acceptance-product-center` 33→32**、**`ui-b01-evidence` 13→11**。

**根因**：App Router 中一段路由只要有了 `loading.tsx` 就走**流式渲染**——响应头 200 在页面渲染完成前发出，于是后代 `notFound()` 只能改渲染内容、**改不了状态码**（4.18 要求 404，实拿 200）；`redirect("/login")` 也被推迟到 hydrate 之后（`ui-b01-evidence` 在 `domcontentloaded` / `reload()` 后取 URL 拿不到 `/login`）。全仓 `notFound()` 仅 `projects/[id]/page.tsx:42,47` 两处，而含 `redirect("/login")` 的源文件有 **13 个**。

**隔离实验**：移除两个 `loading.tsx` → 33+13 全绿；仅留 `login/loading.tsx` → 33+13 全绿；恢复根 `loading.tsx` → 32+11 复现。

**处置**：删除两个路级 `loading.tsx`；同一 UX 目标改由**纯客户端**进度条承担（零服务端语义代价，且覆盖面更广——`/` 与 `projects/[id]` 都能有反馈）；死代码（`.hermes-skeleton` / `.hermes-skel-*`）清除。**未动 `notFound()`、未动任何鉴权代码**——404 是靠删根 loading 恢复的。

**方法学结论（本批最有价值的产出）**：**"新加一个看起来无害的框架文件"必须跑全量基线**，不能只跑与该功能"相关"的那几套。本批 P0 与 §12 的 D-014（改源码未重建 → 假绿）属于同一类：**结论正确而证据面不足**。

### 14.6 回归锁的"会红"验证（七组变异，全部实测后原样恢复）

| 变异 | 变红 |
| --- | --- |
| `Thinking` 的 `role="status"` → `role="statux"` | 3 红 |
| 插入一处 `window.alert(...)` | 1 红 |
| `login/loading.tsx` 的 `hermes-login-card` → `hermes-sidebar` | 4 红 |
| `nav-progress.tsx` 的 `getServerSnapshot` → `return true` | 1 红 |
| `app-shell.tsx` 顶部加 `"use client"` | 1 红 |
| `error.tsx` 的 `router.refresh()` → `router.back()` | 1 红 |
| **放回根 `src/app/loading.tsx`**（防 P0 复发，守卫 2b） | **2 红**，报错指认 `src/app/loading.tsx`；`login` 位点那条正确保持绿 |

**后果复验（把"锁红"与"业务坏"连起来）**：放回根 `loading.tsx` 的同一跑里 `acceptance-product-center` = **32/33**（唯一失败即 4.18，HTTP 200）；移出后回到 **33/33**、锁 **73/73**。工程师侧独立撞出同一现象（他构建时该探针仍在盘上，同样 32/33、唯一失败 4.18），**两条独立路径互相印证**。

**守卫强度**：守卫 2b 用递归 `walk()` 扫 `src/app/**`，**任意层级**的 `loading.tsx` 都会被断言捕获（QA 用临时深度树实测 depth-1 与 depth-2 均命中），因此比领队原话（只点名根位点 + `projects/`）**更强**。

**锁的手法要求（本轮新增）**：锁文件**不得 `import` 被测的 `src/app/**` 模块**，改用 `fs` 源码文本断言。原因：`tsconfig.json` 的 `include` 含 `**/*.ts`，`tests/**` 会被 `next build` 编译 —— 本批中锁文件引用了刚删除的模块，导致**不只是测试变红，而是 `next build` 直接 exit 1**，连带卡死 `acc-server.sh` 与全部服务级套件。

### 14.7 本批发现的缺陷

| 编号 | 现象 | 处置 |
| --- | --- | --- |
| **D-019** | 根 `loading.tsx` 使 `notFound()` 丢 404 状态码（4.18 由 404 变 200）、`redirect()` 推迟到 hydrate 后 → product-center 33→32、ui-b01 13→11。**由领队规格引入** | ✅ 已修（删两个路级 loading，改客户端进度条）；✅ 已上锁（守卫 2b，递归断言 `src/app/**` 下 `loading.tsx` 数为 0）并证明会红 |
| **D-020** | `error.tsx` 的「重试」对服务端错误**无效**：只调 `reset()`，不重新取服务端数据 → 点下去无任何新请求、内容不恢复 | ✅ 已修（`startTransition(() => { router.refresh(); reset(); })`）；✅ 已实证（请求数 1→2、内容恢复） |
| D-021（**登记，未修**） | `error.tsx` 出现时响应码仍是 **200**（错误边界在客户端渲染，改不了状态码，Next 固有行为）；`error.digest` 是唯一追查线索 | ⚠️ 已知留白，见 14.8 |

**另更正领队自身一处口径**：波 1 中领队曾称"14 个页面有 `redirect("/login")`"，那是 **grep 命中行数**；按**文件**计为 **13**（`products/[id]/page.tsx` 内两处 `redirect`，其一是 `redirect("/products")`）。守卫 2b 的断言文案已改为**动态计算**该数，故永远属实。

### 14.8 未执行项（本批）

| 项 | 原因 |
| --- | --- |
| `error.tsx` 的错误响应码（应否 500） | 错误边界在客户端渲染，改不了状态码；要 500 需服务端层拦截，属新架构改动，本批不做 |
| 其余 20+ 个 `page.tsx` 的**首屏硬加载**骨架 | 路级 `loading.tsx` 已被本批证否（D-019），硬加载首屏只由浏览器自身进度承担。**不是遗漏，是取舍** |
| 顶栏按钮 / 页内 `router.push` 的导航反馈 | 本批只覆盖侧栏 `NavProgressLink`；`advisor` 的「新对话」等 `router.push` 路径未接进度条 |
| **非根**位点 `loading.tsx` 的业务后果 | 守卫 2b 已覆盖任意层级，但"非根位点同样会把该段后代 404 打成 200"仅按机制推断，**未单独实跑对照**（QA 主动登记为未验证项） |
| 「`redirect("/login")` 被推迟到 hydrate 后」的独立对照 | 该论断目前只是守卫文案里的理由；未单独构造"加 loading → 退出登录流复现失败"的对照（11/13 那次是**根** loading 造成，已随移除复绿） |
| 真实业务验收 | 同 §11.6。本批为工程验收，**无**真实业务人员确认 |

### 14.9 结论（前端交互反馈层批次）

**用户提出的三项均已交付并经独立验证**：秘塔式思考动画（`Thinking` 原语 + 顾问等待态）、8 处原生弹窗与 8 处整页刷新治理、以及由实施方自行勘查出的 8 类"不舒服点"。

**数字（终检在已提交状态 `3f58cec` 上重跑）**：`authz` **558**（连续两遍）、`product-center` **33**、`b01-http` **52**、`ui-b01-evidence` **13**、`http-errors` **31**、`api-error-mapping` **26**、`cost-calculator` **4**、新增回归锁 **73**（终检 `BUILD_ID = qz_46DEkcwEXCEXdeocWI`，退出码 0）、`tsc` 0 error、`next build` 通过。

**本批的 P0 是领队给出的规格本身有误**（指挥加根 `loading.tsx`），由 QA 按"全量基线"纪律拦下 —— **这正是"独立验证"存在的意义：实施者与规格作者的自验都会漏掉自己造成的回归。** 处置后 D-019 / D-020 均已闭环并上锁，七组变红验证全部通过且原样恢复。

## 15. Quiet Enterprise 视觉迁移批次（2026-09-17/18）

### 15.1 目标与范围

用户要求**① 把视觉系统从旧的 paper/teal 迁移到「Quiet Enterprise」；② 由实施方自己找出"不舒服的地方"改掉；③ 追加"小屏**电脑**自适应"。**

与前 14 节的**性质差异**：§14 也是表现层，但本批主题是**视觉一致性**（令牌 / 色值 / 类名契约）与**可度量的小屏表现**（横向溢出 / 点击区）。因此本批的验收方式 = **源码守卫**（G1/G2 静态扫描）**+ 真实浏览器矩阵走查**（G3/G5/G6/H2 运行时）双轨，不能只靠服务级断言。

范围：`hermes-next/src/**`（表现层）+ `scripts/**`（走查与守卫）。**明令禁止触碰**业务域模块与 Prisma。**最终放行点 `41c0ac1`。**

### 15.2 文件改动（提交链）

| 提交 | 内容 |
| --- | --- |
| `3552928` | **视觉基线**：对齐 Quiet Enterprise 视觉系统（令牌层 + 壳层 + 四组机制 + 逐页落地） |
| `b570c9c` / `fb04920` | 移除 `:root` 自引用令牌（修文字/边框回落）；证据核实环挂到产品总览验证页签 |
| `0fc5375` | 小屏验收度量钩子（6 档 + 全矩阵）+ 修探针静默失效缺陷 |
| `c302679` | 小屏电脑自适应（§10 rev2）——媒体阶梯下行 + 分档规则 + 点击区全档 |
| `ed34977` / `eb072cd` | 死 CSS 清理（52 + 9 个死类）+ 反转型类名契约 + scanner `--product-scope` + 归档一次性脚本 |
| `2d6289c` | 抽出 `status-labels` / `datetime` 零依赖单一来源，模块统一消费 |
| `20cfb76` / `eef999e` | `/trace` 审计文案裸枚举中文化 + 模块层文案守卫；backfill 脚本默认 dry-run + 显式 `--apply` |
| `40c5df1` | ui-walk 并发守卫改为识别「本仓 dev server」（`/api/health` 签名），不再被无关占用误挡 |
| `3ee006d` | 首页 h1 文案「现在的情况」→「工作总览」（方案 A · 消歧，冻结） |
| `bbfc4e4` | **D1 修复**：弹窗关闭键命中区 17×17 → 28×28，并补 G1/G2/G3/G5/G6 守卫 |
| `41c0ac1` | **关 6 项残留**：G6 豁免表元校验（H1）+ G3 收紧到整数 + G2 函数式色值 + G1 fallback + 端口归属校验/占用策略（H2）。**最终放行点** |

### 15.3 逐项结果（权威基线，终检在 `41c0ac1` 上）

| 套件 | 结果 |
| --- | --- |
| `tsc --noEmit` | **0 error** |
| `next build` | 通过 |
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

**浏览器走查（`scripts/ui-walk.sh --full`）**：**152** 屏（8 档 × 19 路由入口），R1 横向溢出 / R2 点击区 <24 / R3 / R4 文案 **8 档全 0**；弹窗态 8/8 打开、R1=0、R2=0；分母 可点元素 **3626** / 文本叶子 **11895** / 图片 **0**。

**点击区口径裁定**：门槛取 **24×24 CSS px**（内部桌面工具 · 指针输入 · WCAG 2.2 Target Size Minimum），**44px 是触屏规范、不采纳**；结论=实现不改（现有门槛本就是 24px）。44px 曾误入派单口径，已在 §10.9.1 更正。

### 15.4 回归锁的「会红」验证（八项变异，全部实测后原样恢复）

| 变异 | 目标守卫 | 变红 |
| --- | --- | --- |
| **M1** 放回路线级 `loading.tsx` | 既有守卫 2b（防 D-019 复发） | 红（既有批次已验） |
| **M2** `/trace` 裸枚举泄漏 | 模块层文案守卫 | 红（既有批次已验） |
| **M3a** `--probe:var(--probe)` | G1 | 命中 1 |
| **M3b** `--x:var(--x,#fff)`（带 fallback 成环） | G1 | 命中 1（`--ink:var(--ink-muted)` 不误伤） |
| **M4a** `#ff0000` + `rgba()` | G2 | 命中 2 |
| **M4b** `hsl(...)` | G2 | 命中 1 |
| **M4c** `oklch(...)` / `color(...)` | G2 | 命中 1 |
| **M5** 插「机会评分 **87.5** 分」 | G3 | 变红 |
| **M6** 插「机会评分 **88** 分」（整数） | G3 | 变红 |
| **M7** 往 `VACUOUS_DENOM_ALLOWED` 塞真实分母 | H1 | 变红 |

**H2 的负向证明（服务器归属校验）**：外来进程占用端口 → `acc-server.sh` **exit 3 且 0 套件**；非本仓 cwd → 被拒；`ui-walk.sh` 侧非本仓 cwd → **exit 4**。**H2 双向均已证成**（正：本仓 dev server 被正确识别；负：非本仓占用被拒）。QA 定向复验另行确认 H2 双向 + 五项变异。

**H2 不用血统判据**：`next start` 父进程常驻、`next dev` 会 **daemonize**（父 `$!` 退出、监听进程被 init 收养），血统恒不成立 —— 若以它为主判据会对 dev 场景**假拒绝**。故血统仅打印佐证，「端口启动前空闲 + cwd==本仓库」为确定性判据。

### 15.5 本批的残留与未覆盖（如实登记，非"全绿"）

| 项 | 现状 | 局限 / 说明 |
| --- | --- | --- |
| **G2 · 具名色** | `color:"white"` 等具名色**可逃** | 不做全仓文本正则（会误伤正文英文词）；如需覆盖须做【受限上下文】语法级解析 |
| **G6/H1 元校验** | 豁免表与断言**同文件** | 改两处即可绕过 —— 作用是「让绕过留下**可见 diff**」，**非密码学封锁** |
| **信号层（console 错误）** | 当前**只报告、不判定** | **可能掩盖真实缺陷**（某页签整页失败仍可 exit 0）。建议改登记制 —— 本轮**未做**，登记为 TODO |
| **端口归属校验边界** | cwd=身份**被信任** | **不存在「复用陈旧构建」风险**（原口径已更正）：`ui-walk.sh` 复用的一定是 `next dev`（按源码实时编译、不吃 `.next` 产物）；`acc-server.sh` 走 `next start` 时**从不复用**（被占即 exit 3）。**真残余是 env/DB 不匹配** —— cwd 不约束 `DATABASE_URL` / `NODE_ENV`；血统刻意排除；端口冲突只**移到 3180+，未根除** |
| **`COLOR_GUARD_EXCLUDE`** | `/advisor/` `/consultation/` `/api/conversations/` `/research/` 临时排除 | 因并行 agent 改这些模块；**待其合入后移除排除、重新纳入 G2** |
| **G4（`globals.css` 函数式色值）** | **已裁定不做**（非 TODO） | 令牌定义文件内函数式色值可能是**合法令牌取值** |
| **双放行机制未统一** | **本批未做** | `GateType.PRODUCTION_GATE` 空门 + G1/G2 走 `DecisionPacket`、G3 走 `LaunchPlan` —— 两套机制**如实并列**，登记为「未统一」 |
| **`images` 分母恒为 0** | 全仓无 `<img>` → 断图检查**天然空跑** | 经 H1 登记为「允许的空分母」（非假绿）；**当前不具备督察力**，引入 `<img>` 后须恢复硬断言 |

### 15.6 跨团队耦合（真实边界）

1. **`globals.css` 工作区的他人改动**：并行 agent 在 `globals.css` 工作区追加 **149 行** `.hermes-challenge-*`（含内联 hex）。我方色彩收敛守卫读**磁盘 `globals.css`** → **对方那 149 行一旦落盘，守卫会变红**（违反同一契约）。本批提交经 `git diff --numstat` 实测 **`149 0`**（纯增、零删），**未破坏对方任何字节**。
2. **`ui-feedback-layer` 对 `/consultation` 页的结构性依赖**：套件（73 断言）依赖 `textarea.hermes-textarea`，落点在 `src/app/advisor/advisor-client.tsx:396` 与 `src/app/consultation/consultation-client.tsx:176`；对方改该模块时我方回归**可能被动变红** —— **口径待用户裁定**（谁改谁保绿 / 或该套件不再覆盖 advisor 页）。**本轮未裁定，仅登记**。

### 15.7 一条数据事实（非本批代码缺陷）

走查中 **16 屏**被信号层标为「signaled」= `console: Failed to load resource: 422`，集中在 `/products/<id>?tab=analysis|version`。QA 定性：产品 `25c14092「AKG 半年套餐」` 的 `versions=0`（21 个产品中**唯一无版本**者，今日由并行 agent 写入共享 dev 库），两个页签都挂 `RevisionPanel` → `GET /revisions` → 按既有契约对非法域数据抛 422；正常创建必然建 v1（`products/service.ts:80`）。**零 `src/` 改动 → 非本批代码缺陷**，登记为「**共享库数据漂移**」，持续观察。

### 15.8 未执行项（本批）

| 项 | 原因 |
| --- | --- |
| 信号层改登记制（console 错误拒绝/白名单） | 需产品与工程共同定义「已知漂移」清单，属新机制，本批不做（登记为 TODO） |
| 端口冲突根除（仓库唯一签名 / 完全可配置端口） | 本批只把冲突**移到 3180+**，未根除 |
| `COLOR_GUARD_EXCLUDE` 回收 | 依赖并行 agent 合入，未到时机 |
| 双放行机制统一（`PRODUCTION_GATE` / `DecisionPacket` / `LaunchPlan`） | 属跨模块架构改动，非本批范围 |
| 真实业务验收 | 同 §11.6 / §14.8，本批为工程验收，**无**真实业务人员确认 |

### 15.9 结论（Quiet Enterprise 批次 · 最终放行点 `41c0ac1`）

**用户提出的三项均已交付并经独立验证**：Quiet Enterprise 视觉系统迁移（令牌层 / 壳层 / 四组机制 / 14 页逐页）、实施方自行勘查出的"不舒服点"整改（死 CSS 清理 / 类名契约反转 / 单一来源抽取）、以及小屏电脑自适应（8 档走查矩阵 R1–R4 全 0）。

**权威基线（终检在 `41c0ac1`）**：`tsc` **0** · `authz` **558**×2 · `product-center` **33** · `b01-http` **52** · `ui-b01-evidence` **13** · `ui-feedback-layer` **73** · `ui-quiet-enterprise` **146** · `http-errors` **31** · `api-error-mapping` **26** · `cost-calculator` **4** · `status-labels` **12** · `datetime-format` **6**；走查 **152** 屏 R1–R4 全 0，弹窗态 8/8。

**QA 定向复验（`41c0ac1`）零回归，H2 双向证成，八项变异全红，本批为最终放行点。** 遗留的 7 项残留（`CAPABILITY_BASELINE.md` §5.9）与 2 项跨团队耦合已**如实登记、未粉饰** —— 其中「信号层可能掩盖真实缺陷」与「`ui-feedback-layer` 依赖 `/consultation`」属**已知未闭环**，需后续批次（或用户裁定）处理。
