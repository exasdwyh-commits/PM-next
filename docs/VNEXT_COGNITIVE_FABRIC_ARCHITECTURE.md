# HERMES-Next VNext：Cognitive Fabric / Judgment-Centric Architecture

日期：2026-09-23  
状态：VNext 架构蓝图（规划分支）  
适用仓库：exasdwyh-commits/PM-next  
基线：main @ c5285a48ae399c0ca019cd580d3632ded2f85411  
优先判断运行时候选：Laya；Jev、自研小模型和纯规则引擎作为可替换 Provider

---

## 0. 文档目的

当前 HERMES-Next 已经完成并稳定了以下底座：

- Evidence / Product Potential / Channel Spec / Economics；
- G1 / G2 / G3 Governance；
- Model Profile / Model Policy / Model Gateway / ModelRun；
- Autonomous Workforce；
- Decision Intelligence；
- Autopilot / Business Event / Automation Causality；
- Evaluation Harness / Golden Cases / Experience Candidate；
- 多条 CI 与本地验收基线。

VNext 不再以“继续增加 Agent 数量”为目标，而是将系统从 Agent-centric architecture 升级为 Judgment-centric architecture：

> 先由统一的判断与调度平面决定“需要什么上下文、什么能力、什么工具、什么模型、什么风险级别、是否升级”，再让 Agent / LLM / MoA 执行；执行后由独立验证平面判定是否真的完成。

最终目标是让 HERMES 从“多个会调用模型的 Agent”变成“有中枢、有快速判断、有深度思考、有独立复核、有经验闭环的数字产品组织”。

---

## 1. VNext 核心原则

### 1.1 Truth First

事实、权限、预算、业务门禁、版本、证据状态、成本计算仍然由确定性领域层掌控。

任何模型，包括 Laya、Jev、Frontier LLM、MoA，都不能直接：

- 修改 ProductVersion；
- 批准 Governance Gate；
- 把 ASSUMED 证据改成 CONFIRMED；
- 覆盖确定性成本引擎；
- 绕过 RBAC；
- 绕过 Idempotency / Revision / ScopeHash；
- 把模型置信度等价为业务授权。

### 1.2 Fast Judge, Slow Think

系统区分两类智能：

- System 1：快速、低延迟、结构化判断；
- System 2：生成式推理、研究、规划、综合与创作。

Laya 优先作为 System 1 Provider，用于 typed decision，而不是生成答案。

System 1 回答：

- 这个任务属于什么类型；
- 需要哪些 skills；
- 哪些上下文有用；
- 是否需要更强模型；
- 是否需要工具；
- 风险是否需要升级；
- 是否已经完成；
- 是否应唤醒 Agent；
- 是否存在明显异常。

System 2 回答：

- 为什么；
- 怎么做；
- 方案是什么；
- 如何权衡；
- 如何设计；
- 如何解释；
- 如何综合多个专家意见。

### 1.3 Provider-Neutral

VNext 的架构绝不写成 “Laya Architecture”。

正式抽象是 Judgment Provider。

Laya、Jev、RulesEngine、未来自研分类器都实现同一契约。

这样即使 Laya 后续 benchmark 不达标、维护停滞、模型更换，也不需要重构业务系统。

### 1.4 Separate Build from Review

开发执行和审核修复必须分离：

- Builder Lane：实现功能；
- Review / Verification Lane：独立读取 diff、测试、CI、运行证据并找问题；
- Central Orchestrator：持有全局目标、依赖图、基线、风险和合并权。

默认不允许一个长期线程同时“设计 → 编码 → 自证通过 → 合并”。

### 1.5 No Infinite Agent Recursion

禁止：

- Agent 无限制委派 Agent；
- Review Agent 再开 Review Agent；
- Reference MoA 再启动 MoA；
- tool loop 每一步重新 fan-out；
- retry 没有预算、次数和 stop reason。

所有并行都必须受到 Parent Task、Budget、Lease、Max Depth 和 Merge Gate 约束。

---

## 2. 目标总体架构

~~~text
User / Event / Product State / External Signal
                  |
                  v
