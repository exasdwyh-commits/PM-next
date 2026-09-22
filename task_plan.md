# HERMES PM-next 当前执行计划

更新时间：2026-09-23  
状态：Code Freeze / Local Final Acceptance

## 1. 当前结论

运行时代码基线 `f0507464` 已完成本轮线上开发，并在 main 上通过全部 8 条核心 CI。

线上不再增加大功能。后续顺序固定为：

1. 本地同步 main；
2. 真实 PostgreSQL 迁移；
3. 静态门禁；
4. 核心回归；
5. 真实 provider smoke test；
6. 浏览器人工验收；
7. 只修 P0 / P1；
8. 无阻断后进入 release candidate。

## 2. 已完成并冻结

### M1 · Model Control Center V1
- ModelProfile / ModelPolicy 持久化
- Agent × TaskClass policy binding
- 官方模板与自定义配置
- API Key 不入数据库
- 设置页配置
- Model Control CI

### M2 · Model Gateway Runtime V2
- Provider Runtime
- Advisor task routing
- policy 内显式 fallback
- fail closed
- ModelRun provenance
- AgentRun 实际 provider/modelId
- 禁止 Model Control 绑定后偷跑旧 Advisor 路径

### M3 · Product Route Persistence V1
- 多 ChannelSpecRoute
- route revision / supersedes
- 渠道经济性与 Hard Gate
- Evidence scoped validation
- confirmed rule lifecycle
- PotentialAssessment append-only
- active-rule concurrency guard
- DB Golden persistence regression

### Release Closeout · Formal G2
- PRODUCTION_GATE 正式实现
- SUPPLIER_QUOTE / SAMPLE_ROUND / PROFESSIONAL_CONFIRMATION / PACKAGING_BRIEF / PRODUCTION_PLAN
- 当前版本 + ACCEPTED + REAL + missingInputs=[] 约束
- G2 冻结 product version / artifact refs / budget / project revision / fingerprint
- Owner 不可自批
- G2 APPROVED != 已开工
- 独立 production start
- PRODUCTION_RECORD 驱动交付
- G3 强制校验 production basis
- `test:g2` / structured / gate-boundaries / G3 全绿

### 组织级基础设施
- Product Potential V2
- Evaluation Harness / Experience Loop
- Autonomous Workforce Kernel
- Workforce Review / Parent Return
- Decision Intelligence
- DecisionRun provenance
- System Principal
- Autopilot
- Business Event Outbox
- Automation Causality
- Golden Organization V2

## 3. CI 基线

`f0507464`：

- Quality CI：PASS
- Governance CI：PASS
- Workforce CI：PASS
- Decision CI：PASS
- Autopilot CI：PASS
- Experience CI：PASS
- Business Event CI：PASS
- Golden Organization CI：PASS

Governance CI 额外覆盖：
- Prisma migrate deploy
- Formal G2
- Formal G3
- structured artifacts
- gate boundaries

## 4. 本地阶段允许修改

只处理：

### P0
- 安装/启动失败
- migrate deploy 失败
- 数据破坏 / 越权 / 跨组织泄漏
- Governance 可绕过
- 核心 CI 同基线失败

### P1
- 核心业务链无法完成
- 页面/API 500
- Provider routing 与配置不一致
- G1/G2/G3 核心交互错误
- Channel Route / Workforce / Autopilot 关键交互错误
- 用户无法理解 Gate 原因

禁止在本轮加入：
- 新 Agent
- 新业务域
- 大 UI 重构
- 新外部数据源
- MoA
- Jev Judgment Engine
- 手机端全量适配

## 5. 下一版本 backlog

### M4 · Cost & Intelligence Tiers
Routine / Balanced / Frontier / Red Team / Private Local，以及预算和 premium 授权。

### M5 · Controlled Mixture of Agents
Primary → Independent Challenger → Synthesis → Governance/Human。

相关长期任务统一保留在 Issue #11，不再拆出与当前 Control Plane 重叠的 Phase 1。

## 6. 完成定义

当前版本最终完成需要：

- GitHub 8 条核心 CI 绿色；
- 本地 npm ci / Prisma / typecheck / lint / build 全绿；
- 本地真实数据库迁移通过；
- G1 → G2 → G3 关键 Gate 语义人工验证；
- 至少一个真实 provider 受控调用成功，或明确保持未配置；
- 无 P0；
- P1 已修复或显式接受。

详细步骤见 `docs/LOCAL_HANDOFF_2026-09-22.md`。