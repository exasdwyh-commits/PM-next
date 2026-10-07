# TASK-011 Codex 独立验收与修复交接

日期：2026-10-06。结论：**REQUEST CHANGES，TASK-011 保持未完成。**

代码审查结论 REQUEST CHANGES；独立架构审查结论 BLOCK。原架构角色启动因账户不支持其预设模型失败，随后由继承当前模型、独立上下文的架构审查代理完成第二条审查；未用作者自审代替独立审查。

## 范围与证据

- 对照 `plan/opencode-task-011-handoff.md`、交付记录、`/tmp/kern-opencode-task011-baseline/manifest.json` 和原件审查。无 Git，以 SHA-256 识别差异。
- OpenCode 的 11 个新增/修改文件与交付清单相符；工作室页面、入口、权限矩阵属于此前 Codex 的独立交付。无数据库 schema / migration / 依赖变化或基线文件删除。
- 本次只新增独立反例、审查记录和进度记录，没有修复 Worker 实现。因此以下问题仍可在当前源码复现。
- 新反例：`tests/regression-worker-review-probes.ts`；最终日志：`plan/logs/codex-task-011-review/counterexamples.log`。它验证正确行为，当前 **6 条断言 FAIL、退出码 1**，不能作为通过门禁。
- 测试通过专用入口和隔离账号执行，账号被拒绝连接开发库。反例结束删除本次创建的组织及其审计夹具，恢复注册表、查询补丁、环境变量、信号监听、心跳和临时锁目录。

## 必须修复

### R1 / HIGH：异常退出提前释放所有权

位置：`src/modules/worker/index.ts:343`、`:356`、`:359`。

文件心跳异常会跳过正常路径的两个 drain，直接进入 finally 删除锁、停止心跳。在临时锁目录注入 EISDIR 后，观测为 `trackedInFlight=1`、`markedStopped=true`、`lockExists=false`。

这次注入跟踪的是未释放的 Promise 屏障，证明排空不变量被破坏；没有据此宣称已经观察到真实旧 token 的越权提交。

修复：把活动轮询集合提升到 finally 可访问的生命周期范围。所有退出路径统一先关闭新工作准入，再等当前查询/轮询收尾，再 drain 业务执行，最后清除心跳、释放锁、标记 stopped。异常必须保留；禁止吞掉异常后直接释放所有权。如果设计退出期限，到期前必须撤销旧执行提交权并关闭账本。

验收：真实文件锁；异常前有实际在途工作；异常期间仍持锁/心跳未标 stopped；完成或撤销执行后才退出，无晚到提交或未处理 rejection。

### R2 / HIGH：停止信号后仍领取并执行新工作

位置：`src/modules/worker/index.ts:272`、`:328`；`src/modules/assistant-runtime/message-worker.ts:95`；`src/modules/worker/loops.ts:170`。

外层 stop 没有传入异步 tick。反例暂停真实消息的 groupBy 查询，在消息仍 QUEUED 时 abort；恢复查询后，该消息实际变为 SUCCEEDED 并记录 startedAt。

修复：给常驻 Worker 的两个 tick、session 解析和最终 claim 传递准入关闭信号或谓词，查询恢复后及每次实际领取前检查。不要把“禁止新领取”与“允许现有执行排空”混为一个会取消全部工作的信号。关闭后释放已预留但未领取的槽位。

验收：conversation 和 executor 均覆盖“查询进入 → abort/SIGTERM → 查询返回”的屏障；消息/任务保持未领取；已领取任务正常排空；补测 once/maxTicks。

### R3 / HIGH：第 21 个组织永久不可见

位置：`src/modules/worker/fair-queue.ts:16`、`:79`、`:120`。

`take: ORG_WINDOW` 在轮转前只选最旧的 20 个组织。保持这些组织积压时，第 21 个组织无论轮转多久都进不了候选。反例用 21 个组织，连续 25 轮，两条队列各只发现 20 个组织。与 F2 不允许持续饥饿冲突。

修复：组织游标必须覆盖整个合格组织集合。推荐按稳定 organizationId 做有界分页并回绕，保留当前单组织内部排序；组织全量发现再轮转也可作为简单方案，但不能对全部组织无上限发起候选查询。不能仅把 20 改为更大的固定数。

验收：至少 21 个组织保持旧积压，新组织稍后进入两条队列；跨页并回绕后有界推进；覆盖组织增删、相同时间戳、空候选、单组织 scope。

### R4 / MEDIUM：组织达到上限时，其他组织无法补位

位置：`src/modules/worker/loops.ts:181`；`src/modules/assistant-runtime/message-worker.ts:103`。

`tryAcquire` 对总上限和单组织上限都返回 null，两条循环都 break。总上限 2、单组织 1，A 占 1 槽，B 的合法任务/消息排队时，两条队列均 `acted=0, bStarted=0`。