+--------------------------------------------------+
| 1. TRUTH PLANE                                  |
| DB / Evidence / RBAC / Cost / Revision / Gates  |
| Deterministic invariants                        |
+-------------------------+------------------------+
                          |
                          v
+--------------------------------------------------+
| 2. JUDGMENT PLANE                               |
| Decision Protocol                               |
| Context Governor                                |
| Task Classifier                                 |
| Capability / Skill Router                       |
| Tool Router                                     |
| Model / Intelligence Router                     |
| Risk Guard                                      |
| Escalation Judge                                |
| Completion Judge                                |
| Provider: Rules / Laya / Jev / future local     |
+-------------------------+------------------------+
                          |
                          v
+--------------------------------------------------+
| 3. REASONING PLANE                              |
| L0 Routine                                      |
| L1 Strong Single Model                          |
| L2 Product Lab / Controlled MoA                 |
| L3 Deep Council                                 |
+-------------------------+------------------------+
                          |
                          v
+--------------------------------------------------+
| 4. ACTION / WORKFORCE PLANE                     |
| Agent / Skill / Tool / MCP / Browser / Code     |
| Autopilot / Delegation / Workflow               |
+-------------------------+------------------------+
                          |
                          v
+--------------------------------------------------+
| 5. VERIFICATION PLANE                           |
| Contract Checks / Tests / CI / AST Impact       |
| Browser Verification / Business Invariants      |
| Independent Review / Completion Evidence        |
+-------------------------+------------------------+
                          |
                          v
+--------------------------------------------------+
| 6. EXPERIENCE PLANE                             |
| Evaluation / Golden Cases / Outcome / Calibration|
| Policy Revision Candidate                       |
+-------------------------+------------------------+
                          |
                          +---- feedback ----------> Judgment
~~~

---

## 3. Plane 1：Truth Plane

VNext 不重写当前业务核心。

继续以现有模块为事实权威，包括但不限于：

- identity；
- products；
- projects；
- evidence；
- economics；
- decisions / governance；
- work；
- business event；
- audit；
- idempotency；
- product potential；
- model control。

Truth Plane 只输出结构化事实，不把“模型解释”写回事实表。

所有 VNext 智能层使用 fingerprint 读取事实：

- productVersionFingerprint；
- channelRouteFingerprint；
- evidenceFingerprint；
- taskInputFingerprint；
- codeBaseSha；
- policyVersion。

如果 fingerprint 改变，旧判断默认失效或进入 STALE，不允许继续冒充当前事实。

---

## 4. Plane 2：Judgment Plane

这是 VNext 的核心新增层。

### 4.1 统一 Decision Protocol

现有 DecisionSpec / DecisionRun 保留并升级为系统统一判断协议。

建议统一结果结构：

    DecisionResult<T> {
      specKey
      specVersion
      value
      confidence?
      distribution?
      reasonCodes[]
      evidenceRefs[]
      provider
      providerVersion
      modelId?
      policyAction
      latencyMs
      costClass
      inputFingerprint
      benchmarkProfile?
      calibrationProfile?
      fallbackReason?
      abstained
      createdAt
    }

重点：

- value 是结构化判断；
- reasonCodes 是可追踪枚举，不靠自然语言猜；
- confidence 不是授权；
- policyAction 由 Policy Gate 决定；
- abstained 是一等结果，不把“不知道”强行变成 choice。

### 4.2 DecisionSpec 分类

VNext 建议至少覆盖：

#### Routing
- workforce.route_agent
- workforce.route_skill
- intelligence.route_level
- intelligence.route_model_policy
- tool.route_toolset

#### Context
- context.relevance
- context.retention
- context.needs_refresh
- context.conflict_detected

#### Risk
- risk.needs_human
- risk.external_commitment
- risk.business_mutation
- risk.security_sensitive
- risk.low_evidence

#### Verification
- completion.status
- review.requires_more_evidence
- review.change_risk
- review.regression_suspected

#### Autopilot
- signal.should_wake_pm
- event.should_spawn_task
- child_result.should_resume_parent

#### Product
- product.needs_deep_analysis
- product.needs_red_team
- product.needs_more_evidence

