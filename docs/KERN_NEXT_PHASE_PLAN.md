# Kern 下一阶段计划（收敛版）

日期：2026-09-26　基线：`main@193ae32c`（tag `v0.1.0-rc1-kern-v2`）

> 继续工作前先读本文件和 `docs/KERN_DELIVERY_LEDGER.md`，再核对 main / 开放 PR / CI。
> **不要**基于其它分支或旧文档重新实现已在 main 的能力（Supervisor、Mission DAG、Generic Executor、Attention、Memory、Billing 均已在 main）。

## 0. 基线状态（已完成）

- 2026-09-26 分支收敛：#33 Supervisor → #34 Attention/UI → #35 Personal Agent 经 #37 集成；`release/v0.1.0-rc1` 与 `main` 快进到同一提交；默认分支改回 `main`。
- 关闭：#24（superseded）、#33/#34/#35（已吸收）、#36（与 #33/#34 重复实现，关闭不合并）。
- `release/v0.1.0-rc1` 冻结，只作为历史指针；**`main` 是唯一开发 / 交付事实源。**

## 1. 本阶段只做四件事（按顺序）

### P0-1 研究能力接入 Supervisor（“研究员不再是假的”）
现状：`supervisor/generic-executor.ts` 给节点的输入是 Persona + Skill + CompanyFact + Memory + 上游结果 + LLM，没有外部来源；只能靠提示词要求“无来源写 UNKNOWN”。
目标：
- Mission 中 research / market / competitor / regulatory 类节点改为先创建或复用 **ResearchRun**，经 SourceCapture / Evidence Verification 得到带来源的证据，再交给 LLM 汇总；
- 节点产出附引用（SourceCapture id / URL / 抓取时间 / trust 分级），外部内容默认 untrusted；
- 无可用研究源时节点诚实 BLOCKED（缺什么源），不得退化为“模型常识”并标成功；
- 验收：DB 回归覆盖“有源 → 引用可追溯”“无源 → BLOCKED + missingInputs”“注入内容被隔离”。

### P0-2 Product R&D 合流为 NEW_PRODUCT Mission Playbook
现状：Supervisor Mission 编排器与 `product-rnd/orchestrator` 两套并行。
目标：
- Product R&D 的 ResearchRun、QA slot、Evidence/UNKNOWN、渠道适配、Potential 评估变成 Mission 的 Playbook 节点与 Skills；
- 一个编排器：`Kern → NEW_PRODUCT Playbook → (Research/Market/Consumer/Formula/Regulatory/Cost/Channel/Competitor/GTM/Red Team) → QA → Product Blueprint →（人确认后）创建 Product`；
- 旧入口保留兼容路由，内部转发到 Playbook；G1/G2/G3 门禁语义不变；
- 验收：现有 product-rnd-fusion / worker / golden-org 回归在新编排下全部保持绿色。

### P0-3 Feedback → Memory → Harness Promotion 闭环（“越用越懂你”）
现状：KernMemory（偏好/结论/置顶/忘记/注入）已实现；Evaluation Harness 有 Prediction → Outcome → Lesson；两者未接通。
目标：
- 用户对 Kern 结论的 👍 / 纠正（含原因）写入 Feedback；
- 纠正 → 生成 PREFERENCE / LESSON 候选 + Harness 评估样本；
- 同类场景再次出现时优先新策略，并记录 A/B 结果；只有 Outcome / Eval 证明变好才 Promotion，可回滚；禁止模型自评代替 Outcome。

### P0-4 IA 收敛
最终导航只保留：**Kern / 产品 / 项目 / 设置**。`/advisor`、`/consultation`、`/war-room`、`/dashboard` 等改为重定向或并入；Workbench 作为 Kern 背后的工作空间，不再制造 AI 功能入口。

## 2. 之后：停止大架构调整
真实模型 E2E + 真实产品任务 dogfooding + P0/P1 bug 修复。

## 3. 已知但不阻塞内部 Beta 的差距（诚实记录）
| 项 | 现状 | 何时做 |
|---|---|---|
| 模型调用计量 | 只在 Mission 启动时检查一次月度上限 | 商业化前：统一 UsageLedger + 原子扣减 |
| 记忆条数额度 | **2026-09-26 已补 enforcement**（事务 + 组织级 advisory lock，已有 source 更新不占额度） | ✅ |
| 今天简报 | 打开 Kern 时动态生成；无定时任务 / 持久化 / 推送 | P2 多渠道触达时一起做 |
| Memory 相关性 | 中文 bigram + 英文词重叠 | 几百条内够用；规模上来再评估向量检索 |
| 支付 / 运营看板 | 未做 | P2 |
