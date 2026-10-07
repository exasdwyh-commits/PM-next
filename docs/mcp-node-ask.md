# KX-51 节点级提问

## 为什么做

以前任务开跑之后，步骤缺关键信息时只能硬猜，或者整个任务停下来 NEEDS_USER。现在单个步骤可以中途问用户一个问题，同时给出默认假设。用户可以回答，也可以不理，任务照常往下走。

## 保留什么、替换什么

- **沿用**：`/api/missions/:id/control` 路由，新增一种控制动作 `answer`，不新增 API（authz 矩阵不变）。
- **沿用**：KX-50 的工具循环。提问做成一个工具 `ask_user`，只给 SPECIALIST / RED_TEAM 节点用，每个步骤最多问一次。

## 流程

1. 模型输出 `{"tool":"ask_user","input":{"question":"…","defaultAssumption":"…"}}`。
2. 执行器写入事件 `node.ask {askId, question, defaultAssumption, timeoutSec}`，然后轮询事件流：
   - 收到同 askId 的 `node.answered`：按回答内容处理。
   - 收到 `mission.cancelled`：视为中止。
   - 超过 `askTimeoutMs`（默认 5 分钟）：写入 `node.answered {mode:"timeout"}`，按默认假设继续。
3. 用户侧调用 `control {action:"answer", askId, mode:"answer"|"ignore"|"abort", text}`：
   - answer / ignore：只写 `node.answered`，不推进任务（执行器自己会读到）。
   - abort：先写 `node.answered`，再走 cancel 的全部逻辑，任务变为 CANCELLED。
4. 回喂给模型的内容：
   - 回答：「用户回答：…（可直接采用）」
   - 忽略 / 超时：「按默认假设继续：…（标注基于假设）」
   - 中止：「一句话收尾」

## 状态与界面

- `getKernMissionStatus` 返回 `pendingAsks`，由纯函数 `computePendingAsks` 用 ask 减去 answered 得出；任务结束后为空。卡片每 4 秒轮询一次状态，所以不依赖 SSE。
- 对话卡片 `MissionCard` 和工作区都会显示 `AskCard`：
  - 输入框，Ctrl/⌘+Enter 提交。
  - 按钮「回答」「按默认继续」「中止任务」。中止需要二次确认，用页面内按钮，不用 window.confirm。
- 时间线文案：「「X」向你提问：…」「你回答：…」「按默认假设继续」「你在提问处中止了任务」。
- SSE 订阅补上 node.ask / node.answered，以及之前漏掉的 node.hypothesis / refuted / retracted。

## 风险

- v1 在执行器里阻塞等待，最长 5 分钟，会占用一个 worker 执行位。KX-34 做 Worker 常驻后，改成挂起 / 恢复。
- 只有应用内提示，没有推送通知（符合「只做站内通知」的要求）。

## 验证

- `tests/regression-kern-node-ask.ts`（`npm run test:kern-node-ask`，已加入 kern-supervisor-ci）。用真实数据库、真实 worker 循环覆盖：
  - 回答：答案进入步骤，计算工具产生事件，完成后不能再回答。
  - 超时：按默认假设完成。
  - 中止：任务取消，事件顺序正确。
- `tests/kern-tool-loop.test.ts`：
  - TL9：每步只能问一次，忽略时回喂默认假设。
  - TL10：`computePendingAsks`。

## KX-51b 改为非阻塞（对照 Meta Muse）

原先 v1 的做法是：步骤提问后在执行器里阻塞等回答，最长 5 分钟。现在改成：

- **不再阻塞**：执行器写入 `node.ask {blocking:false}` 后，工具立即返回「问题已转给用户，先按默认假设继续」。`waitForAnswer` 和 `setAskTimingForTest` 已删除。
- **回答有效期**：任务完成后提问仍可回答；只有任务被取消时才隐藏。
- **`answer` 控制动作**：服务端先确认这个提问存在且还没回答（不存在返回 404，已回答返回 409），再按模式处理：
  - `ignore`：用户选了「假设没问题」，只记录，不重做。
  - `answer`，且该步骤已结束：复用 `prepareNodeRerun`，重做该步骤和它的下游，必要时重新打开已完成的任务（事件 `node.rerun {reason:"USER_ANSWERED"}`）。
  - `answer`，且该步骤还在跑：作废这次执行，节点回到 PENDING，带着回答重新派发。旧执行结束时发现节点的 taskId 已不是自己（`isSuperseded`），就不再写正文。
  - `answer`，但重跑次数已用完、下游正在跑或任务已暂停：退回为「补充信息」，带入后续步骤。
  - `abort`：同之前，走取消逻辑。
- **记住答案**：用 `rememberForUser` 保存为 FACT，`source=mission-ask:<askId>`，下次任务通过记忆召回，不再重复问。写入失败（比如记忆额度满）不影响回答本身。
- **界面**：提问卡文案改为「我先按这个假设在做……回答后会按你的答案重做这一步，并记住」，按钮是「回答 / 假设没问题 / 中止任务」。任务结束后不显示「中止任务」。
- **验证**：`test:kern-node-ask` 已重写为 A0–A4：
  - A0：参数校验。
  - A1：不阻塞先完成 → 回答 → 任务重新打开、步骤重做、答案写入记忆；重复回答被拒，未知提问返回 404。
  - A2：确认假设后不重做。
  - A3：步骤运行中回答 → 作废本次执行并重派，最终采用回答。
  - A4：在提问处中止。
- **暂未做**：把同一任务的多个问题合并到顶栏「需要你」，留到 KX-20 顶栏接入时一起做。