高风险结果仍然只能 ESCALATE / BLOCK，不能 AUTO。

---

## 5. Laya 集成策略

### 5.1 定位

Laya 是优先候选 Judgment Provider，不是业务核心依赖。

适合场景：

- BOOLEAN / NOUL；
- CHOICE；
- SCORE；
- 批量结构化判断；
- 高频路由；
- 快速 guard；
- completion triage；
- context relevance；
- skill shortlist；
- escalation 判断。

不适合直接承担：

- 长文生成；
-复杂产品分析；
-开放式架构设计；
-最终商业判断；
-高基数且未经验证的超大 choice；
-未经 benchmark 的自动业务动作。

### 5.2 Provider 接口

建议新增：

    JudgmentProvider {
      key
      capabilities()
      evaluate(spec, state, options)
      health()
      version()
    }

实现：

- RulesJudgmentProvider；
- LayaJudgmentProvider；
- FakeJudgmentProvider；
- FutureJevJudgmentProvider。

### 5.3 Laya 服务形态

PM-next 为 Node / Next.js，Laya 为 Python / Torch。

不把 Torch 强塞进 Next.js 进程。

建议部署形态：

    Next.js
       |
       | internal HTTP
       v
    Judgment Runtime
       |
       +-- Laya Router
       +-- checkpoint lifecycle
       +-- batching
       +-- health
       +-- calibration metadata

生产要求：

- 独立端口；
- request timeout；
- circuit breaker；
- version endpoint；
- preload 配置；
- CPU / GPU runtime 可切换；
- 不可用时允许 Rules fallback 或 ESCALATE；
- 绝不 silently fallback 到昂贵 Frontier LLM。

### 5.4 Laya 的准入门槛

不能因为官方 benchmark 好看就直接开启自动化。

每一个 DecisionSpec 必须经过 Hermes 自己的 benchmark：

1. 建立 fixed evaluation set；
2. 对比 Rules / Laya / Frontier Judge；
3. 测量 accuracy / false positive / false negative / abstention；
4. 测 calibration；
5. 按 segment 测；
6. shadow mode；
7. 达到该 Spec 自己的门槛；
8. 才允许 BENCHMARKED_ENGINE。

特别注意：

- 高基数标签空间需要 shortlist/coarse-to-fine；
- confidence 不可单独作为安全机制；
- multilingual / domain calibration 要分别验证；
- checkpoint 升级必须重新跑 Harness。

---

## 6. Context Governor

VNext 不再把“检索到的全部内容”直接塞进 Agent 上下文。

新增 Context Governor：

~~~text
Sources
  |
  +-- Company Brain
  +-- Product facts
  +-- Evidence
  +-- Past runs
  +-- Tool outputs
  +-- Files
  +-- Code context
        |
        v
Candidate Context
        |
        v
Deterministic filters
        |
        v
Judgment relevance
        |
        v
HOT / WARM / COLD / DROP
        |
        v
Prompt Pack
~~~

### 6.1 HOT

当前一步必须使用。

### 6.2 WARM

本轮可能需要，保留引用和摘要，不一定注入全文。

### 6.3 COLD

保留可恢复索引，不进入 prompt。

### 6.4 DROP

重复、过期、无关、低价值临时输出。

### 6.5 关键规则

- Governance / Evidence / Current ProductVersion 关键事实不能被模型 DROP；
- Deterministic pinned context 永远优先；
- 模型只筛选“可选上下文”；
- 被裁剪内容必须可恢复；
- 所有 context pack 有 fingerprint；
- Agent 不允许偷偷绕过 Governor 把无限历史装回 prompt。

---

## 7. Capability / Skill Router

Workforce 从“Agent 是大人格 Prompt”升级为“角色 + 能力 + 工具 + 模型策略”的组合。

链路：

~~~text
Task
  |
  v
Task Classification
  |
  v
Capability Need
  |
  +-- domain skill
  +-- reasoning level
  +-- required tools
  +-- data scope
  +-- security scope
  |
  v
Agent Candidate
  |
  v
Policy Gate
  |
  v
