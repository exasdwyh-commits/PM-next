# OpenCode 实施任务：TASK-011 并发与组织公平调度

日期：2026-10-05。状态：任务已安排，尚未实施，等待 OpenCode 实现后由 Codex 独立验收。

## 1. 目标与工作方式

工作目录：`/Users/exasdwyh/Documents/VScode/Kern/pkg-full`。

请完成持续优化计划的 TASK-011：让同一个常驻 Worker 在组织 A 等待慢模型时，组织 B 的会话和任务仍能推进，同时限制并发，保持取消、执行权、幂等、额度与账本正确。

OpenCode 负责实现、测试、交付记录；Codex 负责代码审查、独立复跑和最终验收。其他人在共享目录已有改动，保留已有成果。实现期间只处理本任务；第三阶段 TASK-012～TASK-015另行安排。

先阅读：

- `plan/feature-kern-continuous-optimization-1.md`
- `plan/kern-optimization-progress.md`，特别是 TASK-007～TASK-010。
- 项目适用的 AGENTS.md。
- `tests/test-safety.ts` 与 `scripts/run-test.ts`。

本地没有 Git 历史。Codex 已准备基线副本，路径记录在本文件第 7 节；OpenCode 修改额外文件前也要保存原件，记录新增、修改和删除清单。

## 2. 已核实的问题及修改范围

| 文件 | 当前事实 / 本任务责任 |
| --- | --- |
| `src/modules/worker/index.ts` | 外层逐个 await 循环，慢 conversation 会阻塞 executor 等循环。负责常驻调度、在途生命周期、退出和 once 语义。 |
| `src/modules/worker/loops.ts` | executor 按全局 priority/createdAt 取 limit×4，再串行执行；大组织可占满候选窗口。负责公平发现、领取与调度。 |
| `src/modules/assistant-runtime/message-worker.ts` | 全局取最早 limit×4 条后串行执行；会话锁保证同会话顺序。负责消息队列公平发现及调度，保留数据库顺序约束。 |
| `src/modules/worker/registry.ts` | 上层通过 handler 注册，不让 worker 反向导入业务模块。必要时扩展最小调度接口。 |
| `src/modules/supervisor/worker-runtime.ts` | 注册会话处理器及既有执行能力；衔接接口。 |
| `scripts/pm-worker.ts` | 配置解析及启动；保留组织限定，验证新增并发参数。 |
| `src/modules/worker/claim.ts`、`run-claim.ts`、`executor.ts`、`recovery.ts` | 优先复用执行 token、取消观察与事务提交。仅在生命周期接入确有必要时修改。 |
| `src/modules/workforce/service.ts` | startAgentTask 已锁 Agent 行后检查 maxConcurrentTasks；保留跨领取者的数据库并发保护。 |
| `tests/`、`package.json`、`.github/workflows/kern-supervisor-ci.yml` | 增加真实故障回归及测试入口，接入现有 CI 作业和触发路径。 |

可在 worker 层增加小型调度模块。保留 Next.js / Prisma / PostgreSQL / 独立 Worker，不引入新队列、服务或依赖。预计无需数据库迁移；如确有需要，说明理由并仅用追加迁移，不修改历史迁移。

## 3. 建议实现方式与边界

1. 常驻 Worker 的调度与长执行分离。各循环不能互相等待业务执行完毕；同一轮询器不重叠启动。维护可追踪的在途集合，所有 promise 都有错误处理和收尾。
2. conversation 与 executor 共用进程级并发预算，建议默认总上限 2、单组织上限 1，可设置合法的正整数上限。明确现有 executorBatch 是批次大小还是并发配置，不能同时启动两条队列后把真实总上限翻倍。现有 Agent 数据库并发上限仍独立生效。
3. 发现候选按组织轮转，再在组织内保持优先级 / 时间顺序。公平性不能只依赖全局前 N 条：组织 A 的大量旧任务不能遮住 B。轮转位置需在后续轮询保持；B 也可能在 A 开始等待后才入队。
4. 有空位时继续补充工作。不能 await 整个批次中最慢任务才继续轮询；跳过、争抢失败、取消、异常均归还本进程容量。
5. 消息仍由 conversation 行锁决定领取顺序；同会话最多一个执行，不越过最早 QUEUED/RUNNING 消息。其他会话和组织可并行，始终使用原发起人权限。
6. 有效 organizationId 限定对候选、恢复和执行都生效。进程上限和每组织上限不宣称是多进程全局限制；多进程仍靠数据库 token、会话锁和 Agent 锁保证正确性。
7. 保留独立心跳及最后写入 drain。退出先停止新领取，再收尾已领取工作；明确正常退出、外部 abort、maxTicks、once 的等待及中断规则，测试锁和 stopped 心跳不能在旧工作仍有提交权时提前释放。若设退出截止时间，未完成执行必须按既有机制关闭或撤权，不能静默遗留 promise。
8. research/event/reconcile/schedule 保持有限、非重叠执行；本次重点是会话与 executor 的组织公平性。交付记录明确其他循环的容量边界，不把本任务写成所有业务入口均已共享并发上限。

取消继续阻止后续请求和旧结果提交；远端已接受的写入不能自动重放。模型预算错误仍进入 BLOCKED，不损伤 provider 健康、不烧执行器重试次数；ModelRun 传输事实、逻辑调用和 quota 原子预留不可退化。

## 4. 验收标准

