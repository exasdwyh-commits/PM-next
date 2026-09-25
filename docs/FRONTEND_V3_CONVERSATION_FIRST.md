# PM-next Frontend V3 · Kern Conversation-first OS

> Status: **implemented / delivery baseline**
> Current product name: **Kern**
> Compatibility route: `/muse`
> Management entry: `/manage`

## Product rule

Kern is the primary operating layer. Ordinary users, leaders and digital employees should be able to complete daily work through conversation without understanding internal orchestration objects.

```text
Describe goal
→ Kern resolves real context
→ planner selects a governed capability
→ research / decomposition / digital employees / Mac execution
→ evidence + independent QA
→ Executive Report
→ human Check-in only when needed
→ Kern continues
```

The professional management system remains independent and complete. Product managers, project owners and admins may enter it directly to inspect and manage business objects.

## Two-layer information architecture

### 1. Kern primary shell

The default root redirects to `/muse` for compatibility; the visible brand is Kern.

The first screen answers only:

1. 今天什么最重要；
2. Kern 正在真实执行什么；
3. 现在需要我处理什么。

Rules:

- a user message alone never implies execution;
- only real `AgentRun.RUNNING`, `AgentTask.RUNNING` or desktop `RUNNING` may render “正在执行”;
- QUEUED / WAITING_HUMAN / BLOCKED / FAILED / UNKNOWN stay explicit;
- Proposal changes render as diff + human confirmation;
- fine-grained local permissions are not shown as editable until a real backend authorization model exists.

### 2. Professional management system

Primary management navigation:

```text
管理总览 / 产品管理 / 项目管理 / 市场机会 / 公司知识 / 自动化中心 / 设置
```

Business object vocabulary:

- Product → **产品**
- Project → **项目**
- WorkItem → **工作项**
- Gate → **门禁**
- DecisionPacket → **决策包**
- assistant / product brand → **Kern**

Internal compatibility identifiers such as `/muse`, `.hermes-*` and `hermes_pm` are intentionally not migrated just for naming.

## Product and project management

产品是业务主对象；项目是独立、传统、完整的执行管理对象。

项目详情：

```text
概览 / AI 研发 / 工作项 / 证据 / 决策 / 记录
```

The management backend may be dense when necessary. It is not required to imitate the Kern chat surface.

## Executive Report

Default reading order:

```text
当前结论
→ 关键依据
→ 最大风险与关键风险
→ UNKNOWN / 还不能下结论
→ 需要你决定
→ 下一步
```

Professional-agent notes and provenance remain folded by default.

## Desktop assistant narrative

Users should experience:

```text
Kern 已连接这台 Mac
→ 本机任务在排队 / Kern 正在用你的电脑
→ real receipt / artifact / failure
→ result returns to the original Kern conversation
```

“Desktop Runtime” is implementation terminology, not the primary user narrative. Developer commands such as `npm run desktop` belong in secondary help.

## Visual system

- one calm conversation lane;
- one accent gradient for primary emphasis only;
- solid neutral surfaces, no glass-heavy cards or decorative glow background;
- dark mode first-class;
- 390px must keep the primary action, status, Today cards and composer usable;
- `prefers-reduced-motion` remains supported.

## Guardrails

- No database or governance semantic rewrite as part of frontend work.
- Preserve Product R&D, Independent QA, G1/G2/G3, Evidence, Approval and Audit semantics.
- UNKNOWN remains UNKNOWN.
- No fake loading, fake agent work, fake progress, fake evidence, fake completion or fake desktop execution.
- Old URLs remain reachable unless an explicit migration is separately approved.
