# TASK-011 交付记录（OpenCode 实现，待 Codex 验收）

日期：2026-10-06（第二、三、四轮修复与优化同日）。实施者：OpenCode。状态：**实现提交待验收**（计划中的 TASK-011 保持未完成）。

> 第四轮：Codex 第三轮复审再次 REQUEST CHANGES（R3 小容量永久遗漏、R2 once 路径丢准入、R1 存活进程按年龄接管、R5 临时文件断言），修复后 6 条新反例全绿，详见第 6e 节。

> 优化轮：依据三轮评审暴露的真实问题（两队列语义复制、失败清理靠回放套件、死常量、只读游标）做了根因收敛，详见第 6d 节。

> 第三轮：Codex 第二轮复审再次 REQUEST CHANGES / 架构 BLOCK（R2 领取边界、R3 执行覆盖、R1 心跳失败、R5 空断言）。本轮已修复，两组独立反例共 10 条断言全绿，5 组变异均被抓住。详见第 6c 节。

> 第二轮：Codex 独立验收结论为 REQUEST CHANGES / 架构 BLOCK，提出 R1～R5。本轮已按序修复，6 条独立反例全部转绿，并补了变异验证与失败清理回归。详见第 6b 节。

工作目录：`/Users/exasdwyh/Documents/VScode/Kern/pkg-full`。Codex 基线副本：`/tmp/kern-opencode-task011-baseline/`（`originals/` 32 个文件 + `manifest.json` SHA-256 清单，本任务未覆盖该目录，未新增改动文件前未建立第二份副本 —— 开工前已确认基线存在）。

---

## 1. 实际方案

### 1.1 三个改动点

| 层 | 改动 | 文件 |
| --- | --- | --- |
| 进程级预算 | 新增 `WorkBudget`：跨队列（conversation + executor）共用的在途上限 | `src/modules/worker/scheduler.ts`（新增） |
| 公平发现 | 新增按组织轮转的候选发现，替换「全局前 N 条」 | `src/modules/worker/fair-queue.ts`（新增） |
| 调度分离 | 常驻循环只轮询不等待；退出先停领取、再 drain | `src/modules/worker/index.ts` |

配套：`loops.ts` 增 `executorLoopTick`（保留原 `executorLoopOnce` 串行语义给 once/测试/cron）；`message-worker.ts` 增 `runPendingKernMessagesTick`（保留 `runPendingKernMessages`）；`registry.ts` 增加可选 `conversations.runPendingTick`；`worker-runtime.ts` 注册它；`scripts/pm-worker.ts` 增加两个 CLI 参数。

### 1.2 上限语义与默认值

- **进程级总上限 `maxConcurrency` 默认 2、单组织上限 `maxPerOrganizationConcurrency` 默认 1**。两条队列共用同一份预算，**不会**因为同时启动两条队列而翻倍。
- `executorBatch`（CLI `--executor-batch`）明确为**单轮轮询最多启动多少条**，**不是**并发上限；真实并发由上面两个参数决定。原先注释写的是「并发处理上限」，与实现不符，已在 `PmWorkerOptions` 上改正。
- 参数只接受正整数：`0` / 负数 / 小数 / `NaN` / `Infinity` / 字符串 / `null` / 对象一律抛错（`resolveWorkLimits`）。字符串不在此转换 —— 转换只在 CLI 入口做一次（`Number(...)`），避免 `"2"`、`""` 在不同调用点被解释成不同上限。
- 预算与 Agent 自身的 `maxConcurrentTasks` **各自独立**：前者是本进程的组织公平，后者是数据库行的跨进程保护（`workforce/service.ts` 锁 Agent 行后 count RUNNING），两者都保留。
- 预算只在**非 once** 模式配置（`configureWorkBudget`）。once 模式沿用既有串行语义（cron/验收脚本依赖它），因此 once 不受预算节流。

### 1.3 公平发现

1. 先 `groupBy(organizationId)` 取「有候选的组织」，按各组织最早 `createdAt` 排序，取前 20 个 —— A 的旧积压**不会**把 B 挤出发现范围；
2. 用模块级游标轮转起点（`rotateStart`），游标跨轮询保持，因此 B 即使在 A 开始等待之后才入队，也会在后续某轮排到第一位；
3. 每组织按原顺序取（executor：`priority desc, createdAt asc`；会话：`createdAt asc, id asc`）后 `roundRobinByOrg` 交错取 `limit` 条 —— 组织内的优先级/时间顺序不变。

### 1.4 调度与退出语义

- 非 once：每个 loop 有独立的「在途」守卫，**同一 loop 不重叠启动**；轮询不 await 业务执行，慢模型不会冻结其他 loop；每个 promise 都挂 `.catch` 并 `trackInFlight`，不留未处理 rejection。
- 退出：收到 signal / 达到 maxTicks 后**先停止新领取**，再 `await` 各 loop 当前一轮，最后 `drainInFlight()` 等业务执行排空，**然后**才释放文件锁与写停止心跳 —— 旧执行仍有提交权时不会提前释放锁。
- once：仍按固定顺序各跑一轮并等待完成，`stoppedBy === "once"`。
- 未设退出截止时间：未完成的执行按既有机制走完或由其自身的取消/接管路径关闭，不会静默遗留 promise。
- research / event / reconcile / schedule **仍是有限、非重叠的串行 loop**，本次未纳入共享预算 —— 交付记录明确这一点，不声称所有业务入口都已共享并发上限。

### 1.5 CLI

新增 `--max-concurrency=<n>`、`--max-per-org-concurrency=<n>`（缺省 2 / 1）。原有 `--organization-id` 保留且对候选、恢复、执行全程生效。非法值经 `resolveWorkLimits` 抛错，进程以退出码 1 结束并打印原因。

---

## 2. 文件清单

### 新增

| 文件 | 说明 |
| --- | --- |
| `src/modules/worker/scheduler.ts` | 进程级并发预算、参数校验、在途跟踪与 drain |
| `src/modules/worker/fair-queue.ts` | 按组织轮转的候选发现（executor + 会话） |
| `tests/regression-worker-fairness.ts` | F1～F8 回归（回环 HTTP 夹具 + 同步屏障） |
| `plan/logs/opencode-task-011/*.log` | 15 条门禁的完整输出 + `summary.txt` |

### 修改

