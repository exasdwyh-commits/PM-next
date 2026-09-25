# Digital Employee Executor + 统一 Worker 设计方案

> 状态：**M1 + M2 + M4 已实现**（M3 Muse 增强刻意未做，见 §四）
> 日期：2026-09-25（实施更新）
> 关联：`docs/OPTIMIZATION_PLAN_2026-09-25.md`（问题台账）、QA crash-lease/retry + fencing（已合入）
> 对应评审 4 件事：① QA CAS/fencing 收尾（已合入）、② Executor + Worker（本文档，已实现）、
> ③ Executive Report Renderer（§七，已完成）；④ reasoning 收敛未做。

---

## 〇、实现状态（2026-09-25 本轮）

| 能力 | 状态 | 证据 |
|---|---|---|
| `npm run worker` / `npm run worker:once` | **已实现** | `scripts/pm-worker.ts`、`src/modules/worker/index.ts` |
| 四个 loop（executor / research / event / reconcile） | **已实现** | `src/modules/worker/loops.ts` |
| Digital Employee Executor + 策略表 | **已实现** | `src/modules/worker/executor.ts` |
| executorLease（崩溃可恢复 + fencing） | **已实现** | `src/modules/worker/claim.ts` |
| 单实例文件锁 + 心跳 + 优雅退出 | **已实现** | `src/modules/worker/index.ts` |
| 失败退避重排（1min / 5min / 25min，3 次后留 FAILED） | **已实现** | `src/modules/worker/backoff.ts` |
| 诚实缺省（BLOCKED + missingInputs + DataGap 落库） | **已实现** | formulation / cost / compliance / scientific 四路 |
| 报告「零证据绑定」诚实守卫 | **已实现** | `synthesizeProductRndExecutiveReport()`：`evidences.length === 0` 时强制登记未闭合项 + 风险，见 §七 |
| Muse summary 增强（M3） | **未做（刻意）** | 见 §四「为什么先不做 M3」 |
| QA 由 Worker 执行 | **不做（边界）** | 见 §三「QA 不由 Worker 执行」 |

回归：`npm run test:worker`（W1–W9，含五路自动终结 / 诚实缺省 / 幂等 / 租约崩溃恢复 /
fencing / 单实例锁 / 报告落盘 + 零证据守卫）。既有 `test:qa-dedup`、`test:qa-retry`、
`test:product-rnd-fusion`、`test:workforce`、`test:business-events`、`test:system-principal`
保持绿。

---

## 一、目标与不做什么

### 目标

把系统从「请求链路驱动」升级为「后台自主推进」：

```text
QUEUED AgentTask
   ↓ Executor 自动 claim（lease）
   ↓ 读取 Agent Role / Skills / contextSnapshot
   ↓ 执行策略（确定性模块为主，Muse 为辅）
   ↓ Structured Output
   ↓ AgentRun / ModelRun 留痕
   ↓ finishAgentTask()
```

关掉浏览器后：研究继续推进、任务继续完成、事件继续分发、报告最终落盘。

### 明确不做（边界）

| 不做 | 理由 |
|---|---|
| Executor 不碰 Verifier / Evidence Gate / ToolBroker 授权 | 治理边界是系统强项，保持 |
| Executor 不自动批准 G1/G2/G3 | 人工审批是产品定位 |
| Executor 不让 Muse 自由生成结论 | hallucination 直接污染 Executive Report；见 §三 |
| 不做分布式多 Worker 竞争 | 单机单实例足够；用 lease 保证崩溃可恢复即可 |
| 不重写 Business Event outbox | 已有 lease/attempt/maxAttempts，直接复用 |

---

## 二、统一 Worker（pm-worker）

**一个进程、四个 loop、共享退出信号**。不给每个模块各造定时器。

