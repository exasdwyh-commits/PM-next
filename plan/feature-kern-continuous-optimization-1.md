---
goal: Kern 首次可用、持续可靠、产出可验收的持续优化
version: '1.0'
date_created: '2026-10-05'
last_updated: '2026-10-05'
owner: Codex / 当前会话
status: 'In progress'
tags: [feature, architecture, reliability, acceptance]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In%20progress-yellow)

用户于 2026-10-05 授权按建议制定目标并持续优化。执行目标已在本会话建立。主场景为竞品调研，第二场景为新品方向评估。项目根为 `/Users/exasdwyh/Documents/VScode/Kern/pkg-full`；下文路径均相对此根。每个任务只有在实现及列出的验收均完成后标记完成。

## 1. Requirements & Constraints

- **REQ-001**：新工作区具备幂等默认团队和默认模型策略；不覆盖自定义模型、禁用状态、账号密码或其他组织数据。
- **REQ-002**：计划展示和正式启动共用准备检查。输入缺失、团队缺失、模型未配置、Worker 不在线、额度不足均有中文处理说明；配置就绪不宣称连接探测成功。
- **REQ-003**：竞品对象为必填；区域、渠道、时间范围、维度使用默认值并允许编辑。输入、计划、验收和产出使用同一任务上下文。
- **REQ-004**：计划说明只列实际存在的节点和能力；完成执行、自动验收和用户接受分别记录。
- **REQ-005**：慢任务不中断心跳；取消停止新增调用；旧执行者失去提交权。外部动作已发送时记录真实回执。
- **REQ-006**：重复消息提交只创建一次执行；网页刷新后恢复到同一执行；所有模型路径统一尝试、额度、取消和超时记录。
- **REQ-007**：关键主张绑定来源及支持段；UNKNOWN、冲突和时效不合格不得升级为确定事实。
- **REQ-008**：竞品比较表可编辑、保留版本、按受影响字段重跑；下一步可通过现有审批生成结构化工作项。
- **SEC-001**：保留组织/所有者隔离与受保护动作审批；测试入口只允许显式启用的本机开发模式。
- **CON-001**：保留现有 Next.js、Prisma、PostgreSQL、模块与独立 Worker；新增依赖必须证明现有库无法实现。
- **CON-002**：数据库回归仅使用隔离测试库；迁移通过追加迁移实现，禁止 reset 或破坏现有开发数据。
- **CON-003**：本地包无 Git 历史；改动前为涉及文件保存可恢复副本。最终报告不声称已提交或在线 CI 已通过。
- **CON-004**：先完成本地实现和故障回归。真实模型/搜索质量验证需可用配置；无配置时记录具体条件，不编造实测结果。
- **PAT-001**：状态维护在此计划，详细证据维护在 `plan/kern-optimization-progress.md`。每阶段至少一次浏览器验收。

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001：首次进入能准备运行，竞品缺输入先澄清，计划准确描述真实能力。
- 依赖：无。TASK-003 依赖 TASK-002，TASK-005 依赖 TASK-003 与 TASK-004，TASK-006 依赖前述全部。

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | 建立本计划、会话目标和进度文件；记录本地服务及测试边界。 | ✅ | 2026-10-05 |
| TASK-002 | 新增 `src/modules/workspace/setup.ts` 的 `ensureWorkspaceSetup(session)`；复用 workforce/model-control 初始化，只安装缺失默认值；修改 `scripts/local-test.ts` 在账号建立后初始化。隔离库重复运行无重复团队、策略或覆盖用户修改。 | ✅ | 2026-10-05 |
| TASK-003 | 新增 `src/modules/supervisor/readiness.ts` 的 `getMissionReadiness(session, plan)`；使用 Worker 心跳、实际 agent/policy/provider/tool 配置及 `getUsage`。在 `supervisor/brief.ts` 的 `withEstimate` 返回并在正式 launch 前服务端重查；保留演示独立规则（可缺模型和检索，仍需团队和执行器）。 | ✅ | 2026-10-05 |
| TASK-004 | 新增 `src/modules/supervisor/competitor-brief.ts` 的 `detectCompetitorResearch` / `requiredCompetitorQuestions`；修改 `buildClarifyQuestions`、`buildBriefPlan` 与 `actOnBrief`，对象缺失不得跳过；升级旧未启动 brief 时保留用户输入。 | ✅ | 2026-10-05 |
| TASK-005 | 修改 `src/app/muse/components/brief.tsx` 显示准备问题与设置入口，正式开始仅在准备好时开放，模型或检索缺失时仍可演示，执行器缺失时同时阻止正式和演示启动；从真实节点生成成员/红队/QA 说明，补 `mission-timeline.ts` 角色名称。 | ✅ | 2026-10-05 |
| TASK-006 | 新增准备/澄清单元与数据库回归；更新受影响既有测试。通过 typecheck、针对性 lint 和回归，浏览器验证当前空对象会话、新工作区初始化和缺服务提示。 | ✅ | 2026-10-05 |