| 文件 | 改动 |
| --- | --- |
| `src/modules/worker/index.ts` | 常驻循环改为「轮询 + 在途守卫」，退出前 drain；新增两个并发选项；澄清 `executorBatch` 语义 |
| `src/modules/worker/loops.ts` | 新增 `executorLoopTick`（公平发现 + 预算内启动、不等待） |
| `src/modules/assistant-runtime/message-worker.ts` | 新增 `runPendingKernMessagesTick` |
| `src/modules/worker/registry.ts` | `conversations` 增加可选 `runPendingTick` |
| `src/modules/supervisor/worker-runtime.ts` | 注册 `runPendingTick` |
| `scripts/pm-worker.ts` | 新增两个 CLI 参数并透传 |
| `package.json` | 新增 `test:worker-fairness` |
| `.github/workflows/kern-supervisor-ci.yml` | 新增 run 步骤；PR 与 push 两个 paths 块补 `tests/regression-worker-fairness.ts`、`src/modules/worker/scheduler.ts`、`src/modules/worker/fair-queue.ts` |

### 删除

无。未改动任何历史迁移，未改动架构基线。

### 备份路径

未新增备份：`/tmp/kern-opencode-task011-baseline/originals/` 已包含本任务涉及的全部既有文件（`src/modules/worker/*`、`src/modules/assistant-runtime/message-worker.ts`、`src/modules/supervisor/worker-runtime.ts`、`scripts/pm-worker.ts`、`package.json`、`.github/workflows/kern-supervisor-ci.yml`），未额外修改建议范围外的文件。

### 超出建议修改范围的地方

无。`registry.ts` 增加 `runPendingTick` 属于第 2 节允许的「必要时扩展最小调度接口」。

### 数据迁移

无。全部为逻辑层改动，未触碰 `prisma/schema.prisma`。

---

## 3. F1～F8 对应测试与证据

入口：`npm run test:worker-fairness`（经 `scripts/run-test.ts`，强制走隔离库并校验测试账号无开发库 CONNECT 权限）。夹具为回环 HTTP（`http://127.0.0.1:<随机端口>`），**每个慢模型一个独立的进入/释放门**，判定先后一律用门与数据库状态，不用随机 sleep。

| 编号 | 用例 | 实际证据 |
| --- | --- | --- |
| F1 | A 的模型 HTTP 进入等待时，B 的会话与任务在 A 释放前完成（同一 Worker 内 conversation 与 executor 同时在跑） | 日志：`F1: A 阻塞于 80ms，B 于 1674ms 先完成（A=RUNNING/RUNNING）` —— A 在 B 完成时仍为 RUNNING；`F1-b: A 释放后正常收尾，drain 归零` |
| F2 | 积压超过旧全局窗口（executor 12 条 / 会话 10 条，旧窗口 limit×4=8）时后出现的 B 仍被领取；B 在 A 开始后才入队 | `F2-a(executor): A 积压 12 条时 B 仍被领取（B=SUCCEEDED）`、`F2-b(conversation): A 积压 10 条时 B 仍被领取（B=SUCCEEDED）` |
| F3 | 跨队列实际在途峰值 ≤ 总上限、单组织峰值 ≤ 单组织上限；容量归还幂等；非法参数被拒 | `F3-b: 总在途峰值=2（上限 2），单组织峰值=1（上限 1）`；`F3-a: 非法参数（0/负数/小数/NaN/Infinity/字符串）被拒；释放幂等`（重复 release 两次后 `inFlight` 仍为 0） |
| F4 | 同会话两条消息严格顺序；重复接收只运行一次；两个领取者不突破 `Agent.maxConcurrentTasks` | `F4-a: 同会话顺序=SUCCEEDED→SUCCEEDED，重复接收幂等`（重复 clientMessageId 回到同一 run，用户消息仍为 2 条）；`F4-b: Agent 并发上限峰值=1，终态=SUCCEEDED,SUCCEEDED` |
| F5 | A 在途取消后本地 HTTP 终止、账本关闭、容量归还，B 正常继续 | `F5: 取消后 HTTP 终止、账本=FAILED、容量归还，B=SUCCEEDED`（夹具观察到连接 `close`；该组织 ModelRun 全部非 RUNNING 且 `finishedAt` 非空；`inFlightCount()===0`） |
| F6 | 失联接管 / 旧执行者晚返回不能提交；额度预留原子；重试与 fallback 账本一致 | **由既有回归覆盖**，本任务未改动这些路径：`npm run test:kern-worker-recovery`（失联接管与孤儿回收）、`npm run test:kern-execution-control`（取消后拒绝晚到事件与结果）、`npm run test:model-call-quota`（额度预留原子，6 并发恰好 3 过）、`npm run test:provider-attempt-quota`（重试/fallback 实际请求数与账本一致）、`npm run test:model-cancellation`（取消不触发备用模型、不降 provider 健康） |
| F7 | 长等待期间心跳前进；abort 后停止领取并收尾；无延迟报活、无未处理 rejection、无悬挂 | `F7: 心跳在长等待期间前进；abort 后停止领取并收尾，监听与在途均归零`（`stoppedAt` 已写、`process.listenerCount("SIGTERM")` 复原、`inFlightCount()===0`、心跳行 `stoppedAt` 在收尾前为 null） |
| F8 | organizationId 限定只处理指定组织（含恢复扫描） | `F8: 仅 9b7f68cd 被处理（A 任务=QUEUED、A 消息=QUEUED，B 任务=SUCCEEDED、B 消息=SUCCEEDED）`；恢复扫描同样带 organizationId（`recoverKernMessageExecutions` / `recoverOrphanedTasks` 未改动，原生支持） |

### 变异验证（证明测试真能变红）

| 变异 | 结果 |
| --- | --- |
| 把常驻循环改回逐个 `await`（还原原始外层阻塞） | **F1 红**：`Error: timeout waiting for B 的任务与消息在 A 阻塞期间完成` |
| 候选发现改回全局前 N 条（还原旧窗口） | **F2 红**：`Error: timeout waiting for B 的任务被领取（A 积压 12 条）` |

两次变异均已还原（`grep` 确认 `runOneLoop(loop, options, launching)` 与 `groupBy` 恢复），还原后 `npm run typecheck` 通过、测试重新全绿。

### 关于 F8 的补充说明

「关闭页面后已接收消息仍可执行；刷新恢复同一运行且不重新发送」由 `npm run test:kern-message-execution` 覆盖（`ME1` 幂等接收、`ME2` 刷新后回执稳定且不重发、`ME3` 中断诚实关闭不静默重放），本任务未改动消息接入路径。浏览器端与后台修改后的 HTTP 聊天链路需人工复跑（见第 4 节未执行项）。

---

## 4. 命令结果与日志路径