```text
scripts/pm-worker.ts                     ← 入口（npm run worker）
src/modules/worker/
  ├── index.ts        runPmWorker()      ← 主循环编排 + graceful shutdown
  ├── loops.ts        四个 loop 的单轮实现（幂等，单轮自己判断就绪项）
  ├── claim.ts        AgentTask 执行 lease（复用 qaClaim 的 CAS+lease 模式）
  └── backoff.ts      指数退避 + 抖动
```

### 四个 loop（各自幂等，崩溃不影响正确性）

| Loop | 周期（初值） | 单轮做什么 | 复用 |
|---|---|---|---|
| `executorLoop` | 5s | 找 QUEUED 且 agent 有 `executorStrategy` 的 AgentTask → claim → 执行 → finish | §三 Executor |
| `researchLoop` | 30s | 找 RUNNING/非终态 ResearchRun → `resumeResearchRun()` | 已有 `resumeResearchRun` |
| `eventLoop` | 10s | `dispatchPendingBusinessEvents(org, {workerId, processAutopilot:true})` | 已有，含 lease |
| `reconcileLoop` | 60s | 对每个活跃 Product R&D parent 调 `advanceProductRndProgram`（用系统 session） | 已有 |

### 关键决策

1. **多组织**：Worker 不绑定单一 org。每轮先 `SELECT DISTINCT organizationId FROM AgentTask WHERE status='QUEUED'`（以及 ResearchRun/BusinessEvent 各自的就绪集），逐 org 处理。Executor 的模型策略本来就按 org 解析（`AgentModelPolicyBinding`）。
2. **系统身份**（已实施，与原提案不同）：复用既有的
   `getOrCreateSystemPrincipalSession(orgId)`——每组织一个保留身份
   `system+<orgId>@hermes.invalid`，`isSystem=true`、无口令、不可登录（autopilot 也在用它）。
   不再新造 `worker@hermes.test` 可登录账号。
   **但**：系统身份按设计没有组织成员/项目角色，而 `startAgentTask` /
   `finishAgentTask` / `delegateAgentTask` / `advanceProductRndProgram` 都要求
   `requireProjectRole(..., [OWNER, DECISION_MAKER])`。因此 Worker 会对自己确实要处理的
   项目**幂等补一条 `ProjectMember(role=DECISION_MAKER)`**（`ensureWorkerProjectAccess`）。
   - 为什么不用更窄的 `Role.DIGITAL_WORKER`：该角色存在于枚举中，但没有任何服务函数
     的白名单认它；改用它需要先给上述服务函数扩白名单。**这是本轮明确的 follow-up**
     （见 §六），为控制影响面本轮不动治理代码。
   - Worker 侧硬边界不依赖角色：代码里不存在调用审批 / Gate / ToolBroker 的路径；
     只对「确实有待执行任务」的项目授权。
3. **单实例保证**：`WorkerLease` 表（单行心跳，`workerId + heartbeatAt`）。第二个 Worker 启动时发现心跳 < 30s 则退出；心跳停止 60s 后可被接管。避免双实例双倍执行（loop 本身幂等，这只是省资源 + 防乱序）。
4. **优雅退出**：SIGTERM → 停止领取新任务 → 等当前 task 完成（上限 10min）→ 释放未完成 claim（lease 自然过期也行）→ 退出。
5. **背压**：executorLoop 每轮最多并发 `MAX_CONCURRENT_TASKS=2`（受本地 Muse 单 slot 限制；Muse server 是单模型实例，并发推理会排队）。每个 agent 的 `maxConcurrentTasks` 字段已存在，尊重它。

### QA 不由 Worker 执行（重要边界，直接回应评审的 M2 验收写法）

评审原文的 M2 验收是「START 后关浏览器，五路任务自动完成、QA 自动排队、报告落盘」。
前半段已实现并可复现；**但「报告落盘」不能由 Worker 独立完成，也不应该**：

- 系统治理的硬约束是**独立 QA 不得由产出方自证**。Worker 就是跑五个 specialist 的
  同一个系统身份，让 Worker 去跑 `qa_verifier` 等于自己给自己签字，会直接破坏
  「独立 QA」这个产品定位。
