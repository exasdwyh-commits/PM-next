# HERMES-Next VNext：升级执行规划 / Master Delivery Plan

日期：2026-09-23  
状态：执行规划  
配套架构：docs/VNEXT_COGNITIVE_FABRIC_ARCHITECTURE.md  
目标：在不破坏当前稳定 main 的前提下，以小 PR、双车道审核、中枢调度的方式逐步完成 VNext。

---

## 1. 执行原则

### 1.1 当前 main 是稳定基线

VNext 不在 main 上直接进行大规模试验。

每一阶段：

1. 从已通过验收的 main 创建短生命周期分支；
2. 只解决一个清晰架构目标；
3. Builder 负责实现；
4. Reviewer / Validator 独立验证；
5. Central Orchestrator 根据证据决定是否合入；
6. 合入后重新冻结新的 base SHA；
7. 下一阶段重新从新 main 开始。

禁止一个跨越多阶段的长期巨型分支。

### 1.2 三层工作模型

~~~text
                 CENTRAL ORCHESTRATOR
                 全局目标 / Work Graph
                  / 风险 / 合并判断
                       |
          +------------+-------------+
          |                          |
          v                          v
     BUILDER LANE                REVIEW LANE
     设计与实现                    审核与复现
          |                          |
          +------------+-------------+
                       |
                       v
                VALIDATION LANE
              CI / DB / Runtime / UI
                       |
                       v
                 MERGE DECISION
~~~

小任务可以 Builder + Reviewer 两车道。
涉及 migration、provider、浏览器、真实运行时的任务增加 Validator。

### 1.3 Builder 不自证

Builder 可以跑测试，但 Builder 的 PASS 不是最终 PASS。

最终完成必须至少包含：

- 实现证据；
- 独立 review；
- CI / test evidence；
- 对 acceptance criteria 的逐项核对。

### 1.4 Reviewer 默认不直接乱改

Reviewer 首先产出 Finding。

只有 Central 创建明确 Fix Task 后，才由 Builder/Fixer 修改。

这样避免：

- Reviewer 在找 bug 时顺手改设计；
- 两个线程同时改相同文件；
- 修复引入新的未审变更；
- 失去“谁为什么改”的因果链。

---

## 2. VNext 总体里程碑

建议拆成 10 个阶段。

| Phase | 名称 | 主要产物 | 风险 |
|---|---|---|---|
| P0 | Planning Freeze | 架构、协议、任务图 | 低 |
| P1 | Judgment Contract | Decision Protocol / Provider 接口 | 低 |
| P2 | Laya Shadow Runtime | Laya adapter / benchmark / shadow | 中 |
| P3 | Context + Capability | Context Governor / Skill Router | 中 |
| P4 | Adaptive Intelligence | L0-L3 / Model escalation / budget | 中 |
| P5 | Multi-Lane Coding | Builder / Review / Work Graph | 高 |
| P6 | Verification Fabric | AST / tests / Completion Judge | 高 |
| P7 | Controlled MoA | Product Lab / disagreement / synthesis | 高 |
| P8 | Product & Autopilot Integration | 业务触发与再评估 | 高 |
| P9 | Control Center UI | 可视化、成本、因果、人工覆盖 | 中 |
| P10 | Hardening & Release | Golden regression / migration / closeout | 高 |

严格按依赖推进，不建议 P2/P3/P4/P5 同时大规模开工。

---

# P0 — Planning Freeze

## 目标

冻结 VNext 的边界，避免编码过程中架构漂移。

## 已有产物

- VNEXT_COGNITIVE_FABRIC_ARCHITECTURE.md
- 本执行规划

## 需要完成

- 新建 VNext Master Issue；
- 将旧 Issue #11 的 MoA / Router 内容并入 VNext；
- 明确旧 Issue #11 不再单独驱动实现；
- 给每个 Phase 建立 checklist；
- 定义统一 PR 模板中的：
  - base SHA
  - scope
  - acceptance
  - builder handoff
  - reviewer findings
  - verification evidence

## Merge Gate

纯文档通过 review 即可。

---

# P1 — Judgment Contract Foundation

## 目标

先冻结协议，不接真实 Laya。

## Builder Scope