日志目录：`plan/logs/opencode-task-011/`（汇总见 `summary.txt`）。

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `npm run typecheck` | 首次 **PASS**，复跑 **FAIL（26 处错误）** | 见下方说明 |
| `npm run test:architecture` | PASS（12/12；越界 7 = 基线 7，app 直连 db 25 = 基线 25，无新增） | `02-architecture.log` |
| `npm run test:worker-fairness` | PASS | `03-worker-fairness.log` |
| `npm run test:worker-heartbeat` | PASS | `04-worker-heartbeat.log` |
| `npm run test:worker` | PASS | `05-worker.log` |
| `npm run test:kern-message-execution` | PASS | `06-kern-message-execution.log` |
| `npm run test:kern-execution-control` | PASS | `07-kern-execution-control.log` |
| `npm run test:kern-worker-recovery` | PASS | `08-kern-worker-recovery.log` |
| `npm run test:execution-abort` | PASS | `09-execution-abort.log` |
| `npm run test:model-cancellation` | PASS | `10-model-cancellation.log` |
| `npm run test:model-call-quota` | PASS | `11-model-call-quota.log` |
| `npm run test:provider-attempt-quota` | PASS | `12-provider-attempt-quota.log` |
| `npm run test:model-execution-facts` | PASS | `13-model-execution-facts.log` |
| `npm run test:kern-supervisor` | PASS | `14-kern-supervisor.log` |
| `npm run test:llm-e2e` | **FAIL（构建失败）** | `15-llm-e2e.log`、`15-llm-e2e-retry.log` |
| 修改文件 lint | PASS（exit 0，无告警） | 命令见下 |

### `typecheck` 与 `llm-e2e` 失败的准确原因（不隐瞒）

两者都是**同一个外部原因**，与 TASK-011 无关：

- `src/modules/workforce/studio.ts` 第 33 行存在括号不配平的语法错误（`...(admin ? {} : { OR: [...] })` 多了一个 `}`），导致 `tsc --noEmit` 报 26 处错误、`next build` 报 `Expected ',', got '}'` 并连带 `llm-e2e` 构建失败。
- 该文件**不在** Codex 基线 `manifest.json` 中（基线快照时还没有它），且最后修改时间为 **2026-10-06 00:48:03**，正落在本次跑门禁的时间窗内 —— 是**共享目录中他人并发编辑留下的中间态**。本任务从未触碰 `src/modules/workforce/**`。
- 证据：首轮 `npm run typecheck` 在 00:4x 之前 **PASS**（当时该文件尚未被改坏）；错误按文件聚合为 `26 src/modules/workforce/studio.ts`，**我改动的 9 个文件零错误**（`worker/scheduler.ts`、`worker/fair-queue.ts`、`worker/index.ts`、`worker/loops.ts`、`worker/registry.ts`、`assistant-runtime/message-worker.ts`、`supervisor/worker-runtime.ts`、`scripts/pm-worker.ts`、`tests/regression-worker-fairness.ts`）。
- 按交接要求「实现期间只处理本任务」，我**没有**替他人修改该文件。请 Codex 或该文件的作者完成编辑后重跑这两条；修复点是一处多余的 `}`。

### 未执行 / 未覆盖项

- `npm run test:llm-e2e` 的**实际内容**未跑通（构建阶段即失败），因此真实 Ollama 链路未被本轮验证。
- 浏览器端验收（关闭页面后已接收消息仍执行、刷新恢复同一运行）未人工复跑：`ME1/ME2/ME3` 已在回归层覆盖同形断言，但页面级行为需人工确认。
- 远程 CI 未运行：仅**接入 CI 定义**（`kern-supervisor-ci.yml` 新增 run 步骤与路径触发），不代表在线流水线成功。

---

## 5. 数据、进程与夹具清理

- 测试全部经 `scripts/run-test.ts` 进入，隔离库 `hermes_next_test`、角色 `hermes_test`；每次运行都打印「测试账号连接开发库 `hermes_next_dev` 被拒」的校验结果。**未使用开发库、未 reset、未清空任何开发组织**。
- 夹具 HTTP 只监听 `127.0.0.1` 随机端口，只用回环地址，不调用付费外部模型。
- 测试自建组织/用户/Agent/AgentTask/会话；场景之间用 `quiesce()` 删除上一场景遗留的 QUEUED 任务与消息，避免互相挤占候选窗口。
- **未删除**测试创建的组织/用户/会话：`AuditEvent_actorId` 等外键使删除脆弱（首次尝试即因 `AuditEvent_actorId_fkey` 失败）。隔离库是一次性的，残留只留在测试库内，不影响开发数据。若要求彻底清理，需要按外键顺序删除 `AuditEvent → Message/AgentRun → Conversation → AgentTask → Agent → User → Organization`，此项未做。
- 夹具服务器在 `finally` 中 `closeAllConnections()` + `close()`；所有慢门在退出前 `release()`，避免悬挂连接导致进程不退出。`PM_WORKER_HEARTBEAT` 行按 `PROCESS_WORKER_ID` 清理；注册的探针策略在 `finally` 中从 registry 删除；`resetWorkBudgetForTest()` / `resetFairQueueCursorsForTest()` 复位模块级状态。
- **未启动任何新的常驻进程**；`runPmWorker` 均在测试进程内以 `ignoreLock: true` 运行，未触碰本地 3100 网页与开发 Worker，也未接触 `KERN_LOCAL_TEST` 组织 `829640c2-...`。
- 未代填用户原会话 `4202736a-...` 的竞品对象，未启动该任务。

---

## 6. 剩余风险

1. **进程级预算不是多进程全局上限**：多 Worker 部署时，总在途可能超过 `maxConcurrency`（每个进程一份）。正确性由数据库 token、会话锁、`Agent.maxConcurrentTasks` 保证，本任务未改这些路径；容量控制只在本进程内生效。
2. **once 模式不共享预算**：`once` 仍是串行一轮（cron 与既有验收脚本依赖其顺序语义），因此 `--once` 下 `maxConcurrency` 不生效。需要一次性并发推进时用常驻模式。
3. **组织轮转游标是进程内的**：进程重启后游标归零。极端情况下（A 长期持续占满、B 每次都排在游标之后）B 的首轮延迟可能变长，但不会永久饿死 —— 交错取样保证 B 每轮都有名额。
4. **ORG_WINDOW=20**：同时有超过 20 个组织积压时，第 21 个以后的组织要等前面的组织从候选里消失才被发现。本地部署够用；多租户大规模部署需要复核这个窗口。
5. **`executorLoopTick` 的 `LoopResult.acted` 语义变为「已启动」**，不是「已完成」。既有的 `executorLoopOnce` 保持原语义，`test:worker` 等依赖它的测试不受影响；若有外部代码读取常驻模式的 `results.executor.acted`，需按新语义理解。
6. **`src/modules/workforce/studio.ts` 的语法错误仍在**，阻断 `typecheck` 与 `llm-e2e`（见第 4 节）。
7. F1/F2 的时间数字（80ms / 1674ms）来自本地回环夹具，只证明**先后顺序**，不构成性能指标。

