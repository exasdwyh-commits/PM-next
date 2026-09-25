# Kern 术语冲突表

基线：`main@0fb583b8`。本表只约束**用户可见名称**；路由、CSS 类、数据库 code、兼容字段等内部标识不因改名而重写。

| 概念 | 当前冲突 | 统一口径 | 说明 |
|---|---|---|---|
| 主助理 / 产品品牌 | Kern / Hermes / HERMES / Muse | **Kern** | 所有用户可见助理与品牌文案统一为 Kern；`/muse` 仅保留为兼容路由 |
| Product | 产品 / Product | **产品** | 管理后台业务实体统一中文；代码类型名不改 |
| Project | 项目 / 执行工作区 / 项目作战室 | **项目** | “项目工作区”可描述一个视图，但实体本身统一叫“项目” |
| WorkItem | 任务 / 工作项 | **工作项** | Prisma WorkItem 在产品/项目后台统一显示“工作项”；“任务”留给泛化任务或 AgentTask |
| AgentTask | 任务 / Agent 任务 / 自动化工作 | **自动化任务 / Agent 任务** | 与 WorkItem 区分，避免项目进度和运行时任务混淆 |
| Gate | 门禁 / 门槛 / 放行门 | **门禁** | 泛称统一“门禁”；具体可写 G1 研发打样门禁、G2 生产投入门禁、G3 上市门禁 |
| DecisionPacket | 决策包 / 放行包 | **决策包** | 审批对象统一叫决策包 |
| Desktop Runtime | Hermes Desktop / Desktop Runtime / 本机执行 | **Kern 本机执行 / 本机执行** | 面向用户隐藏 runtime 实现名，强调真实本机动作与回执 |

## 保留的内部兼容标识

以下不属于用户可见品牌，不做破坏性重命名：

- 路由：`/muse`
- CSS：`.hermes-*`
- npm package / repo 内部名：`hermes-next`
- 数据库与代码稳定 key：如 `hermes_pm`
- 已有 API 路径与审计 objectType

目标是消除用户认知冲突，不以“改名”为理由扩大底层迁移范围。
