# TASK-011 第二轮 Codex 复审与修复交接

日期：2026-10-06。结论：**REQUEST CHANGES，TASK-011 保持未完成。**

独立代码审查 REQUEST CHANGES；独立架构审查 BLOCK。两条审查均独立检查新增反例及日志，确认领取边界与实际执行公平性的失败成立。架构审查沿用继承当前模型的独立代理，未使用不受账户支持的预设架构模型。

## 已确认的改善

- 上一轮 `tests/regression-worker-review-probes.ts` 的 6 条断言全部 PASS。
- 单组织容量满时继续扫描其他组织，两条队列均实测允许 B 补位。
- finally 统一等待轮询与在途执行，正常停止的锁、心跳、监听清理通过原公平回归。
- 原公平回归、F1 故意失败后的退出及组织夹具清理均通过本轮独立复跑。

**这些改善尚不足以通过验收。** 发现全部候选组织不等于所有组织获得执行；调用执行函数前检查停止，也不等于实际领取前检查停止。新增 4 条行为断言全部 FAIL，形成下面 3 类运行阻断。

## 必修项

### R2 / HIGH：实际领取发生在停止信号之后

位置：

- `src/modules/assistant-runtime/message-worker.ts:10`、`:24`、`:55`、`:130`。
- `src/modules/worker/loops.ts:214`、`:217`；`src/modules/worker/executor.ts:131`、`:158`；`src/modules/worker/claim.ts:19`。

新增反例暂停在**真正的领取流程内部**：消息在真实事务的首次读取后、写 RUNNING 前暂停；任务在 executeAgentTask 内部读取后、获取租约前暂停。此时外部 admission 检查已经通过。分别 abort，并查询确认数据库仍为 QUEUED，再释放屏障。

实测两者都继续领取并执行到 SUCCEEDED，写入 startedAt：

| 路径 | 停止时 | 恢复读取后 |
|---|---|---|
| conversation | QUEUED | SUCCEEDED，startedAt 非空 |
| executor | QUEUED | SUCCEEDED，startedAt 非空 |

修复：把准入谓词传入真实执行及 claim 路径。消息在事务内读取、锁等待完成后，紧邻所有权写入再次检查；executor 在内部读取、权限检查后，紧邻租约领取再次检查。已领取的执行继续 drain，未领取的释放预算槽。明确领取请求与停止的先后边界；不要承诺撤销已经发给数据库的领取语句。

验收：保留新增两个实际流程屏障；补锁等待、once/maxTicks 的停止行为。仅在 tick 前增加检查无法满足这条反例。

### R3 / HIGH：分页与共享轮转导致实际执行永久遗漏

位置：`src/modules/worker/fair-queue.ts:46`、`:57`、`:121`、`:134`；`src/modules/worker/loops.ts:192`。消息发现复用同样的分页轮转机制。

实测创建 80 个合格组织，每个组织的快速策略在完成前补一条自己的排队任务，因此组织集合始终保持稳定。默认 batch=2、总容量=2、组织容量=1，串行执行 120 轮，每轮等待在途排空：**只有 40 个组织真正开始执行，另 40 个从未执行。**

原因：20 个组织一页，各页共用 rotation。4 个满页时，同一页每次访问的起点增加 4；每次只有起点后的 2 个组织得到执行，固定跳过其余位置。原 F2-c 验证返回的候选包含全部组织，没有证明这些组织实际被领取和执行。空页回绕也没有推进 rotation，不能打破这一循环。

修复建议：以组织键或明确的页内服务位置推进调度游标。把候选读取与实际服务进度衔接起来，避免一个跨页共享 rotation 决定小批次的固定前缀。组织集合变化时，offset 还会跳过移动的行，宜采用稳定键分页及回绕。继续保证查询有界、组织内部排序、共享预算与 scope，不以加大固定窗口解决。

验收：保留 80 组织持续积压的**实际执行**断言；两条队列覆盖多页、组织增删、部分组织饱和和组织限定。不能用候选发现计数代替执行覆盖。

### R1 / HIGH：真实文件心跳失败后仍继续轮询

位置：`src/modules/worker/index.ts:295`～`:305`、`:329`～`:365`；锁接管条件在 `:139`～`:141`。

旧 EISDIR 反例现在通过，是因为同步文件心跳调用已从外层循环移除；该反例在首次 10 秒定时器之前结束，实际未触发修复后的错误路径。

新增反例等待真实 10 秒文件心跳定时器，并向临时写入路径注入 EISDIR。日志出现实际心跳错误后，700ms 内轮询从 **50 次增至 54 次**，文件锁仍存在。

