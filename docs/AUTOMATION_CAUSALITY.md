# Automation Causality & Parent Return V1

日期：2026-09-22

## 本轮目的

上一阶段已经完成：

```text
Business fact
 → BusinessEvent
 → Autopilot
 → DecisionRun
 → AgentTask
```

本轮解决两个产品化问题：

1. 使用者看不到“为什么这个 Agent 被唤醒 / 为什么没有被唤醒”；
2. Hermes PM 把任务委派给专业 Agent 后，子任务完成并不会自动把控制权交回父 Agent。

## 可见因果链

新增统一只读投影：

`automation-trace/service.ts`

真实来源全部来自：

- BusinessEvent
- AutopilotEventReceipt
- DecisionRun
- AgentTask

不通过前端推算自动化状态。

展示链：

```text
业务事件
 → Autopilot
 → DecisionSpec@version
 → reasonCodes
 → policy action
 → AgentTask / SUPPRESSED / WAITING_HUMAN / FAILED
```

### Opportunities

每条 Signal 现在显示：

- 是否唤醒 Hermes PM；
- 使用哪个 DecisionSpec；
- 为什么触发；
- 为什么被抑制；
- 历史 Signal 如果没有 BusinessEvent，明确显示“历史记录暂无因果链”。

### Product War Room

产品总览新增“自动响应”：

- ProductVersion 发布 → Red Team；
- VERIFIED + REAL Evidence → Hermes PM；
- 被抑制的自动化同样展示原因。

### Workforce

新增组织级“自动化因果链”列表，统一查看最近：

- Signal wakeup
- ProductVersion challenge
- Evidence recheck
- Child result return

## 子任务结果返回

新增业务事件：

`AGENT_CHILD_TERMINAL`

只在委派子任务进入真实终态时产生：

- SUCCEEDED
- FAILED

不把：

- BLOCKED
- WAITING_HUMAN

伪装成“子任务已完成”。

链路：

```text
Parent AgentTask
  ↓ delegate
Child AgentTask
  ↓ terminal
AGENT_CHILD_TERMINAL
  ↓
child_task_return Autopilot
  ↓
workforce.resume_parent@v1
  ↓
CHOICE(parentAgentCode)
  ↓
new Parent Review AgentTask
```

## 为什么不直接修改原父任务

原父任务可能处于：

- RUNNING
- WAITING_HUMAN
- BLOCKED
- 已进入其它处理阶段

直接把它改回 RUNNING 会破坏历史事实，也可能绕开人工判断。

因此 V1：

- 原父任务状态保持不变；
- 创建独立 review task；
- DecisionRun 记录返回哪个 Agent；
- BusinessEvent contextRefs 同时指向 parent task、child task、child run。

这样“返回控制权”是一个新的可审计事实，不是对旧事实的覆盖。

## 安全边界

`workforce.resume_parent@v1`：

- RULES only；
- CHOICE 类型；
- 目标必须是默认 Workforce allowlist 中的 Agent code；
- 非法 parentAgentCode 直接失败，不 fallback 到 Hermes PM；
- createAgentTask 再次校验 DecisionRun 的 value 必须等于实际目标 Agent；
- System principal 不获得 OWNER_ONLY Agent 的额外权限。

因此自动返回不能利用 payload 任意唤醒未知 Agent。

## 可靠性

子任务终态与 AGENT_CHILD_TERMINAL 使用同一 DB transaction。

事务提交后即时 dispatch 只是降低延迟。

如果下游不可用：

- 子任务终态仍然成立；
- BusinessEvent 仍然存在；
- 后续可通过 outbox drain 恢复。

## 下一阶段

底座到这里已经足够。

优先继续：

1. 将 Agent review task 的交付物 / result 摘要纳入 return context；
2. 给自动化任务增加“接受 / 继续委派 / 升级人工 / 关闭父工作”动作；
3. Home/Jarvis 展示“今天 Hermes 自动发现了什么、做了什么、哪里等你拍板”；
4. 用真实开品 Golden Cases 跑一轮完整组织闭环。
