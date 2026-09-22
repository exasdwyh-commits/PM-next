# Workforce Review & Home Brief V1

日期：2026-09-22

## 目标

在已有链路：

```text
BusinessEvent
 → Autopilot
 → DecisionRun
 → AgentTask
 → Delegation
 → Child Agent
 → Parent Return
```

之上，补齐“结果能读、结果能处理、首页能看懂今天发生了什么”。

## 1. 委派任务必须返回可读结果

AgentRun 新增：

`outputSummary`

约束：

- 普通任务可为空；
- 委派子任务 FAILED 可由 reason 解释；
- 委派子任务 SUCCEEDED 必须提供非空 resultSummary；
- resultSummary 最大 4000 字符；
- resultSummary 写入 AgentRun；
- 同时进入 AGENT_CHILD_TERMINAL BusinessEvent；
- 再进入父 Agent review task 的 contextSnapshot。

因此不允许：

```text
Child Agent = SUCCEEDED
但父 Agent 实际收到空白回执
```

## 2. Autopilot task context

Autopilot 创建的 AgentTask 统一携带：

```json
{
  "schemaVersion": "autopilot-task-context/v1",
  "event": {
    "receiptId": "...",
    "eventKey": "...",
    "eventType": "...",
    "sourceType": "...",
    "sourceId": "..."
  },
  "state": {},
  "criteria": {},
  "contextRefs": []
}
```

父 Agent review 因此可以直接读取：

- parentTaskId
- parentTaskGoal
- childTaskId
- childAgentCode
- childOutcome
- resultSummary
- reason

无需 UI 再拼装或猜测。

## 3. 返回结果复核动作

`POST /api/workforce/tasks/:id/review-return`

支持：

### ACCEPT_RESULT

接受子结果。

- review task → SUCCEEDED
- 原父任务状态不修改
- 适合：结果可信，但父 Agent 仍需继续原工作

### CONTINUE_DELEGATION

继续交给另一位专业 Agent。

要求：

- toAgentId
- goal
- reason

生成新的 AgentDelegation + child AgentTask，并关闭本次 review task。

### ESCALATE_HUMAN

现有证据不足，升级人工判断。

- review task → WAITING_HUMAN
- reason 必填
- 不伪装成已完成

### CLOSE_PARENT

人工确认当前结果已经足以结束原父工作。

- review task → SUCCEEDED
- original parent AgentTask → SUCCEEDED
- 仍在 QUEUED / RUNNING / WAITING_CONFIRMATION 的 parent AgentRun 同步收口
- closure reason 写 AuditEvent
- 不覆盖 parent Agent 原始 outputSummary

如果被关闭的 parent 本身也是上一层 delegation child，则继续产生新的 AGENT_CHILD_TERMINAL，使多层委派可以继续向上返回。

## 4. Workforce UI

新增“结果待复核”。

每张卡显示：

- 原父任务目标
- 子 Agent
- 子任务结果状态
- 结果摘要
- DecisionRun 版本
- 人工等待原因

并直接提供：

- 接受结果
- 继续委派
- 升级人工
- 关闭父工作

## 5. Home / Jarvis Activity

当前系统没有组织 timezone 字段，因此首页不冒充“自然日今天”。

使用真实滚动窗口：

`最近 24 小时`

展示：

- 感知多少 BusinessEvent
- 自动触发多少 AgentTask
- 抑制多少不必要自动动作
- 自动化失败数
- 等待人工 / 结果复核数
- 最近 Event → DecisionRun → AgentTask 因果链

首页“走你处理”同时包含：

- returned-child review
- Agent WAITING_HUMAN
- Policy Gate WAITING_HUMAN

所有数字来自数据库真实聚合；没有数据就显示空态。

## 6. 治理边界

本轮只自动处理 Workforce workflow 状态。

不会因为：

- 接受 Agent 结果
- 关闭 Agent parent task
- 继续委派

而直接修改：

- ProductVersion
- Project business baseline
- Proposal approval
- DecisionPacket
- Launch authorization

业务事实修改仍走 Governance Kernel。
