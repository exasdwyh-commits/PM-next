# HERMES-Next

企业新品研发、决策治理与 Agent 协作系统。

## 当前状态：进入收尾冻结（2026-09-22）

当前 main 已达到“线上代码收口、本地最终验收与修复”的阶段，不再建议继续在线追加大功能。

最后一个运行时代码基线：f5e5b780
该基线已通过以下 GitHub Actions：
- Quality CI
- Governance CI
- Workforce CI
- Decision CI
- Autopilot CI
- Experience CI
- Business Event CI
- Golden Organization CI

Quality CI 同时通过：
- Golden / Product Potential / Channel Route
- Model Gateway / Model Control / Model Runtime
- Evaluation Harness / Validation Decision / Decision Intelligence / Launch Authorization
- TypeScript typecheck
- ESLint
- Next.js production build

最终状态、验收边界和本地接手方式见：
- docs/PROJECT_CLOSEOUT_2026-09-22.md
- docs/FINAL_ACCEPTANCE_2026-09-22.md
- docs/LOCAL_HANDOFF_2026-09-22.md

历史的 docs/PROJECT_COMPLETION_2026-09-20.md、B01_ACCEPTANCE_REPORT.md、P1_ACCEPTANCE_REPORT.md 继续保留作为阶段证据，不再代表 2026-09-22 的最终状态。

## 当前已经形成的核心能力

1. 产品决策与产品潜力
   - Hard Gates
   - Evidence State / Validation
   - Channel Spec Fit
   - 渠道经济性与贡献毛利
   - Product Potential / PotentialAssessment 快照

2. 渠道规格路线
   - 同一 ProductVersion 可维护多个 ChannelSpecRoute
   - 路线 revision / supersedes
   - ASSUMED / CONFIRMED / SUPERSEDED 渠道规则生命周期
   - VERIFIED + REAL + VERIFIED_BY_LEAD 证据约束
   - 渠道规则变化后的重新验证

3. Model Control / Model Gateway
   - Agent × TaskClass → ModelPolicy
   - 可插拔 ModelProfile
   - Provider Runtime
   - 显式 fallback
   - fail closed
   - ModelRun provenance
   - API Key 不入数据库

4. Autonomous Workforce
   - Agent / Skill / Squad / Delegation
   - 任务开始、完成、回传、复核
   - Result Summary
   - Parent Action
   - Home activity brief

5. Decision Intelligence / Governance
   - 版本化决策规范
   - Rule Engine
   - Policy Gate
   - DecisionRun provenance
   - System Principal
   - Launch Authorization

6. Autopilot / Business Events
   - durable wakeup
   - leases / cooldown
   - Business Event Outbox
   - 自动化因果链
   - Agent child result return

7. Evaluation Harness / Experience Loop
   - 冻结预测
   - 真实 outcome 回写
   - calibration / experience persistence
   - Golden Organization 多案例回归

## 当前不再作为收尾阻塞项的内容

以下内容属于后续增强，不应在本地最终修复阶段扩 scope：
- M4 Cost & Intelligence Tiers 的进一步自动预算策略
- M5 Controlled Mixture of Agents
- Jev / Judgment Engine 等高速判断层
- P3 外部趋势采集与第三方数据源
- 手机端专门适配
- 更大规模 UI 美化和视觉重构

先完成本地真实环境验收，再决定后续版本。

## 历史开放 PR

仓库仍有两个历史 PR：
- #21 Autopilot V1
- #8 Formal G2 production gate

两者都已与当前 main 分叉，main 已包含后续 Autopilot、Decision、Governance、Model Gateway、Channel Route 等新实现。不要直接合并。应在本地验收完成后做差异审查，再关闭或抽取仍有价值的最小改动。

## 本地同步

建议严格从 main 开始：

    git fetch --all --prune
    git switch main
    git pull --ff-only origin main
    npm ci
    npx prisma generate

数据库、环境变量和最终验收步骤见 docs/LOCAL_HANDOFF_2026-09-22.md。

## 常用命令

    npm run dev
    npm run typecheck
    npm run lint
    npm run build
    npm run test:golden-org
    npm run test:channel-routes
    npm run test:model-control
    npm run test:model-runtime
    npm run test:governance
    npm run test:workforce
    npm run test:autopilot
    npm run test:business-events

应用默认端口：3100。

本项目现阶段的目标不是继续扩大功能面，而是保持主干稳定、完成本地真实环境验收、只修复阻断交付的问题。