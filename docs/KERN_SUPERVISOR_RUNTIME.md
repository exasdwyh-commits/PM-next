# Kern Supervisor Runtime · 架构决策 ADR-001

日期：2026-09-26 · 状态：**已实现第一阶段** · 取代 `KERN_ARCHITECTURE_V2.md` 中 “P1 Supervisor runtime” 的 Shadow 方案

## 1. 看代码得出的诊断（不是看文档）

| 问题 | 从代码看到的事实 | 判断 |
|---|---|---|
| Kern 是不是 Personal AI？ | 每一轮对话 = 分到 8 个 intent 中的一个 → 执行一个 capability → LLM 把工具输出润色一遍（`conversation-engine.ts`）。所有 plan 都是在**回复之后**才算出来的，而且只是 shadow | **不是。** 现在是一个带护栏、诚实的**意图路由 + 工具摘要器** |
| 有 Supervisor 吗？ | `goal-plan.ts` 写死了 `autoCreateAgentTasks: false`；唯一能真正派发的是单个 Tech Architect（`dispatch-readiness.ts`） | **没有。** Router + 1 个试点专家 |
| Agent / Skill / Model / Tool 抽象 | Agent/Skill/Policy 数据模型不错；但 executor 是写死的 strategy 表，12 个 Agent 里只有 6 个能执行，**marketing / product / ops / red_team / qa / Kern 的任务会永远停在 QUEUED** | 数据模型保留，执行层有缺口 |
| Memory | CompanyFact + 知识库 + 业务对象；没有情景记忆（episodic），没有用户模型 | 语义记忆够用，没有“长期理解用户”的能力 |
| Harness | Prediction → Outcome → Lesson，全部依赖人工 review，没有 Promotion Loop | 能记录，但不会越用越强 |
| UI 有、底层没有 | 聊天里的 `plan` block（`types.ts`）从来没有真实数据生成过；Workforce 页面展示的 Agent 大多执行不了 | 名副其实的“界面比能力大” |
| 能力有、UI 没有 | Product R&D 编排器、Evidence UNKNOWN 保留、Governance gate 都很强，却埋在产品详情页 tab 里 | 应该由 Kern 在对话里调度并汇报 |
| 过度设计 | 11 条 CI、40+ 份交付/验收文档；同一件事有 Hermes / Muse / Jarvis / Advisor / Kern 五个名字；`jarvis` 模块只剩一个类型；`/advisor` `/consultation` `/war-room` `/dashboard` `/manage` 多个入口职责重叠 | 需要收敛 |

## 2. 这次的决定

**把 Shadow GoalPlan 变成真正能执行的 Mission，并且完全复用现有的 AgentTask / Worker / Delegation 内核。** 不新增表，不写平行的任务系统。

```
用户："我想开发一个新的产品"
  → Kern 回复 + decideMissionLaunch（纯函数，只接手内部可逆的分析类工作）
  → Mission 根任务（hermes_pm, RUNNING, contextSnapshot=kern-mission/v1）
  → 每个 DAG 节点对应一个真实的子 AgentTask（带 AgentDelegation 血缘、幂等 key）
  → 现有 pm-worker 执行 → Generic Agent Executor（Agent 身份 + Skills + 已确认事实 + 上游产出 → Model Gateway）
  → finishAgentTask → advanceKernMission（对根任务加行锁，幂等）
  → QA 判定 REVISE → 只返工被点名的节点及其下游，返工一轮（有预算上限）
  → 综合（Kern）→ 只向原会话回报一次
  → 没有可用模型 / 关键节点失败 → 如实报 BLOCKED → NEEDS_USER，不编造结论
```

### 模块

