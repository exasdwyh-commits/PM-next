# KX-64 浏览器系统通知

## 背景
KX-33 留了通知扩展点，但应用里没有通知中心：内置 `inbox` 渠道只是空壳，“需要你”本来就在对话页显示。
只把事件接到 `inbox` 用户看不到任何变化。2026-09-29 用户选择：做浏览器系统通知（只改前端 + 一个只读接口）。

## 事实核对
- 对话页的 `brief.attention` 只在服务端渲染页面时生成一次，之后不刷新；轮询的只有当前对话的消息。
- 所以前端没有实时来源，需要一个只读接口。

## 做了什么
- `src/modules/supervisor/attention.ts`：`buildAttentionBrief` 追加 `recentDone`（24 小时内完成的任务明细）；原有 `completedRecently` 数量不变。
- `src/modules/muse/attention-feed.ts`：复用首页同一套 `loadAttentionForUser`，加上最近一次运行失败的定时任务，组装成信号流。
  - 每条带稳定 key：`n:<id>` 需要你、`d:<id>` 已完成、`s:<id>:<lastRunAt>` 定时失败（同一定时任务再次失败算新条目）。
  - 链接只允许站内相对路径，外部链接回落到 `/muse`。
- 接口 `GET /api/attention`：只读、只含本人数据。权限矩阵已登记，基线 90 路由 / 125 方法。
- `src/app/muse/desktop-notify.ts`：
  - 默认关闭；在「定时」面板打开时才向浏览器申请权限，开关存在本机 localStorage（`kern.notify.v1`）。
  - 每 30 秒轮询；第一轮只建立基线，页面打开时已存在的事不弹。
  - 只在 Kern 页面不在前台时弹；一轮最多 3 条；点通知回到 Kern 并打开对应对话。
- 「定时」面板顶部新增“系统通知”一行：开启 / 关闭，浏览器拒绝或不支持时给出说明。

## 验证
- 单测 `tests/kern-attention-feed.test.ts`（AF1–AF4）：三类信号、key 稳定、外链丢弃、再次失败算新、24 小时窗口、去重（基线不弹、只弹新的、消失再出现不重复弹）。
- `test:regression-units` 228 项、`test:authz` 1094 项全绿；已有注意力相关测试（kern-attention、desktop-confirm）通过；tsc、eslint 通过。
- 真实浏览器端到端（开发库，`scripts/_kx64-e2e.mjs`，不提交）：
  - 页面置于后台，第一轮通知数 0；
  - 经接口新建一个提醒并标记失败，下一轮弹出且只弹 1 条“定时任务失败：KX64 通知测试”，正文为失败原因；
  - 测试用定时任务已删除。
- 截图：「定时」面板“系统通知”一行正常显示（无头浏览器默认拒绝权限，显示的是“已拒绝”说明）。

## 没做
- 没有通知历史 / 铃铛 / 未读数（用户未选完整通知中心）。
- 浏览器关闭后收不到通知（需要 Web Push + Service Worker，暂不做）。
- 外部渠道（飞书等）仍只是 KX-33 的保留名额。