新增/重构：

- intelligence/contracts/decision.ts
- intelligence/contracts/provider.ts
- intelligence/contracts/policy.ts
- intelligence/judgment/registry.ts
- intelligence/judgment/engine.ts
- intelligence/providers/fake.ts
- intelligence/providers/rules.ts

核心对象：

- DecisionSpec
- DecisionRequest
- DecisionResult
- JudgmentProvider
- JudgmentProviderRegistry
- DecisionPolicyAction
- Abstention
- ReasonCode
- InputFingerprint

优先复用现有 Decision Intelligence，不造第二套 DecisionRun。

## 必须支持的第一批 Spec

- workforce.route_agent@v2
- workforce.needs_human@v2
- signal.should_wake_pm@v2
- intelligence.route_level@v1
- completion.status@v1

## Reviewer Focus

- 是否重复现有 Decision Intelligence；
- HIGH / CRITICAL 是否仍不可 AUTO；
- confidence 是否被错误当授权；
- Rules fallback 是否可解释；
- Spec version 是否真正生效；
- 是否存在隐式默认 provider。

## Tests

新增：

- judgment-contract.test.ts
- judgment-policy-gate.test.ts
- judgment-provider-registry.test.ts
- judgment-abstention.test.ts

## Exit Criteria

- fake provider 可完整跑通；
- rules provider 可完整跑通；
- 无真实模型调用；
- Governance CI / Workforce CI / Decision CI 全绿；
- main 行为没有回归。

---

# P2 — Laya Shadow Runtime

## 目标

接入 Laya，但只 shadow，不驱动生产动作。

## 架构

Next.js 不直接加载 Torch。

新增独立 Judgment Runtime：

~~~text
PM-next
  |
  | internal HTTP
  v
judgment-runtime
  |
  +-- Laya Router
  +-- checkpoint preload
  +-- batch predict
  +-- health
  +-- version
~~~

## Builder Scope

Node 侧：

- LayaJudgmentProvider；
- timeout；
- health；
- circuit breaker；
- result normalization；
- version capture；
- shadow run persistence。

Python 侧：

- minimal service；
- Router preload；
- /health；
- /version；
- /evaluate；
- request validation；
- deterministic error shape。

## Shadow Spec

先只跑：

- route_agent；
- needs_human；
- should_wake_pm；
- route_level；
- completion.status。

真实行为仍以当前 Rules 为准。

记录：

- rules decision；
- Laya decision；
- disagreement；
- confidence；
- latency；
- provider version。

## Benchmark

建立 Hermes 自有 benchmark：

### Workforce
- 真实/脱敏任务路由；
- ambiguous tasks；
- mixed-domain tasks。

### Autopilot
- actionable；
- duplicate；
- blocked；
- irrelevant。

### Completion
- 明显完成；
- 缺测试；
- CI 红；
- acceptance 未满足；
- 需要人工。

## Reviewer Focus

- runtime down 时是否 fail safe；
- 是否存在 silent premium fallback；
- checkpoint/version 是否可追踪；
- confidence 是否被错误使用；
- multilingual/domain 偏差；
- 高基数 option 情况。

## Exit Criteria

- Laya 完成 shadow；
- 形成基准报告；
- 没有任何业务动作由 Laya 单独驱动；
- provider down 不影响现有系统；
- 能一键 disabled。

---

# P3 — Context Governor + Capability Router

## 目标

控制上下文膨胀，并将 Agent 从“固定人格”升级为可组合能力。

## Builder Scope A：Context Governor

新增：

- ContextCandidate；
- ContextPolicy；
- ContextPack；
- HOT / WARM / COLD / DROP；
- pinned facts；
- stale detection；
- fingerprint；
- recoverable refs。

第一批输入：

- ProductVersion；
- Evidence；
- Channel Route；
- Agent parent/child summary；
- recent tool outputs；
- Company Memory。

## Builder Scope B：Skill Router

增强 Skill：

- version；
- capability tags；
- required tools；
- allowed task classes；
- output contract；
- risk class；
- default ModelPolicy；
- evaluation suite key。

实现：

- deterministic eligibility；
- judgment shortlist；
- policy validation；
- no-skill 合法结果。

