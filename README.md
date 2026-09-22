# HERMES-Next

企业新品研发、决策治理与 Agent 协作系统。

## 当前状态：线上实现收口 / 本地最终验收

日期：2026-09-23  
运行时代码基线：`f0507464`

当前版本已经停止线上功能扩张，进入本地真实环境验收与 P0/P1 修复阶段。

`f0507464` 在 main 上通过 8 条核心 CI：

- Quality CI
- Governance CI
- Workforce CI
- Decision CI
- Autopilot CI
- Experience CI
- Business Event CI
- Golden Organization CI

其中 Quality CI 已通过 typecheck、ESLint、Next.js production build；Governance CI 已通过 Formal G2、Formal G3、structured artifacts、gate boundaries、迁移和治理回归。

## 当前版本的核心闭环

### 1. 产品判断
- Evidence / Validation
- Product Potential V2
- Hard Gates
- Channel Spec Fit
- 渠道经济性
- PotentialAssessment 快照

### 2. 多渠道规格
- 一个 ProductVersion 多个 ChannelSpecRoute
- revision / supersedes
- ASSUMED / CONFIRMED / SUPERSEDED 渠道规则
- channel-scoped evidence
- VERIFIED + REAL + VERIFIED_BY_LEAD 约束

### 3. 三门决策闭环
- G1：研发 / 打样授权
- G2：正式生产投入授权
- G3：正式上市授权

G2 明确区分“批准生产投入”和“真实开工”：
- 报价、样品、专业确认、包装、生产计划必须是当前版本、已验收、REAL 的结构化成果；
- Owner 不可自批，必须由指定 Decision Maker 决策；
- G2 批准后仍处于 PRODUCTION_PREP；
- 真实开工是独立动作；
- PRODUCTION_RECORD 验收后才能确认交付；
- G3 会校验生产交付依据。

详见 `docs/FORMAL_G2_PRODUCTION_GATE.md` 与 `docs/FORMAL_G3_LAUNCH_GATE.md`。

### 4. 模型控制
- ModelProfile / ModelPolicy
- Agent × TaskClass → Policy
- Provider Runtime
- 显式 fallback / fail closed
- ModelRun provenance
- API Key 不入数据库

### 5. Autonomous Workforce
- Agent / Skill / Squad / Delegation
- task start / finish / review return
- result summary / parent action
- activity brief

### 6. Decision / Governance / Autopilot
- Decision Intelligence
- Policy Gate / DecisionRun
- System Principal
- Autopilot durable wakeup
- Business Event Outbox
- Automation Causality
- child result return

### 7. Harness / Experience
- 冻结预测
- 真实 outcome
- calibration / experience persistence
- AKG、骆驼奶+AOS、AKK 多案例 Golden Organization 回归

## 当前版本不再扩展

以下进入下一版本，不属于本地最终修复范围：

- M4 Cost & Intelligence Tiers
- M5 Controlled Mixture of Agents
- Jev / Judgment Engine
- 更完整的 P3 外部趋势采集与第三方数据源
- 手机端专项适配
- 大规模视觉重构

父 Issue #11 保留为下一版本 Intelligence / MoA backlog。

## 仓库收口状态

历史 PR #8（旧 G2）和 #21（旧 Autopilot）已经关闭。  
Formal G2 已通过 PR #33 按当前 main 架构重新移植并合入。  
旧 Phase 1 Intelligence Issue #13 已按新 Model Control 架构标记 superseded。

## 本地同步

```bash
git fetch --all --prune
git switch main
git pull --ff-only origin main
npm ci
npx prisma generate
```

完整本地验收见：

- `docs/PROJECT_CLOSEOUT_2026-09-22.md`
- `docs/FINAL_ACCEPTANCE_2026-09-22.md`
- `docs/LOCAL_HANDOFF_2026-09-22.md`

应用默认端口：`3100`。

当前阶段目标只有一个：保持基线稳定，在本地完成真实数据库、真实 provider 和真实业务链验收，只修 P0/P1。