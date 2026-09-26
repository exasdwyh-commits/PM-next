# Kern 系统地图审查 · 2026-09-26

状态：**Architecture V2 migration audit**  
主架构：`docs/KERN_ARCHITECTURE_V2.md`  
地图源：`docs/maps/kern-system.architecture.json`

## 结论

当前 PM-next 已经完成了大部分可靠底座，但产品仍处在：

> **“Kern 对话入口 + 多套成熟底层能力” → “真正的 Personal Chief of Staff”**

的迁移阶段。

今天的代码已经不再是“新 Kern 外壳 + 旧 Advisor 核心”。主聊天链、Capability Registry、Conversation lifecycle 已归属 `assistant-runtime`，Advisor 已退到兼容/专业支持层。

当前真实主链：

```text
User
→ Kern Conversation
→ Conversation Engine
→ Intent / Capability Routing
→ Domain Capability / Model Gateway
→ Workforce / Desktop / Product R&D
→ Evidence / Governance
→ Message / Receipt
```

目标 V2 主链：

```text
User
→ Kern Chief of Staff
→ Context + Memory
→ Goal Plan
→ Supervisor / AgentTask DAG
→ Agents + Skills + Tools + Desktop
→ Evidence / QA / Governance
→ Synthesis
→ Outcome
→ Harness Learning
→ Return to same Conversation
```

差距已经不在“有没有 Agent / Worker / Governance”，而在 **Kern 是否真正接管规划、委派、复核、注意力与持续学习**。

---

## 已经对齐的基础

### 1. Kern 已成为 runtime owner

`conversation-engine.ts` 直接调用：

- Kern Router
- Capability Registry
- Model Gateway
- Conversation Runtime Config

`advisor/service.ts` 只保留兼容 facade，不再拥有主业务运行时。

### 2. Conversation-first 已成立

`/muse` 是默认入口，Conversation 是 Chat 的一级对象。

项目、WorkItem、AgentTask、Run、Evidence、Gate 留在管理层和运行层，不再强迫用户先理解内部对象。

### 3. Capability Registry 已成立

当前主要能力：

- Workspace
- Knowledge
- Product Write
- Product R&D
- Challenge
- Desktop
- Visualize

能力范围可以在 Conversation 级受控配置。

### 4. Risk-based Autonomy 已有基础

`autonomy.ts` 已明确考虑：

- reversibility
- external side effect
- financial impact
- permission sensitivity
- production release
- formal business gate
- destructive action
- target ambiguity

因此“低风险内部可逆动作默认推进，高风险动作找人”已经有确定性基础。

### 5. Workforce 底座成熟

已存在：

- Agent / Skill / Squad
- AgentTask / AgentRun
- parent-child delegation
- return event
- concurrency control
- retry / lease
- Business Event
- Autopilot
- audit

下一阶段不应重写任务内核。

### 6. Product R&D 是第一个成熟 Playbook

当前已有多 specialist、ResearchRun、Evidence、QA、Executive Report 的正式闭环。

Architecture V2 把它重新定义为：

> **Kern Generic Orchestrator 上的第一个成熟业务 Playbook**

而不是孤立的特殊系统。

### 7. Evidence / Governance / Harness 是现有优势

已有：

- SourceCapture / Verification
- UNKNOWN preservation
- Approval / Gate
- EvaluationSuite / Case / Run
- FrozenPrediction
- ProductOutcome
- ExperienceLesson

这些全部保留。

### 8. Visual Intelligence 已有 Project Map Builder

当前已能从 source-backed 文件与依赖信息建立 KernGraph / Archify-style artifact。

Visual Intelligence 仍是按需解释工具，不变成默认首页。

---

## 当前最大结构债

### P0 · 分支事实不统一

当前 `main` 与 `release/v0.1.0-rc1` 已 diverged。

架构和产品演进目前发生在 release 分支，但 README 仍把 `main` 描述为可信交付入口。

在继续扩大代码改造前必须收敛唯一可信分支，否则：

- 文档读取不同代码；
- 本机部署读取不同功能；
- Codex / Kern / CI 可能工作在不同基线。

这是架构治理 P0，不是普通 Git 清理。

---

### P1 · Supervisor 仍然是半成品

`collaboration-planner.ts` 已能计算：

- SOLO
- SPECIALIST
- PAIR
- COUNCIL
- RED_TEAM
- FULL_RND

但当前仍然是 Shadow Recommendation。

它能判断“应该叫哪些专家”，但不会通用地：

```text
Goal
→ Task DAG
→ Create / Delegate AgentTask
→ Monitor
→ Re-delegate
→ QA
→ Synthesize
```

Architecture V2 的第一核心任务就是让它成为真实 Supervisor。

---

### P1 · Planner 仍偏 Intent Router

当前 Planner 更擅长：

> 这句话属于 WORKSPACE / KNOWLEDGE / PRODUCT / CHALLENGE 哪一类？

