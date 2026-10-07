# KX-54 计划节点条件跳过

## 为什么做

以前新产品计划是静态的：哪怕合规结论是「禁止」，营销步骤照样会跑，白花钱，还会产出一份自相矛盾的上市方案。参考 Astron A5，这里只借用「条件分支」，不做通用循环。

## 设计

- `MissionNode.skipWhen?: { nodeKey, signal }`，signal 取值为 `PROHIBITED | CONDITIONAL | CLEAR`。
- **判定信号**：节点在产出里写一行「XX判定：可做 / 有条件可做 / 禁止」。执行器用 `extractNodeSignals` 取最后一条判定行，写进结果的 `signals`。reconcile 时把它存到 `state.nodes[k].signals`，同时附在 `node.finished` 事件上。
- **调度**：`effectiveDeps(n) = dependsOn + skipWhen.nodeKey`。
  - 条件节点结束前，本节点不派发。
  - 条件命中时发出 `SKIP`，原因写成 `CONDITION_<node>_<signal>`。
  - 条件节点被重跑（rerun、QA 打回）时，本节点也跟着重置，所以合规改判后营销会重新参与。
  - 如果用户在计划里删掉了条件节点，条件自动失效。
- **校验**：`validateMissionPlan` 拒绝指向不存在节点或自己的条件，成环检测也把条件依赖算进去。
- **新产品计划**：合规步骤的目标末尾要求写「合规判定」；`gtm`（营销）带上 `skipWhen {compliance, PROHIBITED}`。
- **对用户的说明**：
  - 时间线显示「「营销」已跳过（「合规」判定为禁止，按计划跳过）」。
  - 结论消息里，条件跳过不再算「未完成（按 UNKNOWN 处理）」，而是单独一行「按计划跳过：营销（合规判定为禁止）」。
- 顺带修正：`node.rerun` 的原因是 USER_ANSWERED 时，时间线显示「按你的回答重做」。

## 验证

- `tests/kern-condition-skip.test.ts`（CD1–CD5）已加入 `test:regression-units`，覆盖：
  - 判定行解析。
  - 等待条件节点结束。
  - 条件命中时跳过、有条件可做时照常派发。
  - 合规重跑时连带重置营销。
  - 校验拦下非法条件。
  - 跳过原因的中文说明。
- `test:kern-node-ask` 新增 A5（真实数据库）：合规判定为禁止时，营销从未派发，事件里带 signals 和跳过原因，任务仍然完成，结论消息写明「按计划跳过」。

## 风险

- 模型可能不写判定行。这时没有信号，照常执行，行为和改动前一样。
- 目前只支持单一条件，没有「与 / 或」组合。需要时再扩展。
