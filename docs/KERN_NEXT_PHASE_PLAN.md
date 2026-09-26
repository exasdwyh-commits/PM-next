# Kern 下一阶段计划（收敛版 v2）

更新：2026-09-26

> 继续工作前：先读本文件与 `docs/KERN_DELIVERY_LEDGER.md`，再核对 **`main` 最新提交 / 开放 PR / CI**。
> 本文不写“当前 HEAD 是某 SHA”——以 `git log origin/main -1` 为准，避免文档过时。
> **不要**基于其它分支或旧文档重新实现已在 main 的能力：Supervisor / Mission DAG / Generic Executor / Attention / KernMemory / Billing 均已在 main。

## 0. 基线治理（事实记录）

- `main` 是唯一开发 / 交付事实源；默认分支 = `main`；仓库已开启“合并后自动删除分支”。
- `release/v0.1.0-rc1` 冻结在 `193ae32c`（= #33/#34/#35 经 #37 集成的结果），tag `v0.1.0-rc1-kern-v2` 指向同一提交。main 此后继续前进是预期行为。
- **该 tag 不包含 #38（memory quota 修复）。不移动已有 tag**；下一次真正 Beta freeze 新打 `v0.1.0-rc2`。
- 2026-09-26 删除 37 个已吸收远程分支（清单见文末附录）。仅剩 `main`、`release/v0.1.0-rc1`。
  - 已合并 PR 的分支：内容已在 main；已关闭未合并的 #24/#36：GitHub 永久保留 `refs/pull/<N>/head` 可找回；
  - 无 PR 或合并后仍有新提交的分支先打 `archive/*` tag：`archive/feature/muse-live-operating-shell`、`archive/wip/local-kernel-backup`。
- #37 “本地全新数据库复核”是 PR 记录中的验收记录；GitHub CI 结果为独立证据。
- Memory quota 精确语义：**同一 `source` 的 source-keyed memory 更新不占新额度**；用户两次说“记住…”（`source=null`）仍会产生两条，后续可做语义去重（非 bug）。

## 1. 执行顺序

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0-A | 基线清理：文档 SHA 表述、删除已吸收远程分支、自动删分支 | ✅ 2026-09-26 |
| P0-B | Research Foundation | ⏳ 下一步 |
| P0-C | NEW_PRODUCT Playbook 合流 | ⏳ |
| P0-D | ModelRun 原子 cost guard + 最小 tracing（**真实模型 dogfooding 之前**） | ⏳ |
| P0-E | Feedback → Memory → Harness Promotion | ⏳ |
| P0-F | IA 收敛：Kern / 产品 / 项目 / 设置 | ⏳ |
| Beta | Worker 常驻验收 + 打 `v0.1.0-rc2` | ⏳ |
| 之后 | 停止大架构重构 → 真实模型 + 真实网页 + 真实产品任务 + 真实 Mac 连续跑 20～50 个任务，修 harness / playbook / bug | — |
| P1 | Desktop Intelligence（Computer Use） | 路线图保留 |

## 2. P0-B · Research Foundation

现状：`supervisor/generic-executor.ts` 节点输入 = Persona + Skill + CompanyFact + Memory + 上游结果 + LLM，无外部来源。

**B1 研究节点接 ResearchRun**：research / market / competitor / regulatory 类节点先创建或复用 ResearchRun，经 SourceCapture / Evidence Verification 取证，再交给 LLM 汇总。无可用源 → 节点 BLOCKED（写明缺什么源），不得退化为模型常识并标成功。

**B2 引用全链传递（citation lineage）**：引用必须从 research 节点一直传到下游节点、Synthesizer、Executive Report 与 Kern 对话回执；下游只能引用上游已给出的 source id，不得凭空新增。
- 硬测试：`SourceCapture → research node → downstream node → final answer` 全链 provenance 可回溯；最终答案中每个 citation 都能解析到真实 SourceCapture。

**B3 幂等绑定**：`researchRun idempotencyKey = missionId + nodeKey + revisionRound`。Mission “继续 / 重试”优先续跑 / 复用已有 ResearchRun，**不得重新抓网页、重复付模型费**；只有证据明确过期或用户要求刷新才新建。

**B4 安全边界（验收条件）**
- 来源正文永远是 data，不是 instruction；prompt-injection 内容隔离并标记；
- SSRF / private-network（含重定向后）拒绝；下载大小与超时上限；
- 保留 source URL、fetchedAt、content hash、trust 分级；
- 法规类结论必须带 jurisdiction 与日期，否则视为 UNKNOWN。

## 3. P0-C · NEW_PRODUCT Playbook 合流

目标：一个编排器 —— `Kern → NEW_PRODUCT Playbook → (Research/Market/Consumer/Formula/Regulatory/Cost/Channel/Competitor/GTM/Red Team) → QA → Product Blueprint →（人确认后）创建 Product`。Product R&D 的 ResearchRun、QA slot、Evidence/UNKNOWN、渠道适配、Potential 评估变为 Playbook 节点与 Skills；G1/G2/G3 门禁语义不变。

**迁移方式（不一次性删除旧编排器）**
1. 新任务只进 Mission Playbook；
2. 已存在的旧 Product R&D run 按原路径跑完；
3. 旧 API 保留为 adapter，内部转发 Playbook；
4. 稳定一个周期、无旧 run 在途后，再删除旧 orchestrator。

