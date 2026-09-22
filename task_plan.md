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

## 已完成

### M1 · Model Control Center V1

已合入 main（PR #29）：

- 组织级 ModelProfile / ModelPolicy 持久化；
- Agent × TaskClass → Policy 绑定；
- 官方推荐模板与自定义配置；
- 设置页模型控制中心；
- API Key 不入数据库；
- Profile 默认禁用，禁止假装模型已接通；
- Model Control tests 已进入 Quality CI。

### M2 · Model Gateway Runtime Integration

已合入 main（PR #30）：

- Provider Runtime 使用部署环境 endpoint / secret，API Key 不入数据库；
- Advisor 按意图映射 Agent × TaskClass；
- ModelGateway 已接管真实 provider 路由与策略内 fallback；
- ModelRun 持久化 policy/profile/provider/model/usage/attempts/routing skips；
- AgentRun.provider/modelId 记录实际执行结果；
- Model Control 绑定存在时禁止旧 Advisor 模型旁路；
- 模型不可用时安全回落确定性工具结果；
- Quality / Golden / Governance / Workforce 等 CI 全绿。

## 当前进行中

### M3 · Product Route Persistence V1

目标：让“同一个产品针对不同渠道形成不同规格路线”成为正式业务对象，而不是备注或单一总分。

范围：

- 组织级 ChannelRuleProfileRecord，区分 ASSUMED / CONFIRMED / SUPERSEDED；
- ProductVersion 下可保存多个 ChannelSpecRoute；
- 路线修改形成 revision + supersedes 链，不覆盖历史；
- 确定性计算渠道费用、履约成本、贡献毛利与可承受最高单元成本；
- 渠道经济性失败自动形成 Hard Gate；
- 已确认渠道规则被新版本替代后，旧路线重新进入 NEEDS_EVIDENCE；
- PotentialAssessmentRecord append-only 保存诊断快照与 evidenceFingerprint；
- 真实市场验证只能从 VERIFIED + REAL + VERIFIED_BY_LEAD Evidence 推导；
- 产品详情新增“渠道路线”工作台。

验收：

- 高需求/高差异化不能抵消渠道经济性硬失败；
- ASSUMED 渠道规则不能得到已确认路线结论；
- 新渠道规则版本不会删除旧路线历史；
- 299/12盒、499/24盒可作为同一 ProductVersion 的独立路线比较；
- Prisma migrate deploy、typecheck、lint、build、Channel Route tests、Golden Organization 全绿。

## 下一阶段

### M4 · Cost & Intelligence Tiers

按任务价值分层，而不是“全员永远最强模型”：

- Routine：Agnes / 同级低成本模型；
- Balanced：一般研究、抽取、总结；
- Frontier：产品研发、战略咨询、关键规格判断；
- Red Team：高风险挑战与重大决策复核；
- Private Local：禁止上云任务。

MiMo 等新模型作为可插拔 Profile 进入评测，不写死为系统依赖。

### M5 · Controlled Mixture of Agents

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
