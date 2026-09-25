# Kern Visual Intelligence

状态：**V1 foundation / typed graph + council visualization**

## 1. 定位

Kern Visual Intelligence 不是“画架构图插件”，而是 Kern 的结构化思考与解释层。

它把可拆解的问题统一表示为：

```text
对象 → 关系 → 约束 → 证据 → 决策 / 执行
```

同一套协议后续可以覆盖：

- 软件架构与依赖；
- 配方与原料机制；
- 产品研发与商业模型；
- 顾问团的分工、冲突与综合；
- Kern / Agent / Tool 的执行链；
- Before / Delta / After 变更证明。

## 2. V1 已落地能力

### KernGraphV1

统一 Typed IR：

- `SYSTEM`
- `DEPENDENCY`
- `CAUSAL`
- `DECISION`
- `EXECUTION`

每个 node / edge 都必须声明 truth state：

- `VERIFIED`：有真实记录或证据支持；
- `INFERRED`：模型/规则推断、规划或建议；
- `UNKNOWN`：明确未知。

UI 不允许把 INFERRED 渲染成 VERIFIED。

### Deterministic validation

任何图进入 UI 前都经过确定性校验：

- schema/version；
- 唯一 node / edge id；
- layer 边界；
- edge endpoint 完整性；
- truth state；
- V1 节点规模限制。

这层是未来接模型生成 Graph IR 的安全边界：模型负责提出结构，validator 决定它能否被展示为合法 artifact。

### Council Graph

当前 Shadow Collaboration Planner 已经能输出：

- SOLO
- SPECIALIST
- PAIR
- COUNCIL
- RED_TEAM
- FULL_RND

Visual Intelligence 将复杂协作建议映射为 `DECISION` graph，并持久化到本轮 assistant message citations。

因此：

- 当次响应可直接显示；
- 页面刷新后仍然存在；
- 图与产生它的会话消息绑定；
- Shadow 图明确标记“建议，不代表已执行”。

## 3. Semantic Passport

Muse 中点击任一节点会打开该节点的 Semantic Passport，第一阶段展示：

- 节点类型；
- truth state；
- detail；
- metadata；
- 与其它节点的关系。

后续统一扩展：

- evidence refs；
- source file / line；
- owner / agent；
- run / receipt；
- before / after；
- related artifacts。

原则：优先扩展 Passport，不为每类对象继续增加独立侧栏。

## 4. 下一阶段

### P1 · Domain Graph Builders

在 KernGraphV1 上增加确定性/半结构化 builder：

1. Formula Graph
   - 功效目标
   - 原料
   - 剂量
   - 机制
   - 证据
   - 法规
   - 成本
   - 冲突 / UNKNOWN

2. Project Architecture Graph
   - module
   - API
   - database
   - agent
   - tool
   - dependency
   - source evidence

3. Business / Product Graph
   - 用户问题
   - 产品价值
   - 渠道
   - 成本
   - 供应链
   - 风险
   - 假设

### P2 · Change Proof

统一：

```text
BEFORE
→ PROPOSED
→ APPLIED
→ VERIFIED
→ UNVERIFIED
```

不把“依赖范围”自动命名为“风险”或“实际影响”。

### P3 · Execution Graph

把真实 AgentRun / AgentTask / ToolCall / Receipt 投影为 `EXECUTION` graph。

只有已经发生的节点才能是 VERIFIED；Shadow / plan 节点保持 INFERRED。

### P4 · Renderer adapters

KernGraphV1 是 Kern 自己的协议，renderer 可替换：

- 内置轻量 renderer（当前）；
- Archify adapter；
- Mermaid / SVG；
- future canvas / 3D graph。

这样 Kern 不依赖任何一个外部可视化项目。

## 5. 顾问团约束

顾问图不是“多 Agent 很热闹”的装饰。

正确语义：

```text
same brief
→ independent first pass
→ conflict / evidence check
→ optional red team
→ QA
→ Kern synthesis
```

多模型一致不等于证据。共识只能作为协作结果，不能自动提升 truth state。

## 6. UX 入口

建议逐步形成三个入口：

- 自动：复杂 PAIR / COUNCIL / RED_TEAM / FULL_RND 回合附协作图；
- 显式：“把这件事画给我看 / 拆解一下 / 可视化”；
- 对象页：“Visualize / Ask Kern about this”。

目标不是让每个回答都有图，而是在复杂问题上让用户能够看懂 Kern 如何拆解、依据什么、哪些仍是未知。