## Reviewer Focus

- pinned truth 是否可能被 DROP；
- stale context 是否继续使用；
- context pruning 是否造成 evidence loss；
- skill router 是否能越权；
- Agent 是否又被重新硬绑模型。

## Tests

- context-governor.test.ts
- context-staleness.test.ts
- skill-router.test.ts
- skill-policy.test.ts

## Exit Criteria

- ContextPack 可追溯；
- 关键事实永不被模型裁剪；
- Skill 选择可解释；
- 无权限 skill 无法被 judgment 强行选择。

---

# P4 — Adaptive Intelligence Router

## 目标

完成 L0-L3 智力档位和成本控制。

## Builder Scope

新增：

- IntelligenceLevel；
- routeIntelligenceTask；
- EscalationReason；
- BudgetEnvelope；
- ModelPolicy selection；
- premium gate；
- disagreement input；
- previousFailure input。

输入至少包含：

- taskClass；
- risk；
- businessValue；
- ambiguity；
- evidenceCoverage；
- requestedMode；
- budget；
- previousFailures；
- disagreement。

输出：

- level；
- policy；
- primary；
- reference count；
- aggregator requirement；
- estimated cost class；
- escalation reasons。

## 规则

- L0：低风险；
- L1：复杂单模型；
- L2：核心研发 / 高价值；
- L3：高风险 + 高分歧 / 用户明确请求；
- budget 不允许时不得偷偷升级；
- provider 不可用时只能在明确 policy 内 fallback。

## Reviewer Focus

- premium 是否可能误触发；
- 单一 confidence 是否控制升级；
- 预算是否能被 fallback 绕过；
- Laya 是否被误当 reasoning model；
- L0/L1 是否误 fan-out。

## Exit Criteria

- 日常任务默认不进入 premium；
- 所有升级理由可追踪；
- Cost / ModelRun / DecisionRun 能串起来。

---

# P5 — Multi-Lane Coding Orchestration

## 目标

把用户要求的“代码一个线程、审核修复另一个线程、中枢把控”变成正式能力。

## 核心对象

### WorkGraph
记录：

- goal；
- baseSha；
- nodes；
- dependencies；
- owner lane；
- risk；
- state。

### WorkNode
类型：

- PLAN；
- IMPLEMENT；
- TEST；
- REVIEW；
- FIX；
- VALIDATE；
- DOC；
- MERGE_REVIEW。

### Handoff
结构：

- source node；
- target node；
- commit SHA；
- changed files；
- assumptions；
- unresolved；
- evidence refs。

## Central Orchestrator

实现：

- create graph；
- resolve ready nodes；
- limit concurrency；
- detect conflicting paths；
- spawn child AgentTask；
- collect terminal result；
- create review node；
- create fix node；
- block merge until review/validation pass。

## Builder Lane

约束：

- 只能处理 IMPLEMENT / FIX；
- 必须绑定 baseSha；
- 必须输出 commit；
- 不拥有 merge decision。

## Review Lane

约束：

- 只能处理 REVIEW；
- 默认 read-only；
- 输出 structured findings；
- 不把自己标 PASS 当最终 merge。

## Validator Lane

约束：

- 处理 TEST / VALIDATE；
- 运行环境验证；
- 不改业务设计。

## Git Isolation

同一 WorkGraph 中：

- 每个可并行实现节点使用独立 branch/worktree；
- Central 在分配前检测 changed-path overlap；
- 预计强冲突则串行；
- 不允许两个 Builder 同时写同一核心 migration / schema 区域。

## Reviewer Focus

这一阶段 Reviewer 要重点审查 Orchestrator 本身：

- deadlock；
- orphan tasks；
- duplicate child；
- repeated review loops；
- infinite fix cycle；
- stale baseSha；
- merge after stale review；
- reviewer accidentally writes。

## Exit Criteria

至少用 3 个 coding golden tasks 跑通：

1. 低风险单文件功能；
2. 多文件 API + test；
3. Prisma / migration + API + UI。

必须证明：

- Build 与 Review 独立；
- Finding 能生成 Fix；
- Fix 后必须 re-review；
- stale review 不可放行。

---

# P6 — Verification Fabric + Completion Judge

