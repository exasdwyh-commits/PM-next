# KX-33 通知渠道扩展点（重定范围）

## 背景
原计划 KX-33 是“接通第一个真实系统：飞书只读”（D-04）。
2026-09-29 用户决定暂不接飞书，只预留扩展点。本次按新范围完成。

## 事实核对
动手前检索了 `src/` 和 `tests/`：仓库里没有任何飞书 / Lark 代码，所以没有需要删除的实现。

## 做了什么
- 新模块 `src/modules/notify/index.ts`（纯逻辑，不访问网络、不碰数据库）。
  - `NotifyChannel` 接口：`id`、`label`、`kind`（builtin / external）、`isConfigured()`、`send()`。
  - 内置渠道 `inbox`（应用内）：始终可用，不能被覆盖。
  - 保留名额 `RESERVED_CHANNELS`：飞书、企业微信、邮件、Webhook。只用于展示“以后可接”，没有实现。
  - `registerNotifyChannel()`：以后接入时只需实现接口并注册，只能注册外部渠道。
  - `dispatchNotification()`：
    - 不点名渠道时只发 `inbox`；
    - 保留或未知渠道 → `skipped`；
    - 未配置 → `skipped/unconfigured`；
    - 外部渠道没有审批凭据 → `needs_approval`（能力 `external.send`，与 KX-31 连接器写工具一致）；
    - 发送异常收敛为 `failed`，永不抛错。
  - `normalizeMessage()`：标题压缩空白并截到 120 字，正文截到 2000 字，链接只允许站内相对路径（拒绝 `https://`、`//`）。
- 测试 `tests/kern-notify.test.ts`（6 项），已加入 `test:regression-units`。
- 路线图：KX-33 行、D-04 决策、§10 日志已更新。

## 没做什么
- 没有新接口、没有界面、没有数据库迁移，所以 authz 基线不变（87 路由 / 122 方法）。
- 还没有业务代码调用 `dispatchNotification`。接入真实渠道时再把计划完成、需要你确认等事件接上。

## 以后接飞书怎么做
1. 在 `src/modules/notify/` 下新建 `feishu.ts`，实现 `NotifyChannel`，凭据走 vault，不写进仓库。
2. 启动时 `registerNotifyChannel(feishuChannel)`。
3. 调用方先拿 `external.send` 审批凭据，再以 `approvedExternal: true` 发送。
