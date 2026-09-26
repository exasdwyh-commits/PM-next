# Kern V1.1 · Dynamic Routing & Council Architecture

> 局部运行时文档。主架构以 `docs/KERN_ARCHITECTURE_V2.md` 为准；本文件记录 Supervisor 路由与受限 AUTO 的实现细节。

状态：**已批准方向 / Shadow + 受限 Phase 2 AUTO**

## 1. 目标

Kern 不应该让用户每天手动选择 Agent 或模型。用户只描述目标，系统决定：

1. 这是普通对话、专业问题、复杂咨询、红队挑战还是完整研发；
2. 一个人做还是需要顾问团；
3. 需要哪些专家；
4. 需要多强的模型；
5. 是否需要研究、独立 QA、Red Team 或人工 Gate。

但“决定怎么做”与“有权执行”必须分开。任何写业务数据、本机执行、审批、Gate、发布、外部承诺仍走现有确定性治理链。

## 2. 三层路由

### L0 · Deterministic Safety Router

继续保留现有硬规则：

- Desktop execution；
- Proposal / business mutation；
- Approval / Gate；
- 显式 Product R&D 启动；
- 其他高影响动作。

这些能力不开放给模型自由选择。

### L1 · System-1 Reflex

现有 Laya Shadow 信号继续保留：

- assistant.intent
- assistant.complexity
- assistant.requires_research
- assistant.expert_class
- assistant.proactive_value

第一阶段只作为 telemetry，不直接触发 Agent 或写入。

### L2 · Collaboration Planner

新增 Shadow Collaboration Plan：

- SOLO
- SPECIALIST
- PAIR
- COUNCIL
- RED_TEAM
- FULL_RND

输出同时记录：

- recommended experts
- synthesis tier: FAST / BALANCED / FRONTIER
- researchRequired
- independentFirstPass
- qaRequired
- redTeamRequired
- routing reasons

第一阶段只写入 AgentRun.contextSnapshot，不自动调度。

## 3. 顾问团规则

### SOLO
普通问答、状态读取、简单总结。Kern 自己完成。

### SPECIALIST
一个明确专业域，例如法规、成本、科学证据。

### PAIR
两个互补专业，例如：

- 配方 + 科学证据
- 市场 + 成本
- 法规 + 供应链

### COUNCIL
2–5 个专家独立 first pass，再综合。适用于跨域产品判断。

### RED_TEAM
先有主判断，再由 Red Team 独立攻击关键假设。

### FULL_RND
复用现有重型 Product R&D：

市场 + 科学 + 配方 + 法规 + 成本 → Independent QA → Executive Report。

不重写现有 Product R&D。

## 4. 多 Agent 协作原则

顾问团不是群聊，也不是串行抄答案。

正确过程：

```text
Kern brief
→ experts receive the same evidence/context independently
→ independent first pass
→ conflict detector
→ optional Red Team
→ QA / evidence check
→ Kern synthesizer
→ one answer to the user
```

多模型一致不能替代 Evidence。

## 5. 模型路由目标

现有 Model Gateway 与 Policy 保留。后续在 policy 之上加入运行时约束：

- minimumQualityTier
- maxCostTier
- preferredLatency
- privacy/cloud boundary
- minimum context
- required capabilities

建议默认梯度：

- SOLO / 简单：FAST
- SPECIALIST / PAIR：BALANCED
- COUNCIL / RED_TEAM / FULL_RND：FRONTIER synthesis
- 高风险：不得因省钱降到低于最低质量要求

具体 provider/modelId 永远由 Model Control 配置，不把供应商写死进业务逻辑。

## 6. Tech Architect

当前 Workforce 缺少与 CODE expert_class 对应的独立技术架构角色。

V1.1 后续新增：

`tech_architect_agent`

职责：架构、接口、数据模型、技术方案、代码审查、测试策略、技术风险。

边界：

```text
Tech Architect = 脑
Desktop Operator = 手
```

Tech Architect 不直接伪装本机执行。

## 7. 推进阶段

### Phase 1 — 已完成
- Collaboration Plan Shadow
- 写 AgentRun contextSnapshot
- 不自动调度
- 收集真实任务分布与误路由
- CODE 类任务路由到独立 Tech Architect，不再让 Kern PM 同时承担技术架构专家

### Phase 1.5 — 当前
- AgentRun 持久化 `kern-routing-receipt/v1`
- 回执记录推荐模式、专家、模型档、研究/QA/Red Team 要求
- 显式记录 `authority=ADVISORY_ONLY`
- 显式记录 `autoDispatchEligible`，但不等于已经自动执行
- SOLO / 低风险 SPECIALIST 才可能进入下一阶段自动调度候选

### Phase 1.6 — 已完成执行契约
- `tech_architect_agent` 已具备真实 Worker executor strategy
- 新增 `CODING` policy `tech-architecture-coding`，默认 Profile 仍禁用
- Tech Architect 只产出架构/代码审查/测试策略等 advisory 结果，不拥有文件、终端、GitHub 或业务写权限
- 未安装 policy、未启用 Profile、provider runtime 未配置时均 fail closed / BLOCKED
- routing receipt 新增运行时 dispatch readiness：区分 INLINE_READY、EXECUTOR_READY、AGENT_UNAVAILABLE、MODEL_POLICY_MISSING、MODEL_PROFILE_DISABLED、PROVIDER_RUNTIME_MISSING、NO_CHAT_EXECUTOR、REVIEW_REQUIRED
- “可以路由给某专家”与“这个专家现在真的能无人值守执行”不再混为一谈
- 执行契约完成后才允许进入受限 AUTO，避免“会路由但不会执行”