### Implementation Phase 2

- GOAL-002：任务可控、故障可恢复、消息与费用可以对账。
- 依赖：GOAL-001。TASK-008 依赖 TASK-007；TASK-009 与 TASK-010 可独立实现；TASK-011 依赖本阶段全部。

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-007 | 修改 `worker/index.ts` 为独立心跳，退出清理定时器；在 `worker/registry.ts`、`executor.ts`、`supervisor/tools.ts`、`model-gateway/types.ts`、`provider-runtime.ts` 贯穿 AbortSignal；每次新增工具调用前检查任务状态，区分取消与 provider 故障。 | 是 | 2026-10-05 |
| TASK-008 | 在 `worker/claim.ts` 定义提交权校验；`executor.ts` 结果与完成写入使用领取 token 校验及事务；`recovery.ts` 保留代次保护，旧执行者不得写入或删除新租约。连接器写操作前复查，沿用动作指纹和回执。 | 是 | 2026-10-05 |
| TASK-009 | 给消息入口增加客户端幂等标识及原子接收；使用追加 Prisma 迁移保存消息执行关联。在 `assistant-runtime/service.ts` / `conversation-engine.ts` 拆分接收与执行，由既有 Worker 执行并向 `muse-client.tsx` 回报状态；刷新/断线复用原执行 ID。 | 是 | 2026-10-05 |
| TASK-010 | 把 legacy Advisor LLM 通过 `model-gateway/runtime.ts` 适配；在 `supervisor/metrics.ts` 明确逻辑调用与实际尝试、成功、tokens 的不同字段，以 ModelRun 为尝试事实源；增加任务级尝试/耗时预算，未知金额保留未知。 | 是 | 2026-10-05 |
| TASK-011 | 增加慢调用、取消、失联接管、旧执行者回归、重复消息、额度并发和重试对账回归；限制 executor 并发和组织公平调度，证明慢组织不会阻塞另一组织进展。 | 否 | — |

### Implementation Phase 3

- GOAL-003：主张可追溯、场景可验收、产出可修改并转成行动。
- 依赖：GOAL-002。TASK-013 依赖 TASK-012；TASK-014 依赖 TASK-013；TASK-015 依赖本阶段全部。

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-012 | 新增 `supervisor/competitor-result.ts`，定义带对象/字段/来源/支持段/时间/状态的比较表和主张结构；追加迁移，复用 `evidence/verification-service.ts` 绑定项目内 capture/claim，未绑定项目保持 Mission 来源。业务来源保存失败必须阻止对应成功提交。 | 否 | — |
| TASK-013 | 在 `supervisor/contract.ts` 增加对象、必需维度、价格单位/时间与关键主张来源校验；UNKNOWN 与来源冲突保留状态；`response-format/from-mission.ts` 区分执行/验收/用户接受，在报告展示支持段。 | 否 | — |
| TASK-014 | 新增 `src/app/muse/components/competitor-result.tsx` 及对应所有者受控接口，比较表编辑生成不可变版本；重跑受影响字段与综合结论，保留未改字段及差异；`office-export.ts` 导出同一版本。 | 否 | — |
| TASK-015 | 扩展 `supervisor/takeaway.ts` 的行动项提案，保存负责人、依赖、交付与验收；复用现有确认。新增评测样例与 `scripts/kern-quality-eval.ts`，记录耗时、来源覆盖、修改、真实尝试/tokens；已配置真实服务时运行人工检查案例，否则明确缺失配置。 | 否 | — |

阶段完成门禁：所列回归通过，当前代码类型检查通过，浏览器行为与后台状态一致，结果和剩余实测条件写入进度文件。三阶段均达到门禁后才把会话目标标记完成。

阶段 1 已通过验收；阶段 2 的 TASK-007～TASK-010 已完成取消、接管提交保护、消息幂等、模型统一与任务预算。下一项是 TASK-011 并发与组织公平调度。第三阶段尚未实施，总体目标未完成。证据及运行边界见 `plan/kern-optimization-progress.md`。

