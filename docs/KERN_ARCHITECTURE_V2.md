# Kern Architecture V2 · Personal Chief of Staff + Product OS

日期：2026-09-26  
状态：**Target Architecture / Active migration**  
适用基线：`release/v0.1.0-rc1`

> 本文是 Kern 的主架构文档。旧的 Conversation-first、Muse、Advisor、Workforce、Visual Intelligence 文档继续作为局部设计说明，但若与本文冲突，以本文的产品边界和分层为准。

---

## 1. 产品定义

Kern 不是“项目管理软件里的 AI”，也不是“带工具的聊天机器人”。

Kern 的产品身份是：

**Personal Chief of Staff + Agent Supervisor + Product Strategy Partner + Execution Controller**

它直接对用户负责，理解长期目标与当前上下文，决定什么时候自己回答、什么时候研究、什么时候调用专业 Agent、什么时候执行、什么时候复核，以及什么时候才需要打断用户。

对用户而言，产品应该尽量简单：

```text
我
↓
Kern
↓
结果 / 少量真正需要我决定的事项
```

复杂度全部留在 Kern 下面：

```text
Kern
├─ Context / Memory
├─ Planning / Routing
├─ Agent Organization
├─ Skills / Playbooks
├─ Tools / Desktop / APIs
├─ Evidence / QA / Governance
└─ Harness / Learning
```

核心原则：

1. **一个助理，多种能力。** 用户不应管理一堆 Agent 才能完成工作。
2. **对话是入口，不是边界。** Conversation 是默认交互面，但 Kern 可以持续执行 Work、处理事件和主动汇报。
3. **Kern 是 Supervisor。** Agent 是 Kern 的员工，Model 是脑力资源，Skill 是方法，Tool 是工具，Playbook 是 SOP。
4. **默认自治，受保护动作再找人。**
5. **Evidence before confidence。** 模型置信度、多 Agent 共识都不能替代证据。
6. **Proactive but restrained。** 会主动发现和推进问题，也必须知道什么时候不打扰用户。
7. **Learning must be evaluated。** “记住了”不是成长；只有通过 Outcome、Eval、Regression、Promotion 的改进才进入正式 Harness。

---

## 2. 外部参考：借思想，不复制产品

这些项目只作为产品与架构参考，不作为 Kern 的运行时依赖。

| 参考 | 主要吸收点 | Kern 对应设计 |
|---|---|---|
| Today | Living Memory、Proactivity、Execution、主动克制 | Attention Engine、四层 Memory、Assistant Benchmark |
| OpenClaw | Gateway 作为统一控制平面，Tools / Sessions / Channels / Devices 收敛 | Kern Gateway |
| Hermes Agent | 长期记忆、Skill 演化、跨会话学习、子 Agent 委派 | Procedural Memory、Skill Lifecycle、Harness |
| Pioneer | Gateway 与 Native Desktop 解耦，多设备接入 | Kern Client / Gateway / Desktop Runtime |
| Second-Me | 长期用户模型、身份与个人上下文建模 | User Model / Episodic Memory |
| Letta / MemGPT | Stateful Agent 与长期 Agent State | Kern State |
| Memmy | 多 Agent 共用统一 Memory Hub | Kern-owned Memory |
| Khoj | Personal knowledge、Research、Automation | Knowledge + Research + Scheduled Work |

参考地址：

- Today: https://today.ai/
- OpenClaw: https://github.com/openclaw/openclaw
- Hermes Agent: https://github.com/NousResearch/hermes-agent
- Pioneer: https://github.com/pioneerdotai/pioneer
- Second-Me: https://github.com/mindverse/Second-Me
- Letta: https://github.com/letta-ai/letta
- Memmy Agent: https://github.com/MemTensor/memmy-agent
- Khoj: https://github.com/khoj-ai/khoj

**禁止做法：**

- 不把某个开源项目直接变成 Kern 的框架依赖；
- 不为了“像某个产品”重写已经成熟的 Evidence / Governance / Product OS；
- 不把参考项目的术语直接暴露给最终用户；
- 不让外部 Agent 框架成为业务事实来源。

---

## 3. 目标总架构