## 目标

“完成”由证据决定，不由 Agent 自报。

## Builder Scope

### Change Impact Pack

采集：

- changed files；
- imports；
- exports；
- API routes；
- Prisma models；
- migrations；
- DecisionSpec；
- Governance code；
- tests；
- UI routes。

### Verification Contract

每类任务定义 required checks。

例如 CODING：

- typecheck；
- lint；
- targeted tests；
- required regression；
- build when necessary；
- migration check if schema touched。

### Completion Judge

输入：

- acceptance；
- handoff；
- diff；
- CI；
- verification；
- open findings。

输出：

- COMPLETE；
- VERIFY_MORE；
- INCOMPLETE；
- WAITING_HUMAN。

## 原则

Compiler / AST / schema / test 能决定的先决定。

Judgment Provider 只处理：

- acceptance ambiguity；
- semantic mismatch；
- suspicious incomplete work；
- missing verification category。

## Exit Criteria

- CI 红不可能 COMPLETE；
- blocking finding 不可能 COMPLETE；
- missing required test 不可能 COMPLETE；
- completion decision 有完整 evidence refs。

---

# P7 — Controlled Product Lab / MoA

## 目标

在 Judgment / Context / Routing / Verification 都稳定后，再正式启用 MoA。

## 第一批场景

### Opportunity Gate
- Market；
- Channel；
- Red Team。

### Channel Spec & Economics
- Product；
- Channel；
- Economics。

### Core Product Review
- Product；
- Evidence；
- Red Team。

## 规则

- 每次 2-3 reference；
- 同一 Evidence Pack；
- parallel once；
- reference 不允许继续开 MoA；
- disagreement structured；
- 低分歧不升级 L3；
- 高分歧才 premium synthesis；
- 仍不确定则 WAITING_HUMAN。

## Golden Cases

必须覆盖：

- AKG 半年套餐；
- 骆驼奶 + AOS；
- AKK 后生元。

## Exit Criteria

- MoA 不越过 Hard Gate；
- 成本引擎仍是确定性；
- 假设不会变事实；
- reference failure 有降级策略；
- premium 使用理由可见。

---

# P8 — Product / Autopilot Integration

## 目标

让 Cognitive Fabric 进入真实组织运行，但仍分级开放。

## 第一批事件

- ProductVersionChanged；
- EvidenceVerified；
- SignalIngested；
- AgentChildTerminal；
- ReviewChangesRequired；
- ModelProviderUnhealthy。

## 允许的自动化

逐个 DecisionSpec 开启，不批量开启。

每个 Spec 经：

1. benchmark；
2. shadow；
3. review；
4. policy enable；
5. audit。

## 重点

Laya/Judgment 不能直接产生业务 mutation。

链路仍是：

    Event
      -> Judgment
      -> Policy Gate
      -> AgentTask
      -> Proposal
      -> Governance

---

# P9 — Intelligence / Workforce Control Center UI

## 目标

让使用者看得懂“系统为什么这样做”。

## 页面能力

### Intelligence
- 当前 provider；
- Laya health/version；
- shadow accuracy；
- DecisionSpec；
- benchmark status；
- calibration；
- disabled/enabled。

### Task Trace
- task；
- context pack；
- skills；
- intelligence level；
- model；
- tools；
- escalation reason；
- cost；
- output。

### Coding
- WorkGraph；
- Builder；
- Reviewer；
- findings；
- CI；
- validation；
- merge readiness。

### Product Lab
- specialists；
- disagreement；
- premium use；
- evidence gaps；
- next experiment。

## 人工控制

- force single model；
- disable third-party；
- disable Laya；
- force human review；
- request Deep Council；
- stop graph；
- cancel child tasks。

---

# P10 — Hardening / Release

## 目标

完成 VNext 正式收口。

## 必须执行

### Regression
- Quality；
- Governance；
- Workforce；
- Decision；
- Autopilot；
- Experience；
- Business Event；
- Golden Organization；
- VNext Judgment；
- VNext Coding；
- VNext MoA。

### Failure Injection
- Laya down；
- timeout；
- malformed response；
- stale fingerprint；
- provider version changed；
- reference timeout；
- premium unavailable；
- budget exhausted；
- reviewer crash；
- builder crash；
- stale PR；
- migration fail；
- CI flake；
- duplicate event。