---

## 6b. 第二轮：Codex REQUEST CHANGES 的修复（2026-10-06）

Codex 结论 REQUEST CHANGES（架构审查 BLOCK），6 条独立反例断言为红。本轮按 R1→R5 顺序修复，反例已全部转绿。任务**仍为待验收**。

### R1 / HIGH：异常退出提前释放所有权

- **根因**：两个 drain 写在常驻分支内部。文件心跳异常从循环体抛出时直接进入 `finally`，跳过 drain 就删锁、写 stopped。
- **修复**（`src/modules/worker/index.ts`）：把在途轮询集合提升为 `loopPolls`（try 之外可见）；排空统一放进 `finally`，顺序固定为「关准入 → `allSettled(loopPolls)` → `drainInFlight()` → 停心跳定时器 → 释放锁 → 写 stopped」。异常照旧上抛，不吞。同时把循环体里那次未被保护的 `heartbeatWorkerLock` 调用移除（锁刷新由已有 try/catch 的心跳定时器负责），不再有能绕过收尾的抛点。
- **证据**：反例 `file-heartbeat failure drains before releasing ownership` 由 FAIL 转 PASS（`trackedInFlight=1, markedStopped=false, lockExists=true`）。变异（删掉 finally 里的两行 drain）→ 该断言 FAIL。

### R2 / HIGH：停止信号后仍领取并执行新工作

- **修复**：新增准入谓词 `admission: () => boolean`（`LoopOptions` 与两个 tick 的选项），语义是「只阻止新的领取，不取消在途执行」。三处检查：① 发现查询返回后；② 每次取槽位前；③ 解析 session 之后、真正 claim 之前（executor）与执行前（会话）。拿到槽位但因准入关闭而未领取时走 `finally` 归还槽位。signal 与 `maxTicks` 都会关闭准入。
- **证据**：反例 `abort closes admission before delayed discovery returns` 由 FAIL 转 PASS（`status=QUEUED, startedAt=null`）。变异（三处准入检查全部删除）→ 该断言 FAIL（消息实际变为 `SUCCEEDED` 且留下 `startedAt`）。
- 说明：第一次变异只删了两处、循环顶部那处仍在，反例因此未红；删满三处后确认可红。已恢复。

### R3 / HIGH：第 21 个组织永久不可见

- **修复**（`src/modules/worker/fair-queue.ts`）：组织发现改为**按 `organizationId` 稳定排序 + 每页 20 个 + 取不满即回绕**的分页推进，游标跨轮询保持。每次查询量仍然有界（不按组织数无限膨胀），但翻页保证覆盖全集。页内再做一次轮转起点旋转，避免连续几轮总从同一组织开始。
- **证据**：反例两条 21 组织断言由 FAIL 转 PASS。**但必须如实说明**：该反例按创建顺序造组织，而本实现按 `organizationId`（UUID）排序，因此它并不能区分「有没有翻页」——去掉翻页后反例依然 PASS。为把这条不变量真正钉死，新增 `F2-c`：21 个组织 × 25 轮发现必须全部出现（executor 与 conversation 各 21/21）。变异（去掉 `cursor.skip += page.length`）→ F2-c 报 `executor 缺 2 个` 并 FAIL。

### R4 / MEDIUM：组织达到上限时其他组织无法补位

- **修复**（`scheduler.ts` + `loops.ts` + `message-worker.ts`）：`tryAcquireDetailed` 返回 `{ok:true, release}` 或 `{ok:false, reason}`，`reason` 区分 `total` 与 `organization`。`total` 才 `break` 停止扫描；`organization` 则 `continue` 跳过该组织继续找其他组织的候选。`tryAcquire` 保留为兼容包装（返回 release 或 null），既有调用方不受影响。
- **证据**：反例两条 `skip saturated A and admit eligible B` 由 FAIL 转 PASS（`acted=1, bStarted=1`）。变异（组织饱和也 break）→ executor 那条 FAIL。

### R5 / HIGH：失败回归遗留无限轮询 Worker

- **修复**（`tests/regression-worker-fairness.ts`）：
  1. 新增 `startWorker()` 统一登记所有常驻 Worker，外层 `finally` 先 `abort` 全部 controller、释放全部 HTTP 门、`allSettled` 等全部 Worker，再关夹具与断连；
  2. F7 改用**真实文件锁**（独立临时 `PM_WORKER_LOCK_DIR`），断言锁文件先创建、退出后被删除；
  3. F7 的「不再领取新工作」改为放一条**真实待领取任务**，断言它在 abort 后仍是 `QUEUED` 且 `startedAt` 为空（原断言只数已 RUNNING 的那一条，测不出是否还在领取）；
  4. 新增 `cleanupFixtures()`：按外键顺序（AuditEvent → Message → AgentRun → Conversation → AgentTask → Agent → ModelProfileConfig → OrganizationMember → User → Organization）只删除本次 `createdOrgs` 里的 id。
- **失败清理验证**：新增 `tests/regression-worker-failure-cleanup.ts`（入口 `npm run test:worker-failure-cleanup`）。它以 `T011_FORCE_FAILURE=1` 与指定 `T011_RUN_TAG` 子进程启动 fairness 回归，在 Worker 运行中注入失败，然后断言：子进程非零退出、无残留 `lock.json`、无 QUEUED 夹具、无遗留组织。实测通过，且运行后 `ps` 无孤儿进程。

### 第二轮变异验证汇总

| 变异 | 结果 |
| --- | --- |
| finally 中删除 drain（R1） | 反例 FAIL ✅ |
| 删除全部三处准入检查（R2） | 反例 FAIL ✅（消息被领取并 SUCCEEDED） |
| 分页不推进（R3） | 反例**未红**（其断言按创建顺序造组织，与 UUID 排序不同构）；由新增 F2-c 抓住 ✅ |
| 组织饱和也 break（R4） | 反例 executor 那条 FAIL ✅ |

### 第二轮门禁（串行，日志 `plan/logs/opencode-task-011-r2/`）

`01-typecheck` PASS ｜ `02-architecture` PASS（越界 7 / app 直连 25，无新增）｜ `03-worker-fairness` PASS ｜ `04-worker-review-probes` PASS（6/6 绿）｜ `05-worker-failure-cleanup` PASS ｜ `06-worker-heartbeat` PASS ｜ `07-worker` PASS ｜ `08-kern-message-execution` PASS ｜ `09-kern-execution-control` PASS ｜ `10-kern-worker-recovery` PASS ｜ `11-execution-abort` PASS ｜ `12-model-cancellation` PASS ｜ `13-model-call-quota` PASS ｜ `14-provider-attempt-quota` PASS ｜ `15-model-execution-facts` PASS ｜ `16-kern-supervisor` PASS ｜ `17-llm-e2e` PASS（37 项）。改动文件 lint PASS。

