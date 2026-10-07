# Kern 下一阶段规划（KX-4x / KX-6x）

更新：2026-09-29。分支 `feat/kern-experience`，保密阶段只做本地提交。

## 本阶段已完成（本地提交）
| 提交 | 编号 | 内容 |
|---|---|---|
| `03d58e3` | KX-35 | 本机命令分级确认（只读自动 / 允许一次 / 危险拒绝） |
| `23b9b74` | KX-38 | 合入前端改版分支（毛玻璃外壳、深色主题、回复排版） |
| `7b20bbf` | KX-60 | 浅色主题改为参考图蓝色系；工作台覆盖层统一指向令牌源 |
| `8aad92b` | KX-33 | 重定范围：暂不接飞书，通知渠道扩展点 + 审批门 |
| `95000aa` | KX-38 补漏 | `/api/missions/{id}/response` 登记进权限矩阵（88 / 123） |
| `31cf1db` | KX-61 | 连接器权限三档：关闭 / 只读 / 读写交互 |
| （本次） | KX-62 | 产出库第一步：只读汇总页 + 接口 + DB 回归 |

## 待办（建议顺序）
### KX-62 产出库（Library）— 第一步已完成，下面是第二步
- 目标：Kern 生成的报告、表格、文档集中在一个地方，按任务 / 类型 / 时间查找，可再次下载（参考 Meta Muse 的 Library）。
- 建议做法：
  1. 先做只读聚合页，不新建表：从已完成任务的导出（`/api/missions/{id}/export`）和结论信封里列出产出。
  2. 验证有用之后，再加 `KernArtifact` 表存文件元数据（需要迁移，测试库单独 `migrate deploy`）。
- 新接口需要登记权限矩阵并更新基线。
- 第一步已做（只读汇总，不建表）；第二步是 `KernArtifact` 表与分页。

### KX-64 浏览器系统通知 — 已完成（见 `docs/mcp-kx64-desktop-notify.md`）
- 用户选择浏览器系统通知，而不是只接空壳 inbox 或做完整通知中心。

### KX-63 真实数据界面走查 — 已完成（见 `docs/mcp-kx62-library.md`）
- KX-61 三段切换、KX-62 列表行与下载按钮：开发库没有连接器和已完成任务，只截到了空状态。需要造一条已完成任务和一个连接器后再截图。

### 暂缓
- 飞书等外部渠道：等用户决定再接，接法见 `docs/mcp-kx33-notify-channels.md`。
- 租户包 P3–P5：在 `feat/tenant-pack` 分支上，尚未合入本分支。
- KX-41：用户未选择。

## 注意事项
- `[data-palette="paper"]` 回退块仍被覆盖层压住（既有问题）。
- 下划线开头的截图 / 恢复脚本不提交：`scripts/_kx60-shot.mjs`、`_kx62-shot.mjs`、`_kx63-seed.mjs`、`_kx64-e2e.mjs`、`_kx64-shot.mjs`、`_restore-env.sh`、`_shot-callout.mjs`、`_shots-reply.mjs`、`_shots-unify.mjs`。