### Operational Docs
- local setup；
- Laya runtime；
- environment；
- rollback；
- provider disable；
- troubleshooting；
- benchmark rerun；
- release checklist。

## Release Gate

只有当：

- old main golden cases 全部保持；
- VNext golden cases 通过；
- 本地真实 DB 验收；
- provider smoke test；
- coding workflow 三个真实任务验收；
- no P0 / P1 open findings；

才进入正式 release。

---

## 3. 推荐 PR 序列

建议大致：

1. PR-A：Judgment contracts + fake/rules provider
2. PR-B：Laya shadow adapter + runtime contract
3. PR-C：Hermes judgment benchmark
4. PR-D：Context Governor
5. PR-E：Skill / Capability Router
6. PR-F：L0-L3 Intelligence Router
7. PR-G：WorkGraph / Central Orchestrator
8. PR-H：Builder / Review handoff
9. PR-I：Verification / Completion
10. PR-J：Code impact / AST
11. PR-K：Controlled MoA core
12. PR-L：Product Lab integrations
13. PR-M：Autopilot integrations
14. PR-N：Control Center UI
15. PR-O：Hardening / docs / release

每个 PR 都应小于“需要一次性理解整个系统”的规模。

---

## 4. Central Orchestrator 的运行规约

### 4.1 全局唯一职责

Central 必须维护：

- Current Goal；
- Current Base SHA；
- WorkGraph；
- Active Nodes；
- Blockers；
- Open Findings；
- Merge Candidates；
- CI State；
- Budget State；
- Architectural Invariants。

### 4.2 不允许只靠聊天历史

关键状态必须落在：

- GitHub Issue；
- PR；
- commit；
- structured AgentTask；
- Handoff；
- ReviewFinding；
- VerificationRun。

对话只是控制界面，不是唯一状态存储。

### 4.3 上下文隔离

Builder context：

- requirement；
- relevant architecture；
- target files；
- acceptance；
- base SHA。

Reviewer context：

- requirement；
- architecture invariants；
- diff；
- tests；
- CI；
- acceptance。

不要把 Builder 全部推理历史喂给 Reviewer。

### 4.4 冲突检测

Central 在并行前检查：

- same file；
- same symbol；
- schema/migration；
- same API contract；
- same shared type；
- same decision spec。

高冲突自动串行。

---

## 5. Bug 修复专用流程

用户特别要求避免“一边开发一边修复导致一直卡住”。

以后统一采用：

~~~text
Feature Builder
  |
  v
Implementation PR
  |
  v
Independent Audit
  |
  +-- no blocker --> Validation
  |
  +-- blocker ----> Finding Batch
                       |
                       v
                   Fix Task
                       |
                       v
                   Fix Commit
                       |
                       v
                   Re-review
~~~

### Finding Batch

Reviewer 一轮尽量收集完整 blocking findings，不发现一个就立即打断 Builder。

只有以下情况立即中断：

- data loss；
- security；
- migration destructive；
- governance bypass；
- wrong base；
- large architectural violation。

普通 bug 先形成 batch。

这样减少 ping-pong。

---

## 6. Coding 子代理策略

若运行环境支持子代理，推荐角色：

### Architect / Central
- 规划；
-拆图；
-合并判断。

### Builder
- 实现。

### Test Engineer
- 补 targeted tests；
- failure reproduction。

### Reviewer
- diff / contract / regression 审核。

### Validator
-真实环境 / UI / DB / provider。

### Red Team
只在：
-权限；
-安全；
-governance；
-重大架构；
-外部副作用
时触发。

禁止每个任务都拉满全部子代理。

---

## 7. 任务状态机

建议 WorkNode：

- PLANNED
- READY
- RUNNING
- HANDOFF_READY
- REVIEWING
- CHANGES_REQUESTED
- VALIDATING
- BLOCKED
- WAITING_HUMAN
- SUCCEEDED
- FAILED
- CANCELLED

关键：

- CHANGES_REQUESTED 不是 FAILED；
- BLOCKED 不是 terminal success；
- WAITING_HUMAN 不允许被 child complete 误解释为完成；
- SUCCEEDED 需要 completion evidence。

