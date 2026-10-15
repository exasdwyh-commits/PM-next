# Kern 成熟强化 A2-1：可靠回原会话

日期：2026-10-15<br>
分支：`fix/kern-worker-recovery`<br>
基线：远端 main `e7d1e93ced411a7c319e0cffdfaeca7720d65936`。第一批连接器修复仍在独立 PR #102，不把它混入本批，不直接合并 main／部署。

## 本批问题和范围

既有 Worker 先完成 `finishAgentTask()`，再调用 `appendConversationReturn()`。两次事务之间进程崩溃，或回执事务失败后，任务已终结，孤儿恢复只扫描 RUNNING，原会话可能永久收不到结果。

本批补该恢复入口，并收紧已有回执校验；不新增任务状态机、模型调用、数据库表、迁移、定时器、外部写权限或业务 Gate。

## 持久化契约

1. 只以已保存的 AgentTask／最新 AgentRun 为真相，校验组织、Agent、创建人、请求人、会话 owner、状态和 finishedAt。
2. 最新运行与任务状态必须相符：SUCCEEDED／FAILED；BLOCKED／WAITING_HUMAN 对应 WAITING_CONFIRMATION。排队、运行、取消，以及旧 run 的回调不能发布终态回执。
3. 会话已归档、owner 已停用／为系统身份、目标丢失或所属关系错误，不补发。恢复不会另建会话或改任务状态。
4. 原有任务行锁串行化并发回执；消息、run.outputMessageId、contextSnapshot 中的 receipt 在同一事务落地。中途失败全部回滚，下轮重试。
5. 幂等单位是一次 run，而非整个任务一生。BLOCKED 后人工补输入再执行，新的 run 可以得到新回执，旧回调不能顶掉新结果。
6. 兼容旧 receipt：核实实际消息属于同一会话／run，再修复缺失的 run linkage，不重复发消息；仅凭一个 context messageId 字符串不能抑制新 run 的交付。
7. 摘要读取已提交 run 的 outputSummary／errorReason／任务 blockedReason，不相信迟到回调传入的摘要。完整 output 仅允许 SUCCEEDED 且 executorResult.runId 匹配；旧快照无 runId 时使用已保存摘要，避免旧产物冒充本次结果。
8. 显示文本仍保留原来的 12,000 字符完整产物截断和 4,000 字符摘要上限；截断必须提示，完整产物保留在任务快照中。

## 恢复调度

- 上层 workforce 提供 `recoverAgentTaskConversationReturns()`，由 supervisor 组装到可选 lifecycle hook；worker 底层不反向 import 领域模块。
- 复用 executor 的现有约 30 秒恢复节流入口，先恢复孤儿，再恢复缺失回执。两者独立 try/catch，前者失败不抑制后者。
- SQL 在 limit 之前过滤失效目标和已交付最新 run；默认每批 50，上限 200，0 表示不处理。
- 每项失败独立记录，整批继续。回执补发只写会话交付，不计作新执行任务／新模型工作，也不重放原任务工具副作用。
- 无 executor loop 的部署不会自动补发；Worker 未启动、数据库不可用等仍需运维处理。上线必须部署并重启对应 Worker，而非只更新前端。

## 复验入口和实际证据

- 新增 `npm run test:kern-conversation-receipts`；接入既有 `test:workforce` 尾部，Supervisor CI 已调用该入口，无需修改 workflow。
- 使用专用测试角色，验证其不能连接开发 guard 库；本轮在既有 `hermes_test` 中新建独立 schema `kern_maturity_worker_20261015`，应用原有 51 个迁移。没有迁移开发／生产库，也没有修改现有服务使用的 public schema。
- 修复前实际红测：CR01 跨任务 run、CR02 运行中误报成功、CR03 失败误报成功均错误创建消息；CR04 缺少恢复入口。**0/4 通过**。
- 修复后新增数据库回归 **19/19 通过**：错误 run／提前／错状态；缺失回执补发；8 并发一次交付；失败摘要不复用旧成功产物；BLOCKED→新成功；同状态旧回调；跨组织；归档／停用；事务失败回滚；单项失败不阻断；旧 marker 修复；新进程恢复并再次重启去重；孤儿耗尽重试失败回传；无效目标不占限额；产物绑定与截断；等待人工不报成功；发现后发生归档的并发边界。
- CR14 使用两个真实新 Node 进程调用 Worker executor loop；崩溃窗口通过预置“已提交终态、无回执”状态复现，不宣称随机 kill 全链路实验。
- 官方单元回归 **420/420**，runtime architecture **10/10**，分层／prompt 检查 **12/12** 通过。与第一批 427 的差异来自本批独立基于 main，未包含 PR #102 的新增连接器测试；没有删除那一批测试。
- `worker-executor`、`regression-kern-worker-recovery`、`regression-workforce-kernel` 真实数据库套件通过。
- 类型、lint、project-map 通过；lint 有 1 个既有 warning；源文件映射 668/668。

## 公平调度夹具的既有抖动

- 本批候选在 F2 超时；未修改的 main 对照也出现同一超时，并且同一 baseline 既有通过也有失败，不能归因于新回执逻辑。
- 最小数据库探针实际复现：默认 `availableAt=2026-10-15T16:45:54.527Z`，紧接着的 JS 发现 cutoff 为 `.526Z`，差 1ms；按同一 cutoff 查询结果是 0。单次 tick 的测试因此可能根本没发现刚创建的 B，而不是 B 因组织积压被饿死。
- 尝试重置游标不能消除失败，该尝试已撤回；最终仅把公平测试 helper 创建的任务设置为 `availableAt: new Date(0)`，保证测试所需的“已经到期”前提。没有放宽时限、删除断言或修改生产排队规则，21 组织实际服务／并发峰值／取消与心跳断言仍保留。
- 最终公平调度完整套件连续 3 次通过（真实本地 HTTP 夹具）；保留此前失败和对照证据，不以偶然一次绿掩盖失败。远端状态另见交付回执。

## 边界和后续

- 不声称整个 A2 完成：所有执行入口、真实用户模型／外部工具、浏览器交互仍要分批做同版本验收。
- 不保证业务 exactly-once：本批保证受控回执路径事务幂等，不代替外部供应商的写入幂等。
- 尚未新增失败回执的持久化退避／死信管理；大量持续失败记录和高积压下的吞吐、公平性还需专项验证，不宣称无限规模无饥饿。
- 原有恢复节流是进程级，未在本批重构多组织的恢复调度；多个 scoped loop 共用进程时仍存在节流共享边界。
- 不改变取消引擎、批准引擎、ScheduleRun、RequiredAction、前端聚合卡或 Watch。定时崩溃恢复等留在下一批。
- 完整 build、远端 CI、PR 和部署状态以本批交付回执为准；本文件里的本地回归不冒充上线验证。
