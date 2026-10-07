# KX-36 做法（Playbook）

> 把一次顺利完成的工作沉淀为可复用的「做法」。下次说类似的事，Kern 按这个做法拆计划。
> 用户只看到“做法”这个词；没有 playbook 编辑器，也没有模板市场。

## 为什么改

Kern 已经能拆计划、跑完、写回记忆，但“这次怎么拆的”没有沉淀下来：同类工作每次都从默认模板重新拆。
记忆（KX-13）存的是**结论与偏好**，做法存的是**拆法**（MissionPlan 的节点、成员、预算、成功标准）。两者互补，不合并。

## 保留 / 替换

- 保留：简报两段式（CLARIFY → PLAN）、`buildNewProductMissionPlan`、goal-plan 通用计划、launchKernMission 快照、记忆写回。
- 新增：`src/modules/playbooks/`（match.ts 纯函数 + service.ts）、表 `KernPlaybook`、`/api/playbooks`、`/api/playbooks/{id}`。
- 不替换任何已有路径：没有匹配到做法时，行为与 KX-36 之前完全一致。

## 数据

`KernPlaybook`（迁移 `20260928220000_add_kern_playbook`）：name、sourceGoal、sourceMissionTaskId、plan（模板化 MissionPlan）、
useCount / successCount / failureCount、lastUsedAt。唯一键 (userId, sourceMissionTaskId)，随 User 级联删除。每人最多 50 个。

## 流程

1. 保存：工作完成后，「带走」区出现「保存为做法」。只有**本人发起、COMPLETED、非演示**的工作能存，否则 422；他人的工作 404；重复保存幂等。
   保存时 `templatizePlan` 把原目标替换成 `{{goal}}`（goal、节点 objective、成功标准）。
2. 匹配：`createBriefForMessage` 调 `findPlaybookForGoal`：目标分词（CJK 二元组 + 拉丁词，去停用词），Dice 相似度 ≥ 0.3 才命中；
   同分取成功率高者、再取用得多的。只在本人的做法里找。
3. 简报：PLAN 阶段显示「按你保存的做法「X」：用过 N 次，顺利完成 M 次」+「不用这个做法」（action `drop-playbook`，回到默认计划）。
   计划 = `instantiatePlan(template, goal)`，澄清答案仍作为“已确认的约束”附在 goal 上。
4. 启动：快照写入 `playbookRef {id,name}`；非演示时 `useCount+1`。
5. 结果：任务结束（不论是否挂在对话上）按 outcome 计 success / failure。已知限制：NEEDS_USER 后恢复再完成，会同时计一次失败和一次成功。
6. 管理：「记忆」抽屉底部「保存的做法」，可改名 / 删除。工作区「信息」页显示「做法」。

## 验证

- `tests/kern-playbook.test.ts`（纳入 test:regression-units）：相似度、挑选、模板化 / 实例化、简报去掉做法。
- `npm run test:kern-playbook`（真实库）：PB1 保存校验、PB2 匹配（相似命中 / 无关与他人不命中）、PB3 useCount / successCount、PB4 越权 404。
- authz 基线 86 路由 / 121 方法。

## 风险

- 相似度是词面匹配，可能误套用。缓解：阈值 0.3、简报明示、一键不用、失败次数影响排序。
- 模板里旧目标的替换只覆盖原文出现处；改写过的表述会残留。节点结构本身与目标无关，影响有限。