```text
┌─────────────────────────────────────────────────────────────┐
│                           USER                              │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                         KERN                                │
│ Personal Chief of Staff / Supervisor                       │
│                                                             │
│ Dialogue · Attention · Planning · Delegation · Synthesis    │
└───────────┬─────────────────┬─────────────────┬─────────────┘
            │                 │                 │
            ▼                 ▼                 ▼
┌────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ KERN MEMORY    │  │ PRODUCT OS       │  │ KERN GATEWAY     │
│ Working        │  │ Opportunity      │  │ Models           │
│ Episodic       │  │ Validation       │  │ Tools / MCP      │
│ Semantic       │  │ Product / R&D    │  │ Desktop Runtime  │
│ Procedural     │  │ Launch/Marketing │  │ Events / Channels│
└───────┬────────┘  └────────┬─────────┘  └────────┬─────────┘
        │                    │                     │
        └────────────────────┼─────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                  AGENT ORGANIZATION                         │
│ Agents · Squads · Skills · Playbooks · Generic Executor     │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                TRUST / GOVERNANCE LAYER                     │
│ Evidence · QA · Verification · Approval · Audit · Receipts  │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    HARNESS LEARNING                         │
│ Eval · Outcome · Lesson · Challenger · Regression · Promote │
└─────────────────────────────────────────────────────────────┘
```

Workbench 是这些真实对象的管理视图，不是另一套业务内核。

---

## 4. Kern Core：从 Router 升级为 Supervisor

### 4.1 当前真实状态

当前已有：

- `conversation-engine.ts`
- `router.ts`
- `planner.ts`
- `collaboration-planner.ts`
- `autonomy.ts`
- Capability Registry
- AgentTask / AgentRun / Delegation
- Worker / BusinessEvent / Autopilot

底座已经具备，但当前 Planner 主要解决的是：

> “这句话应该进入哪个 capability？”

而目标 Supervisor 要解决：

> “为了完成这个目标，需要哪些工作、谁来做、先后关系是什么、什么时候复核、什么时候升级人工？”

### 4.2 新的 Kern Goal Plan

增加统一的内部计划协议：

```ts
KernGoalPlan {
  goal
  successCriteria[]
  contextRefs[]
  assumptions[]
  missingInputs[]
  tasks[]
  dependencies[]
  researchPolicy
  qaPolicy
  humanGates[]
  budgetPolicy
  completionPolicy
}
```

Task 至少包含：

```ts
KernPlannedTask {
  taskKey
  objective
  preferredAgentRole
  requiredSkills[]
  requiredCapabilities[]
  modelTier
  dependencies[]
  evidenceRequired
  qaRequired
  riskClass
  expectedArtifact
}
```

**Plan 默认是内部对象。** 除非用户要求查看计划，否则不要把完整计划变成用户待办列表。

### 4.3 Collaboration Planner 从 Shadow 升级为 Execution Planner

当前 `collaboration-planner.ts` 已能判断：

- SOLO
- SPECIALIST
- PAIR
- COUNCIL
- RED_TEAM
- FULL_RND

下一阶段：

```text
Shadow Recommendation
→ Goal Plan
→ AgentTask DAG
→ Delegation
→ Execution
→ QA
→ Kern Synthesis
```

不新增第二套任务系统；继续使用现有 `AgentTask / AgentRun / AgentDelegation`。

---

## 5. Generic Agent Executor

### 5.1 当前问题

现在 Worker 自动执行主要通过 `EXECUTOR_STRATEGIES[agentCode]` 为特定 Agent 写固定代码。

这种方式适合 Product R&D 的确定性 specialist，但不适合扩展成通用 Personal AI 团队。

如果每增加一个 Agent 就增加一个 `runXxxAgent()`，最终会重新变成巨大 switch。

### 5.2 目标

建立通用 Agent Runtime：

```text
AgentTask
↓
Load Agent Identity
↓
Load Skills
↓
Load Kern Context / Memory
↓
Resolve Capability Scope
↓
Resolve Model Policy
↓
Execute Tools / Research / Desktop / Domain Services
↓
Structured Artifact
↓
Evidence / QA
↓
Return to Parent
```

Agent 本身主要由配置定义：

- role / responsibility
- instructions
- skill bindings
- model policy
- capability permissions
- output contract
- QA policy
- concurrency / cost policy

确定性业务执行器仍然保留，用于：

- 数据库写入；
- Evidence verification；
- Gate；
- 财务与成本计算；
- 明确业务规则；
- 任何需要服务端真值的动作。

LLM Agent 不取代确定性服务。

---

## 6. Kern Gateway

### 6.1 定位

参考 OpenClaw / Pioneer，把 Gateway 作为 Kern 的统一控制平面，而不是让 UI 直接知道每个 Runtime 和 Agent 的细节。