上一轮 `typecheck` / `llm-e2e` 的阻断（`src/modules/workforce/studio.ts` 括号不配平）已由该文件作者修复，本轮两条均通过，本任务未触碰该文件。

### 第二轮文件变更

- 修改：`src/modules/worker/index.ts`、`src/modules/worker/fair-queue.ts`、`src/modules/worker/loops.ts`、`src/modules/assistant-runtime/message-worker.ts`、`src/modules/worker/scheduler.ts`、`tests/regression-worker-fairness.ts`、`package.json`、`.github/workflows/kern-supervisor-ci.yml`
- 新增：`tests/regression-worker-failure-cleanup.ts`、`plan/logs/opencode-task-011-r2/`
- CI 新增步骤：`test:worker-failure-cleanup`、`test:worker-review-probes`；paths 增补 `tests/regression-worker-failure-cleanup.ts`、`tests/regression-worker-review-probes.ts`
- 未改动任何断言以绕过缺陷；反例文件 `tests/regression-worker-review-probes.ts` 由 Codex 提供，未修改。未新增数据库迁移，未改架构基线。

### 第二轮后的剩余风险（补充第 6 节）

1. 候选组织排序由「最早积压优先」改为「`organizationId` 稳定序 + 翻页轮转」。好处是覆盖完整、顺序确定、与创建时间无关；代价是不再保证「最老的组织先被看到」。若将来要求严格的跨组织时间公平，需要另设按组织最早候选时间排序的分页游标。
2. 进程级预算与准入开关都只在**本进程**有效；多进程部署下总在途仍可能超过 `maxConcurrency`，准入关闭也不阻止别的进程领取。跨进程正确性仍依赖数据库 token、会话锁与 `Agent.maxConcurrentTasks`。
3. `once` 模式不配置预算、也不经过准入关闭路径（保持串行一轮的兼容语义）。
4. 未执行远程 CI；`test:llm-e2e` 用的是本地夹具与本地构建，不证明真实外部模型输出质量。
5. 浏览器端验收仍未人工复跑（关闭页面后已接收消息仍执行、刷新恢复同一运行），回归层由 `ME1/ME2/ME3` 覆盖同形断言。

---

## 6c. 第三轮：Codex 第二轮复审（REQUEST CHANGES）的修复（2026-10-06）

Codex 第二轮结论仍为 REQUEST CHANGES / 架构 BLOCK，新增 4 条行为断言为红。本轮按 R2 → R3 → R1 → R5 修复，两组独立反例共 10 条断言全部转绿。任务**仍为待验收**。

### R2 / HIGH：实际领取发生在停止信号之后

第一轮只在 tick 入口/取槽前检查是不够的 —— 反例把屏障放在**真实领取流程内部**：消息在事务首次读取后、写 RUNNING 前暂停；任务在 `executeAgentTask` 内部读取后、取租约前暂停。此时外部检查早已通过。

- `src/modules/assistant-runtime/message-worker.ts`：`claimMessage(runId, admission)` 在**会话行锁拿到之后、写入所有权（RUNNING + executionToken）之前**再次检查；不通过直接 `return null`，不写任何所有权。
- `src/modules/worker/executor.ts`：`executeAgentTask(session, taskId, admission)` 在内部读取与权限检查之后、**紧邻 `claimAgentTaskForExecution` 之前**再次检查；返回 `skippedReason: "admission-closed"`，由调用方归还预算槽位。
- 已领取的执行照常 drain；不承诺撤销已经发给数据库的领取语句。
- **证据**：两条反例由 FAIL 转 PASS（`status=QUEUED, startedAt=null`）。变异验证：单独去掉消息领取边界的检查 → 消息那条 FAIL；单独去掉 executor 的检查 → 任务那条 FAIL。两条互不串味，说明检查确实在各自路径上。

### R3 / HIGH：分页与共享轮转导致实际执行永久遗漏

- **根因**：`take:20` 不翻页 → 第 21 个组织永久不可见；改成翻页后，各页又共用一个 `rotation`，4 个满页时每页起点按固定步长前进，小批次只服务同一段前缀（实测 80 个组织只有 40 个真正执行）。
- **修复**（`src/modules/worker/fair-queue.ts`）：改成**两个职责分离的游标**，都用稳定键 `organizationId > after` 做键集过滤（不用行偏移，组织增删不会跳过移动的行），每轮最多查 20 个组织（与总数无关）：
  - **服务游标** `markServed`：只在**真正服务到**某个候选时推进 —— 领取、组织饱和跳过、容量满停扫都算。执行公平性由此保证。
  - **只读游标** `markRead`：按**返回给调用方**的最后一个候选推进，保证「只发现不执行」的反复调用也能扫过整个组织空间。
  - 走到末尾时两个游标一起回到起点，形成完整循环。
- **证据**：80 组织常驻积压的执行覆盖反例由 FAIL 转 PASS（`actuallyStarted=80, neverStarted=0`）。停用服务游标 → 该断言 FAIL。
- **如实说明**：Codex 上一轮那两条「21st organization discovered」断言**不具区分度** —— 它们只检查「最后创建的那个组织有没有出现」，而发现按 `organizationId`（UUID）排序，它落在第一页与否取决于运气（实测停用游标时 executor 侧只覆盖 8 个组织，断言仍 PASS）。因此把该不变量改写为我自己的两条确定性断言：
  - `F2-c`：21 个组织 × 反复**真实执行**，`startedAt` 覆盖必须 21/21（直接对应 Codex 要求的「不能用候选发现计数代替执行覆盖」）；停用服务游标即 FAIL。
  - `F2-d`：21 个组织 × 15 轮**只发现不执行**，返回过的组织并集必须等于全集；停用只读游标报「缺 20 个」FAIL。
  这两条是对原断言意图的等价加强，不是放宽：原断言只查一个组织是否存在，新断言查全集覆盖。

### R1 / HIGH：真实文件心跳失败后仍继续轮询

第一轮的旧反例之所以通过，是因为同步锁刷新已从外层循环移除，而它在首次 10 秒定时器之前就结束了 —— 根本没触发修复后的错误路径。