- 因此 `EXECUTOR_STRATEGIES` **刻意不包含 `qa_verifier`**，并且回归测试里有一条断言
  专门锁死这件事（防止以后有人"顺手"补上）。
- 正确的验收口径：**五路任务自动终结 + QA 自动排队**由 Worker 保证；报告落盘由
  「QA 独立完成」触发既有自动 advance 链路完成（`test:worker` 的 W9 就是这么验证的：
  用独立身份完成 QA → 报告自动生成，unknowns 明确列出缺口）。

### 失败重试与退避（已实施）

策略：某路执行抛异常 → 正常 `finishAgentTask(FAILED)` 关闭本次 AgentRun（不留 RUNNING
悬挂）→ 若 `executorState.attempts < 3`，把任务重新排回 `QUEUED` 并把 `availableAt`
设为退避时间（1min / 5min / 25min）；3 次用尽则保持 FAILED，由报告 unknowns 呈现给人。
`startAgentTask` 自身会拒绝 `availableAt` 未到的任务，所以退避是**由既有机制执行**的，
不需要额外定时器。

### Backoff / 重试

| 对象 | 机制 |
|---|---|
| BusinessEvent | 已有 `attempt/maxAttempts/lease`，不改 |
| ResearchRun | 已有状态机 + errorReason；Worker 只负责 resume，连续失败 3 次后 blockedReason 置为需要人工 |
| AgentTask（Executor 执行失败） | 新增 `contextSnapshot.executorState = {attempt, lastError, nextRetryAt}`；退避 1min/5min/25min，3 次后 task → BLOCKED（人工介入）。**不改** AgentTask 表结构（jsonb 扩展），避免迁移 |
| Worker 崩溃 | AgentTask 执行 lease `executorLease`（同 qaClaim 模式：`{token, expiresAt}`，过期可重抢）——QA 修复已验证过该模式 |

---

## 三、Digital Employee Executor

### 核心原则：确定性优先，Muse 只做「结构化总结」不做「结论生成」

五个 specialist 的产出必须是**可审计的结构化数据**。现状它们有确定性模块：

| Agent | 执行策略（v1） | Muse 的角色（可选增强 v2） |
|---|---|---|
| `research_agent` | 调 `runResearchRunTasks` 关联的 market-research 模块产出证据/claim | 无（已确定性） |
| `scientific_evidence_agent` | 调 `scientific-evidence.ts` 模块 | Muse 把 claim 清单写成人话摘要（仅 outputSummary） |
| `formulation_agent` | v1：BLOCKED with明确 missingInputs（等待人输入配方约束）——**诚实缺省** | 无 |
| `compliance_agent` | v1：基于已收证据做规则检查（官方来源校验已有 evidence 链路），产 structured checklist | Muse 总结，不判断 |
| `cost_bom_agent` | v1：BLOCKED（缺真实价格来源，禁止编造 BOM） | 无 |

> 这是与"让 5 个 agent 都被 LLM 驱动"的根本分歧：**formulation/cost 这类没有数据就必然编造的任务，Executor 的正确行为是快速 BLOCKED + 精确 missingInputs**（与 UNKNOWN 保留哲学一致），而不是生成看起来专业的假数据。评审可改此立场，但默认按此实现。

### Executor 执行一个 AgentTask 的流程

