# KX-73 结果指标 + 三次成功才自动化

> 状态：完成，`feat/kern-experience`。阶段 2（可靠性）第二项；完成后开窗口 B。

## 1. 用户视角

1. **每项工作结束记 5 个数**（产出页「带走」区一行「这次的指标」）：
   - 完成率：任务是否 COMPLETED；契约是否验收通过（未复核为「未复核」）。
   - 人工介入次数：暂停、补充输入、改计划、手动重跑、回答提问、打回。
   - 返工轮数：QA 打回 + 手动重跑 + 复核打回。
   - 到结果耗时：从开跑到有结果。
   - 单次成本：模型调用次数、模型累计耗时、token（拿不到就是 null；不折算金额——路线图决定不做计费）。
2. **做法维度看趋势**：`playbookMetrics(id)` 汇总名下所有运行的平均值；做法列表显示「连续验收 N 次」。
3. **三次成功才自动化**：「定期重跑」只在满足全部条件时可用，否则显示原因：
   - 不是演示运行；
   - 这次是按保存的做法跑的（先「保存为做法」）；
   - 这次已在验收清单里复核通过；
   - 该做法连续 3 次验收通过（`AUTOMATION_MIN_ACCEPTED = 3`）。
   - 打回后重做再通过不清零（一次工作只算一次）；任务失败 / 取消清零。
4. **定时跑的也算数**：定时任务启动的新任务带着 `playbookRef`，其结果继续计入做法的连续验收与指标。

## 2. 代码

| 位置 | 作用 |
|---|---|
| `kern-contracts/metrics.ts` | `MissionMetrics` / `PlaybookMetrics` / `AutomationEligibility` 类型与常量（L5） |
| `supervisor/metrics.ts` | `computeMissionMetrics`（从快照 + 事件 + 契约算）、`aggregatePlaybookMetrics`、`automationEligibility`（纯函数） |
| `supervisor/service.ts` | 快照字段 `metrics`；`refreshMissionMetrics`（只改 metrics 字段，用最新快照合并）；状态视图返回 `metrics`、`automation` |
| `supervisor/controls.ts` | `review` 之后刷新指标；通过且按做法跑、非演示 → `recordPlaybookAcceptance` |
| `playbooks/service.ts` | `acceptedStreak` / `lastAcceptedAt`（迁移 `20260929120000_add_playbook_accepted_streak`）；失败清零；`playbookMetrics` |
| `schedule/service.ts` | `createSchedule` MISSION 走 `automationEligibility`，不满足 422 带原因；payload 带 `playbookRef`，执行时传给 `launchKernMission` |
| `app/muse/mission-timeline.ts` | `MissionMetricsView` / `AutomationView` / `metricsLine()` |
| `app/muse/components/mission-workspace.tsx` | 「这次的指标」一行；`RerunSchedule` 按 `automation` 显示原因或表单 |
| `app/muse/components/sheets.tsx` | 做法列表显示连续验收次数 |
| `tests/kern-mission-metrics.test.ts` | 3 条纯单测（已入 regression-units） |
| `tests/regression-kern-schedule.ts` SC5 | 真库：无做法 → 422；有做法未复核 → 422；复核通过后 streak 2→3、指标落库、`automation.allowed`；定时启动的新任务带 `playbookRef` |

无新 API 路由（权限矩阵不变）；新增 2 列，无新表。

## 3. 决定与取舍

- **成本不折算金额**：`ModelRun` 没有价格字段，路线图明确不做计费；先记调用次数 / 耗时 / token，窗口 B 看趋势够用。
- **指标在复核时刷新，而不是每次状态查询算**：状态视图直接读快照里的 `metrics`，SSE 不变；任务结束但未复核时 `accepted = null`。
- **闸门放在 `createSchedule` 服务层**：UI 只是提前显示原因，绕过 UI 直接调 API 同样被拦。
- **旧任务没有 `playbookRef` 就不能转定时**：这正是「先沉淀做法再自动化」的本意；老定时任务不受影响（只在创建时检查）。

## 4. 校验

tsc 0、eslint 0，全量回归见路线图 §10 日志。
