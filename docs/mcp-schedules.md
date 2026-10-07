# KX-34 定时与主动

让 Kern 按时主动找你，而不是等你来问。代码在 `src/modules/schedule/`，由 worker 的 `schedule` loop 触发。

## 三种定时

| kind | 做什么 | 发到哪里 |
|---|---|---|
| DAILY_BRIEF | 每日简报：列出需要你处理的事、上次简报以来结束的工作、3 天内过期的凭证和出错的连接器。**全都没有就不发**（lastStatus = SKIPPED_EMPTY）；光有“正在推进”也不发。 | 绑定的对话；没有绑定就发到「Kern 简报」对话（没有就新建） |
| REMINDER | 到点发出“提醒：…” | 同上 |
| MISSION | 定期重跑：按某次任务的原计划，以本人身份再启动一次 | 原任务的对话 |

每个用户最多 20 个定时，每日简报只能有一个。

## 为什么这样设计

- **不用新概念**：简报复用 `loadAttentionForUser`（`muse/read-model.ts`），和首页「需要你」是同一套判断。
- **不打扰**：没有真实内容就静默，这是 Personal AI 的底线。
- **定期重跑不重新规划**：在创建时保存原计划的快照，结果可以和上次直接比较；要改计划就重新发起一次任务。

## 调度

- 5 段 cron（分 时 日 月 周），按用户时区计算。前端默认取浏览器时区，缺省 Asia/Shanghai。
  - 实现在 `cron.ts`，是纯函数，不引入依赖。
  - 支持 `*`、列表、范围、步长；周 0 和 7 都表示周日；日和周同时受限时取「或」。
  - 夏令时由 `Intl` 处理，时间按当地时刻落点。
- **原子认领**：`updateMany where { id, enabled, nextRunAt: 旧 slot }` 把 nextRunAt 推到下一次，只有 count = 1 的那个 worker 执行。
  - 多 worker 并发或重启都不会重复触发。
  - worker 停机期间错过的多个 slot 合并成一次执行，不会补发一串。
- **第二道幂等**：MISSION 的 sourceRunId 为 `schedule:<id>:<slot ISO>`，同一个 slot 只会启动一次任务。
- **失败处理**：记录 lastError；连续失败 5 次自动停用。手动恢复时清掉错误并重新计算下一次触发时间。
- **身份**：执行时构造 schedule 所有者的 session（不用 worker 的 SYSTEM principal），所以额度、记忆、归属都算在本人名下。

## 接口

- `GET /api/schedules`、`POST /api/schedules`，body 为 `{ kind, cron, timezone?, title?, text?, missionTaskId?, conversationId? }`。
- `PATCH /api/schedules/{id}`，body 为 `{ enabled?, cron?, timezone?, title? }`。
- `DELETE /api/schedules/{id}`。

只有本人能操作，他人一律 404。authz 基线为 83 / 116，矩阵 1023 项全绿。

## 入口

- 顶栏「定时」抽屉：开关每日简报（频率和时间）、添加提醒、暂停或删除。
- 任务结果区「定期重跑」：可选每周一、每天或每月 1 日的 9:00。

## 前提：worker 必须在运行

定时只由 `npm run worker` 触发（loop 间隔 30s）。`npm run dev` 只启动网页。常驻与崩溃自恢复见 KX-34b。

## 测试

- `tests/kern-schedule.test.ts`：cron 解析、上海 / 东京 / 纽约夏令时的下一次触发、描述文案、简报是否静默。已纳入 test:regression-units。
- `npm run test:kern-schedule`（真实数据库）：
  - SC1 校验与越权
  - SC2 提醒送达且不重复
  - SC3 并发认领只执行一次
  - SC4 简报没内容不发，有内容才发
  - SC5 定期重跑以本人身份启动
  - SC6 连续失败自动停用

## 暂不做

- 消费类提醒（续费或付款）需要进入 WAITING_HUMAN 审批，等 KX-35 再做。
- 站外通知（邮件或 IM）：按显示层需求 v1，目前只做站内通知。