Execution Assignment
~~~

### 7.1 Skill 必须是显式对象

建议 Skill 具备：

- key / version；
- capability tags；
- allowed task classes；
- required tools；
- minimum evidence；
- default model policy；
- output contract；
- evaluation suite；
- risk class。

### 7.2 Agent 变成长期责任主体

Agent 保存：

- role；
- ownership；
- domain scope；
- allowed skills；
- allowed tools；
- escalation path。

Agent 不保存“永久固定大模型”。

---

## 8. Intelligence Router：L0-L3

现有 Model Control Center 继续作为模型配置平面。

VNext 增加 Intelligence Level：

### L0 Routine Execute

高频、低风险、结构化：

- 分类；
-整理；
-抽取；
-普通任务拆分；
-低风险工具调用。

优先低成本模型或纯规则。

### L1 Think

中等复杂：

- 普通竞品分析；
- PRD；
- 规格建议；
- Review；
- Coding 子任务。

使用强单模型，不默认 fan-out。

### L2 Product Lab

核心研发：

- Opportunity Gate 前分析；
- Channel Spec；
- Unit Economics 解释；
-核心规格；
-高价值产品判断；
-重大代码架构变更。

允许 2-3 个 specialist + aggregator。

### L3 Deep Council

只在以下条件触发：

- 高价值；
- 高风险；
- 高分歧；
-低证据；
-用户显式要求最强分析；
- L2 无法收敛。

L3 必须记录升级原因和预算。

---

## 9. Controlled MoA

MoA 不作为默认模式。

### 9.1 单一 Evidence Pack

所有 reference 读取同一个版本化 Evidence Pack。

禁止每个专家自己重新搜索、重新定义事实。

### 9.2 Specialist 角色

例如 Product Lab：

- Market；
- Channel；
- Product / Spec；
- Economics；
- Evidence；
- Red Team。

根据任务只选需要的 2-3 个，不固定全上。

### 9.3 Structured Disagreement

Reference 输出统一为：

- conclusion；
- evidenceRefs；
- assumptions；
- unknowns；
- risks；
- counterArguments；
- confidence；
- experiment proposals。

然后计算 disagreement。

低分歧时不升级昂贵模型。

高分歧才进入 premium synthesis 或 WAITING_HUMAN。

---

## 10. Tool Router 与 Tool Guard

VNext 的 Tool 选择必须与模型选择解耦。

Judgment Plane 可以建议：

- 不需要工具；
- database read；
- web research；
- file retrieval；
- GitHub read；
- code edit；
- test runner；
- browser；
- external action。

真正工具权限由 Policy Gate 决定。

工具分级：

- READ_ONLY；
- LOCAL_WRITE；
- REPO_WRITE；
- EXTERNAL_SIDE_EFFECT；
- BUSINESS_MUTATION。

System 1 只能“建议动作”，不能提升自己的权限。

---

## 11. Coding Workforce：双车道 + 中枢

这是 VNext 工程执行的核心升级。

### 11.1 Central Orchestrator

职责：

- 理解最终目标；
- 创建 Work Graph；
- 冻结 base SHA；
- 拆分任务；
- 分配 Builder / Reviewer；
- 控制依赖；
- 维护全局风险；
- 读取 CI；
- 接收 review findings；
- 决定是否进入 fix cycle；
- 决定是否 merge；
- 更新文档 / issue / acceptance。

Central Orchestrator 默认不直接承担大量编码。

### 11.2 Builder Lane

职责只有：

- 读取明确范围；
- 基于 frozen base 实现；
- 写/改测试；
- 本地静态检查；
- 提交 commit；
- 产出 Implementation Handoff。

Builder 输出：

- changed files；
- design decisions；
- known limitations；
- tests added；
- tests executed；
- unresolved questions；
- expected reviewer focus。

### 11.3 Review / Verification Lane

使用独立上下文读取：

- requirement；
- base SHA；
- PR diff；
- tests；
- CI；
- relevant contracts；
- architecture invariants。

Reviewer 不依赖 Builder 的“我已经完成”结论。

Reviewer 输出：