修复：区分总容量满和组织容量满；只在总容量满时停止扫描，组织满则跳过继续发现其他组织。丢失 claim、异常和取消要归还容量；批次计数语义明确，避免把未领取当实际执行。

验收：A 持续占槽，B 在同一 tick 开始实际执行；两队列共用同一个总上限，单组织及 Agent 数据库并发上限不变。

### R5 / HIGH：失败回归遗留无限轮询 Worker

位置：`tests/regression-worker-fairness.ts:554`、`:577`、`:625`。

F7 的 Worker 无限轮询，只有前置等待和断言成功才 abort；外层 finally 没有终止/等待它。退出失败可留下后台进程，并执行其他测试创建的组织任务。

本次实测发现 5 个孤儿进程：67860、68083、69099、71825、72803。父进程均为 1；cwd 均为当前 pkg-full；命令均为 `node --import tsx tests/regression-worker-fairness.ts`；分别于 00:23:08、00:24:10、00:26:44、00:35:29、00:40:07 启动，检查时已运行约 8 小时。已只对这 5 个确认归属的进程发 SIGTERM，并确认全部退出。本地网页 PID 36938 与限定测试组织的开发 Worker PID 36936 仍在。

清理前 supervisor 两次复跑在 S9 / S4 失败，任务被无测试模型钩子的进程执行后出现 MODEL_UNAVAILABLE；清理后 S1～S9 全部通过。该时序和源码支持遗留进程干扰的判断，未把它认定为 supervisor 新源码回归。

修复：每个无限/长时 Worker 的 controller 和 promise 都由外层 finally 管理；断言失败也先 abort 全部 Worker、释放 HTTP 屏障、await 全部退出，然后才重置注册表/断开数据库。旧测试组织残留 QUEUED 工作也应清理，范围限定本次创建的 IDs，先处理 AuditEvent FK。F7 的“无新领取”断言要放一个真实待领取任务，不能只数已经 RUNNING 的唯一任务。补实际文件锁及失败清理测试。

验收：故意令中间断言失败，测试应非零退出且不残留子进程、监听端口、活动 heartbeat、锁或 QUEUED 夹具；无论成功失败都可连续重跑。

## 独立门禁结果

最终 15 个交接门禁均有通过记录，但新增反例为红，因此不能验收通过。

| 门禁 | 结果 / 日志 |
|---|---|
| typecheck | PASS / `typecheck.log` |
| architecture | PASS，12 项 / `architecture.log`；7 条跨层、25 个 app DB 基线无新增 |
| worker-fairness | PASS / `worker-fairness-clean.log`，清理遗留进程后重跑；现有覆盖无法发现上述反例 |
| worker-heartbeat | PASS，HB1～HB2 / `worker-heartbeat.log` |
| worker | PASS / `worker.log` |
| kern-message-execution | PASS / `kern-message-execution.log` |
| kern-execution-control | PASS / `kern-execution-control.log` |
| kern-worker-recovery | PASS / `kern-worker-recovery.log` |
| execution-abort | PASS，5 项 / `execution-abort.log`；初次 EPERM 为沙箱监听限制，重跑后通过 |
| model-cancellation | PASS / `model-cancellation.log` |
| model-call-quota | PASS / `model-call-quota.log` |
| provider-attempt-quota | PASS / `provider-attempt-quota.log` |
| model-execution-facts | PASS，MF1～MF8 / `model-execution-facts.log` |
| kern-supervisor | PASS，S1～S9 / `kern-supervisor-clean.log`，清理遗留进程后重跑；保留此前失败日志 |
| llm-e2e | PASS，重新生产构建、独立 HTTP 服务及 Worker、37 项 / `llm-e2e.log` |

日志目录：`plan/logs/codex-task-011-review/`。改动文件 lint 和新增反例 lint 均 PASS。之前工作室暂时编译错误已经排除，本次构建成功。HTTP 模型测试使用本地夹具，不证明真实外部模型输出质量。未执行远程 CI。

## OpenCode 执行顺序

1. 先完成 R1 / R2，统一退出生命周期及准入关闭。
2. 完成 R3 / R4，修复发现轮转和空余槽补位。
3. 完成 R5，确保红测试不会遗留执行进程，夹具只清本次 IDs。
4. 扩展现有回归并使独立反例变绿。若正确实现导致某个测试 seam 不再适用，解释并替换成同等行为断言，禁止删断言绕过缺陷。
5. 串行复跑交接全部门禁，更新交付记录实际日志及残留限制；仍交由 Codex 独立验收，不能自行勾选 TASK-011。

独立反例入口（从 pkg-full 执行）：

```sh
node --import tsx scripts/run-test.ts tests/regression-worker-review-probes.ts
```

修复范围沿用原交接；不引入新队列/服务/依赖，不扩大生产组织 scope，不修改用户原会话。并发预算仍为进程内预算；once 串行兼容、多进程 DB fencing、远端副作用不重放的边界继续保留。
