# Decision Intelligence Kernel

日期：2026-09-22

## 定位

Decision Intelligence Kernel 是 Hermes 的“快速判断与路由层”。

它不等于 Agent，也不等于 Governance。

正确链路：

```text
Event / Work Item
  ↓
DecisionSpec
  ↓
DecisionEngine
  ↓
Typed DecisionResult
  ↓
Policy Gate
  ↓
AUTO / ESCALATE_AGENT / ESCALATE_HUMAN / BLOCK
  ↓
Workforce / Governance
```

## 为什么现在先做契约，不先接 Laya / Jev

快速判断模型的价值很明确：

- 分类
- 路由
- 优先级
- Signal relevance
- 是否需要人工
- 是否值得唤醒 Agent

但模型置信度不能直接等于自动执行资格。

因此先冻结以下契约：

- DecisionSpec
- DecisionEngine
- DecisionEngineResult
- Policy Gate
- RulesEngine

以后 Laya、Jev、小模型或第三方 Judge 只能作为 DecisionEngine 插件进入。

## DecisionSpec

每一个判断必须有稳定 key + version，例如：

- workforce.route_agent@v1
- workforce.needs_human@v1
- workforce.task_priority@v1
- signal.should_wake_pm@v1

Spec 决定：

- 输出类型 BOOLEAN / CHOICE / SCORE
- 风险等级
- 允许哪些引擎
- 允许的 choice 集合 / score 范围
- 自动化政策
- 是否要求 benchmark / calibration / confidence

Agent 不得自己发明临时 schema 直接驱动自动动作。

## 自动化政策

### DISABLED

永不自动动作。

### RULES_ONLY

只有确定性 RulesEngine 结果可以 AUTO。

### BENCHMARKED_ENGINE

模型引擎只有在以下条件全部满足时才能 AUTO：

- Spec 允许模型
- benchmarkProfile 存在（如要求）
- calibrationProfile 合格（如要求）
- confidence 达标（如要求）

否则升级给 Agent 或 Human。

## 全局风险上限

HIGH / CRITICAL 的 DecisionSpec 永不 AUTO。

即使配置错误地写了 RULES_ONLY 或 BENCHMARKED_ENGINE，
Policy Gate 仍强制升级。

这防止“高置信模型”绕过治理。

## 当前默认规则

### workforce.route_agent

低风险规则路由：

- Red Team → red_team
- Research → research_agent
- Marketing → marketing_agent
- Ops → ops_agent
- Product → product_agent
- 默认 → hermes_pm

当前仅 RulesEngine 可自动路由。

### workforce.needs_human

命中以下任一条件返回 true：

- businessMutation
- budgetApproval
- governanceGate
- highRisk
- externalCommitment

它只回答“是否需要人工”，不批准任何业务修改。

### signal.should_wake_pm

必须同时：

- actionable
- 非 duplicate
- 非 blocked
- relevanceScore >= 70

才允许低风险自动唤醒。

### workforce.task_priority

用确定性规则生成 0-100 队列优先级；
它是排队信号，不是业务价值分数。

## 与 Laya/Jev 的边界

未来模型可以进入：

```text
MODEL DecisionEngine Adapter
  ↓
DecisionResult
  ↓
Benchmark / Calibration metadata
  ↓
Policy Gate
```

但不能直接：

```text
Laya/Jev → AgentTask
Laya/Jev → ProductVersion mutation
Laya/Jev → Governance approval
```

## 下一步

1. 增加持久化 DecisionRun；
2. AgentTask / AgentRun 记录 decisionRunId；
3. Autopilot/Wakeup 只能通过 Decision Intelligence 触发；
4. 建 Hermes Decision Benchmark；
5. benchmark 达标后才尝试 Laya/Jev adapter。
