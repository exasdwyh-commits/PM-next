# PM-next 项目收尾说明

日期：2026-09-23  
阶段：Online Implementation Complete / Local Finalization  
运行时代码基线：`f0507464`

## 一、收尾结论

PM-next 本轮线上实现已经收口。

当前主干不再只是“产品中心 + Agent 骨架”，而是形成了可审计、可治理、可替换模型、可自动委派，并覆盖研发打样、生产投入与上市授权的完整产品研发决策骨架。

`f0507464` 已在 main 上通过 8 条核心 CI。后续应转入本地真实环境验收，只修 P0/P1。

## 二、本轮完成的闭环

### 产品判断
Evidence → Product Potential → Hard Gate → Validation → Channel Route → Outcome / Experience。

### 模型执行
Agent × TaskClass → ModelPolicy → Provider Runtime → ModelRun → fallback / fail closed。

### Agent 协作
Agent / Skill / Squad / Delegation → Result → Review Return → Parent Action。

### 自治
Business Event → Outbox → Autopilot → DecisionRun → AgentTask → Causality / Receipt。

### 三门治理
- G1：研发 / 打样授权
- G2：生产投入授权
- G3：上市授权

G2 当前已经正式进入 main，并确保：
- 当前确认 ProductVersion；
- 真实且已验收的结构化生产成果；
- 样品 / 报价 / 包装 / 专业确认 / 生产计划冻结；
- 独立决策人；
- scopeHash / productionFingerprint 漂移失效；
- G2 批准与真实开工分离；
- Production Record 与交付分离；
- G3 不能绕过生产依据。

## 三、冻结范围

除 P0/P1 修复外，不再修改这些核心契约：

- identity / auth / tenancy
- products / product versions
- evidence / validation
- product potential
- channel routes
- decisions / G1 / G2 / G3
- production lifecycle
- model control / model gateway runtime
- workforce
- decision intelligence
- evaluation harness
- governance
- autopilot / business event outbox
- automation trace

## 四、不属于当前收尾 blocker

- M4 intelligence / cost tier 自动化
- M5 Controlled MoA
- Jev / Judgment Engine
- P3 大规模外部趋势与第三方数据采集
- 手机端专项适配
- 视觉大改版

这些属于下一版本，不允许在本地修复阶段扩大 scope。

## 五、仓库清理

已完成：
- PR #33 合并：Formal G2 on current main
- PR #8 关闭：旧 G2 分支被 #33 替代
- PR #21 关闭：旧 Autopilot 分支被 current main 替代
- Issue #13 关闭：旧 Phase 1 Intelligence 设计被 Model Control / Runtime 架构替代
- Issue #11 保留：下一版本 Adaptive Intelligence / MoA backlog

## 六、正式交付入口

- `README.md`
- `task_plan.md`
- `docs/PROJECT_CLOSEOUT_2026-09-22.md`
- `docs/FINAL_ACCEPTANCE_2026-09-22.md`
- `docs/LOCAL_HANDOFF_2026-09-22.md`
- `docs/FORMAL_G2_PRODUCTION_GATE.md`
- `docs/FORMAL_G3_LAUNCH_GATE.md`

旧 B01/P1 验收文档继续保留作为历史证据，不再代表当前最终状态。

## 七、下一步

本地完成最终验收后：

1. 只修 P0/P1；
2. 重跑最终门禁；
3. 剩余 P2 记为 accepted debt / next-version backlog；
4. 无阻断后再打 `v0.1.0-rc1`；
5. 然后开启 M4/M5/Jev/P3 等下一版本工作。

当前版本不再需要线上继续堆功能。