验收：product-rnd-fusion / worker / golden-org 回归在新编排下保持绿色；在途旧 run 迁移测试。

## 4. P0-D · ModelRun 原子 cost guard + 最小 tracing

现状：月度模型调用上限只在 Mission 启动时检查一次（299/300 时仍可启动，内部多节点 / QA / revision 可冲破上限）。这既是计费问题也是长期运行的稳定性问题，必须在真实模型 dogfooding 前解决。
- 每次 ModelRun 前原子 `check-and-charge`（或 `reserve → consume → release`），超额 fail closed、节点诚实 BLOCKED；
- 最小 UsageLedger：`mission_started / model_call / research_call / desktop_action`；
- 最小 tracing：每个 Mission 可看到节点 × 模型调用 × 耗时 × 结果；
- 完整账单 / 支付以后再做。

## 5. P0-E · Feedback → Memory → Harness
用户 👍 / 纠正（含原因）→ Feedback → PREFERENCE / LESSON 候选 + Harness 评估样本 → 同类场景优先新策略并记录结果 → 只有 Outcome / Eval 证明变好才 Promotion，可回滚；禁止模型自评代替 Outcome。附带：`source=null` 记忆的语义去重。

## 6. P0-F · IA 收敛
导航只保留 **Kern / 产品 / 项目 / 设置**；`/advisor`、`/consultation`、`/war-room`、`/dashboard` 改为重定向或并入；Workbench 是 Kern 背后的工作空间。

## 7. Beta 验收：Worker 生产级常驻
“关掉浏览器仍在工作”依赖独立 `pm-worker` 常驻。验收：进程崩溃自动重启；机器重启自动启动；任务租约恢复；重复 Worker 防护；模型 / DB 临时断线恢复。

## 8. P1 · Desktop Intelligence（Computer Use）
已有：文件、Terminal、Git、Browser 打开、App 启动、Clipboard、AppleScript、本机 Agent。
**未有**：屏幕理解、坐标点击、拖拽、视觉状态恢复。不抢在 P0 前做，但 Desktop Runtime **不得**被描述为“已完成的 Computer Use”。

## 9. 已知差距（不阻塞内部 Beta）
| 项 | 现状 | 何时做 |
|---|---|---|
| 今天简报 | 打开 Kern 时动态生成；无定时 / 持久化 / 推送 | P2 多渠道触达 |
| Memory 相关性 | 中文 bigram + 英文词重叠 | 规模上来再评估向量检索 |
| 支付 / 运营看板 | 未做 | P2 |

## 附录 · 2026-09-26 删除的远程分支（branch → tip）
| 分支 | tip |
|---|---|
| `delivery/hermes-desktop-runtime` | `9ce27e4f` |
| `docs/kern-v1-beta-freeze-record` | `5cd681fc` |
| `feat/kern-attention-home` | `ade5b104` |
| `feat/kern-conversation-controls` | `359f96a3` |
| `feat/kern-conversation-first-autonomy` | `4f1fa78e` |
| `feat/kern-delivery-batch-a2-a5` | `8a0575d5` |
| `feat/kern-governed-planner` | `06dbd5e2` |
| `feat/kern-personal-agent` | `193ae32c` |
| `feat/kern-supervisor-runtime` | `2cbebb0b` |
| `feat/kern-today-brief` | `895ed511` |
| `feat/kern-v11-chat-start-product-rnd` | `23c6840d` |
| `feat/kern-v11-product-rnd-report-chat` | `1e86b770` |
| `feat/kern-v11-product-rnd-status-chat` | `1a98d129` |
| `feat/kern-v11-routing-council-shadow` | `181b68c2` |
| `feat/kern-v11-routing-receipts-tech-architect` | `f571122a` |
| `feat/kern-v11-specialist-auto-return` | `aa036d6f` |
| `feat/kern-v11-specialist-execution-contract` | `194f6c40` |
| `feat/kern-v2-supervisor-batch1` | `b66daed9` |
| `feat/kern-visual-intelligence` | `e6844214` |
| `feature/muse-live-operating-shell` | `0c192df9` |
| `fix/actionable-empty-states` | `a557cc13` |
| `fix/kern-honest-shell` | `866ff420` |
| `fix/kern-memory-quota-and-honest-plan` | `9af50a18` |
| `fix/kern-terminology-contract` | `93116051` |
| `fix/kern-v11-product-conversation-continuity` | `2e38c4ab` |
| `fix/knowledge-banner-user-copy` | `991c2844` |
| `fix/project-visible-enum-labels` | `e3d8c42d` |
| `fix/restore-muse-css-and-map-audit` | `c09e7c69` |
| `frontend-v3-conversation-first` | `c9d7cc5b` |
| `fusion/pm-os-final` | `4e2352bd` |
| `integration/kern-v2-final` | `193ae32c` |
| `refactor/kern-capability-registry` | `d8a7f126` |
| `refactor/kern-conversation-runtime` | `82420ecb` |
| `refactor/kern-own-conversation-lifecycle` | `59f2b501` |
| `release/kern-v1-beta-final-acceptance` | `cfff5fe0` |
| `test/mobile-conditional-layout` | `7602fd7e` |
| `wip/local-kernel-backup` | `95870cfb` |
