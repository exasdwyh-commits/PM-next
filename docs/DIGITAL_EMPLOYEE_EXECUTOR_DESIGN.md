# Digital Employee Executor + 统一 Worker 设计方案

> 状态：PROPOSAL（待评审后实施）
> 日期：2026-09-25
> 关联：`docs/OPTIMIZATION_PLAN_2026-09-25.md`（问题台账）、QA crash-lease/retry（已合入）
> 对应评审结论的 4 件事中的第 2、3 件（Executor 为第一优先级，Worker 承载 Executor）。

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
2. **系统身份**：Worker 用机器身份（新表 `WorkerLease` 或 env 指定的 service user）调这些服务函数；它们目前接收 `SessionContext`，传 `session={userId: systemUserId, ...}`。`assertCanInvokeAgent` 对 system agent 放行的路径需要核对（`isSystem=true` 的 agent 由 org admin 身份调用是现状；Worker 需要一个合法 user）。**建议**：seed 增加每 org 一个 `worker@hermes.test` 系统用户（ORG_ADMIN + project OWNER 不给——用 DECISION_MAKER 级别即可，够调 advance/finish，不能动审批）。
3. **单实例保证**：`WorkerLease` 表（单行心跳，`workerId + heartbeatAt`）。第二个 Worker 启动时发现心跳 < 30s 则退出；心跳停止 60s 后可被接管。避免双实例双倍执行（loop 本身幂等，这只是省资源 + 防乱序）。
4. **优雅退出**：SIGTERM → 停止领取新任务 → 等当前 task 完成（上限 10min）→ 释放未完成 claim（lease 自然过期也行）→ 退出。
5. **背压**：executorLoop 每轮最多并发 `MAX_CONCURRENT_TASKS=2`（受本地 Muse 单 slot 限制；Muse server 是单模型实例，并发推理会排队）。每个 agent 的 `maxConcurrentTasks` 字段已存在，尊重它。

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

| 阶段 | 内容 | 验收 |
|---|---|---|
| **M1 Worker 骨架** | `npm run worker` + 4 loop + WorkerLease 单实例 + graceful shutdown；executorLoop 先空转（只打日志） | 关浏览器后 ResearchRun 自主推进到 PUBLISHED；BusinessEvent 被 drain |
| **M2 Executor 最小集** | claim lease + 策略表 + `research_agent` / `scientific_evidence_agent` 确定性执行 | START Product R&D 后关浏览器，五路任务自动完成、QA 自动排队、报告落盘 |
| **M3 Muse 增强** | summary 增强 policy + 降级路径；`compliance_agent` 规则检查 | 增强开关对系统无侵入（Muse 停掉 → 一切照常，只是摘要变模板串） |
| **M4 诚实缺省完善** | formulation/cost BLOCKED + missingInputs 规范化（DataGap 自动创建） | 报告 unknowns 明确列出缺什么，而不是编造 |

M1+M2 完成即达成评审的「关浏览器以后 AI 还在干活」。M4 之后系统才配得上「客户演示」。

---

## 五、测试策略

- `tests/worker-loop-idempotency.ts`：同一 QUEUED task 被 loop 处理两次只产生一份产出。
- `tests/worker-crash-recovery.ts`：executorLease 过期占位 → 下一轮重抢（复用 qa-retry 测试手法）。
- `tests/worker-honest-default.ts`：无数据时 formulation/cost 快速 BLOCKED 且 DataGap 落库、报告 unknowns 含对应条目、无编造内容。
- 既有 `test:qa-dedup` / `test:qa-retry` / `test:golden-org` 全部保持绿。

---

## 六、待评审决策点

1. formulation/cost 的「诚实 BLOCKED」立场是否接受？（§三）
2. Worker 系统身份用 per-org `worker@hermes.test`（DECISION_MAKER 权限）是否接受？（§二.2）
3. M1 是否需要同时上 `reconcileLoop`？（Product R&D 已有 finish 触发的自动 advance + 前端轮询兜底；Worker 版只是补「关浏览器」场景——建议上，成本极低）
4. 并发上限 2（受 Muse 单实例约束）是否合理？未来 Muse 多实例（多进程分端口）再调。