```text
Web Client ─┐
Mobile ─────┼── Kern Gateway
Desktop ────┘       │
                    ├─ Model Gateway
                    ├─ Agent Runtime
                    ├─ Tool / MCP Registry
                    ├─ Desktop Runtime
                    ├─ Event / Automation
                    ├─ Memory
                    └─ Governance
```

### 6.2 当前代码映射

现有能力不要重写：

- Model Gateway → 保留
- Capability Registry → 保留
- Desktop Runtime → 保留
- BusinessEvent / Autopilot → 保留
- Workforce → 保留
- Knowledge → 保留

“Kern Gateway”首先是**架构边界收敛**，不要求立即创建一个巨大 `gateway.ts`。

目标是保证：

> Client 只和 Kern 交互；Kern 再决定调用哪个 Runtime。

这也为未来手机远程控制本机 Codex / Git / Browser 提供清晰边界。

---

## 7. Kern Memory：四层统一 Memory Hub

Memory Owner 必须是 Kern，不是某个专业 Agent。

### 7.1 Working Memory

当前目标、最近对话、当前计划、正在执行的工作。

生命周期短，允许快速变化。

### 7.2 Episodic Memory

“我们一起做过什么”。

例如：

- 某次新品判断；
- 某个项目为什么改方向；
- 某次实验失败；
- 用户否决过什么方案；
- 某个 Agent 曾经在哪类任务上失败。

这是目前最弱的一层。

建议增加：

```text
Episode
- subject
- context refs
- action
- result
- decision
- outcome
- lesson refs
- occurredAt
```

### 7.3 Semantic Memory

当前已经较成熟：

- CompanyFact
- KnowledgeDocument / Chunk
- Product / Project
- Evidence
- Decision
- Rules

继续作为组织事实与长期知识。

### 7.4 Procedural Memory

“怎么把事情做好”。

包括：

- Skill
- Playbook
- Evaluation rule
- Routing policy
- approved ExperienceLesson
- Prompt / tool-use pattern

这是 Harness 真正可积累的部分。

### 7.5 Memory Retrieval Policy

Agent 不应各自建立独立长期记忆。

标准流程：

```text
Kern resolves context
→ inject minimum relevant memory
→ Agent executes
→ result returns to Kern
→ Kern decides what becomes Episode / Fact / Lesson
```

避免：

- 每个 Agent 保存互相冲突的长期事实；
- Conversation History 无限增长；
- 未验证模型总结直接进入 Semantic Memory。

---

## 8. Attention Engine：主动，但克制

Personal AI 不应该只会响应 Prompt。

Kern 需要持续识别：

- deadline
- blocker
- abnormal change
- awaiting reply
- failed automation
- new evidence
- stale assumption
- project drift
- opportunity signal
- agent return
- outcome available

但发现事件不等于通知用户。

### 8.1 Attention Score

内部判断可以考虑：

```text
importance
× urgency
× confidence
× user relevance
× actionability
× novelty
× interruption cost
```

输出：

- AUTO_HANDLE：自己处理
- WATCH：继续观察
- SURFACE：在工作台显示
- INTERRUPT：主动提醒用户
- HUMAN_GATE：必须用户决定

### 8.2 Proactive Restraint

必须作为正式 Eval：

- 不重复提醒同一问题；
- 能自动处理的不升级人工；
- 没有新信息时不重复汇报；
- 低置信度异常优先补证据；
- 用户当前高优先任务不被低价值通知打断；
- “Agent 很忙”不是值得通知用户的事件。

这是 Kern 与普通自动化机器人的重要区别。

---

## 9. Product OS：统一业务生命周期

Kern 的核心业务不是“管理项目”，而是辅助用户把想法变成经过验证并能够上市/交付的产品。

统一生命周期：

```text
Signal
↓
Opportunity
↓
Hypothesis
↓
Validation
↓
Product Concept
↓
R&D / Build
↓
Commercial Model
↓
MVP / Sample
↓
Launch
↓
Marketing / Growth
↓
Outcome
↓
Learning
```

### 9.1 Product R&D

现有 Product R&D 保留，并定义为第一个成熟 Playbook。

不要拆掉已有：

- Research
- Scientific Evidence
- Formulation
- Compliance
- Cost/BOM
- QA
- Executive Report

### 9.2 Market Validation Playbook

新增正式 Validation Program：

```text
Hypothesis
→ Validation Method
→ Evidence / Experiment
→ Metric
→ Result
→ PASS / FAIL / UNKNOWN
→ Next hypothesis
```