---

## 8. Merge Gate

Central 只有满足全部条件才允许 merge：

- acceptance 已映射；
- required tests 通过；
- required CI 通过；
- blocking findings = 0；
- review commit SHA = current head SHA；
- verification commit SHA = current head SHA；
- migration 状态正确；
- docs 已更新（如架构/运行方式变化）；
- no governance regression；
- no hidden fallback；
- completion = COMPLETE。

如果 head SHA 在 review 后变化，review 自动 STALE。

---

## 9. 度量

VNext 除功能正确外，还要记录效率。

### Judgment
- latency；
- accuracy；
- disagreement；
- abstention；
- false positive；
- false negative。

### Context
- candidate tokens；
- injected tokens；
- reduction ratio；
- recovery frequency；
- missed-context incidents。

### Model
- calls；
- premium ratio；
- fallback；
- cost；
- tool-loop count。

### Coding
- first-pass review pass rate；
- findings / PR；
- fix cycles；
- CI failures；
- stale reviews；
- mean nodes per WorkGraph。

### Product Lab
- reference count；
- disagreement；
- L3 escalation；
- human escalation；
- cost per run。

这些数据用于 Experience Candidate，不用于自动“自我改权重”。

---

## 10. 每阶段标准 Handoff 模板

Builder 必须输出：

### Scope
做了什么 / 没做什么。

### Base
base SHA / head SHA。

### Files
改动文件。

### Contracts
新增/修改接口。

### Tests
新增和运行。

### Risks
已知风险。

### Follow-ups
不属于本 PR 的内容。

Reviewer 必须输出：

### Verdict
PASS / PASS_WITH_NONBLOCKING_FINDINGS / CHANGES_REQUIRED / BLOCKED。

### Blocking Findings
结构化列表。

### Non-blocking
后续建议。

### Verification Required
需要 Validator 额外跑什么。

---

## 11. 第一阶段开工顺序

规划合并后，严格从下面开始：

### Step 1
P1.1 DecisionResult / JudgmentProvider contract。

### Step 2
P1.2 Fake + Rules Provider。

### Step 3
P1.3 Policy Gate compatibility。

### Step 4
P1.4 tests + independent review。

完成 P1 后才进入 Laya。

不要直接从“接 Laya”开工，否则会重新把业务层绑到具体实现。

---

## 12. 下一版本最终形态

完成后，HERMES 的运行方式应当是：

~~~text
Goal / Event
   |
   v
Central Orchestrator
   |
   v
Truth Snapshot
   |
   v
Judgment Fabric
   |
   +--> Context
   +--> Skill
   +--> Agent
   +--> Model
   +--> Tool
   +--> Risk
   |
   v
Execution WorkGraph
   |
   +--> Builder / Specialist tasks
   |
   v
Independent Review
   |
   v
Verification
   |
   v
Completion Gate
   |
   +--> Merge / Proposal / Governance
   |
   v
Outcome
   |
   v
Experience Harness
~~~

这套结构的关键价值不是“更多 Agent”，而是：

- 每个 Agent 上下文更小；
- 每个角色职责更清晰；
- 模型成本可控；
- 快速判断与深度推理解耦；
- 开发与审核互相独立；
- 出错时可恢复；
- 全链路可追踪；
- 底层 Judgment Provider 可替换；
- HERMES 中枢始终拥有全局一致性。

---

## 13. Master Definition of Done

VNext 只有在以下全部成立时才宣告完成：

- P1-P10 全部合并；
- 当前稳定版全部 regression 保持通过；
- Laya 至少有一组低风险 DecisionSpec 经过 Hermes benchmark 正式启用，或明确判定不采用并成功替换 Provider；
- Context Governor 生产可用；
- Capability / Skill Router 生产可用；
- L0-L3 路由生产可用；
- Builder / Reviewer 双车道完成真实 GitHub 项目验证；
- Completion Judge 不允许假绿；
- Controlled MoA 完成三组 Golden Product Cases；
- 控制中心可解释每次关键升级与自动化；
- 文档、部署、回滚、验收全部收口；
- main 无 P0/P1 未解决问题。