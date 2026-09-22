# HERMES PM-next 当前执行计划

更新时间：2026-09-22

## 当前基线

PM-next 已经不再处于旧的 TASK-017 / 产品中心补页面阶段。当前 main 已完成并由 CI 覆盖的核心能力包括：

- Product Potential V2：Hard Gates + Channel Spec Fit + Evidence State + Validation；
- Model Gateway V2：显式候选、能力约束、健康隔离、Circuit Breaker、fail closed；
- Evaluation Harness / Experience Loop：冻结预测、真实结果、经验回写；
- Autonomous Workforce Kernel：Agent / Skill / Squad / Delegation / Return Review；
- Decision Intelligence：版本化决策规范、规则引擎、Policy Gate、DecisionRun provenance；
- Autopilot + Business Event Outbox：业务事件驱动 Agent，带租约、冷却、回执和因果链；
- Golden Organization V2：AKG、骆驼奶+AOS、AKK 多案例端到端组织级回归；
- Quality / Workforce / Governance / Decision / Autopilot / Experience / Golden Organization CI 当前 main 为绿色。

旧版 TASK-016～TASK-045 计划只保留历史参考价值，不再作为当前执行顺序。

## 当前进行中

### M1 · Model Control Center V1

目标：把 Model Gateway 从代码内核推进为可配置控制平面。

范围：

1. 组织级 ModelProfile 持久化；
2. 组织级 ModelPolicy 持久化；
3. Agent × TaskClass → Policy 绑定；
4. 官方推荐模板；
5. 设置页可配置 Profile / Policy / Agent 绑定；
6. API Key 不入数据库；
7. 模板默认禁用，禁止假装模型已经接通；
8. 新增独立回归测试并进入 Quality CI。

验收：

- 安装模板不会产生真实模型调用；
- 已配置的 provider/modelId 不会被重复安装模板覆盖；
- cloudAllowed=false 不能引用 CLOUD Profile；
- Agent 绑定 TaskClass 与 Policy TaskClass 不一致时拒绝；
- Strategic / Red Team 官方策略强制 REASONING；
- typecheck / lint / build / Model Control tests 全绿。

## 下一阶段

### M2 · Model Gateway Runtime Integration

1. 把现有 AdvisorLLMClient 包装为 ModelProviderPlugin；
2. 执行前按 Agent × TaskClass 解析 ModelPolicy；
3. ModelGateway 接管真实 provider 路由；
4. 新增 ModelRun 持久化：
   - policyKey / version
   - profileKey
   - provider / modelId
   - attempts / fallback
   - usage
   - latency
   - failure kind
5. AgentRun.provider/modelId 只记录实际执行结果；
6. 未配置 Provider 时 fail closed，不回退到未知模型。

### M3 · Cost & Intelligence Tiers

按任务价值分层，而不是“全员永远最强模型”：

- Routine：Agnes / 同级低成本模型；
- Balanced：一般研究、抽取、总结；
- Frontier：产品研发、战略咨询、关键规格判断；
- Red Team：高风险挑战与重大决策复核；
- Private Local：禁止上云任务。

MiMo 等新模型作为可插拔 Profile 进入评测，不写死为系统依赖。

### M4 · Controlled Mixture of Agents

MoA 只用于高价值任务，不做无差别多模型并发：

```text
Primary analysis
  → Independent challenger
  → Synthesis
  → Governance / Human decision
```

必须有：

- 任务白名单；
- 最大调用次数；
- 成本预算；
- 独立上下文或防锚定机制；
- Harness 对比单模型与 MoA 的真实收益。

### M5 · Product Route Persistence

把 PRODUCT_POTENTIAL_V2 文档中的下一阶段模型正式落库：

- ChannelRuleProfile；
- ProductRoute / ChannelSpecRoute；
- PotentialAssessment；
- supersedes 链；
- 真实渠道规则 CONFIRMED / ASSUMED；
- 每个渠道路线独立成本、利润和验证状态。

目标不是增加“一个总分”，而是让开品判断可解释、可追溯、可复盘。

## 需要收口的历史分支 / PR

当前仍有历史开放 PR，需要在后续合并前逐个判断是否已被 main 覆盖：

- Autopilot V1 历史 PR：main 已经存在更新版本时，应优先做差异审查，避免重复合并旧实现；
- Formal G2 production gate：与现有 Governance / Launch Authorization 重新对齐后再决定合并方式。

原则：不因为 PR 存在就直接合并；先以当前 main 的业务契约和 CI 基线为准。

## 项目完成标准

PM-next 的“功能完成”不等于页面都能点。

真正可交付需要同时满足：

1. 产品判断：证据、Hard Gate、渠道经济性、验证闭环；
2. Agent：可委派、可复核、可升级人工；
3. 模型：可配置、可替换、可审计、可控成本；
4. 自治：事件可触发，但不能绕过 Governance；
5. 学习：只有真实 outcome 才进入经验；
6. UI：用户能看到系统为什么判断、Agent 做了什么、下一步谁负责；
7. CI：类型、迁移、关键 Golden Case、自治和治理回归全部持续绿色。
