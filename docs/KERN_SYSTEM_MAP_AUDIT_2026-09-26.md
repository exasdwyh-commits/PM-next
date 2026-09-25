# Kern 系统地图审查 · 2026-09-26

基线：`3e89e3c`  
地图源：`docs/maps/kern-system.architecture.json`  
方法：按 Archify 的 source-backed architecture 结构，把当前真实代码入口、路由、工具、Work Engine、Desktop Runtime、Governance 与管理工作台放到一张图上，再检查产品逻辑是否与“对话优先 Agent 客户端”一致。

## 结论

**主产品逻辑已经对齐，但底层仍是“新 Kern 外壳 + 旧 Advisor 核心”过渡态。**

正确主链应保持：

```text
用户
→ Kern Chat
→ Conversation API
→ Kern Assistant Runtime
→ Router
→ Tools / Model
→ Work Engine / Desktop Runtime
→ Governance
→ Result / Receipt 回到原对话
```

`/manage` 是旁路管理面，不应重新成为日常主入口。

## 已对齐

1. **对话主入口成立**  
   `/muse` 是默认使用面；工作台独立保留。

2. **Work 在后台而不是用户管理 Agent**  
   Product R&D / Workforce / Desktop Runtime 都可以由对话触发，执行结果可回到原会话。

3. **低风险工作开始自主执行**  
   明确的内部、可逆动作不再重复要求用户点击确认；权限、CAS、幂等和审计仍在服务端。

4. **高影响动作仍有治理边界**  
   Governance / Approval / ToolBroker 继续负责真正的人类 Gate。

5. **Visual Intelligence 已降级为按需工具**  
   普通聊天不自动展示顾问团和结构图；用户明确要求“画 / 拆解 / 可视化”才出现。

## 本轮整体改造状态

这份地图审查已经进入实施阶段：

- **P0 已完成第一阶段**：主聊天链从 `advisor.sendMessage` 迁到 `assistant-runtime/conversation-engine.ts`。Advisor 只作为 `LEGACY_ADVISOR_COMPAT` capability provider，Conversation CRUD 也已归到 Assistant Runtime。
- **Conversation 语义已清理**：Kern Chat ViewModel 使用 `ConversationSummary / activeConversationId / conversationId`，不再把会话称为 Mission，也不再预加载 Today 管理驾驶舱。
- **Autonomy 已升级**：从动作白名单改为 capability risk assessment，显式考虑 reversibility / external side effect / financial / permission / production release / formal gate / destructive / ambiguity。
- **Project Map Builder 已落地**：可从真实 source file + static import 生成 VERIFIED KernGraph，并转换为 Archify architecture spec；`npm run kern:map` 可重复生成项目地图。

当前尚未完全移除 Legacy Advisor provider；下一轮继续把领域 capability 按模块从 `advisor/service.ts` 抽出，而不是再把运行时逻辑放回去。

## 地图暴露出的结构债

### P0 · Legacy Advisor capability provider 仍待继续拆分

`src/modules/assistant-runtime/service.ts` 已不再调用 `sendLegacyAdvisorMessage`。当前过渡依赖是 `conversation-engine.ts` 调用 Advisor 暂存的 intent/tool capability provider。

结果是：

- 新产品身份已经是 Kern；
- 但大量 intent、tool dispatch、产品提议、状态查询仍集中在旧 Advisor service；
- 后续每加一种 Kern 能力，都容易继续把 `advisor/service.ts` 做大。

**目标：** 逐步把它拆成 `router → capability executor → response composer`，Advisor 变成一类 capability，而不是 Kern 的底座。

### P1 · UI 内部仍残留 goal / mission 语义

Kern 已经是聊天客户端，但 ViewModel 与局部变量仍大量使用 `Mission / goalId / goal`。

这不会立刻造成 bug，但会让未来开发者再次把 Conversation 当项目任务看板。

**目标：** UI 层改成 `ConversationSummary / conversationId / conversation`；Mission 只保留在真正的任务/项目域。

### P1 · Autonomy 还是动作白名单，不是风险策略

当前自动执行覆盖：

- `UPDATE_FIELD`
- `CREATE_WORK_ITEM`
- `CREATE_PRODUCT`

这已经比“每次审批”正确，但长期应该变成：

```text
capability
× reversibility
× external side effect
× financial impact
× permission sensitivity
× ambiguity
→ AUTO / ASK / DENY
```

这样新工具加入时不需要继续手工写“这个动作要不要再问一次”。

### P1 · Visual Intelligence 还没有真正的 Project Map Builder

现在有 Typed Graph IR 和 Council Graph，但还没有：

```text
repository
→ source evidence
→ module / dependency extraction
→ KernGraph / Archify artifact
→ architecture audit
```

本次地图仍是人工 source-backed mapping。下一阶段应让 Kern 能真正对任意 repo 运行同一流程。

## 推荐继续顺序

1. **保持 Muse 原始视觉系统不再重做 CSS。**
2. **把 Conversation 语义从 goal / mission 中清出来。**
3. **从 advisor/service.ts 抽出 Capability Executor。**
4. **把 Autonomy 升级为 risk-based capability policy。**
5. **做 Project Map Builder，让 Archify / KernGraph 都吃同一份 source-backed IR。**

## 产品边界

最终产品应始终维持：

```text
Kern = 对话 + 理解 + 调度 + 执行 + 汇报
Work = Kern 在后台持续完成复杂工作的运行形态
Workbench = 项目/产品/任务/审计的管理视图
Council = Kern 内部调用的智力资源
Visual Intelligence = 需要解释复杂结构时调用的工具
Governance = 只在真正高影响动作上要求人介入
```

只要后续改动违反这条边界，就应在架构审查里视为产品回退。