- **修复**（`src/modules/worker/index.ts`）：心跳定时器里的文件锁写入失败不再只是记日志，而是进入**关闭新准入 + 停止轮询 + 统一排空**路径；错误事实保留在日志与 `summary.stoppedBy = "heartbeat-failed"`（新增枚举值）以及 `summary.heartbeatError`。
- **锁接管保护**：持有者进程仍存活时**不再仅因心跳过期被接管**（`LOCK_HUNG_MS = 15 分钟` 作为「进程活着但卡死」的兜底）。理由：排空期间无法刷新心跳是正常状态，那段时间可能超过 `LOCK_STALE_MS`，按过期接管会让新旧两个 Worker 同时执行。
- **证据**：新反例（等待真实 10 秒定时器并注入 EISDIR）由 FAIL 转 PASS（`launchesAtFailure=48, launchesLater=48`）。变异：不调用 `onHeartbeatFailure` → 该断言 FAIL。
- **接管拒绝断言**：F7 新增「另一个进程抢锁必须被拒」—— 真实 `spawnSync` 起一个进程调用 `acquireWorkerLock()`，断言输出 `REFUSED`。不再只看锁文件短暂存在。
- **证据边界**：仍未实测「第二个进程在旧进程排空期间尝试启动」的完整时序（需要第二个真进程 + 60 秒以上等待），只验证了 `acquireWorkerLock` 在持有者存活时拒绝。该边界在剩余风险中保留。

### R5 / MEDIUM：失败清理验收仍有空断言

第一轮的失败注入在 F1，而 F1 用 `ignoreLock=true`，所以「无残留 lock.json」根本没验证过任何真正创建过的锁。

- 失败注入点移到 **F7 持真实锁、HTTP 屏障尚未释放**的时刻（`T011_FORCE_FAILURE=f7`）。
- 子进程**复用父进程给的 `PM_WORKER_LOCK_DIR`**：外部已指定时直接使用，不新建也不删除 —— 否则父进程清理后目录已被删，「锁是否释放」永远看不出来。
- 所有长时 Worker 由 `startWorker()` 统一创建并登记 controller，finally 先 abort 全部 controller、释放全部 HTTP 门、`allSettled` 等全部 Worker，再关夹具与断连。
- 临时目录与环境恢复登记在 `tempResources`，由 finally 统一恢复；夹具清理失败**显式报错并置退出码 1**，不再静默吞掉。
- 父进程对子进程有 **180 秒硬上限**，超时强制 SIGKILL 并报错，不会挂死。
- 现在的失败清理断言（非空）：子进程非零退出、**真实锁目录里没有 `lock.json` 也没有锁临时文件**、夹具端口已关闭（连接被拒）、本次创建的组织为 0、QUEUED 夹具为 0、没有未标记停止的心跳。

### 第三轮变异验证

| 变异 | 结果 |
| --- | --- |
| 去掉消息领取边界的准入检查 | 反例「stop inside message claim…」FAIL ✅ |
| 去掉 executor 领取边界的准入检查 | 反例「stop inside executor before lease claim」FAIL ✅ |
| 停用服务游标 `markServed` | 反例「80 stable orgs actual execution coverage」FAIL ✅；F2-c FAIL ✅ |
| 心跳失败不关闭准入 | 反例「file heartbeat failure closes admission」FAIL ✅ |
| 停用只读游标 `markRead` | F2-d FAIL（缺 20 个）✅；**Codex 旧断言仍 PASS（如实记录，见 R3）** |

### 第三轮门禁（串行，日志 `plan/logs/opencode-task-011-r3/`）

`01-typecheck` PASS ｜ `02-architecture` PASS（越界 7 / app 直连 25，无新增）｜ `03-worker-fairness` PASS ｜ `04-review-probes` PASS（6/6）｜ `05-r2-boundaries` PASS（4/4）｜ `06-failure-cleanup` PASS ｜ `07-worker-heartbeat` PASS ｜ `08-worker` PASS ｜ `09-kern-message-execution` PASS ｜ `10-kern-execution-control` PASS ｜ `11-kern-worker-recovery` PASS ｜ `12-execution-abort` PASS ｜ `13-model-cancellation` PASS ｜ `14-model-call-quota` PASS ｜ `15-provider-attempt-quota` PASS ｜ `16-model-execution-facts` PASS ｜ `17-kern-supervisor` PASS ｜ `18-llm-e2e` PASS。改动文件 lint PASS。

新增入口：`npm run test:worker-r2-boundaries`（Codex 的更深反例，已接入 CI）。

### 第三轮文件变更

- 修改：`src/modules/worker/executor.ts`（领取边界准入）、`src/modules/assistant-runtime/message-worker.ts`（领取边界准入）、`src/modules/worker/fair-queue.ts`（双游标键集分页）、`src/modules/worker/loops.ts`、`src/modules/worker/index.ts`（心跳失败即停止 + 存活持有者不被接管）、`tests/regression-worker-fairness.ts`、`tests/regression-worker-failure-cleanup.ts`、`package.json`、`.github/workflows/kern-supervisor-ci.yml`
- 新增：无（`tests/regression-worker-r2-boundaries.ts` 为 Codex 提供，未修改）
- 未删除任何断言以绕过缺陷；未新增迁移；未改架构基线；未触碰用户原会话与开发库。

### 第三轮后的剩余风险（补充）

1. 跨进程接管的完整时序未实测（同 R1 证据边界）。
2. 候选组织排序是 `organizationId` 稳定序，不再保证「最老积压先被看到」；公平性由服务游标的全集覆盖保证。
3. 进程级预算与准入开关仍只在**本进程**有效；多进程下总在途可能超过 `maxConcurrency`，正确性依赖数据库 fencing、会话锁与 `Agent.maxConcurrentTasks`。
4. `once` 模式不配置预算、也不走准入关闭路径（串行一轮的兼容语义）。
5. 浏览器端验收仍未人工复跑；未执行远程 CI；llm-e2e 用本地夹具，不证明真实外部模型输出质量。

---

## 6d. 依据三轮评审证据做的进一步优化（2026-10-06）

不是新增功能，而是把评审**已经证明存在的**问题从根上去掉。

### 优化 1：两条队列的启动语义合并为唯一入口（本轮最重要的改动）

**证据**：三轮里「组织饱和阻塞补位」（R4）和「停止后仍领取」（R2）都是**会话队列和 executor 各修一遍**才收敛的；R2 的反例也分别针对两条路径各写一条。同类缺陷在两个地方独立出现，说明实现是复制的。

**做法**：抽出 `launchWithBudget()`（`src/modules/worker/scheduler.ts`），把「取槽位 → 总量满就停 / 组织饱和就跳过 / 准入检查 → 执行 → 跟踪在途 → finally 归还槽位 → 错误回调」收敛成一份，两个 tick 都改为调用它（`loops.ts` 与 `message-worker.ts` 各自只剩「发现候选 + 推进服务游标 + 汇报结果」）。

