# PM-next 项目收尾说明

日期：2026-09-23  
阶段：Online Implementation Complete / Local Finalization  
- 当前 RC 分支提交：`1bea212b2305209be64772c0215c2f68f75aa1b7`
- 最近有完整核心 CI 通过证据的基线：`f05074648d79861f1d57f4218a675ce8bd8b4cae`

## 一、收尾结论

PM-next 本轮线上实现已经收口。

当前主干不再只是“产品中心 + Agent 骨架”，而是形成了可审计、可治理、可替换模型、可自动委派，并覆盖研发打样、生产投入与上市授权的完整产品研发决策骨架。

`f0507464` 已在 main 上通过 8 条核心 CI；这不是当前 RC 分支 HEAD 的完整 CI 结果。RC1 分支后续补入了修复与权限矩阵变更，完整矩阵曾受 GitHub Actions runner 启动故障影响，精确提交的 CI 证据仍待补齐。后续只做本地真实环境验收和 P0/P1 修复。

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

2026-09-23 本机自动化矩阵与 Provider 最小 smoke 已通过。剩余收尾工作：

1. 只修 P0/P1，并提交当前工作区修复；
2. GitHub Actions runner 恢复后，对最终候选提交重跑 8 条 CI；
3. 完成 Model Gateway 持久化 provenance、真实 G1→G2→生产→交付→G3 业务链和桌面/平板人工检查；
4. 剩余 P2 记为 accepted debt / next-version backlog；
5. 当前已有 `v0.1.0-rc1` 候选标签；验收完成且无阻断后，再冻结并发布正式 `v0.1.0`；
6. 然后开启 M4/M5/Jev/P3 等下一版本工作。

当前版本不再需要线上继续堆功能。