- PASS；
- PASS_WITH_NONBLOCKING_FINDINGS；
- CHANGES_REQUIRED；
- BLOCKED。

Finding 必须结构化：

- severity；
- file/symbol；
- reproduction；
- expected；
- actual；
- root cause hypothesis；
- recommended fix；
- required test。

### 11.4 Fix Cycle

推荐流程：

~~~text
Central
  |
  v
Builder implementation
  |
  v
PR / commit
  |
  v
Independent Review
  |
  +-- PASS ------> Central merge gate
  |
  +-- FINDINGS --> Fix Task
                     |
                     v
                  Builder/Fixer
                     |
                     v
                  Re-review
~~~

不要在 Review 线程中边发现边无边界修改同一批文件。

### 11.5 可选第三车道：Runtime Validator

针对复杂改造，可增加 Validator：

- 跑真实 DB；
- 跑 provider；
- 跑 browser；
- 跑 migration；
- 跑 Golden Cases；
- 检查 UI；
- 收集 artifacts。

Validator 只验证，不做业务设计。

### 11.6 Git 隔离

并行线程不得共享同一个 mutable working tree。

推荐：

- 独立 branch；
- 独立 worktree；
- 独立 PR；
- 或至少独立 commit ownership。

同一文件存在高冲突时，不并行写，Central 改为串行依赖。

---

## 12. Code Impact / Verification

VNext 为 Coding Task 增加 Change Impact Pack。

至少包含：

- changed files；
- affected imports；
- affected exported symbols；
- touched Prisma models；
- touched APIs；
- touched decision specs；
- touched governance contracts；
- expected tests；
- expected migrations；
- affected UI routes。

第一阶段可使用 TypeScript AST / tsserver / dependency graph 做确定性分析。

模型只判断模糊影响项。

原则：

> 能通过 AST / schema / compiler / test 确定的，不浪费 LLM 判断。

---

## 13. Completion Judge

AgentTask 不允许仅凭 executor 自报成功。

新增独立 completion 判断：

输入：

- acceptance criteria；
- implementation handoff；
- diff；
- CI；
- test evidence；
- runtime evidence；
- unresolved findings。

输出只允许：

- COMPLETE；
- VERIFY_MORE；
- INCOMPLETE；
- WAITING_HUMAN。

对于高风险任务，Completion Judge 只能建议，最终由 Merge Gate / Human 决定。

---

## 14. Verification Plane

验证分四层。

### Layer A Contract

- typecheck；
- schema；
- required fields；
- API contract；
- DecisionSpec output shape。

### Layer B Invariant

- Governance 不可绕过；
- Evidence 状态不被伪造；
- fallback 不越界；
- budget 不超限；
- child task 不越权；
- System Principal 不越权。

### Layer C Integration

- DB；
- provider；
- model gateway；
- event/outbox；
- autopilot；
- workflow；
- UI。

### Layer D Golden / Outcome

- AKG；
-骆驼奶 + AOS；
- AKK；
-未来真实产品案例；
- coding golden tasks；
- automation golden traces。

---

## 15. Experience Plane

所有 Judgment Provider 都必须进入 Harness。

需要记录：

- spec；
- provider；
- model/checkpoint version；
- input fingerprint；
- decision；
- confidence；
- policy action；
- eventual result；
- false positive；
- false negative；
- abstention；
- latency；
- runtime cost。

Experience Candidate 可以建议：

- 修改阈值；
- 修改 provider；
-修改 shortlist；
-修改 ModelPolicy；
-修改 prompt；
-修改 rule。

不能自动修改正式生产规则。

---

## 16. 数据模型增量建议

不要求第一 PR 一次性全部加入。

建议逐步增加：

### JudgmentProviderProfile
- organizationId
- key
- kind
- endpoint
- enabled
- capability
- healthPolicy
- versionMetadata

不保存 secret。

### JudgmentRun
- specKey
- specVersion
- providerKey
- providerVersion
- inputFingerprint
- outputJson
- confidence
- reasonCodes
- latencyMs
- fallbackReason
- policyAction

可复用/扩展现有 DecisionRun，优先避免双表语义重叠。

