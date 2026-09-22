# Autopilot / Event Wakeup V1

日期：2026-09-22

## 定位

Autopilot 是 Workforce 的事件触发层，不是第二套 Agent，也不是业务写入捷径。

V1 链路：

```text
Event
  ↓
AutopilotEventReceipt
  ↓
Decision Intelligence
  ↓
DecisionRun
  ↓
Policy Gate
  ↓
AgentTask (仅允许的动作)
  ↓
AgentRun
  ↓
Governance（如需业务写入）
```

## V1 只开放一个默认动作

`signal_wake_pm`

使用：

`signal.should_wake_pm@v1`

只有规则判断明确为 true 时，才能创建 Hermes PM 的 EVENT AgentTask。

false 信号会保留：

- EventReceipt
- DecisionRun
- suppressionReason

而不是静默丢弃。

## 幂等与去重

同一个：

`autopilotId + eventKey`

只能存在一条 Receipt。

如果相同 eventKey 再次提交：

- payloadHash 相同 → 返回原 Receipt；
- payloadHash 不同 → 409，拒绝覆盖历史事实。

## 系统主体

无人值守任务不再冒充创建者或管理员。

每个组织会创建显式系统主体：

`system+<organizationId>@hermes.invalid`

特性：

- passwordHash = null
- isSystem = true
- 禁止 createSession
- 禁止通过 HTTP session / dev mock auth 登录
- AuditEvent 明确记录为 Hermes Runtime 行为

## Worker Lease

Receipt 在处理前必须 claim：

- leaseOwner
- leaseExpiresAt
- attempt
- maxAttempts

活跃 lease 不允许第二 worker 抢占。

过期 lease 可以恢复，解决 worker 崩溃后永久卡在 PROCESSING 的问题。

## Pause / Cooldown

### 人工暂停

AutopilotStatus = PAUSED

新事件仍可形成 PENDING receipt，但不处理、不丢失。

恢复后继续处理。

### 自动 cooldown

连续处理失败达到 failureThreshold 后：

`pausedUntil = now + cooldownSeconds`

cooldown 内事件继续排队为 PENDING，不形成失败风暴。

人工确认修复后可恢复并清零 failure streak。

## 当前允许的任务触发

Autopilot 仍受 DecisionRun → AgentTask 的硬边界约束。

当前只有：

- workforce.route_agent → 精确匹配目标 Agent
- signal.should_wake_pm=true → Hermes PM

能作为 AUTO 任务触发依据。

needs_human、priority score、false wakeup、BLOCK 等都不能被重新解释成任务授权。

## 尚未开放

V1 刻意不做：

- 任意事件自动执行
- ProductVersion 自动修改
- Proposal 自动批准
- Governance 自动通过
- Laya/Jev 直接触发任务
- 无限 retry
- 并行 fan-out
- 外部副作用

下一阶段才考虑：

1. SignalItem ingestion adapter
2. ProductVersionChanged → Red Team
3. EvidenceVerified → Hermes PM re-evaluation
4. child task complete → parent wakeup
5. durable scheduler / outbox