```text
1. claim: AgentTask.contextSnapshot.executorLease CAS（WHERE 无活跃 lease 或已过期，
   AND status='QUEUED'），失败即跳过（别的 worker/请求在处理）
2. startAgentTask（QUEUED→RUNNING，产生 AgentRun）
3. 按 agent.code 查执行策略表 executorStrategy（新模块内常量，同 PRODUCT_RND_SPECIALISTS 风格）
4. 执行：
   a. 确定性模块：直接调用，产出写 contextSnapshot.result + AgentRun.outputSummary
   b. 需要模型增强的：组装 prompt（role.instructions + task.goal + 已收证据引用），
      走 executePersistedModelGateway（taskClass 用现有非 ASSISTANT 类，如 SYNTHESIS——
      策略绑定由 org 的 AgentModelPolicyBinding 决定，未配置则 safe-off 跳过增强，不阻塞主产出）
5. finishAgentTask(SUCCEEDED/FAILED/BLOCKED)
   - Product R&D child 终结时已有的自动 advance 链路会接管（报告合成→parent 关闭）
6. 释放 executorLease（写 executorState 落定）
```

### 与 Model Policy 的关系

- 每个 agent 的模型策略已由 `AgentModelPolicyBinding` + policies 管（`assistant-*-resident` 是 Assistant 专用）。
- specialist 增强走新 policyKey（如 `research-summary-resident`），**默认不绑定**——未绑定 = 纯确定性执行，系统照常工作。这保证 Executor 上线不依赖 Muse 运行。
- Muse 不可用时增强步骤降级：outputSummary 写确定性模板串，`errorReason` 不设（不算失败）。

### 安全边界（硬编码，策略不可覆盖）

```text
executorStrategy 允许的动作白名单（v1）：
  - 调用 research/evidence 确定性模块         ✅
  - 写自己 task 的 contextSnapshot/output     ✅
  - 走 model gateway（policy 未绑定则跳过）    ✅
  - 创建 Evidence/Claim/Verification          ✅（走既有服务函数，继承其校验）
  - 标记 claim 为 VERIFIED                    ❌ 硬禁止
  - 调 ToolBroker 外部动作                     ❌ v1 不开放
  - 改其它 AgentTask / WorkItem / Approval     ❌ 硬禁止
  - finish 自己 → 触发既有自动 advance         ✅（已有链路）
```

---

## 四、实施阶段

| 阶段 | 内容 | 验收 | 状态 |
|---|---|---|---|
| **M1 Worker 骨架** | `npm run worker` + 4 loop + 单实例锁 + graceful shutdown | 关浏览器后 ResearchRun 自主推进到 PUBLISHED；BusinessEvent 被 drain | **已实现** |
| **M2 Executor 最小集** | claim lease + 策略表 + **五个 specialist 全部具备合法 v1 executor strategy** | START Product R&D 后关浏览器：**五路任务全部自动终结**（允许其中若干路是 `BLOCKED + DataGap + missingInputs`）+ QA 自动排队 | **已实现** |
| **M3 Muse 增强** | summary 增强 policy + 降级路径 | 增强开关对系统无侵入（Muse 停掉 → 一切照常，只是摘要变模板串） | **未做** |
| **M4 诚实缺省完善** | formulation/cost/compliance/scientific 的 BLOCKED + missingInputs 规范化（DataGap 自动创建） | 报告 unknowns 明确列出缺什么，而不是编造 | **已实现**（并入 M2） |

### M2 验收口径修正（评审指出原写法逻辑不成立）

原文写「`research_agent` / `scientific_evidence_agent` 最小执行器完成后…五路任务自动完成」，
这是自相矛盾的：只实现两路，`formulation / compliance / cost` 没人执行，工作流必然停住。

修正后的口径（也是本轮的实现与测试口径）：

> **五个 specialist 必须都有 v1 executor strategy。** 当某一路缺乏真实输入时，它的正确
> 终态是 `BLOCKED + DataGap + 精确 missingInputs`，而不是「未执行」。只要有一路没有
> strategy，链路就会卡在 QUEUED 上——这正是本轮要求「全部覆盖」的原因。

### 为什么先不做 M3（Muse 增强）

M3 是**纯增益**、不影响正确性：目前五路要么确定性产出，要么诚实 BLOCKED。在
「关浏览器能自己干活」这个核心能力尚未被验证充分之前引入模型增强，只会让
「产出是确定性结论还是模型措辞」变得难以审计。M3 的建议落点已经写清楚（只做
`outputSummary` 措辞，policy 未绑定即跳过），等 M1/M2 在真实项目上跑几轮再上。