目标需要升级为：

> 完成这个业务目标，需要哪些步骤、依赖、Agent、工具、Evidence、QA 和 Human Gate？

因此新增统一 `KernGoalPlan`，但继续复用现有 AgentTask / AgentRun。

---

### P1 · Worker 仍以 specialist hard-code 为主

当前 `worker/executor.ts` 的自动 strategy 主要服务 Product R&D specialist。

这保证了确定性与诚实缺省，但无法自然扩展：

- Product Agent
- Marketing Agent
- Ops Agent
- Red Team
- future specialist

目标是增加 **Generic Agent Executor**：

```text
Agent identity
+ skills
+ context
+ capability scope
+ model policy
+ tool registry
→ structured execution
```

确定性领域服务继续保留，不让 LLM 取代业务真值逻辑。

---

### P1 · Memory 主要是 Semantic，不像长期助理

当前较成熟：

- CompanyFact
- KnowledgeDocument
- Product / Project
- Evidence

但缺少系统化：

- Episodic Memory：过去一起做过什么；
- User Model：用户工作方式和稳定偏好；
- Procedural Memory：经过 Eval 验证的方法与 Playbook。

Architecture V2 统一 Memory Owner 为 Kern。

---

### P1 · Proactivity 还没有 Attention Engine

已有 BusinessEvent / Autopilot，可以“被事件唤醒”。

但还缺一层：

> 事件发生后，值得不值得打扰用户？

目标输出：

- AUTO_HANDLE
- WATCH
- SURFACE
- INTERRUPT
- HUMAN_GATE

“主动克制”必须进入 Assistant Benchmark，避免 Kern 变成高频提醒机器人。

---

### P2 · Product OS 缺 Validation 与 Marketing 闭环

当前产品研发能力强，但：

- Market Validation 仍偏研究/分析；
- Marketing 主要是 Agent + Skill 身份，没有完整执行对象和反馈闭环。

目标生命周期：

```text
Signal
→ Opportunity
→ Hypothesis
→ Validation
→ Product
→ R&D / Build
→ Launch
→ Marketing
→ Outcome
→ Learning
```

Product R&D 不重写；新增 Validation Program 与 Marketing Playbook。

---

### P2 · Harness 有学习数据，但没有正式 Promotion Loop

当前：

```text
Prediction
→ Outcome
→ Backtest
→ ExperienceLesson Candidate
→ Human Review
```

目标：

```text
Lesson
→ Improvement Proposal
→ Challenger
→ Regression
→ Champion comparison
→ Promotion Gate
→ New version
→ Observe Outcome
```

禁止系统无评测地自改规则。

---

## 前端审查

### Kern Chat

方向正确，但模型 / 顾问 / Skill / Capability 当前直接暴露在输入区域。

V2 规则：

- 默认：`Auto · Kern`
- Advanced Controls：按需展开
- 用户可覆盖自动路由
- 默认不要求用户管理 Agent

### Workbench

当前仍有明显“展示型 Dashboard”遗留：

- 大 Hero；
- 大字号；
- 大 padding；
- 同一信息多次强调；
- Panel 解释文字过多。

下一轮按标准专业 SaaS 密度收敛：

- Page title 20–22px
- Section 14–16px
- Body 13–14px
- Meta 11–12px
- Row 36–40px
- Panel padding 12–16px

首页只回答：

1. 需要我处理什么？
2. Kern 正在做什么？
3. 核心工作推进到哪里？
4. 哪里异常？

---

## 下一阶段唯一推荐顺序

### P0 Product convergence

- 收敛唯一可信分支；
- Architecture V2 成为主架构；
- Workbench 降噪；
- Advanced Controls 默认折叠；
- 清理历史用户可见命名。

### P1 Supervisor runtime

- KernGoalPlan；
- executable collaboration planner；
- AgentTask DAG；
- Generic Agent Executor；
- QA / re-delegation / synthesis；
- Decision Budget；
- Attention Engine。

### P2 Product OS completion

- Validation Program；
- Marketing Playbook；
- Product lifecycle 统一；
- Outcome 回收。

### P3 Harness learning

- Episodic Memory；
- Assistant Benchmark；
- Improvement Proposal；
- Challenger / Regression；
- Promotion / Rollback。

---

## 产品边界

最终必须始终维持：

```text
Kern
= Personal Chief of Staff
= 理解 + 规划 + 调度 + 执行 + 复核 + 汇报 + 学习

Conversation
= Kern 的第一交互界面

Workbench
= 真实业务对象的管理视图

Agents
= Kern 管理的专业员工

Models
= 可替换脑力资源

Skills
= 方法

Playbooks
= 可执行 SOP

Gateway
= 统一控制平面

Governance
= 受保护动作的硬边界

Harness
= 可评测、可升级、可回滚的学习系统
```

**内部能力越强，用户看到的系统应该越简单。**
