# HERMES PM-next 当前执行计划

更新时间：2026-09-22
状态：收尾冻结 / Local Acceptance

## 1. 当前结论

PM-next 当前不再处于功能高速扩展阶段。

运行时代码基线 f5e5b780 已完成 M1-M3，并在 main 上通过 8 条核心 CI。接下来停止在线追加大功能，转为：
1. 文档收口；
2. 本地同步；
3. 真实环境验收；
4. 只修 P0 / P1 缺陷；
5. 验收完成后再建立下一版本 backlog。

## 2. 已完成并进入冻结的能力

### M1 · Model Control Center V1
已完成：
- ModelProfile / ModelPolicy 持久化；
- Agent × TaskClass → Policy；
- 官方模板和自定义 Profile / Policy；
- API Key 不入数据库；
- 设置页配置；
- Model Control tests 纳入 Quality CI。

### M2 · Model Gateway Runtime V2
已完成：
- Provider Runtime；
- Advisor 意图映射；
- ModelGateway 真实策略路由；
- 显式 fallback / fail closed；
- ModelRun provenance；
- AgentRun 记录实际 provider/modelId；
- Model Control 绑定存在时禁止旧 Advisor 模型旁路。

### M3 · Product Route Persistence V1
已完成并加固：
- ChannelRuleProfileRecord 生命周期；
- ProductVersion 下多 ChannelSpecRoute；
- revision + supersedes，不覆盖历史；
- 渠道费用、履约成本、贡献毛利、最高可承受单元成本；
- 经济性 Hard Gate；
- 规则变更后重新进入 NEEDS_EVIDENCE；
- PotentialAssessmentRecord append-only；
- VERIFIED + REAL + VERIFIED_BY_LEAD 的真实验证约束；
- 渠道路线工作台；
- channel-scoped evidence；
- confirmed product version 前置条件；
- active rule concurrency guard；
- 数据库级 Golden persistence regression。

### 组织级基础设施
已经稳定进入 main：
- Product Potential V2；
- Evaluation Harness / Experience Loop；
- Autonomous Workforce Kernel；
- Workforce Review / Parent Return；
- Decision Intelligence；
- DecisionRun provenance；
- System Principal；
- Autopilot；
- Business Event Outbox；
- Automation Causality；
- Golden Organization V2。

## 3. 当前 CI 基线

运行时代码基线 f5e5b780：
- Quality CI：PASS
- Governance CI：PASS
- Workforce CI：PASS
- Decision CI：PASS
- Autopilot CI：PASS
- Experience CI：PASS
- Business Event CI：PASS
- Golden Organization CI：PASS

Quality CI 已覆盖 typecheck、lint、build、Golden、Product Potential、Channel Route、Model Gateway、Model Control、Model Runtime、Harness、Validation Decision、Decision Intelligence、Launch Authorization。

## 4. 当前阶段只允许的修改

本地最终修复阶段只处理：
- P0：无法安装、无法启动、迁移失败、数据破坏、鉴权/越权、Governance 绕过、核心测试失败；
- P1：核心业务路径不可完成、页面/API 500、真实 provider 路由错误、Channel Route / Workforce / Autopilot 关键交互错误；
- 少量明显 UI 阻断问题。

不要在最终修复阶段加入：
- 新 Agent；
- 新业务域；
- 新的大型 UI 重构；
- 新的外部数据源；
- 新 MoA；
- Jev Judgment Engine；
- 手机端全量适配。

## 5. 延后到下一版本

### M4 · Cost & Intelligence Tiers
继续保留为下一版本增强：
- Routine / Balanced / Frontier / Red Team / Private Local；
- 组织级预算；
- 调用成本上限；
- 新模型 Profile 评测；
- 不把 MiMo、Jev 或任何具体模型写死为系统依赖。

### M5 · Controlled Mixture of Agents
继续保留为下一版本增强：
Primary analysis → Independent challenger → Synthesis → Governance/Human

要求：
- 白名单；
- 最大调用次数；
- 成本预算；
- 防锚定；
- Harness 对照收益。

## 6. 历史 PR 收口

仍开放：
- PR #21 Autopilot V1
- PR #8 Formal G2

两者均已与 main 分叉。禁止直接合并。
本地验收结束后：
1. diff 对照 current main；
2. 已被 main 新实现覆盖的部分直接关闭；
3. 只有仍存在且有测试价值的最小改动才重新开新 PR。

## 7. 完成定义

当前版本最终完成需要同时满足：
- GitHub 8 条核心 CI 持续绿色；
- 本地 npm ci / Prisma / typecheck / lint / build 全绿；
- 本地真实 PostgreSQL 迁移通过；
- 登录、产品、证据、渠道路线、模型控制、Workforce、Autopilot、Governance 核心路径可人工走通；
- 至少一个真实 provider 在本地完成受控调用，或明确记录为未配置；
- 不存在 P0；
- P1 有明确关闭或接受记录。

详细验收见 docs/FINAL_ACCEPTANCE_2026-09-22.md。
本地执行见 docs/LOCAL_HANDOFF_2026-09-22.md。