## 3. Alternatives

- **ALT-001**：拆微服务或新队列。当前问题可通过现有 Worker 和数据库解决，新增部署组件会提高交付成本。
- **ALT-002**：扩大默认数字员工数量。先用竞品场景测量 QA/红队真实收益再扩展。
- **ALT-003**：直接用提示词约束全部验收。关键输入与结果字段采用结构检查，模型负责提议，状态与授权由业务逻辑决定。

## 4. Dependencies

- **DEP-001**：现有本地 PostgreSQL 和 Prisma 迁移；测试库角色必须保持隔离。
- **DEP-002**：现有默认 workforce、model-control preset 与 gateway。配置就绪和外部连接可用分别记录。
- **DEP-003**：真实模型与检索配置用于最终质量验证，缺失不阻止本地实现及测试替身验证。
- **DEP-004**：常驻 Worker 启动应收窄到测试工作区；旧组织待执行任务不得因测试启动被无意执行。

## 5. Files

- **FILE-001**：`scripts/local-test.ts`、`workspace/setup.ts`：首次初始化。
- **FILE-002**：`supervisor/readiness.ts`、`competitor-brief.ts`、`brief.ts`、`src/app/muse/components/brief.tsx`：输入与准备状态。
- **FILE-003**：`worker/index.ts`、`claim.ts`、`executor.ts`、`recovery.ts`、`supervisor/controls.ts`：执行可靠性。
- **FILE-004**：`assistant-runtime/service.ts`、`conversation-engine.ts`、消息 API 与 Muse：消息执行。
- **FILE-005**：`model-gateway/*`、`supervisor/metrics.ts`、`usage/index.ts`：调用事实与预算。
- **FILE-006**：`prisma/schema.prisma` 与新增迁移、`evidence/*`、`competitor-result.ts`：结果与来源。
- **FILE-007**：`office-export.ts`、`takeaway.ts`、版本化结果界面和接口：编辑与交接。
- **FILE-008**：`tests/`、`package.json`、`.github/workflows/kern-supervisor-ci.yml`：回归入口和质量评测。

## 6. Testing

- **TEST-001**：重复初始化不重复数据，不覆盖关闭的 agent/profile 和自定义 binding；非组织管理员不可初始化。
- **TEST-002**：缺对象不能进入 PLAN/launch；完整对象不重复追问；缺 Worker/模型不可启动正式任务；演示规则明确。
- **TEST-003**：旧计划保留输入并升级；中文提示和角色说明符合实际节点。
- **TEST-004**：慢任务期间心跳持续；取消后无新调用；旧租约结果被拒；服务崩溃后恢复正常。
- **TEST-005**：重复消息同 ID 同内容只执行一次，同 ID 异内容拒绝；来源查询权限保持隔离。
- **TEST-006**：provider 重试/切换逐次计数，逻辑调用和尝试可对账；预算耗尽无额外 HTTP 请求。
- **TEST-007**：比较对象/维度完整；价格单位与时间缺失可见；篡改支持段、冲突来源和无来源判断不能通过确定事实验收。
- **TEST-008**：编辑保留旧版本，只更新目标字段及依赖；导出版本一致；行动项按审批落地。
- **TEST-009**：所有数据库测试运行前执行 `assertTestDatabaseSafety`。新增 API 更新 authz matrix/coverage；新增表追加迁移。

## 7. Risks & Assumptions

- **RISK-001**：任务取消无法撤销已发送的远端动作，应显示回执，不伪造撤销成功。
- **RISK-002**：执行路径接线影响历史计划和兼容调用；逐阶段保留原测试并增加回归。
- **RISK-003**：真实研究质量不可由测试替身证明，最后单独列出真实验证结果。
- **ASSUMPTION-001**：用户授权持续推进本计划；任务状态以代码与当前验证为准，时间估算不当作承诺。
- **ASSUMPTION-002**：不自动部署、不对外发送、不修改用户凭证；已有外部动作审批持续生效。

## 8. Related Specifications / Further Reading

- [架构与落地建议](/Users/exasdwyh/Documents/VScode/Kern/架构与落地建议-20261005.md)
- [本地状态](/Users/exasdwyh/Documents/VScode/Kern/pkg-full/docs/KERN_LOCAL_STATUS_2026-10-05.md)
- [进度与验证](/Users/exasdwyh/Documents/VScode/Kern/pkg-full/plan/kern-optimization-progress.md)