证据边界：这条反例用轮询替身，证明故障后仍继续轮询；没有声称实测故障后真实任务被领取。catch 只记录错误且不关闭 admission、存活 PID 的文件锁超过 60 秒后可被接管，均由当前源码支持。此次未等待 60 秒或启动第二进程验证接管，不能把该风险写成已发生的双执行。

修复：文件心跳失败进入关闭新准入、停止轮询与统一排空路径，保留错误事实。排空期间无法刷新锁时，必须确保仍持有执行权的存活旧进程不会仅因时间过期而被接管；可沿用简单的本机活进程保护或明确的撤权机制，不需要新增队列服务。

验收：实际触发定时器错误；错误后不新增领取；已有执行完成或撤权后才释放所有权。补另一个进程在旧进程仍排空时的启动拒绝断言，不能只测锁文件短暂存在。

## R5 / MEDIUM：失败清理验收仍有空断言

位置：`tests/regression-worker-failure-cleanup.ts:20`～`:42`；`tests/regression-worker-fairness.ts:357`～`:391`、`:640`～`:682`、`:720`。

本轮故意失败清理测试独立 PASS，子进程非零退出且清掉本次组织，没有观察到遗留测试进程。但失败注入发生在 F1，该 Worker 使用 ignoreLock=true，所以“无残留 lock.json”没有验证任何真正创建过的锁。真实锁位于后面的 F7，根本未走到。

F7 的临时目录删除及 PM_WORKER_LOCK_DIR 恢复仍只在断言成功后执行；外层 finally 没有接管这些资源。startWorker 只登记 promise，只有 F7 显式登记 controller，其余长时 Worker 失败后依靠 maxTicks 才退出。夹具清理失败还被吞掉。

补测与修复：在 F7 真实锁存在、HTTP 尚未释放时注入失败；外层 finally 管理所有 controller、临时目录和环境恢复；验证停止心跳、端口、锁、子进程和本次夹具。父测试须有明确的等待上限及受控失败收尾，避免等待永不退出的子进程。

## 本轮独立验证

日志目录：`plan/logs/codex-task-011-r2-review/`。

| 检查 | 结果 | 日志 |
|---|---|---|
| typecheck，含新增反例 | PASS | `typecheck-with-boundaries.log` |
| architecture | PASS，12 项；基线 7/25 无新增 | `architecture.log` |
| 交付改动定向 lint / 新反例 lint | PASS | `lint.log` / `deeper-probe-lint.log` |
| 上一轮 6 条反例 | 全部 PASS | `review-probes.log` |
| OpenCode 公平回归 | PASS | `worker-fairness.log` |
| 故意失败清理回归 | PASS，上述覆盖限制保留 | `worker-failure-cleanup.log` |
| 新增更深行为反例 | 4 条 FAIL，退出码 1，夹具清理完成 | `deeper-boundaries.log` |

本轮没有重新跑全部 17 条门禁；OpenCode 交付中的全绿记录不是 Codex 本轮独立结果。运行阻断已得到明确证据，修复后再跑完整门禁。未运行远程 CI，未调用真实外部模型。

使用隔离测试账号，测试入口再次确认该账号无法连接开发库。新增反例只清理本次创建的组织、审计及心跳，恢复查询补丁、注册表、环境和临时锁目录。最终进程检查无本轮回归遗留；原开发网页和限定测试组织 Worker 保持运行，未重启加载尚未验收的代码。

复审前快照：`/tmp/kern-task011-r2-review-baseline/manifest.json`；本轮核对 325 个已有文件哈希无变化，见 `source-integrity.json`。Codex 本轮新增测试与记录，未改运行实现、原会话或开发库。

## OpenCode 下一轮执行

1. 修复 R2 的实际领取边界，先让两条停止反例变绿。
2. 修复 R3 的服务游标，让 80 个组织实际执行覆盖完整，并覆盖消息队列。
3. 修复 R1 的定时心跳失败及排空期间的所有权保护。
4. 补强 R5 的真实持锁失败退出场景。
5. 串行复跑两组独立反例、公平回归、失败清理及交接全部门禁；交付记录追加实际证据，保持 TASK-011 待 Codex 验收。

从 pkg-full 执行：

```sh
node --import tsx scripts/run-test.ts tests/regression-worker-review-probes.ts
node --import tsx scripts/run-test.ts tests/regression-worker-r2-boundaries.ts
node --import tsx scripts/run-test.ts tests/regression-worker-fairness.ts
node --import tsx scripts/run-test.ts tests/regression-worker-failure-cleanup.ts
```

如果正确实现更改了测试接口，可调整屏障位置以保持相同行为断言，并说明原因；不得删除失败场景或把真实执行覆盖降为候选计数。继续沿用原交接责任与 scope，不扩大生产处理范围，不修改用户原会话。