### ContextPack
- taskId
- fingerprint
- pinnedRefs
- hotRefs
- warmRefs
- coldRefs
- droppedRefs
- policyVersion

### ExecutionPlan
- parentTaskId
- baseSha
- plannerVersion
- workGraphJson
- status

### ReviewFinding
- taskId
- reviewRunId
- severity
- location
- findingType
- reproduction
- status
- resolutionCommit

### VerificationRun
- taskId
- commitSha
- suite
- status
- evidenceJson
- startedAt
- finishedAt

若现有 AgentRun / DecisionRun 能自然承载，应扩展而不是重复造表。

---

## 17. 建议模块布局

~~~text
src/modules/intelligence/
  contracts/
    decision.ts
    provider.ts
    policy.ts

  judgment/
    registry.ts
    engine.ts
    task-classifier.ts
    risk-guard.ts
    escalation.ts
    completion.ts

  context/
    governor.ts
    pack.ts
    retention.ts

  capability/
    skill-router.ts
    agent-router.ts

  routing/
    intelligence-router.ts
    model-router.ts
    tool-router.ts

  providers/
    rules.ts
    laya.ts
    fake.ts

  council/
    evidence-pack.ts
    specialist.ts
    disagreement.ts
    orchestrator.ts
    aggregator.ts

  code-governance/
    impact-graph.ts
    review-contract.ts
    completion-evidence.ts

  telemetry/
    trace.ts
    metrics.ts
    calibration.ts
~~~

保留现有 Model Gateway、Workforce、Governance 模块边界，不把所有代码塞进 intelligence。

---

## 18. API / Runtime 边界

建议新增内部接口：

- POST /internal/judgment/evaluate
- GET /internal/judgment/health
- GET /internal/judgment/version

Next.js 对外 API 不直接暴露底层 Laya。

业务 API 永远调用 Hermes Decision Service。

这样可以：

- 替换 Laya；
-做 A/B；
-做 shadow；
-禁用 provider；
-做 circuit breaker；
-记录 DecisionRun；
-保持业务契约稳定。

---

## 19. Observability

VNext 必须可以回答：

1. 为什么唤醒这个 Agent？
2. 为什么选这个 Skill？
3. 为什么选这个模型？
4. 为什么升级 L2 / L3？
5. 为什么调用这个 Tool？
6. 哪些 Context 被裁剪？
7. 哪个判断来自规则，哪个来自 Laya？
8. 为什么没有自动执行？
9. Builder 改了什么？
10. Reviewer 为什么不通过？
11. 哪个 commit 修复了 finding？
12. 谁最终允许合并？

建议统一 Trace ID：

    BusinessEvent
      -> DecisionRun
      -> ExecutionPlan
      -> AgentTask
      -> AgentRun
      -> ModelRun / ToolRun
      -> ReviewRun
      -> VerificationRun
      -> MergeDecision

---

## 20. Cost Control

VNext 的节省不是只看模型单价，而是减少不必要的深推理。

成本策略：

- Rules 优先解决确定性问题；
- Laya 处理高频 typed decisions；
- L0/L1 默认单模型；
- Context Governor 减少 token；
- MoA 只在 L2/L3；
- reference 只运行一次；
- Tool output 先筛再回主模型；
- Reviewer 优先使用 compiler/test/AST；
- premium 模型必须有 escalation reason；
- 每任务 / 每 Product Lab / 每组织都有预算上限。

---

## 21. Reliability

### Provider Down
- Rules 可回答则 Rules；
-否则 ESCALATE；
-不能偷偷切 premium。

### Low Confidence
- 不等于失败；
-按 Spec policy 进入 agent/human。

### Conflicting Decisions
-记录 disagreement；
-升级更强 reasoning 或 WAITING_HUMAN。

### Stale Context
- fingerprint 不一致则重新 pack。

### Builder Crash
- commit 前状态可丢；
-已有 commit/PR 可恢复；
-Central 从 GitHub 状态重新构造任务。

### Reviewer Crash
-不影响 Builder commit；
-重新建立独立 review task。

