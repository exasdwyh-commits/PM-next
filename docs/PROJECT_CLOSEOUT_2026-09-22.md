# PM-next 项目收尾说明

日期：2026-09-22
阶段：Online Closeout / Local Finalization

## 一、收尾结论

PM-next 已经达到适合停止线上功能扩张、转入本地最终修复的阶段。

最后一个运行时代码提交：
f5e5b780 — Channel Route V1 hardening: evidence-scoped validation and governed lifecycle

该提交之后不建议继续在线新增大的业务能力。当前最重要的工作是把真实环境、真实数据库、真实 provider 和关键浏览器路径在本地跑一遍，修掉最后的 P0/P1。

## 二、为什么现在应该收尾

过去一轮已经把系统从“产品中心 + 基础 Agent”推进为完整的受治理 AI 产品负责人骨架：
- 产品潜力判断不再是单一总分，已经有 Hard Gate、Evidence State 和 Validation；
- 同产品多渠道规格已成为持久化业务对象；
- Model Control 与 Runtime 已接通；
- Agent / Skill / Squad / Delegation 已形成 Workforce；
- Decision Intelligence、Governance、Launch Authorization 已有独立回归；
- Autopilot 已由业务事件驱动，并记录 durable receipt、lease、cooldown 与 causality；
- Experience Loop 能把冻结预测和真实结果关联；
- AKG、骆驼奶+AOS、AKK 已进入 Golden Organization 多案例回归。

继续在线堆功能的边际价值已经低于本地真实验收。

## 三、冻结范围

冻结以下核心域：
- identity / auth / tenancy
- products / product versions
- evidence
- product potential
- channel routes
- model control
- model gateway runtime
- workforce
- decision intelligence
- evaluation harness
- governance
- autopilot
- business event outbox
- automation trace

除修复缺陷外，不再改变核心数据契约。

## 四、当前非阻断项

以下不是本次收尾 blocker：
- M4 智力/成本分层的进一步自动化；
- M5 Controlled MoA；
- Jev Judgment Engine；
- P3 外部趋势采集；
- 第三方数据源深度接入；
- 手机端专项适配；
- 大规模视觉升级。

这些全部进入下一版本，不允许在本地收尾阶段顺手扩 scope。

## 五、历史 PR

PR #21 与 PR #8 都是旧设计时期分支，并已与当前 main 分叉。

处理原则：
- 不直接 merge；
- 不以“PR 还开着”判断系统尚未完成；
- 本地验收结束后再进行差异审查；
- 如果 main 已覆盖其意图，关闭；
- 如果仍有独立价值，只抽取最小变更并重新测试。

## 六、最终交付物

收尾后的正式入口：
- README.md：当前状态和入口；
- task_plan.md：冻结后的执行计划；
- docs/PROJECT_CLOSEOUT_2026-09-22.md：本文件；
- docs/FINAL_ACCEPTANCE_2026-09-22.md：最终验收基线；
- docs/LOCAL_HANDOFF_2026-09-22.md：本地同步和修复手册。

旧阶段验收文档继续保留，仅作为历史证据。

## 七、下一步

本地完成最终验收后：
1. 只修 P0/P1；
2. 重新跑最终门禁；
3. 将剩余问题记录为 accepted debt 或 next-version backlog；
4. 再考虑打 v0.1.0-rc1 / v0.1.0 标签；
5. 然后再开启 M4/M5/Jev 等下一阶段。

当前阶段的关键词是：稳定、复验、修复、冻结，而不是继续扩功能。