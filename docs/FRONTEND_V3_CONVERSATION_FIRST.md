# PM-next Frontend V3 · Conversation-first Department OS

> Status: implementation in progress  
> Baseline: `fcd4fc86`  
> Branch: `frontend-v3-conversation-first`

## Product rule

> Product brand: **科恩 KERN** — AI 工作总管 / AI Chief of Staff. The `/muse` route is a compatibility path, not a user-facing product name.


The frontend must hide internal orchestration complexity from ordinary users.

Primary interaction loop:

```
Describe goal
→ KERN understands context
→ system researches / decomposes / executes
→ user reviews result
→ user makes business decision
→ system continues
```

Users should not need to understand `AgentTask`, `AgentRun`, `ResearchRun`, leases, fencing tokens, or internal governance objects before they can complete a business task.

## Primary navigation

1. 今日
2. 产品
3. AI 助理
4. 市场机会
5. 公司知识
6. 自动化中心
7. 设置

Legacy routes remain available for compatibility but are grouped into the primary mental model:

- Projects / War Room → 产品
- Consultation → AI 助理
- Dashboard / Trace → 自动化中心
- Organization → 设置

## Home contract

The home screen answers only three questions:

1. What needs my decision or review now?
2. What is KERN currently doing?
3. What should I start or continue next?

The global command input reuses the existing `/advisor?query=` flow. Do not present fake command execution.

## Product workspace

Project detail is presented as a product work surface:

- 概览
- AI 研发
- 任务
- 证据
- 决策
- 记录

Default = 概览.

The overview must show:
- current stage
- blocking gaps
- next recommended action
- compact counts for tasks / verified evidence / pending decisions / feedback

Do not expose all low-level panels at once.

## Guardrails

- No database or governance semantic changes as part of this frontend refactor.
- Preserve Product R&D, Independent QA, G1/G2/G3, Evidence, Approval and audit semantics.
- UNKNOWN remains UNKNOWN.
- Old URLs must remain reachable until explicit migration/removal work.
- Mobile must preserve primary action and status readability.