### CI Flake
-区分 deterministic failure 与 flaky candidate；
-重试次数有限；
-仍失败则 BLOCKED。

---

## 22. Security / Governance

- Laya runtime 默认只接收经过最小化的 state；
-敏感字段由 Context Policy 决定是否可发送；
-未来云端 Judgment Provider 必须遵循 cloudAllowed；
-本地 Laya 可作为敏感任务快速判断候选；
-任何 EXTERNAL_SIDE_EFFECT / BUSINESS_MUTATION 仍必须通过正式权限和治理；
-Builder 无 merge 权；
-Reviewer 无业务 Gate 审批权；
-Central Orchestrator 也不能绕过 Governance。

---

## 23. 产品业务集成优先级

### 第一优先
- Workforce 路由；
- Context Governor；
- Completion Judge；
- Autopilot wake/suppress；
- Model escalation。

### 第二优先
- Product Opportunity；
- Channel Spec；
- Evidence recheck；
- Red Team trigger。

### 第三优先
- Product Lab MoA；
- Deep Council；
- Coding Workforce 完整自动闭环。

不要一开始把所有产品 Gate 全部模型化。

---

## 24. 迁移策略

VNext 必须渐进迁移。

### Stage A
Decision Protocol + fake provider。

### Stage B
Laya shadow mode，只记录，不驱动动作。

### Stage C
低风险 routing 允许 BENCHMARKED_ENGINE。

### Stage D
Context / Skill / Model routing。

### Stage E
Coding 双车道。

### Stage F
L2 Product Lab。

### Stage G
L3 Deep Council。

任何 Stage 都可以回退到现有规则/Workforce，不要求 big-bang migration。

---

## 25. 明确不做

VNext 不做：

- 无限自治；
-让模型直接批准业务 Gate；
-把所有规则替换成 Laya；
-把所有任务变成 MoA；
-把所有代码生成改成模板；
-在线自动训练并直接替换生产模型；
-无审批自动合并高风险代码；
-同一个 Agent 同时拥有实现、审核、批准全部权限。

---

## 26. VNext Definition of Done

达到以下条件才算完成：

1. Judgment Provider 可替换，Laya 不是硬依赖；
2. Decision Protocol 覆盖主要 routing / risk / completion；
3. Laya 在 Hermes 自有 benchmark 中达到准入门槛；
4. Context Governor 可显著减少非必要上下文且关键事实不丢失；
5. Agent / Skill / Model / Tool 路由解耦；
6. L0-L3 智力升级有明确策略和预算；
7. Builder 与 Reviewer 独立；
8. Central Orchestrator 能追踪完整 Work Graph；
9. Coding task 有独立 review + verification + completion evidence；
10. MoA 只在高价值场景启动；
11. 所有自动化有可见因果链；
12. 失败可恢复、可解释、不可假绿；
13. Golden Cases 和现有 Governance 回归全部通过；
14. main 始终保持可发布，VNext 通过小 PR 渐进合入。

---

## 27. 外部参考

Laya：
- https://github.com/NandhaKishorM/laya
- https://github.com/NandhaKishorM/laya/blob/main/BENCHMARKS.md

本仓库现有相关文档：
- docs/DECISION_INTELLIGENCE.md
- docs/MODEL_CONTROL_CENTER.md
- docs/MODEL_GATEWAY.md
- docs/EVALUATION_HARNESS.md
- docs/AUTOPILOT_EVENT_WAKEUP.md
- docs/AUTOMATION_CAUSALITY.md

---

## 28. 最终架构判断

VNext 的核心不是“接入 Laya”。

真正升级是：

> HERMES 由 Agent 驱动，转为由统一 Judgment Fabric 调度 Agent、Skill、Context、Tool 和 Model；由独立 Verification Fabric 判断执行是否真实完成；由 Central Orchestrator 控制多线程/多 Agent 的全局一致性。

Laya 只是目前非常适合作为 System 1 的执行引擎之一。

只要 Hermes 自己的 Decision Protocol、Policy Gate、Harness、Work Graph 和 Verification Contract 稳定，底层快速判断模型可以长期自由替换。