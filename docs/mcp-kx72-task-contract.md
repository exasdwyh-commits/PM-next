# KX-72 任务契约：开跑前说清楚，跑完按条验收

> 状态：完成，`feat/kern-experience`。阶段 2（可靠性）第一项。

## 1. 用户视角

1. **契约卡**：对话里出「我拟的计划」时，计划下方多一张「任务契约」：要的结果、产出、怎样算完成（自动检查项 + 需要你判断的项）、
   约束（你回答的澄清问题）、会先问你的事（受保护动作）、会用到的能力（KX-71 目录里检索命中的）。改计划、换做法，契约跟着重算。
2. **自动检查**：任务完成时系统先查四条：关键步骤全部成功、独立 QA 通过、综合结论五个固定分节齐全、关键依据有「事实 / 推断」标注。
   结果带证据写进契约。
3. **验收清单**：产出页顶部出现清单，自动项只读显示 ✓ / ✗；需要你判断的项可以「打回」并写一句哪里不对。
   - 「全部通过」→ 契约成立，记一轮复核。
   - 打回 N 条 → 综合结论带着你的意见重做（连带 QA 之后的步骤），任务重新打开；自动项回到待检查，被打回的项回到待复核并保留意见。
     重做完成后再复核一轮。次数受 `MAX_MISSION_RERUNS` 保护。
4. **统一交接格式**：`contractMarkdown()` 把契约卡渲染成 Markdown（勾选状态 `[x] / [!] / [ ]`），供导出与后续任务交接使用。

## 2. 代码

| 位置 | 作用 |
|---|---|
| `kern-contracts/task-contract.ts` | `TaskContract` / `AcceptanceCriterion` / `ContractReview` 类型（L5，纯类型） |
| `supervisor/contract.ts` | `buildTaskContract`、`checkTaskContract`、`applyContractReview`、`reviewFeedback`、`contractMarkdown`（纯函数） |
| `supervisor/brief.ts` | PLAN 阶段生成 `brief.contract`（`briefContract` + `suggestCapabilities`），开跑时传给 `launchKernMission` |
| `supervisor/service.ts` | 快照字段 `contract`；COMPLETED 时 `checkTaskContract`；状态视图返回 `contract` |
| `supervisor/controls.ts` | 新控制 `{ action: "review", verdicts: [{ id, pass, note? }] }`；事件 `contract.reviewed`；审计 `KERN_MISSION_CONTRACT_REVIEWED` |
| `app/muse/components/contract-card.tsx` | `ContractCard`（契约卡）、`ContractReview`（验收清单） |
| `tests/kern-task-contract.test.ts` | 4 条纯单测（已入 regression-units） |
| `tests/regression-kern-mission-controls.ts` C5b | 真库：完成时自动项已检查 → 打回 1 条 → 综合结论重做且提示词含意见 → 打回项回到待复核 → 全部通过 → 2 个 `contract.reviewed` 事件 |

复用而非新造：打回走既有 `prepareNodeRerun`（与「重跑」同一条路径），无新 API 路由（权限矩阵不变），契约随任务快照保存（无新表）。

## 3. 决定与取舍

- **自动项用户不能改成通过**：只能通过重做让系统重新检查，避免「点一下就算过」。
- **未提到的人工项默认通过**：复核时用户只需标出不满意的，减少点击。
- **打回后人工项回到待复核而不是保留 FAIL**：重做过了，应该由用户再看一眼；意见保留供参照。
- **契约生成不阻塞**：能力目录检索失败只影响「会用到的能力」一栏，不影响出卡。
- 「按需检索能力」目前接到契约卡；写进模型提示词等 KX-73 指标出来后再看是否值得（避免无指标地改 prompt）。

## 4. 校验

- tsc 0；改动文件 eslint 0；source-guards 61 / 61；architecture 11 / 11；regression-units 258 / 258；frontend-v3 15 / 15；
  delivery-contracts 全过；kern-autonomy 16 / 16。
- 真库：kern-mission-controls（含 C5b）、kern-brief、kern-supervisor、kern-playbook、kern-schedule、kern-takeaway、kern-node-ask、
  kern-worker-recovery、worker 全过。
