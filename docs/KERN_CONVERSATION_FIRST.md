# Kern · Conversation-first Chief of Staff

状态：**Active product direction**  
主架构：`docs/KERN_ARCHITECTURE_V2.md`

## 1. 产品定位

Kern 的身份不是“聊天客户端”。

**Kern 是 Personal Chief of Staff；Conversation 是它的第一交互界面。**

用户进入 Kern 后应该先看到一个干净、可信、可以直接交代工作的对话，而不是：

- 今日待办仪表盘；
- 审批队列；
- 项目驾驶舱；
- 数字员工组织图；
- 模型 Playground；
- 一堆要求用户判断的卡片。

项目、工作项、产品、审批、证据、运行轨迹、Agent、Model、Skill 都真实存在，但它们不应该成为普通用户完成工作的前置知识。

```text
用户
↓
Kern
↓
理解目标 + 长期上下文
↓
自己规划 / 研究 / 调 Agent / 使用工具
↓
执行能安全执行的工作
↓
QA / Evidence / Governance
↓
回到同一条对话汇报结果
```

`/manage` 是业务管理视图，不是 Kern 本人。

---

## 2. 用户交互原则

### 默认：少问，先做

用户已经明确表达目标时，不把内部规划重新变成一串问题。

例如：

- “把目标人群改成 25–45 岁女性”
- “建一个任务跟进供应商报价”
- “验证这个产品值不值得做”
- “检查这个仓库并修掉能确定的问题”

如果目标和对象明确，Kern 应推进并返回结果。

### 只在真正需要人时打断

需要人类介入的主要情况：

- 支付 / 下单 / 财务承诺；
- 正式发布 / 上线 / 对外发送；
- 删除或不可逆覆盖；
- 高权限或敏感权限变更；
- G1 / G2 / G3 正式 Gate；
- 法律、合同或外部承诺；
- 多个目标无法可靠区分；
- 多个合理方案之间存在真实战略取舍。

“系统内部可逆写入”不是默认 Human Gate。

---

## 3. Decision Budget

每次 Kern 准备问用户问题前，都应先判断：

1. 能否根据明确指令直接执行？
2. 能否从已知事实解决？
3. 能否通过研究解决？
4. 能否让专业 Agent / QA 解决？
5. 能否采用安全默认值并记录？
6. 是否真的需要用户承担价值取舍或受保护决策？

只有第 6 类默认升级给用户。

目标不是“让用户参与每一步”，而是“把真正需要用户判断的少数事项交给用户”。

---

## 4. Proactive but restrained

Kern 不只响应 Prompt。

它可以因真实事件主动工作：

- deadline approaching
- blocker
- agent return
- new evidence
- failed automation
- opportunity signal
- stale assumption
- outcome available

但事件发生不等于通知用户。

Kern 应决定：

- AUTO_HANDLE
- WATCH
- SURFACE
- INTERRUPT
- HUMAN_GATE

主动克制是正式能力：

- 没有新信息不重复提醒；
- 能自己处理的不升级人工；
- Agent 很忙不是值得通知用户的理由；
- 低置信度异常先补证据；
- 不用多个 UI 模块重复强调同一件事。

---

## 5. Conversation 与 Work

Work 不是另一个首页，也不是要求用户管理 Agent。

它是 Kern 在后台完成复杂目标的运行形态：

```text
用户：把这个仓库检查一下并修好

Kern：我来处理。

内部：
Goal Plan
→ Code / Review agents
→ tools
→ tests
→ QA
→ receipts

Kern：
完成。修了 3 处，测试通过。这里是变更摘要。
```

用户想看过程时再展开：

- Plan；
- 运行轨迹；
- Evidence；
- Agent / Tool；
- Visual Intelligence；
- Receipt。

默认不展开。

---

## 6. 模型 / 顾问 / Skill / Capability 控件

高级控制能力保留，但不应默认占据输入框。

默认：

```text
[ 给 Kern 发消息……                     ↑ ]
                          Auto · Kern
```

点击 Advanced 后才显示：

- 模型；
- 顾问；
- Skills；
- Capabilities。

原则：

> 用户可以覆盖 Kern 的自动路由，但不应该被迫成为 Agent 调度员。

当用户手工选择多个顾问时，如果没有独立 AgentRun，Kern 不得声称“多个顾问已经分别独立执行”；只能说这些是本轮采用的专业视角。

---

## 7. 对话与长期 Memory

Conversation History 不等于 Memory。

Kern 的长期上下文由主架构定义的四层 Memory 提供：

- Working；
- Episodic；
- Semantic；
- Procedural。

Kern 负责选择最小必要上下文注入当前对话和 Agent 任务。

Agent 不拥有独立、互相冲突的长期用户记忆。

---

## 8. 管理工作台

`/manage` 继续承载：

- 产品；
- 项目；
- 市场机会；
- Validation；
- Marketing；
- 工作项；
- 风险与证据；
- 自动化；
- 审计；
- 设置。

工作台是标准 SaaS / OA 管理面，不需要“AI 化视觉”。

首页只回答：

1. 什么需要我处理？
2. Kern 正在做什么？
3. 哪些核心工作在推进？
4. 哪里异常？

默认高密度、低噪声。

---

## 9. Visual Intelligence

Visual Intelligence 是按需解释工具，不是默认 UI。

适合：

- 用户明确要求画图 / 拆解；
- 软件架构；
- 配方关系；
- 产品商业模型；
- Agent 执行链；
- Before / Delta / After。

普通复杂咨询即使内部使用 Council，也不自动展示一张“多 Agent 很热闹”的图。

---

## 10. Autonomy

当前风险模型继续保持：

```text
capability
× reversibility
× external side effect
× financial impact
× permission sensitivity
× production release
× formal gate
× destructive
× ambiguity
→ AUTO / ASK / DENY
```

Proposal 是内部事务与审计协议，不等于每个 Proposal 都要给用户弹确认卡。

受保护动作仍由 Governance / Approval / Gate 决定。

---

## 11. 判定标准

Kern Conversation 成功的标准不是：

> “聊天界面很好看。”

而是：

> 用户只需表达目标；Kern 能持续理解、执行、管理 Agent、减少不必要决策，并把可信结果带回同一条对话。

**Conversation 越简单，背后的 Supervisor / Memory / Gateway / Harness 应该越强。**
