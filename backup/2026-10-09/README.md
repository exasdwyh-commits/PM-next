# 2026-10-09 工作备份（非交付物）

- `tmp-explore.cjs` / `tmp-explore2.cjs` / `tmp-ov.cjs`：开发过程中用的 Playwright 探查脚本（登录 → /muse → 发送样例 → 截图 / 测横向溢出）。
- `tmp-shots/`：探查截图（固定样例模型下的真实 /muse 链路：worker → mock 模型）。
- `env.redacted`：当时本地 `.env` 的键与非敏感值，口令/密钥已替换为 `<redacted>`。

正式交付在 `feat/arena-workspace-port`；这个分支只用于防止数据丢失。
