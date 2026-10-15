# Kern 成熟强化：本机同步文档入口

MCP 本机总目录：`D:/VScode/Kern-OS/docs/kern-maturity/`。

| 文档 | 用途 |
|---|---|
| Kern与Bops源码核对及改进方案-2026-10-15.md | 历史源码评审快照，非实时施工指纹 |
| Kern成熟强化优先-施工路线V2.md | 用户确认的完整分阶段路线及当前进度 |
| KERN_MATURITY_PHASE_A.md | 第一批连接器安全施工契约（原件也在 PR #102 的 docs/plans） |
| Kern成熟强化-第一批交付回执.md | PR #102；6/6 CI 通过，未合并／部署 |
| KERN_MATURITY_PHASE_A2_RECEIPTS.md | 第二批可靠回原会话的范围、实现、测试与边界 |
| Kern成熟强化-第二批交付回执.md | 本机交付时生成，记录第二批准确 PR／SHA／最终 CI 状态 |

源码使用 `.tmp-kern/maturity-connectors` 和 `.tmp-kern/maturity-worker` 两个独立 Git worktree，未直接覆盖 `PM-next` 或其它并行 WIP。

本机回执持续更新；GitHub 中 `docs/kern-maturity/` 是各批提交时的同步快照，不冒充实时部署状态。总路线不因单批完成而自动变成全项完成；准确交付状态以相应回执和 PR 为准。
