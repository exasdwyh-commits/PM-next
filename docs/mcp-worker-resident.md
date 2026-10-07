# KX-34b Worker 常驻与崩溃恢复

任务推进、定时、研究续跑都依赖后台 Worker。KX-34b 解决三个问题：Worker 挂了能自动起来、挂在半路的任务能被接管、用户能看到 Worker 没在跑。

## 1. 守护进程

```
npm run worker:supervised            # 推荐的常驻方式
npm run worker:supervised -- --quiet # 其余参数原样传给 worker
```

- 崩溃后自动重启，退避间隔 1s → 2s → 4s … 封顶 60s。稳定运行 5 分钟后，崩溃计数清零。
- 已有活跃 Worker 时，本实例以退出码 75 退出。守护进程每 30s 再试一次，不会疯狂重启。
- Ctrl+C / SIGTERM 会转发给 Worker，让它跑完当前轮再退出；等待 30s 后强制结束。
- 策略是纯函数，写在 `src/modules/worker/supervisor-policy.ts`。
- 生产环境用 systemd、pm2 或容器的 restart=always 与此等价，但仍然要保证单实例（文件锁 + 退出码 75）。

## 2. 数据库心跳

表 `PmWorkerHeartbeat`，迁移 20260928180000。

- 每个 Worker 进程有一个随机的 `PROCESS_WORKER_ID`，启动时写一次心跳，之后每轮更新（节流 10s），退出时写入 stoppedAt。
- 超过 90s 没有心跳，就视为死亡。
- 文件锁 `.pm-worker/lock.json` 只能管住同一台机器；心跳让网页进程和其他机器也能看到 Worker 的状态。

## 3. 孤儿任务恢复

**原先的缺陷**：执行器只领取 QUEUED 任务，startAgentTask 会把任务改成 RUNNING。Worker 在执行途中崩溃后，任务会永远停在 RUNNING；租约过期了也没人再领取，整棵任务树卡死。

**现在的做法**：
- executor 租约里记录持有者：`executorLease.owner = PROCESS_WORKER_ID`。
- executor loop 每 30s 扫描一次，调用 `recoverOrphanedTasks`（在 `src/modules/worker/recovery.ts`）。

判定规则（只看带租约的 RUNNING 任务；supervising 的任务根没有租约，不会被误伤）：

| 租约 | 判定 |
|---|---|
| 有 owner，owner 心跳新鲜，或 owner 就是本进程 | 不动。即使租约过期也不动：任务慢不等于进程死了 |
| 有 owner，心跳超过 90s、已 stopped，或无心跳行且领取已超过 90s | 孤儿 |
| 没有 owner（旧租约） | 租约过期才算孤儿 |

接管流程：
- 原子 UPDATE：只有旧 token 还在的时候，才把它换成恢复标记。多个 Worker 同时扫描时只有一个能成功。
- 走 `finishAgentTask(FAILED)`，正常关闭 AgentRun。
- attempts 加 1，lastOutcome 记为 INTERRUPTED。
  - 次数小于 MAX_EXECUTOR_ATTEMPTS（3）：重新排队，立即可被领取。
  - 次数用完：保持 FAILED，由上层任务按节点失败处理，得出结论，不会挂起。

这样恢复时间从「永不恢复」缩短到约 90s + 30s。

## 4. 健康可见

- `GET /api/worker/health` 返回 `{ status: running|stale|stopped|never, running, heartbeatAt, startedAt }`。任何登录用户可读，不暴露主机名和 pid。authz 基线 84 / 117，矩阵 1030 项全绿。
- 任务工作区：任务进行中且 Worker 不在运行时，显示「后台执行服务没在运行，这项工作暂时不会推进；恢复后会从断点继续」。
- 定时抽屉：有启用的定时且 Worker 不在运行时，显示同样的提示。

## 测试

- `tests/kern-worker-supervision.test.ts`（纳入 test:regression-units）：
  - WS1 退避
  - WS2 退出决策
  - WS3 健康判定
  - WS4 重复启动：活进程且心跳新鲜时拒绝；心跳陈旧或进程已死时接管
- `npm run test:kern-worker-recovery`（真实数据库）：
  - WR1 崩溃后重新排队，重复扫描保持幂等
  - WR2 持有者活着时不动，失联后才接管
  - WR3 次数用完标记 FAILED，任务根不受影响
  - WR4 恢复后任务得出结果
  - WR5 心跳在退出时被标记为停止
- 实机冒烟（Windows，2026-09-28）：
  - 守护进程启动后，第二个 worker 以退出码 75 退出；
  - taskkill /F 杀掉 worker 后，1s 内自动重启并换了新 pid；
  - taskkill /T 结束守护进程时，子进程一并退出。