---

## 五、测试策略（已实现）

- `tests/worker-executor.ts`（`npm run test:worker`）：
  - W1 策略表完整性 + 「qa_verifier 必须不在表里」的独立性锁；
  - W2 ResearchRun 无人值守自主发布；
  - W3 五路自动终结（1 SUCCEEDED + 4 诚实 BLOCKED）；W4 DataGap + HONEST_BLOCKED 载荷；
  - W5 幂等（对已终结任务再跑一轮 acted=0）；W6 reconcileLoop 补排 QA；
  - W7 executorLease 崩溃恢复 + fencing（旧 token release 无效）；
  - W8 单实例锁（活跃锁拒绝 / 陈旧锁接管）；
  - W9 QA 独立完成后报告落盘，unknowns 含配方/成本缺口，且**零证据绑定时必须登记
    未闭合项并产生风险**（见 §七）。
- 既有 `test:qa-dedup` / `test:qa-retry` / `test:product-rnd-fusion` / `test:workforce` /
  `test:business-events` / `test:system-principal` / `test:autopilot` / `test:governance` /
  `test:unknown-injection` 全部保持绿。

### 本轮附带的一个产品级修复

`finishAgentTask` 原先只在 `SUCCEEDED / FAILED` 时写 `AgentRun.outputSummary`，
`BLOCKED` 会被丢掉。于是「诚实的缺口说明」传不到管理报告的 `advisoryNotes`，
报告里只剩一句机器 `blockedReason`。已改为 `BLOCKED` 也写入 `resultSummary`
（`src/modules/workforce/service.ts`）。

---

## 六、决策点与遗留 follow-up

已决策：

1. **formulation / cost 的「诚实 BLOCKED」立场：采纳并实现。** 没有真实输入时
   Executor 的正确行为是快速 BLOCKED + 精确 missingInputs + DataGap 落库，
   由报告 unknowns 呈现给人，而不是让模型编一个看起来专业的 BOM/配方。
2. **Worker 系统身份：复用系统 principal + 幂等补 `ProjectMember(DECISION_MAKER)`。**
   不新造可登录账号。
3. **reconcileLoop：上。** 成本极低，且覆盖「finish 触发的自动 advance 失败/没跑」的场景。
4. **并发上限 2：保留。** 当前策略是确定性的，这个值主要防 DB 抖动；未来接 Muse 再评估。

遗留 follow-up（本轮未做，已明确）：

1. **把 Worker 的权限收窄到 `Role.DIGITAL_WORKER`**：需要给
   `startAgentTask` / `finishAgentTask` / `delegateAgentTask` / `advanceProductRndProgram` /
   `queueProductRndQa` / `synthesizeProductRndExecutiveReport` 的角色白名单加入
   `Role.DIGITAL_WORKER`，然后 Worker 只用该角色。当前用 DECISION_MAKER 是权宜，
   影响面清晰但没有最小权限。
2. **researchLoop 的槽位饥饿**：`researchLoopOnce` 每轮取最旧的 N 个 RUNNING 批次，
   若存在长期卡住的 RUNNING 批次会占用槽位（已用 7 天窗口兜底）。
   修法：对「无 QUEUED 且无陈旧 RUNNING 任务」的批次标记 `BLOCKED` 并移出候选集。
3. **M3 Muse summary 增强**（见 §四）。
4. **专家侧结构化 claim / DataGap 落库**（本轮新发现，见 §七「副产物发现」）：
   走 LLM 路径的专家只写叙述性 `outputSummary`，不落 `Evidence` / `Claim` /
   `DataGap`，导致报告零证据。修法：专家执行收口时把结论与缺口结构化成
   `Evidence.claims` / `DataGap`，报告才能真正「结论有据」。
5. **Executive Report Renderer 已落地**（评审 4 件事的第 4 件），见 §七。

