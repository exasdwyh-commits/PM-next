# KX-40 本地全量回归（仅本地，不推送）

> 日期：2026-09-28 · 分支 `feat/kern-experience` · 基于 `67508dc [KX-36]`
> 机密阶段：本任务只做本地回归与本地提交，**不 push、不开 PR、不同步**（原计划的「PR 拆分」顺延到解除机密后）。

## 1. 结论

| 项 | 结果 |
|---|---|
| `test:*` 套件 | **77 / 77 通过**（总耗时约 7 分钟） |
| 有意不跑 | `test:llm-e2e`（调用真实模型）、`test:critical`（组合命令，含 llm-e2e；其余组成部分已单独跑）、`test:sweep`（组合命令，会重跑全部含 llm-e2e） |
| `npx next build` | 通过（EXIT=0） |
| `npx tsc --noEmit -p .` | 0 错误 |
| `npx eslint .` | 0 问题（修复后，见 §3） |
| 数据库 ⟷ 数据模型 | 开发库、测试库均与 `schema.prisma` 一致（见 §4） |

## 2. 执行方式与中断原因

- 第一次用 `outputs/_kx40.sh`（`nohup` 后台）跑到 `test:http-errors` 时中断：日志最后一行是「需要重新构建：源码比构建产物新（例：tsconfig.json）」后接 `^C`。
  - 根因 1：验收服务器用独立构建目录 `.next-acc`，`next build` 会自动改写 `tsconfig.json` 的 include 和 `next-env.d.ts` 的引用路径，使源码比构建产物新，每次都触发重建。
  - 根因 2：`nohup … &` 会随远程会话结束被杀（与路线图 §0 第 6 条一致）。
- 续跑改用 `outputs/_kx40b.sh <起点> [终点]`，由 ShunCode 终端托管（`run_command` background），分 3 批：
  `test:http-errors → test:product-rnd-e2e`、`test:api-errors → test:qa-retry`、`test:gate-boundaries-http → 末尾`；最后单独补跑 `test:acceptance`（首轮被误列入跳过）。
- 跑完后用 `git checkout -- tsconfig.json next-env.d.ts` 还原这两个自动生成的改动，工作区保持干净。

## 3. 修复

| 问题 | 修复 |
|---|---|
| `npx eslint .` 报 1 个错误，位置在 `.next-acc/server/chunks/*.js`（构建产物） | `eslint.config.mjs` 忽略列表补 `.next-acc/**`（`.gitignore` 早已忽略该目录，eslint 漏配） |

修复后复核：eslint 0、tsc 0、`test:kern-autonomy` 16/16、`test:delivery-contracts` 通过、`test:source-guards` 50/50。

## 4. 数据库与数据模型一致性

命令见 `outputs/_dbdiff.sh`，输出见 `outputs/kx40/db-diff.txt`。

| 检查 | 结果 |
|---|---|
| `prisma migrate status`（hermes_next_dev） | 38 个迁移，Database schema is up to date |
| `prisma migrate diff` 开发库 → schema | 空迁移（一致） |
| `prisma migrate diff` 测试库（hermes_next_test）→ schema | 空迁移（一致） |

## 5. 逐项结果

| 套件 | 退出码 | 耗时 |
|---|---|---|
| `test:db` | 0 | 2s |
| `test:r1` | 0 | 3s |
| `test:p1` | 0 | 2s |
| `test:r2` | 0 | 2s |
| `test:r3` | 0 | 1s |
| `test:revision` | 0 | 2s |
| `test:partial` | 0 | 2s |
| `test:http` | 0 | 86s |
| `test:http-errors` | 0 | 15s |
| `test:ui` | 0 | 29s |
| `test:ui-feedback` | 0 | 46s |
| `test:evidence` | 0 | 2s |
| `test:opportunity` | 0 | 2s |
| `test:blueprint` | 0 | 3s |
| `test:product-center` | 0 | 14s |
| `test:science` | 0 | 12s |
| `test:authz` | 0 | 20s |
| `test:product-rnd-e2e` | 0 | 13s |
| `test:api-errors` | 0 | 2s |
| `test:signal` | 0 | 2s |
| `test:governance` | 0 | 3s |
| `test:golden` | 0 | 1s |
| `test:research-snapshot` | 0 | 2s |
| `test:launch-auth` | 0 | 2s |
| `test:g3` | 0 | 2s |
| `test:potential` | 0 | 1s |
| `test:model-gateway` | 0 | 2s |
| `test:harness` | 0 | 2s |
| `test:workforce` | 0 | 3s |
| `test:experience` | 0 | 2s |
| `test:validation-decision` | 0 | 2s |
| `test:decision-intelligence` | 0 | 1s |
| `test:decision-run` | 0 | 2s |
| `test:system-principal` | 0 | 2s |
| `test:autopilot` | 0 | 2s |
| `test:business-events` | 0 | 3s |
| `test:golden-org` | 0 | 8s |
| `test:model-control` | 0 | 2s |
| `test:model-runtime` | 0 | 2s |
| `test:channel-routes` | 0 | 1s |
| `test:g2` | 0 | 2s |
| `test:structured` | 0 | 2s |
| `test:gate-boundaries` | 0 | 1s |
| `test:fusion-core` | 0 | 1s |
| `test:product-rnd-fusion` | 0 | 3s |
| `test:unknown-injection` | 0 | 2s |
| `test:qa-dedup` | 0 | 3s |
| `test:qa-retry` | 0 | 4s |
| `test:gate-boundaries-http` | 0 | 14s |
| `test:worker` | 0 | 3s |
| `test:assistant-persona` | 0 | 2s |
| `test:frontend-v3` | 0 | 2s |
| `test:desktop-runtime` | 0 | 1s |
| `test:tenant` | 0 | 2s |
| `test:delivery-contracts` | 0 | 7s |
| `test:mobile-layout` | 0 | 23s |
| `test:visual-intelligence` | 0 | 2s |
| `test:kern-autonomy` | 0 | 1s |
| `test:source-guards` | 0 | 3s |
| `test:regression-units` | 0 | 3s |
| `test:kern-project-map` | 0 | 2s |
| `test:kern-runtime-architecture` | 0 | 1s |
| `test:kern-conversation-controls` | 0 | 2s |
| `test:kern-goal-plan` | 0 | 1s |
| `test:kern-memory-quota` | 0 | 2s |
| `test:kern-vault` | 0 | 2s |
| `test:kern-connector-approval` | 0 | 4s |
| `test:kern-schedule` | 0 | 3s |
| `test:kern-playbook` | 0 | 4s |
| `test:kern-worker-recovery` | 0 | 3s |
| `test:kern-supervisor-plan` | 0 | 2s |
| `test:kern-supervisor` | 0 | 5s |
| `test:kern-mission-controls` | 0 | 3s |
| `test:kern-brief` | 0 | 4s |
| `test:kern-takeaway` | 0 | 4s |
| `test:kern-node-ask` | 0 | 5s |
| `test:acceptance` | 0 | 3s |

## 6. 复现

```bash
cd /d/VScode/Kern-OS
bash outputs/_kx40b.sh test:db            # 从头跑到尾（跳过 llm-e2e / critical / sweep）
bash outputs/_kx40b.sh test:ui test:authz # 只跑一段
cd PM-next && git checkout -- tsconfig.json next-env.d.ts   # 跑完还原自动生成的改动
```

日志：`outputs/kx40/<套件>.log`；汇总：`outputs/kx40/summary.txt`（均在仓库外）。
