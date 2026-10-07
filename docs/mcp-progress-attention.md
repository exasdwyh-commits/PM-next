# KX-53 真实进度与中断读模型

## 为什么做

- 进度条以前按「完成数 / 总数」计算：QA 和综合的耗时差别很大，进行中的步骤又按 0 算，所以常常卡在某个数字不动，然后突然跳到 100%。
- 需要用户处理的事分散在三处：提问、停下待处理、暂停。没有统一的读模型，顶栏的「需要你」也看不到提问。

## 做了什么

- `plan.ts` 新增 `estimateMissionProgress(plan, state)`，返回 `{pct, remainingSteps, remainingDepth}`：
  - 按节点类型加权：专家 1、红队 1、QA 0.6、综合 1.5。
  - 进行中的节点算一半；跳过、受阻、失败都算已结束。
  - 还没全部结束时最高显示 99%。
  - `remainingDepth` 是未结束节点沿依赖关系的最长链，即「还剩几轮」。
- 事件帧：supervisor 推进时，给 `node.dispatched`、`node.finished`、`node.skipped`、`mission.finished` 的 payload 附上 `progress`（Astron A2）。
- 状态接口：
  - `progress` 增加 `pct`、`remainingSteps`、`remainingDepth`。
  - 新增 `attention[]`，由纯函数 `missionAttention` 生成，类型为 ASK、NEEDS_USER 或 PAUSED；任务取消后为空。
- 界面：
  - 卡片进度条和标签改用真实进度，标签显示「约 62% · 还剩 2 轮」。工作区副标题同步。
  - 老数据没有 pct 时，退回按计数计算（`progressPct`、`progressLabel`）。
- 「需要你」：attention 引擎的 MISSION 信号新增 `openQuestions`。任务运行中或已完成、且有未答提问时，聚合成一条 SURFACE：「有 N 个问题想确认（已先按假设推进，回答后会修正）」。这就是 KX-51b 里的「问题聚合」。

## 与 Astron 的差异

没有新增 `node.interrupt` 事件。KX-51b 之后提问不再阻塞，真正的「中断」只剩三种情况，而它们已有各自的事件：`node.ask`、`mission.finished(NEEDS_USER)`、`mission.paused`。所以只做了统一的读模型 `attention`，避免同一件事写两种事件。

## 验证

- `tests/kern-progress.test.ts`（PG1–PG5）已加入 `test:regression-units`，覆盖：
  - 进度边界。
  - 权重与单调性。
  - 界面回退。
  - 中断读模型。
  - 「需要你」的聚合。
- `test:kern-node-ask` A1 新增断言：关键帧都带 progress，结束帧为 100。
- 教训：`src/modules/muse/read-model.ts` 禁止出现 `missionId:` 字样（kern-runtime-architecture 测试），变量名要避开。