| 文件 | 职责 |
|---|---|
| `src/modules/supervisor/plan.ts` | 纯函数：新产品 Playbook、GoalPlan→MissionPlan、DAG 校验、`decideMissionStep` 监督策略、返工、QA 解析 |
| `src/modules/supervisor/generic-executor.ts` | 任何 Agent 都能执行 mission 节点；依次尝试 agent 自己的 policy → Kern 的 policy；都不行就诚实地 BLOCKED |
| `src/modules/supervisor/service.ts` | 启动 / 推进 / 查询状态 / 回报对话 |
| `workforce/service.ts` | mission 子任务结束 → 推进 mission（和 Product R&D 的做法一样）；监督中的根任务不占 Agent 的并发槽位 |
| `worker/executor.ts`, `worker/loops.ts` | mission 节点走通用执行器；reconcile loop 负责恢复中断的 mission |
| `assistant-runtime/service.ts` | 对话入口：满足条件就启动 mission，回复里只加一句“我已接手” |
| `app/api/missions/[id]` + `muse/components/mission.tsx` | 对话里的一张实时进度卡（第一次让 `plan` 类 UI 有了真实数据） |

### 监督策略（`decideMissionStep`）

1. 依赖全部结束就派发；上游失败的部分按 UNKNOWN 往下游传，**降级而不是卡死**。
2. QA 判 REVISE 时，只返工被点名的节点及其下游，最多返工 `maxRevisionRounds` 轮。
3. 任务预算是硬上限，超出的节点标为 SKIPPED，并在综合结论里说明。
4. 综合节点没有成功，或关键节点没有成功 → NEEDS_USER（根任务进入 WAITING_HUMAN）。
5. Mission 只做分析和建议；所有写入、对外发布、支付、正式 Gate 仍然走原有 Governance 通道。

## 3. 保留 / 替换 / 风险

- **保留**：AgentTask / Run / Delegation / Worker / 租约 / 重试、Model Gateway、Governance、Product R&D 编排器、Evidence。
- **替换**：“GoalPlan 只能 Shadow” 的限制 → 满足条件时可以真正执行。Tech Architect 单专家试点仍然保留，作为 SOLO/SPECIALIST 的路径。
- **风险**
  - 触发过宽，会产生不必要的模型成本 → 目前只在“新产品目标”和 PAIR/COUNCIL/RED_TEAM 时启动，并且有任务预算。
  - Product R&D 编排器和 Mission 暂时并存，是两套编排 → 下一阶段把 Product R&D 改成 Mission Playbook，届时复用它的 QA 槽位与 ResearchRun。
  - 通用执行器目前没有联网工具 → prompt 已明确要求“没有来源就写 UNKNOWN”；下一步接入 ResearchRun 和 Desktop 工具。
- **验证**：`test:kern-supervisor-plan`（7 个纯函数用例）、`test:kern-supervisor`（真实数据库和 worker loop：DAG → 返工 → 综合 → 回报一次；无模型时诚实升级；对话入口）、既有的 workforce / golden-org / autopilot / product-rnd-chat 等回归全部通过；新增 `kern-supervisor-ci.yml`。

## 4. 下一阶段（按优先级）

1. **Attention Engine + 决策预算**：Mission 的 NEEDS_USER 和 STRATEGIC_VALUE_TRADEOFF 汇总到首页“需要我处理”，其余全部静默处理。
2. **工具化的专业成员**：research 节点接入 ResearchRun 和 Evidence（有真实来源），以 source-backed 的方式替代纯模型推断。
3. **Product R&D → Mission Playbook**：合并成一套编排器。
4. **Episodic Memory**：每个结束的 Mission 生成一条“我们一起做过什么、结果如何”的记忆；Kern 规划时读取；用户偏好从被否决和修改过的结论中学习。
5. **Harness Promotion**：以 Mission 的真实结果（ProductOutcome）为标签，评估 playbook 版本，走 champion/challenger 流程。
6. **IA 收敛**：只保留 Kern（对话）+ Workbench（业务对象）+ Settings；`/advisor` `/consultation` `/war-room` `/dashboard` 合并或下线；统一只用 “Kern” 这一个名字。