支持不同产品类型：

- 消费品：用户访谈、渠道反馈、样品测试、落地页、价格测试；
- 软件：痛点访谈、搜索需求、竞品、Landing Page、Prototype、Activation；
- ToB：客户访谈、POC、采购约束、Decision Unit、销售周期。

### 9.3 Marketing Playbook

Marketing 不能只保留一个 Agent 身份。

标准对象：

```text
Positioning
→ Audience
→ Message
→ Channel
→ Campaign
→ Content
→ Experiment
→ Metric
→ Outcome
→ Review
```

最终 Outcome 回到 Harness。

---

## 10. Harness Learning Loop

### 10.1 当前已有基础

现有数据库已经具备：

- EvaluationSuite
- EvaluationCase
- EvaluationRun
- EvaluationCaseResult
- FrozenPrediction
- ProductOutcome
- ExperienceLesson

这套基础必须保留。

### 10.2 目标学习闭环

```text
Execution / Prediction
↓
Real Outcome
↓
Evaluation
↓
Failure taxonomy
↓
Experience Lesson Candidate
↓
Improvement Proposal
   ├─ Skill
   ├─ Prompt
   ├─ Playbook
   ├─ Routing Policy
   └─ Evaluation Rule
↓
Offline Regression
↓
Champion vs Challenger
↓
Human Promotion Gate
↓
New Version
↓
Observe New Outcomes
```

### 10.3 禁止自修改

Kern 可以自动：

- 发现模式；
- 生成 Lesson Candidate；
- 生成 Challenger；
- 跑离线回归；
- 提出 Promotion 建议。

Kern 不可以未经治理自动：

- 修改正式评分权重；
- 修改合规规则；
- 修改关键 Gate；
- 修改生产模型策略；
- 把自己生成的 Lesson 升级为事实。

---

## 11. Kern Assistant Benchmark

参考 Personal AI 产品的评测思路，把“像不像一个好助理”变成 PM-next 的正式 Harness。

V1 建议覆盖：

### Capability

- Context recall
- Multi-step execution
- Tool execution
- Agent delegation
- Cross-session continuity
- Research
- Desktop execution

### Quality

- Goal completion
- Correctness
- Evidence grounding
- Efficient model routing
- Synthesis quality
- Failure recovery

### Assistant behavior

- Proactivity
- **Proactive restraint**
- Minimum necessary clarification
- Decision budget
- Interrupt quality
- No duplicate emphasis

### Trust

- Permission boundary
- Auditability
- Reversibility
- Unknown preservation
- Sensitive action gate
- Trace / Receipt integrity

每个 Benchmark Case 必须有：

```text
input
context
expected behavior
forbidden behavior
required evidence / receipt
pass criteria
```

**没有真实 Receipt 的执行不得算成功。**

---

## 12. Decision Budget

Kern 每次准备询问用户前，都应判断：

> 这件事真的必须由用户决定吗？

优先级：

1. 能根据明确指令执行 → 执行
2. 能从已有事实解决 → 解决
3. 能研究解决 → 研究
4. 能让 Agent / QA 解决 → 内部解决
5. 可安全采用默认值 → 采用并记录
6. 只有真正价值取舍 / 受保护动作 → 找用户

Human Gate 主要包括：

- 金钱 / 支付；
- 正式对外发布；
- 法律 / 合同承诺；
- 敏感权限；
- 不可逆删除；
- Production release；
- G1/G2/G3 正式 Gate；
- 多个合理方案之间的战略取舍。

---

## 13. UX Architecture

### 13.1 Kern Chat

默认只展示：

```text
Recent Conversations

Conversation

[ Ask Kern ... ]
                     Auto · Kern
```

模型 / 顾问 / Skill / Capability 仍然保留，但默认收进 Advanced Controls。

原因：

> 专业助理应该自己知道调用谁，而不是要求用户每次配置 Agent Playground。

高级用户可以覆盖 Kern 的自动选择。

### 13.2 Workbench

Workbench 遵循成熟 SaaS / OA 范式。

首页只回答：

1. 什么需要我处理？
2. Kern 正在做什么？
3. 哪些核心工作在推进？
4. 哪些地方异常？

不要把首页变成 AI 报告。

标准密度：

- Page title：20–22px
- Section title：14–16px
- Body：13–14px
- Meta：11–12px
- Normal KPI：16–18px
- Primary KPI：最多 22–24px
- Panel padding：12–16px
- Row height：36–40px

信息原则：