新增建议入口 `npm run test:worker-fairness`，经 `scripts/run-test.ts` 启动。使用真实隔离 PostgreSQL 和本地 HTTP 模型夹具；同步屏障控制慢请求释放，避免仅用随机 sleep。每项打印结果及关键时间顺序 / 峰值，失败进程返回非零。

| 编号 | 必须证明 |
| --- | --- |
| F1 | 同一个常驻 Worker 中 A 的模型 HTTP 已进入等待，B 的任务在 A 释放之前完成；测试同时有 conversation 与 executor，排除通过两个独立 Worker 绕开外层阻塞。 |
| F2 | A 积压条数超过旧的全局候选窗口，B 仍能领取；分别覆盖会话和任务队列，并覆盖 B 在 A 开始后才入队。多轮持续积压不能永久饿死后出现的组织。 |
| F3 | 跨队列实际在途峰值不超过配置总上限、单组织上限；额度争抢、skip 和异常后容量可恢复；无效/小数/负数/NaN 参数被拒绝或使用明确约定。 |
| F4 | 同会话两条消息严格顺序；重复接收和竞争领取只运行一次；两个独立领取者不突破 Agent.maxConcurrentTasks，不产生重复结果。 |
| F5 | A 在途取消后，本地 HTTP 终止、账本关闭、容量归还；B 正常继续，取消不触发备用模型，也不降低 provider 健康。 |
| F6 | 失联接管 / 旧执行者晚返回不能提交事件、结果或释放新 token。并发额度预留仍原子；重试和 fallback 的实际请求数量与账本一致。可复用现有回归，指出证据对应关系。 |
| F7 | 长等待期间心跳前进；abort / once / maxTicks 的收尾符合第 3 节约定；退出后无延迟报活、无未处理 rejection、无额外领取或悬挂测试进程。 |
| F8 | organizationId 限定只能处理指定组织，包括恢复扫描。关闭页面后已接收消息仍可执行；刷新恢复同一运行且不重新发送。后台修改后复跑既有 HTTP 聊天链路。 |

实现至少复跑下列相关门禁，数据库用例串行，避免互相清理夹具；输出分别保存日志：

```sh
npm run typecheck
npm run test:architecture
npm run test:worker-fairness
npm run test:worker-heartbeat
npm run test:worker
npm run test:kern-message-execution
npm run test:kern-execution-control
npm run test:kern-worker-recovery
npm run test:execution-abort
npm run test:model-cancellation
npm run test:model-call-quota
npm run test:provider-attempt-quota
npm run test:model-execution-facts
npm run test:kern-supervisor
npm run test:llm-e2e
```

另对实际修改文件运行 lint。不能删除断言、放宽隔离/取消要求、更新架构违规基线来得到通过。现有架构基线为 7 条跨层 / 25 个 app 直连数据库；不新增。远程 CI 未运行就明确写“仅接入 CI 定义”。真实外部模型质量不属于本地夹具证明。

## 5. 数据与本地服务

- 开发库为 `hermes_next_dev`；隔离测试库为 `hermes_next_test`。测试角色 `hermes_test` 无开发库 CONNECT 权限。测试必须从已有安全启动器进入，不打印连接串、密钥或整份 .env。
- 禁止 reset、清空开发组织或以开发库执行测试夹具。测试自建组织和可回收数据，HTTP 夹具只用回环地址，不调用付费外部模型。
- 本地 3100 网页及 Worker 当前由 `dev:local` 管理；开发 Worker 仅服务 `KERN_LOCAL_TEST`，组织 ID `829640c2-f80f-4d79-aeae-b0a6c88fe905`。运行状态可能变化，操作前检查实际进程。
- 不启动面向整个开发库的无范围 Worker。独立验收 Worker 使用隔离库、自己的锁目录，结束后停止自己创建的进程。需要重启开发服务时先确认进程归属，并保持组织限定。
- 用户原会话 `4202736a-cb7c-4086-8bb0-f16f278a9976` 的竞品对象未填；不要代填或启动该任务。浏览器验收另建测试会话。

## 6. 交付及复审

完成后写 `plan/opencode-task-011-delivery.md`，包含：

1. 实际方案、总上限 / 单组织上限 / Agent 限制、CLI 默认值、once 和退出语义。
2. 新增 / 修改 / 删除文件、备份路径、超出建议修改范围的理由。
3. F1～F8 对应测试用例、真实时间顺序和峰值证据。
4. 各命令结果、完整日志路径、未通过和未执行项；既有测试如失败，报告具体原因，不能隐瞒。
5. 数据迁移（如有）、自建进程和夹具清理情况、剩余风险。

可以在进度文件追加“TASK-011 实现提交待验收”及证据；计划 TASK-011 保持未完成，交由 Codex 复审后标记。不要声称已提交 Git 或在线 CI 成功。

Codex 将对比原件、检查调度和事务竞态、独立复跑关键回归、验证浏览器与 Worker 行为。实现方报告通过不等于最终验收通过。

## 7. 修改前基线

基线目录：`/tmp/kern-opencode-task011-baseline/`。

- `originals/`：本任务可能涉及的已有源码、入口、测试及 CI 文件副本。
- `manifest.json`：src / scripts / tests / prisma / .github 与 package 文件的 SHA-256 清单，用于发现额外修改及新增文件；不包含 .env、构建目录和依赖。

临时目录可能被系统清理。OpenCode 开工先确认基线存在；若不存在，在自己的首个改动前重新建立副本及清单，记录新路径。