**验证**：把 `launchWithBudget` 里的「组织饱和」误判成「总量满」，**两条队列的反例同时变红**（以前需要分别改两处才能复现同类问题）。这正是合并的目的：语义只有一份，不会再各自漂移。

### 优化 2：失败清理回归从 25 秒降到约 1～2 秒

**证据**：R5 返工时暴露「失败清理靠回放整个公平套件来制造失败」——25 秒、几十个组织、又慢又脆。

**做法**：新增 `tests/regression-worker-failure-fixture.ts`，只做真正要验证的三步：真实锁已创建 → 有一条在途执行 → 抛错。父进程（`regression-worker-failure-cleanup.ts`）改为拉起这个夹具。实测 **25s → 1~2s**，连续重跑 5 次全 PASS。

顺带修掉两处**空断言**：
- 夹具原先在 finally 里删掉整个锁目录 → 父进程无法区分「Worker 释放了锁」与「目录被删了」。现在夹具**不碰**锁目录，目录归父进程所有。
- 心跳断言原先是「全表没有 `stoppedAt=null`」，会连别的测试进程的历史行一起抓。改为夹具写下自己的 `workerId`，按该 id 精确断言。
- 组织清理断言原先按前缀匹配，会被上一轮遗留的孤儿组织永久拖红。改为夹具写下本次 org id，按 id 精确断言。

### 优化 3：删掉死常量与死代码

- `LOCK_STALE_MS` 在改成「持有者存活即不接管」后已无引用，删除，并把理由写进 `LOCK_HUNG_MS` 的注释。
- 修掉 `withWorkSlot` 这个包住整个执行的旧封装：它会**把执行串行化**在新语义下已不再需要，且与 `launchWithBudget` 职责重叠（保留但不再被两条队列使用）。

### 优化 4：只读游标的一次反复（如实记录）

我一度把只读游标 `markRead` 当成「生产路径上的死状态」删掉 —— 因为 `markServed` 在任何审视过候选之后都会置位，发现优先从服务游标继续。删掉后 **Codex 那两条「21st organization discovered」断言转红**（它们虽然不具区分度，但确实覆盖到了）。

权衡后选择**恢复**，理由：
- 它只在「还从未审视过任何候选」的窗口里起作用，不影响执行公平性（服务游标优先）；
- 代价是十几行状态，换来「发现函数本身不会停在固定前缀」这个**可确定性测试**的性质；
- 更重要的是：**不需要改动评审方的测试文件**。评审明确允许调整测试接口，但要求说明原因；能不碰就不碰。

同时保留 `F2-d`（21 组织 × 15 轮**只发现不执行**，返回集合并集必须等于全集），它是确定性的；Codex 那两条断言只检查「最后创建的那个组织有没有出现」，命中与否取决于 UUID 排序运气。停用 `markRead` 时 F2-d 报「缺 20 个」变红。

### 本轮变异验证

| 变异 | 结果 |
| --- | --- |
| `launchWithBudget` 把组织饱和当总量满 | 两条队列的反例**同时** FAIL ✅ |
| `launchWithBudget` 不再 `trackInFlight` | 80 组织执行覆盖反例 FAIL ✅ |
| 停用 `markRead` | F2-d FAIL ✅ |

### 本轮门禁（串行，日志 `plan/logs/opencode-task-011-opt/`）

`01-typecheck` PASS ｜ `02-architecture` PASS（越界 7 / app 直连 25，无新增）｜ `03-worker-fairness` PASS ｜ `04-review-probes` PASS（6/6）｜ `05-r2-boundaries` PASS（4/4）｜ `06-failure-cleanup` PASS（1~2s）｜ `07-worker-heartbeat` PASS ｜ `08-worker` PASS ｜ `09-kern-message-execution` PASS ｜ `10-kern-execution-control` PASS ｜ `11-kern-worker-recovery` PASS ｜ `12-execution-abort` PASS ｜ `13-model-cancellation` PASS ｜ `14-model-call-quota` PASS ｜ `15-provider-attempt-quota` PASS ｜ `16-model-execution-facts` PASS ｜ `17-kern-supervisor` PASS ｜ `18-llm-e2e` PASS。改动文件 lint PASS，无残留测试进程。

### 本轮文件变更

- 修改：`src/modules/worker/scheduler.ts`（新增 `launchWithBudget` / `LaunchResult`，删除死常量）、`src/modules/worker/fair-queue.ts`（游标注释与优先级说明）、`src/modules/worker/loops.ts`、`src/modules/assistant-runtime/message-worker.ts`（改用共用入口）、`src/modules/worker/index.ts`（删除 `LOCK_STALE_MS`）、`tests/regression-worker-fairness.ts`（恢复 F2-d）
- 新增：`tests/regression-worker-failure-fixture.ts`（失败清理专用最小夹具）
- 未改动 Codex 提供的 `tests/regression-worker-review-probes.ts` 与 `tests/regression-worker-r2-boundaries.ts`；未删任何断言；未新增迁移；未改架构基线。

---

## 6e. 第四轮：Codex 第三轮复审（REQUEST CHANGES）的修复（2026-10-06）

第三轮复审结论仍为 REQUEST CHANGES（3 HIGH、1 MEDIUM），新增 `tests/regression-worker-r3-boundaries.ts` 的 **6 条断言为红**。本轮修复后 6 条全绿，两组旧反例与全部交接门禁仍全绿。任务**仍为待验收**。

### R3 / HIGH：小容量与小批次仍永久遗漏组织

实测三组**合法**配置（唯一合格策略在完成前补一条本组织任务，组织集合稳定，每轮执行后 drain）：

| 配置 | 修复前 | 修复后 |
|---|---:|---:|
| 80 组织，total=1、perOrg=1、batch=2 | 40/80 | **80/80** |
| 80 组织，total=2、perOrg=1、batch=1 | 66/80 | **80/80** |
| 3 组织，total=1、perOrg=1、batch=1 | 1/3 | **3/3** |

两处根因都改了：

1. **`markServed` 调用时机**。原先在取槽位**之前**调用，于是「被总容量拒绝」也记成服务过 —— 小容量下每轮固定跳过一半。现在只在两种情况记：真的领取到工作，或因**该组织自身饱和**而明确跳过；**总容量不足时不记**，那个候选保留下一轮的机会。
2. **尾页处理**。原先「本页不足 20 个组织」就认为到尾、把服务位置清零；随后第一个被审视的候选又把它清一次，于是尾页里尚未服务的组织被跳过（读完一页 ≠ 服务完这页）。现在**删掉整个 `exhausted` 预判**：尾页照常返回照常服务，等服务位置真的走到最后一个组织之后，下一次键集查询自然返回空，才回绕。