- 同一业务事实只表达一次；
- 状态优先表格/列表，不优先大卡；
- 默认中性色；
- 只有异常使用强视觉；
- 默认折叠内部 Agent / Runtime / Governance 细节。

### 13.3 Management vs Kern

```text
Kern
= 对话 / 理解 / 统筹 / 执行 / 汇报

Workbench
= 产品 / 项目 / Validation / Marketing / Task / Risk

Automation Center
= Agent / Task / Run / Event / Runtime

Settings
= Models / Skills / Tools / Permissions / Memory / Harness
```

---

## 14. 当前代码 → V2 迁移映射

| 当前模块 | V2 去向 | 动作 |
|---|---|---|
| conversation-engine | Kern Core | 保留并扩展 Goal Plan |
| router / planner | Kern Supervisor | 从 Intent Router 升级为规划入口 |
| collaboration-planner | Execution Planner | 从 Shadow 升级为可执行 DAG |
| capability registry | Kern Gateway | 保留 |
| workforce | Agent Organization | 保留 |
| worker/executor | Agent Runtime | 抽象 Generic Executor |
| product-rnd/orchestrator | Product R&D Playbook | 保留 |
| desktop-runtime | Kern Gateway / Device Runtime | 保留 |
| model-gateway | Kern Gateway / Model Runtime | 保留 |
| knowledge | Semantic Memory | 保留 |
| CompanyFact | Semantic Memory | 保留 |
| Evaluation* | Harness | 保留 |
| ExperienceLesson | Procedural Memory Candidate | 扩展 Promotion Flow |
| business-events/autopilot | Attention/Event Runtime | 保留并接 Attention Engine |
| Muse UI | Kern Chat Client | 保留视觉基底，降低控制项曝光 |
| /manage | Workbench | 降噪 / 高密度化 |
| advisor | Compatibility only | 继续收缩，不得重新成为 runtime owner |

---

## 15. 实施顺序

### P0 · Product convergence

1. 统一可信分支，解决 `main` / `release` diverged。
2. 本文成为主架构基线。
3. 工作台紧凑化：字号、间距、重复信息、Hero 收口。
4. Kern Chat Advanced Controls 默认折叠。
5. 清理用户可见 Hermes / Muse / Advisor 历史命名。

验收：

- 用户只需要理解 Kern / Workbench；
- 首页首屏能看到关键事项；
- 普通用户不需要理解 Agent runtime。

### P1 · Supervisor runtime

1. 定义 `KernGoalPlan`。
2. Collaboration Planner → executable planner。
3. Plan → AgentTask DAG。
4. Generic Agent Executor。
5. Parent return → QA / re-delegation / synthesis。
6. Decision Budget + Attention Policy。

验收：

- 一个自然语言复杂目标能产生真实多 Agent 执行；
- 不需要用户手工点每个 Agent；
- 结果必须回原 Conversation；
-失败/阻塞/UNKNOWN 不得伪装成功。

### P2 · Product OS completion

1. Validation Program。
2. Marketing domain。
3. Product lifecycle 统一。
4. Outcome 回收。
5. Playbook Registry。

验收：

- 新产品可从 Opportunity 走到 Outcome；
- 每个核心假设可追溯验证状态；
- Marketing 不是单次建议，而是可执行实验闭环。

### P3 · Harness learning

1. Episodic Memory。
2. Assistant Benchmark。
3. Lesson → Improvement Proposal。
4. Challenger / Regression。
5. Promotion / Rollback。

验收：

- 能证明某次 Harness 更新提升了哪些指标；
- 可以回滚；
- 不能以模型自评代替 Outcome。

---

## 16. 最终产品体验

目标体验不是：

```text
用户
→ 选择 Agent
→ 选择 Skill
→ 选择模型
→ 看一堆计划
→ 决定下一步
```

而是：

```text
用户：验证这个新品值不值得做，并推进到可以决策的程度。

Kern：
收到。

内部：
理解目标
→ 读取长期上下文
→ 市场 / 用户 / 竞品并行
→ Product Agent
→ Compliance
→ Cost
→ Red Team
→ QA
→ 缺口补证
→ 汇总

Kern：
我已经完成第一轮验证。
目前 4 个关键假设中 3 个有证据支持，1 个仍是 UNKNOWN。
我已自动建立下一步验证任务。
现在只有“目标渠道选择”会实质改变产品规格，需要你决定。
```

这就是 Kern Architecture V2 的判定标准：

> **内部系统越强，用户看到的系统越简单。**

