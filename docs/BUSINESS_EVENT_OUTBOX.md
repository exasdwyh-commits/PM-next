# Transactional Business Event Outbox V1

日期：2026-09-22

## 目标

把 Hermes 从“可以手动调用 Autopilot”推进到“真实业务事实发生后，自动化链路可靠接上”。

核心问题不是事件总线本身，而是避免 dual-write：

```text
业务写入成功
  但
自动化事件写入失败
```

如果这两步不是同一个数据库事务，系统就会出现不可恢复的“事实已变化但 Agent 永远不知道”。

因此 V1 采用 transactional outbox：

```text
Domain mutation
  + BusinessEvent
      同一 PostgreSQL transaction
             ↓
BusinessEvent dispatcher
             ↓
AutopilotEventReceipt
             ↓
DecisionRun
             ↓
Policy Gate
             ↓
AgentTask
```

## 当前接入的真实业务事件

### SIGNAL_CAPTURED

来源：

- 手工录入 SignalItem
- 自动 collector 真正创建的新 SignalItem

不是每条信号都唤醒 PM。

`signal.should_wake_pm@v2` 只使用现有真实字段：

- valueTier = high
- valueReason 非空
- nature = REAL
- 非 blocked

特别禁止为了自动化补造连续 relevanceScore。

高价值但没有价值判断依据的信号会留下：

- BusinessEvent
- AutopilotEventReceipt
- DecisionRun
- SUPPRESSED

而不会创建 AgentTask。

### PRODUCT_VERSION_PUBLISHED

发布新的不可变 ProductVersion 后：

```text
PRODUCT_VERSION_PUBLISHED
 → product_version.should_red_team@v1
 → product_version_red_team
 → Red Team AgentTask
```

目的不是阻止版本发布，而是在版本影响后续执行前自动补一次挑战：

- 核心假设
- 规格 / 渠道适配
- 证据缺口
- 失败路径
- 未知项

### EVIDENCE_VERIFIED

只有：

- verifyStatus = VERIFIED
- nature = REAL

才触发：

```text
EVIDENCE_VERIFIED
 → evidence.should_wake_pm@v1
 → evidence_recheck_pm
 → Hermes PM AgentTask
```

DEMO 证据即使状态被标记为 VERIFIED，也不会自动驱动 PM 重评。

## 可靠性语义

### 1. 业务事务与事件事务一致

生产者必须调用：

`enqueueBusinessEventInTx(tx, ...)`

并放在业务写入的同一个 transaction 中。

业务事实和 BusinessEvent：

- 要么一起提交
- 要么一起回滚

### 2. 即时派发只是降低延迟，不是可靠性的来源

业务事务提交后会 best-effort 调用 dispatcher。

如果此时：

- Autopilot 尚未初始化
- worker 暂时异常
- 服务重启

业务 API 仍保持成功语义。

因为 BusinessEvent 已经持久化，可以以后通过：

`dispatchPendingBusinessEvents(...)`

恢复。

### 3. BusinessEvent 与 Autopilot 各自拥有重试边界

BusinessEvent 负责：

`业务事实 → durable Autopilot receipt`

一旦 AutopilotEventReceipt 已成功创建，BusinessEvent 标记 DISPATCHED。

之后即使 Agent/Decision processing 失败，也由 Autopilot 自己的：

- retry
- cooldown
- pause
- lease

负责。

这样不会因为下游失败重新制造同一业务事件。

### 4. 幂等

BusinessEvent：

`organizationId + eventKey`

唯一。

相同 eventKey：

- 相同 payload → 返回已有事件
- 不同 payload → 409

AutopilotEventReceipt 又有自己的 eventKey 幂等。

因此形成双层去重：

```text
Domain idempotency
 → BusinessEvent idempotency
 → Autopilot receipt idempotency
 → AgentTask provenance
```

### 5. Worker lease

BusinessEvent 同样使用：

- leaseOwner
- leaseExpiresAt
- attempt
- maxAttempts

活跃 lease 不能被抢。

worker 崩溃后，过期 lease 可以恢复。

## 当前明确不做

- 不因为 OutboxEvent 自动修改 ProductVersion
- 不自动批准 Proposal
- 不自动通过 Governance
- 不用模型置信度直接授权业务写入
- 不把未核实 Signal 自动当作事实
- 不补造 Signal relevance 分
- 不把下游 Autopilot 失败回滚成业务 API 失败

## 下一节点

后续从底层继续造基础设施的收益已经很低。

优先进入可见产品闭环：

1. Opportunities 显示“是否触发 Hermes / 为什么没触发”
2. Product War Room 显示 ProductVersion → Red Team 的 challenge trace
3. Evidence 页显示“新证据影响了哪些分析/判断”
4. Workforce 显示 Event → DecisionRun → AgentTask 的因果链
5. child Agent 完成后自动唤醒 parent/leader 复核