### Phase 2A — 当前受限 AUTO
- SOLO 继续走 Kern 当前对话执行路径，不额外创建 AgentTask
- **仅低风险、单一 `tech_architect_agent` 且 `dispatchReadiness=EXECUTOR_READY` 时自动创建专家 AgentTask**
- 自动任务以当前用户消息为来源，使用 MANUAL provenance；这不是业务 Autopilot，也不授予额外业务权限
- 同一 source AgentRun + conversation + agent 使用数据库唯一 `AgentTask.idempotencyKey` 去重；并发重放也不得创建第二个专家任务
- 当前 Kern 回复只显示真实任务状态（如 QUEUED），不把排队说成正在执行
- Worker 完成 / BLOCKED / 最终 FAILED 后，通过 `kern-conversation-return/v1` 自动把专家回执追加到原会话
- 回传使用 `kern-conversation-return-receipt/v1` + AgentTask 行锁去重；并发回传只允许一条消息，前端复用现有消息轮询
- routing receipt 在实际排队时标记 `phase=AUTO` 并记录 dispatchTaskId / dispatchTaskStatus / dispatchedAgentCodes / dispatchError
- Market / Science / Formulation / Compliance / Cost 等其它 SPECIALIST 仍保持 Shadow；不能因为 Product R&D 内有专用 executor 就误认为它们可执行任意聊天任务
- PAIR / COUNCIL / RED_TEAM / FULL_RND 仍保持现有治理与建议态

### Phase 2B — 后续
- 基于真实 routing/return receipts 做误路由与成本/质量校准
- 为其它 Specialist 建立各自的 generic chat executor contract 后，逐个开放，而不是一次性放开
- PAIR / COUNCIL 继续在 conflict detector / synthesis / QA 契约完整后再启用 AUTO

### Phase 3
- 校准后开放 PAIR / COUNCIL
- RED_TEAM / FULL_RND 继续高门槛
- 引入 conflict detector 与 council synthesis

## 8. 不变的红线

- 没有真实执行，不显示“正在执行”；
- 模型不能绕过 Proposal / Approval / Gate；
- UNKNOWN 不补齐；
- Agent 共识不是证据；
- 顾问团只扩展智力，不扩大权限。


## 9. Phase 1.5 implementation note

当前实现新增独立 `tech_architect_agent` 与 `technical_architecture` Skill。它负责架构、接口、数据模型、技术方案、代码审查、测试策略与技术风险；真实文件/终端/GUI 修改仍由 Desktop Operator 或其他受控执行路径完成。

每次 Kern 对话运行现在会在对应 AgentRun 的 `contextSnapshot` 中同时保存：

- `collaborationPlanShadow`
- `routingReceipt.version = kern-routing-receipt/v1`
- recommendedMode / recommendedExperts
- synthesisTier
- researchRequired / qaRequired / redTeamRequired
- autoDispatchEligible
- authority = ADVISORY_ONLY
- dispatchedAgentCodes（Shadow 阶段为空；Phase 2A 只有真实创建专家任务后才写入）

这使下一阶段可以用真实历史回执校准路由，而不是直接把启发式规则升级成自动执行。


## 10. Tech Architect execution boundary

Tech Architect 的 Worker 路径使用 Model Gateway 的 `CODING` task class。模型调用成功时会生成持久化 ModelRun，并绑定到当前 AgentRun；输出只作为技术建议/审查结果。

它明确不能：

- 宣称已经修改代码、文件或 GitHub；
- 调用 Desktop Operator 的本机权限；
- 绕过 Proposal / Approval / Gate；
- 把没有仓库/文件证据的判断说成“已检查代码”。

因此 Phase 2 的 AUTO 开关必须同时满足：路由候选成立 + 单专家低风险 + executor contract 存在 + policy 已绑定 + Profile 显式启用 + provider runtime 可执行。


## 11. Phase 2A conversation return contract

Kern 的 Tech Architect AUTO 是“受控 advisory delegation”，不是业务写权限升级。

真实链路：

```text
用户消息
→ Kern Collaboration Planner
→ Runtime Dispatch Readiness
→ 低风险 + 单 Tech Architect + EXECUTOR_READY
→ AgentTask(QUEUED)
→ pm-worker 领取
→ CODING Model Gateway
→ AgentRun / ModelRun
→ SUCCEEDED / BLOCKED / 最终 FAILED
→ kern-conversation-return/v1
→ 原 Kern 会话新增一条 Assistant 回执
```

关键不变量：

1. **没有 Worker/model runtime 就不派发。** disabled Profile 或 runtime 缺失不会制造假任务。
2. **排队就是排队。** 初始消息只展示数据库里的真实 AgentTask 状态。
3. **回执属于原用户。** organization、task creator、conversation owner 与 context requestedByUserId 必须一致。
4. **回执幂等。** 已存在 conversation return receipt 时不重复追加消息。
5. **模型只负责技术建议。** Tech Architect 仍不能宣称改过文件、GitHub、终端或 Desktop。
6. **失败不伪装成功。** BLOCKED 与最终 FAILED 都以对应状态回原会话。
7. **业务治理不变。** Proposal / Approval / Gate / Product R&D / Desktop Runtime 的权限边界不被 AUTO 扩大。