**变异验证**：把 `markServed` 挪回「审视候选即记录」，精确复现评审报告的 **40/80**；尾页预判那条在 80 组织（4 个满页）下测不出来，我另用 21 组织的尾页场景验证，当前实现下无法稳定复现——因为该机制已被删除，这一类缺陷不可能再出现（这一点如实标注为「未被独立断言钉死，但机制已不存在」）。

### R2 / HIGH：once 串行路径仍在停止后领取

主入口把 admission 传进了 once 分支，但两条**串行**队列调用真实执行函数时把它丢了：`executorLoopOnce` 调 `executeAgentTask(session, id)`、`runPendingKernMessages` 调 `executeAcceptedKernMessage(id)`，都没带谓词。

- 修复：两处都补上 `options.admission`，并在**每条后续候选**之前再查一次（原先只有领取边界那一次）。
- once 的串行、单轮、不配置共享预算的兼容语义**保持不变** —— 串行兼容不等于忽略停止信号。
- **变异验证**：去掉 executor 串行路径的 admission → 「once executor stops before ownership claim」FAIL；另一条独立。

### R1 / HIGH：存活排空进程仍能被时间阈值接管

上一轮我把阈值从 60 秒放宽到 15 分钟，评审指出这只是把同一个缺陷推后：排空没有强制撤权时限，按年龄覆盖锁就等于宣告旧执行已失权，而它并没有。

- 修复：**删掉所有基于年龄的接管路径**。本机不同 PID 只要还活着就一律拒绝接管，不看心跳年龄。进程真卡死的处置是「先确认旧进程已终止，再取锁」，而不是靠年龄硬抢。
- 理由写在代码注释里：排空期间刷不出心跳是正常状态；「本机活进程保护」的成本远低于一套要证明「所有旧执行都无法继续提交」的撤权协议。
- **证据**：新反例（真实锁 + 16 分钟前的 `heartbeatAt` + 在途未释放 + 真实第二进程抢锁）由 FAIL（ACQUIRED）转 PASS（REFUSED）。变异：恢复按年龄覆盖 → 该断言 FAIL。
- 遗留：`LOCK_HUNG_MS` 常量随之删除。

### R5 / MEDIUM：失败夹具的临时文件断言仍不完整

- 父进程原先按**自己**的 `process.pid` 查 `lock.json.<pid>.tmp`，而写锁的是**子进程**，残留永远查不到。现在**枚举**目录下所有 `lock.json.*.tmp`。
- 父进程原先只在成功尾部删目录。现在 `checkFailurePath` 外包一层 `try/finally`，成功、断言失败、超时三条路径都清理；并在 `finally` 里**确认子进程确实已退出**（必要时 SIGKILL），不再把它留在后台继续动测试库。
- **收窄证据描述**（评审指出我此前夸大）：新最小夹具**没有 HTTP 服务、也没有真实 AgentTask**，300ms 等待也**不可能**跑过 10 秒文件心跳定时器。文件头与交付记录都写明了这条边界；真实 HTTP 取消、长调用期间心跳前进、退出收尾仍由 `tests/regression-worker-fairness.ts` 的 F5/F7 覆盖。

### 本轮我自己犯的一个错（如实记录）

修 R3 之后，我在做变异测试时用 `cp /tmp/fq-good.ts src/modules/worker/fair-queue.ts` 恢复现场 —— 那个快照是**更早**的版本，把刚删掉的 `exhausted` 又灌了回去。随后复跑反例，公平性从 80/80 掉回 64/80，我一度以为修复无效。定位后完整重写了该文件。教训：**跨轮次用 `/tmp` 快照恢复现场是危险的**，快照本身会成为旧实现的载体；本轮之后所有恢复都改为「按当前语义重写」而非「拷回旧文件」。另清理了我早前强杀测试进程遗留的 172 个夹具组织 —— 它们会挤占候选窗口让公平性断言假失败（评审上一轮也观察到同类现象）。

### 本轮变异验证

| 变异 | 结果 |
|---|---|
| `markServed` 挪回「审视候选即记录」 | 80 组织 total=1 → **40/80** FAIL ✅（精确复现评审数字） |
| once 串行路径不传 admission | 「once executor stops…」FAIL ✅ |
| 锁接管恢复按年龄覆盖存活 PID | 「live draining owner…」FAIL ✅ |

### 本轮门禁（串行，日志 `plan/logs/opencode-task-011-r4/`）

`01-typecheck` PASS ｜ `02-architecture` PASS（越界 7 / app 直连 25，无新增）｜ `03-r3-boundaries` PASS（6/6）｜ `04-review-probes` PASS（6/6）｜ `05-r2-boundaries` PASS（4/4）｜ `06-worker-fairness` PASS ｜ `07-failure-cleanup` PASS ｜ `08-worker-heartbeat` PASS ｜ `09-worker` PASS ｜ `10-kern-message-execution` PASS ｜ `11-kern-execution-control` PASS ｜ `12-kern-worker-recovery` PASS ｜ `13-execution-abort` PASS ｜ `14-model-cancellation` PASS ｜ `15-model-call-quota` PASS ｜ `16-provider-attempt-quota` PASS ｜ `17-model-execution-facts` PASS ｜ `18-kern-supervisor` PASS ｜ `19-llm-e2e` PASS。改动文件 lint PASS，无残留测试进程。

CI 新增 `npm run test:worker-r3-boundaries` 步骤与 `tests/regression-worker-r2-boundaries.ts`、`tests/regression-worker-r3-boundaries.ts` 路径触发。

### 本轮文件变更

- 修改：`src/modules/worker/fair-queue.ts`（删除 `exhausted` 预判、修正 `markServed` 语义）、`src/modules/worker/loops.ts`（`markServed` 时机 + once 串行准入）、`src/modules/assistant-runtime/message-worker.ts`（同上）、`src/modules/worker/index.ts`（删除按年龄接管）、`tests/regression-worker-failure-cleanup.ts`、`package.json`、`.github/workflows/kern-supervisor-ci.yml`
- 未改动 Codex 提供的三份反例文件；未删任何断言；未新增迁移；未改架构基线；未触碰用户原会话与开发库。

---

## 7. 进度文件

按交接要求，`plan/kern-optimization-progress.md` 追加「TASK-011 实现提交待验收」及本文件路径；计划中的 TASK-011 **保持未完成**，交由 Codex 复审后标记。

未声称已提交 Git，未声称在线 CI 成功。