---

## 七、Executive Report Renderer + 「零证据」诚实守卫

评审第 3 件（Renderer）本轮落地，并在真实数据上发现并修掉一个报告真实性问题。

### 7.1 Renderer 落地

| 层 | 文件 | 做什么 |
|---|---|---|
| 后端裁剪 | `src/modules/product-rnd/orchestrator.ts` `buildExecutiveReportPreview()` | 把完整 `ProductRndExecutiveReport` 裁成负责人视图（溯源引用限量），失败返回 `null` 而不是把原始 JSON 丢给前端 |
| 共享类型 | `src/shared/executive-report-types.ts` | `ExecutiveReportPayload` 等；溯源预览上限常量 |
| 前端视图 | `src/components/executive-report.tsx` | 8 个分区：摘要 / 结论与证据（带证据等级 Badge）/ **未闭合项（UNKNOWN）** / 风险 / 需负责人决策 / 建议动作 / 数字员工意见 / 溯源。空数据走 `Empty` |
| 面板接线 | `src/components/product-rnd-panel.tsx` | 接 `/api/projects/[id]/product-rnd`，渲染五路任务 + 报告 |
| 页面接入 | `src/app/projects/[id]/project-detail-client.tsx` | 删除此前**从未渲染**的 START/RECONCILE 死代码，改为挂载 `ProductRndPanel` |

验证：`scripts/verify-executive-report-ui.mjs`（playwright 真实浏览器，13 项检查全绿，
含「报告容器内无 JSON 原文直出」与报告容器截图）。

### 7.2 诚实守卫（副产物发现，已修）

**现象**：dev 库中一份真实报告出现自相矛盾——

```text
摘要：已汇总 6 个数字员工任务、0 条证据、0 条 claim；当前 0 个未闭合项，QA 状态：READY_FOR_HUMAN_REVIEW。
未闭合项（UNKNOWN / 缺口）(0)    ← 报告说自己健康
风险                             ← 空
但 advisoryNotes 里专家自己写着：
  research：…标注 2 个来源缺口
  scientific：…2 项关键 claim 证据等级 UNKNOWN 待补
  cost：关键原料价格缺真实供应商报价，已列为缺口
```

**根因**：`unknowns` 只从 DataGap / KnowledgeDebt / **证据等级为 UNKNOWN 的 claim** /
**非 SUCCEEDED 的专家** 四个来源收集。LLM 专家路径「成功」但只写叙述摘要、
不落 `Evidence`/`Claim`，于是四个来源同时为空 → 报告显示成一份零缺口的健康报告。
「0 条证据」的结论直接被当成可提交人类审查。

**修法**（只做可判定的检查，不解析专家自由文本——那会变成猜测）：

```ts
const hasNoBoundEvidence = evidences.length === 0;
// unknowns 追加：报告未绑定任何结构化证据（N 个专家任务均未落 claim）：
//              现有摘要属专家意见而非可追溯结论，不得作为业务批准依据。
// risks   追加：报告零证据绑定：所有结论都无法沿引用回到原始来源。
```

连带效果：`decisionsRequired` 自动从「是否进入下一业务门」变成「是否继续补证/返工」，
`recommendedActions` 自动前置「优先处理高影响 DataGap / KnowledgeDebt」。

**注意（治理语义）**：合成是幂等的——work item 处于 `SUBMITTED / ACCEPTED` 且已有报告时，
`alreadySynthesized` 直接返回存档，**不会**追溯改写历史报告。所以该守卫只对
新合成的报告生效；历史 artifact 保持不变（结论性 artifact 不可事后篡改）。

**验证证据**：

- 单测：`npm run test:worker` → W9 `unknowns=9 项（含零证据守卫），risks=2`；
- 端到端：对一份真实 program 收口独立 QA 后合成，报告摘要由「0 个未闭合项」
  变为「当前 1 个未闭合项」，并列出该未闭合项与 2 条风险。
