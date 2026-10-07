# Kern 持续优化进度

## 当前状态

- 目标：三阶段实现、回归和浏览器验收。执行计划仍进行中；会话目标工具当前为 usageLimited，本轮按用户“继续”授权推进，总体目标尚未完成。
- 第一阶段 TASK-001～TASK-006：已完成。
- 当前阶段：第二阶段。TASK-007～TASK-010 已完成；TASK-011 第三轮修复及重构已提交，Codex 复审仍未通过，待修复小容量公平游标、once 停止领取与存活排空进程的锁保护。
- 第三阶段：尚未实施，证据绑定、版本化产出和行动项不能视为已实现。
- 本地服务：`http://127.0.0.1:3100`；本地一键测试模式已重启，默认团队/策略已补齐。
- 常驻 Worker 已启动，仅服务 KERN_LOCAL_TEST 组织，心跳记录组织范围及执行循环。
- 当前测试组织没有可用模型配置和网页检索配置。真实外部调研质量仍未验收。
- 不是 Git checkout，本轮没有提交或推送。

## 执行日志

### 2026-10-05：第一阶段完成

实现：

- 新增 `src/modules/workspace/setup.ts`，初始化使用 missingOnly，只添加缺失值；保持账号、停用状态、自定义 instructions、模型和绑定。
- 初始化放在 workspace 层，符合现有分层；identity 层不反向依赖 workforce。
- 计划展示与正式启动共用准备检查，检查目标、计划真实成员、模型路由约束/运行配置、executor 心跳、调研检索及额度；配置检查不发外部请求。
- 模型选择与实际执行共用 resolver；配置失效进入模型缺失提示，数据库故障不被伪装成就绪。
- 竞品对象必填且不可跳过；旧未启动计划只读升级、下次动作保存，原节点保留。
- 区域/渠道/时间/维度有默认范围，可在计划中编辑；保存同步到实际目标和契约。
- 成员说明只引用实际节点；没有独立 QA 时明确提示。预计步骤生成次数与实际 provider 尝试次数的区别可见。
- 演示跳过模型、检索和额度要求；仍检查团队、输入与执行器，防止创建后无人推进。

验证：

- `npm run typecheck` 通过。
- 所有本轮变更文件针对性 lint 通过。
- `npm run test:architecture`：12 项通过，没有新增跨层或 app 直连数据库。
- `npm run test:kern-supervisor-plan`：50 项通过。
- `npm run test:frontend-v3`：48 项通过。
- `npm run test:kern-readiness`：R1～R3 通过；配置保留、管理员边界、缺团队/模型/执行器/检索/额度、旧卡片、必填对象、范围同步、启动前复查均检查。
- `npm run test:kern-brief`：B1～B6 通过，正式与演示流程通过测试替身在真实隔离库运行。
- 测试角色 `hermes_test` 对开发库 CONNECT 被拒绝，数据库测试限定 `hermes_next_test`。

浏览器验证：

- 原会话 `4202736a-cb7c-4086-8bb0-f16f278a9976` 补问对象，空值不能确认，用户未填对象保持未填。
- 独立验收会话 `568a516a-8385-4dd9-a702-235531c3181a`，完整对象直接进入三步计划；不声称有红队或 QA。
- 范围改为“中国大陆 / 电商 / 近 30 天”保存，契约立即同步；没有创建或启动实际模型任务。
- 模型、检索、执行器缺失说明可见；正式和演示按钮按各自条件禁用。
- 原会话已恢复为当前页。
- 截图：`/Users/exasdwyh/Documents/VScode/Kern/kern-required-subject.jpg`、`/Users/exasdwyh/Documents/VScode/Kern/kern-plan-readiness.jpg`。

### 2026-10-05：第二阶段开始

TASK-007 的独立心跳子项：

- 每 10 秒独立刷新数据库和本机锁心跳，长时间等待不再阻止报活。
- 心跳写入串行；退出清理定时器，等待最后写入结束再标记 stopped，防止停止后被延迟写入复活。
- 清理外部 abort 监听；已取消的启动不运行 loop；ignoreLock 不写本机锁。
- `npm run test:worker-heartbeat`：HB1/HB2 通过，真实隔离库慢步骤等待 12 秒期间，数据库与文件心跳均增长。
- `npm run test:kern-worker-recovery`：WR1～WR5 通过，现有恢复行为保持。
- typecheck、针对性 lint、分层守卫通过。

### 2026-10-05：TASK-007 / TASK-008 完成

实现：

- 取消/跳过/回答重派会在同一事务关闭正在运行的子任务和 AgentRun，并撤销租约。
- 执行器每 750ms 观察跨进程取消；每次模型、工具、MCP 请求前重新检查当前任务、运行、领取 token 和任务根的节点归属。
- AbortSignal 传递到模型 HTTP、限流等待、网页检索/抓取、MCP 和演示等待；取消直接退出，不按 provider 故障处理，不自动重试或切换模型。
- 模型额度事务之后、发送请求之前再次检查；已经接收但尚未发出的调用也关闭账本，避免留下 RUNNING。
- 输出、执行状态、DataGap、AgentRun 和任务收尾合并到事务；按根任务→子任务顺序加锁，再验证 token，保证取消与提交串行。
- 恢复者用新 token 关闭旧 run、更新状态并重新排队；旧执行者不能提交事件/结果，也不能删除新执行者的租约。
- 临时失败在事务内重新排队；父任务不会提前看到中间 FAILED；普通委派重试不发终态业务事件。
- 连接器沿用动作指纹和一次性授权核销；凭证等待结束、每次远程发送之前复查执行权。
- 新测试命令和 CI 已接入。

验证：

- typecheck、所有本轮变更文件针对性 lint、分层守卫 12 项通过。
- `test:kern-execution-control` EC1～EC4：真实隔离库，执行中取消、旧事件拒绝、接管后旧执行者恢复、新租约保留、新结果唯一、事务重试、普通委派不误发终态事件。
- `test:execution-abort` EA1～EA5：限流等待取消、调用前撤权、凭证等待中撤权、真实 MCP HTTP 中断、模型返回后停止工具与后续调用。
- `test:model-cancellation`：真实本地模型 HTTP 中断，账本关闭，无备用调用，取消不损伤模型健康；额度事务后撤权仍不发 HTTP。
- `test:kern-worker-recovery` WR1～WR5、`test:kern-mission-controls` C1～C9、`test:kern-node-ask` A0～A5、`test:worker` W1～W9、`test:provider-attempt-quota` 均通过。
- 连接器/工具循环/网络保护/模型路由与 provider 既有回归合计 38 项通过。
- 本批为后台改动，没有创建开发库模型任务；浏览器仍保留用户原会话。

下一步：TASK-009 原子消息接收、客户端幂等标识、断线后复用执行与既有 Worker 后台处理；同时补齐 Worker 心跳的组织/loop 作用范围，避免全局在线误判。TASK-010 统一旧 Advisor 模型入口并区分接收、实际 HTTP 尝试、逻辑调用和 tokens。

### 2026-10-05：TASK-009 完成

实现：

- 追加迁移 `20261005040000_message_execution`，保存客户端消息标识、输入关联和执行 token；消息与 QUEUED 运行在同一事务接收。接口新请求返回 202，重复请求复用原运行，不执行模型；相同标识换内容拒绝。
- 新会话支持客户端 UUID，创建回执丢失后重试复用原会话；消息标识在本机持久化，页面刷新通过只读接口恢复执行状态。
- Worker 新增 conversation loop，以原发起人权限顺序执行；同会话只领取一次，接受时冻结运行配置，未来排队消息不进入当前模型历史。
- 临时回复在后处理完成之前不发布；提交检查 token。失联运行关闭 FAILED 并给出中断提示，不自动重放已可能产生副作用的请求，保留中断前内容供核对。
- 新消息取消会撤销执行权，真实模型 HTTP 终止；取消使用状态条件更新，不能覆盖并发完成的终态。
- 心跳明确已知组织/loop 范围；旧心跳不能证明新执行器可用。本地启动包含仅服务 `KERN_LOCAL_TEST` 的 Worker，避免处理其他开发组织积压任务。
- 旧 `/advisor` 书签携带会话、产品和查询重定向到统一 Kern 界面；页面直连数据库减少 1 个，现为 25，跨层违规仍为 7。
- 浏览器发现并修复否定指令误判：`不要创建任务` 不再触发创建工作项；保留正常明确创建指令。

验证：

- typecheck、针对性 lint、架构 12 项、前端 48 项、Kern 运行架构 9 项通过。
- `test:kern-message-execution` ME1～ME5：隔离库实际并发接收、会话去重、排队顺序、配置快照、上下文隔离、真实模型 HTTP、中断不重放、旧回复拒绝、取消、终态保护和 Worker 范围通过；接入 CI。
- `test:kern-readiness` R1～R3 通过；意图路由 4 项通过。
- `test:science` 30 项、`test:llm-e2e` 37 项通过；均通过真实独立 HTTP 服务及后台 Worker 执行，本地模型夹具覆盖正常/故障/超时/历史注入，不代表真实外部模型质量。
- 浏览器验收会话 `5a8e7a83-6089-4d0c-9d23-9d2e3dedd78e`：在“消息已保存，等待执行”后刷新，原运行回复显示；数据库确认 2 次主动发送 = 2 条 USER + 2 条 ASSISTANT + 2 条唯一运行，0 提议、0 任务。
- 修复前误判因没有项目未产生写入；修复后实际工具为 `knowledge.search`，明确显示知识缺口。原用户会话已恢复，未填的竞品对象保持未填。
- 验收截图：`/Users/exasdwyh/Documents/VScode/Kern/kern-message-recovery.jpg`。
- 开发库只应用这次已确认的追加迁移，无重置；测试库角色仍无开发库连接权限。

下一步：TASK-010 统一 legacy Advisor 与模型账本，明确接收、实际 HTTP、成功和 tokens，并加入单次任务预算；TASK-011 处理并发与组织公平调度。第三阶段尚未开始。

## 当前限制

- Worker 范围已明确；部署追加迁移后应重启 Worker，旧进程心跳不包含已知 scope，不能作为运行就绪证明。
- 第一阶段的模型探测是配置检查，不证明外部服务可连接，也不证明输出质量。
- 消息恢复已验证；结构化产出、来源绑定和场景验收仍属于第三阶段。
- 取消能停止后续调用并撤销本地提交；远端已接收的写操作无法靠断开 HTTP 回滚，一次性授权不会自动重放。
- 历史 ModelRun 的传输事实保留未知；新记录区分逻辑调用、获准预留与发送尝试，不能把行数都当成已发 HTTP。

### 2026-10-05：TASK-010 完成

实现：

- 新增 `model-gateway/legacy-config.ts` / `legacy.ts`，旧顾问对话和专业分析均经统一网关执行。旧配置默认值与显式开关保留，迁移不添加隐式重试；专业分析关联原 AgentRun。独立旧适配器仅保留兼容接口及隔离单元测试。
- 追加迁移 `20261005050000_model_attempt_facts` 已同步开发库与隔离测试库，Prisma 已生成。重试和切换分别写 ModelRun，共享 logicalCallId；transportKnown / transportStartedAt 区分历史未知、未发送与发送尝试。发送标记表示移交给 HTTP 传输，不证明远端接收或扣费。
- 未发送预留关闭后释放额度，保留审计行；真实失败尝试仍计入。组织级事务锁保护并发预留，取消和预算错误不损伤 provider 健康、不触发备用模型。
- 根任务的模型预算跨节点和运行共享，首笔采用的上限和截止时间持久化；后续环境修改不能静默加额。默认任务 64 次 / 15 分钟，直接会话运行 16 次 / 2 分钟；后续新预算可用 `KERN_MODEL_BUDGET_ATTEMPTS` / `KERN_MODEL_BUDGET_MS` 调整。
- 耗时从任务/运行已记录的开始时间计算，没有开始时间的兼容调用从首次获准计算。截止时间中止在途模型请求；已超时的任务首个请求也被拦截。预算拒绝进入 BLOCKED，不消耗执行器重试额度。此预算约束模型执行，不替代远端工具超时及动作回执。
- 指标升级 `kern-mission-metrics/v2`，区分逻辑调用、实际尝试、成功、预留和 tokens。任务直接汇总自身 ModelRun，排除其他对话；缺少传输/逻辑标识或 usage 时保留未知。旧快照可读，不以工具事件推算真实请求次数；做法平均值仅使用已知实际尝试。货币金额仍 unknown。
- 设置页区分配额占用、已知请求、已保存端点与启用的调用配置；不宣称配置检查证明外部连通性。网关最终错误保留具体超时/失败原因。

验证：

- 最终 typecheck、针对性 lint 通过；架构 12 项，基线仍 7 条跨层 / 25 个 app 直连 DB，无新增。
- `test:model-execution-facts` MF1～MF8 通过：真实本地模型 HTTP、旧配置默认值、无凭证/提示正文入账、未发送配额释放、失败尝试计数、缺失/非法 tokens、历史未知、并行节点共享预算、不可静默加额、在途超时、专业分析失败采纳、任务汇总/组织隔离和首个请求前超时。
- `test:model-call-quota` MCQ1～MCQ9、`test:provider-attempt-quota`、`test:model-cancellation` 通过。切换和重试各自留痕，属于同一逻辑调用。
- 消息 ME1～ME5、准备检查 R1～R3、任务 S1～S9 通过。原任务夹具 S5 初次因缺 Worker 心跳被新门禁拒绝，补齐组织范围心跳和退出清理后通过，正式门禁保留。
- 模型/旧配置/指标/展示单元 43 项，专业分析与指标相关 65 项，最终指标与架构 23 项，前端 48 项通过。
- 最终源码重新构建：独立 HTTP 服务及 Worker 的模型聊天 37 项、科学证据 30 项通过。均使用本地模型夹具，不代表真实外部服务质量。
- 浏览器设置页确认配额占用与已知请求均为 0、可调用配置为 0；截图 `/Users/exasdwyh/Documents/VScode/Kern/kern-model-usage.jpg`。已恢复原会话，竞品对象保持未填写，未启动原任务。
- 本地网页和限定测试组织的 Worker 已重启加载最终代码。测试角色仍被拒绝连接开发库，开发库未 reset。
- 新回归已加入 npm 脚本和 CI 定义，未运行远程 CI。主要源码/schema 修改前副本在 `/tmp/kern-optimization-model-backup/`。

下一项：TASK-011，建立有界并发和组织公平调度，用两个组织的真实慢调用证明彼此可推进。第三阶段 TASK-012～TASK-015 尚未实施。

### 2026-10-05：TASK-011 交接准备

- 按用户授权安排 OpenCode 实现、Codex 验收的协作方式；未启动 OpenCode、未改动运行源码。
- `plan/opencode-task-011-handoff.md` 明确源码责任、调度建议、F1～F8 验收及安全测试入口；交付记录要求写入 `plan/opencode-task-011-delivery.md`。
- 已核实外层 Worker 和两条队列均串行等待；验收要求同一个 Worker 中 B 在 A 慢 HTTP 释放前完成，同时覆盖全局候选窗口遮蔽及后来入队的组织。
- 修改前 SHA-256 清单与关键原件在 `/tmp/kern-opencode-task011-baseline/`，便于本地无 Git 情况下审查差异；未包含 .env。
- TASK-011 保持未完成；OpenCode 自测交付后，由 Codex 审查、独立复跑及浏览器核验后更新。第三阶段仍未开始。

### 2026-10-06：TASK-011 实现提交待验收（OpenCode）

- 新增进程级并发预算 `src/modules/worker/scheduler.ts`（跨 conversation + executor，默认总上限 2、单组织 1，参数只收正整数）与按组织轮转的候选发现 `src/modules/worker/fair-queue.ts`；常驻循环改为「轮询 + 在途守卫」，退出先停领取再 drain，锁与停止心跳不再提前释放。
- `executorBatch` 明确为单轮启动条数而非并发上限；Agent 侧 `maxConcurrentTasks` 与数据库 token/会话锁保持独立。once 模式仍为串行一轮，未纳入共享预算。
- 新增回归 `tests/regression-worker-fairness.ts`（入口 `npm run test:worker-fairness`），用回环 HTTP 夹具的进入/释放门做同步屏障，覆盖 F1～F5、F7、F8，F6 由既有回归对应；两次变异（常驻循环改回逐个 await、候选发现改回全局前 N 条）分别使 F1、F2 变红。
- 门禁：15 条中 13 条 PASS（含 architecture 7/25 无新增、worker、message-execution、execution-control、worker-recovery、execution-abort、model-cancellation、model-call-quota、provider-attempt-quota、model-execution-facts、kern-supervisor、worker-heartbeat、worker-fairness）。`typecheck` 与 `llm-e2e` 被 `src/modules/workforce/studio.ts` 的括号不配平阻断 —— 该文件不在 Codex 基线清单内、修改时间落在本轮门禁时间窗内，属共享目录他人并发编辑，未由本任务修改。
- 详细改动清单、证据、剩余风险见 `plan/opencode-task-011-delivery.md`，日志在 `plan/logs/opencode-task-011/`。
- TASK-011 仍保持未完成，等待 Codex 独立复跑与浏览器核验后标记；未提交 Git，未运行远程 CI。

### 2026-10-06：数字员工工作室单页扩展

- 根据 Orbit 实际浏览器观察，新增 `/workforce/studio`，提供真实员工侧栏、员工抽屉、待关注事项、任务筛选、交接回执和统一交办。Muse 与原团队页增加入口。
- 交办复用既有幂等接收流程，按用户和组织保存本地回执，刷新只读恢复；统计为最近 80 个可见员工任务及最多 20 条关联交接。缺少模型、进程或结果时如实显示。
- 新数据聚合按组织、员工、任务、运行和交接父任务过滤，显式省略提示词与上下文。权限隔离 WS1～WS3、类型检查、新文件 lint、架构 12 项、路由/CSS 守卫 8 项通过。
- Computer Use 实际验收桌面及 400px 设备预览；交办收到确定性工具回复，刷新恢复原回执。只读核对 1 条输入、1 次执行、1 条回复；未登录接口返回 401。
- 工作室开发时的暂时括号错误已修复，全项目 typecheck 已重新通过。OpenCode 交付中的历史门禁结果不因此自动转为独立验收通过。
- 当前测试组织没有启用模型，员工任务/交接为空；不据此声明真实多模型执行或成果验收已完成。详细结果与限制见 `plan/digital-workforce-studio-delivery-20261006.md`。
- 本轮未修改 Worker 与数据库 schema；TASK-011 的交付仍待独立验收，TASK-012～015 保持未完成。

### 2026-10-06：TASK-011 Codex 独立审查未通过

- 代码审查 REQUEST CHANGES、独立架构审查 BLOCK。发现 4 类运行缺陷：第 21 个组织永久不可见、组织满时其他组织无法补位、停止后的异步查询仍领取新工作、文件心跳异常绕过 drain 提前释放锁及停止心跳。
- 新增 `tests/regression-worker-review-probes.ts`，真实隔离库和明确屏障复现 6 条失败断言；原 Worker 实现未改，反例保持红以供 OpenCode 修复验收。反例只清本次自建组织和审计夹具。
- 另发现原公平测试失败清理遗漏：5 个同仓库孤儿测试进程持续轮询约 8 小时。核实 PID/cwd/命令/父进程后已逐一 SIGTERM，全部退出；原开发网页与限定组织 Worker 保持运行。清理后 supervisor S1～S9 通过，此前 S4/S9 失败日志保留为干扰证据。
- 交接 15 项门禁最终均有 PASS 记录；包括重新生产构建、独立 HTTP 模型链路 37 项。此前 studio 临时编译阻断已消除。现有门禁未覆盖新反例，不能因此判定 TASK-011 完成。
- 审查、具体源码位置、证据边界、OpenCode 修复顺序及复跑入口见 `plan/opencode-task-011-codex-review.md`；日志在 `plan/logs/codex-task-011-review/`。TASK-011 保持未完成，第三阶段未开始。

### 2026-10-06：TASK-011 第二轮修复（Codex REQUEST CHANGES）

- Codex 独立验收给出 REQUEST CHANGES / 架构 BLOCK，5 个必修项（R1 异常退出提前释放所有权、R2 停止后仍领取新工作、R3 第 21 个组织永久不可见、R4 组织饱和阻塞其它组织补位、R5 失败回归遗留孤儿 Worker），并提供 6 条独立反例。
- 已按序修复：排空统一进 `finally`（异常不再绕过所有权释放）；新增只阻止新领取、不取消在途执行的准入谓词；组织候选改为稳定序分页 + 回绕；预算区分「总量满」与「组织饱和」；测试侧统一登记/收尾 Worker、改用真实文件锁、失败清理按外键顺序只删本次 id。
- 6 条独立反例全部转绿。另如实记录：R3 那条反例按创建顺序造组织，与本实现按 organizationId 排序不同构，去掉翻页它仍会 PASS，因此新增 F2-c（21 组织 × 25 轮必须全覆盖）把该不变量钉死，变异下确实变红。
- 新增 `tests/regression-worker-failure-cleanup.ts`：注入失败后断言非零退出、无残留锁、无 QUEUED 夹具、无遗留组织。变异验证 4 组，3 组由反例直接抓住，R3 组由 F2-c 抓住。
- 门禁 17 条全绿（含 typecheck、architecture 7/25 无新增、llm-e2e 37 项），日志 `plan/logs/opencode-task-011-r2/`。上一轮被他人并发编辑阻断的 `src/modules/workforce/studio.ts` 已由其作者修复，本任务未触碰。
- 仍为**待验收**：不自行勾选 TASK-011，等待 Codex 复审。见 `plan/opencode-task-011-delivery.md` 第 6b 节。

### 2026-10-06：TASK-011 第二轮 Codex 复审仍未通过

- 上一轮 6 条独立反例全绿；本轮独立复跑 typecheck、定向 lint、架构 12 项（7/25 无新增）、公平回归和故意失败清理均通过。
- 新增 `tests/regression-worker-r2-boundaries.ts`，隔离库实测 4 条更深行为断言失败：消息/任务在内部读取后、实际领取前停止，恢复后仍执行到 SUCCEEDED；80 个持续积压组织按默认容量和批次执行 120 轮，只有 40 个实际开始；真实 10 秒文件心跳 EISDIR 后轮询从 50 次继续增至 54 次。
- 心跳反例实测的是继续轮询；准入未关和存活进程超过 60 秒可被接管属于源码推断，本轮未宣称实测双执行。原 EISDIR 反例已经无法触发移到定时器中的错误路径。
- 独立代码审查 REQUEST CHANGES、架构审查 BLOCK；另要求补强 R5，现有故意失败发生于 ignoreLock=true 的 F1，无残留锁断言未覆盖真实持锁失败。
- 修复顺序、精确位置及证据边界见 `plan/opencode-task-011-codex-review-r2.md`；日志 `plan/logs/codex-task-011-r2-review/`。核对复审前 325 个已有文件哈希无变化，Codex 本轮只新增反例与审查记录，未改运行实现。
- 本轮测试夹具已清理，无回归进程遗留；原网页与限定测试组织 Worker 保持运行，未加载未验收代码。本轮没有独立复跑全部 17 门禁，TASK-011 继续未完成，第三阶段未开始。

### 2026-10-06：TASK-011 第三轮修复（Codex 第二轮 REQUEST CHANGES）

- Codex 第二轮仍 REQUEST CHANGES / 架构 BLOCK，4 条新行为断言为红：实际领取发生在停止信号之后、80 个常驻积压组织只有 40 个真正执行、真实文件心跳失败后仍继续轮询、失败清理验收存在空断言。
- 已修复：准入谓词下沉到**真实领取边界**（会话在行锁后写所有权前、executor 在取租约前）；组织候选改为「服务游标 + 只读游标」双键集分页；心跳定时器失败即关闭准入并停止轮询、存活持有者的锁不再因心跳过期被接管；失败注入移到 F7 持真实锁时刻且子进程复用父进程锁目录，父进程加 180 秒硬上限。
- 如实记录：Codex 旧的两条「21st organization discovered」断言不具区分度（按创建顺序造组织、而发现按 UUID 排序，是否命中取决于运气），改写为 F2-c（21 组织实际执行覆盖 21/21）与 F2-d（只发现不执行时 15 轮全集覆盖）两条确定性断言，二者均在变异下变红。
- 门禁 18 条全绿（含 typecheck、architecture 7/25 无新增、两组独立反例 10/10、llm-e2e），日志 `plan/logs/opencode-task-011-r3/`。
- 仍为**待验收**，不自行勾选 TASK-011。见 `plan/opencode-task-011-delivery.md` 第 6c 节。

### 2026-10-06：TASK-011 依据评审证据的进一步优化

- 把会话队列与 executor 重复实现的「取槽位 / 容量满就停 / 组织饱和就跳过 / 跟踪在途 / 归还槽位」合并为唯一入口 `launchWithBudget()`。依据：R4 与 R2 都是两条队列各修一遍才收敛，说明实现是复制的；变异测试显示一处误判会让两条队列同时变红。
- 失败清理回归改用专用最小夹具（真实锁 + 一条在途执行 → 抛错），25 秒降到 1~2 秒，连跑 5 次稳定；顺带修掉三处空断言（夹具删锁目录、心跳全表断言、组织前缀匹配）。
- 删除改为「持有者存活即不接管」后已无引用的 `LOCK_STALE_MS`，理由写入 `LOCK_HUNG_MS` 注释。
- 只读游标一度删除后 Codex 两条断言转红，权衡后恢复：它不影响执行公平性，且能不动评审方的测试文件；保留确定性的 F2-d（全集覆盖）而非依赖 UUID 运气。
- 门禁 18 条全绿，日志 `plan/logs/opencode-task-011-opt/`。仍为**待验收**。

### 2026-10-06：TASK-011 第三轮 Codex 复审仍未通过

- 上一轮深层反例 4/4 通过；类型检查、定向 lint、架构 12 项、原公平回归及新版持锁失败清理独立通过。两条独立审查仍分别为 REQUEST CHANGES / BLOCK。
- 新增 `tests/regression-worker-r3-boundaries.ts`，6 条行为断言失败：80 组织 total=1/batch=2 执行 240 轮仅 40 个开始；total=2/batch=1 仅 66 个开始；3 组织 total=1/batch=1 执行 30 轮仅 1 个开始。两条 once 内部领取流程停止后均仍执行到 SUCCEEDED。真实存活 Worker 正在排空时，将自建锁年龄模拟为 16 分钟，真实第二进程仍可接管。
- 锁反例仅模拟时间，未实际等待 16 分钟，未宣称观察到重复模型调用。公平测试统计真实策略执行，未以候选数量替代。
- 旧补位反例首跑被测试库无关策略占槽影响；Codex 将自己反例的策略注册表限定为自建策略并在 finally 恢复，保留断言，复跑 6/6 通过。未把该首跑失败认定为 R4 源码回归。
- R5 另有临时文件 PID 查错和父测试失败资源收尾缺口；专用夹具没有 HTTP 服务，相关交付表述需收窄。
- 修复交接见 `plan/opencode-task-011-codex-review-r3.md`；日志 `plan/logs/codex-task-011-r3-review/`。本轮未改运行实现、schema、原用户会话或开发库。夹具已清理，没有测试进程遗留；未重启未验收代码，未重复全部 18 项门禁或远程 CI。TASK-011 继续未完成，第三阶段未开始。

### 2026-10-06：TASK-011 第四轮修复（Codex 第三轮 REQUEST CHANGES）

- 新增反例 `tests/regression-worker-r3-boundaries.ts` 6 条为红。三类修复：
  - R3：服务游标只在「真领取」或「该组织饱和跳过」时推进，**总容量拒绝不推进**；并删除 `exhausted` 尾页预判（读完一页 ≠ 服务完这页）。三组合法配置 40/80、66/80、1/3 → 全部 80/80、80/80、3/3。
  - R2：once 串行路径把 admission 传到真实领取函数，并在每条后续候选前复查（串行兼容 ≠ 忽略停止信号）。
  - R1：删除所有按年龄接管存活 PID 的路径 —— 本机不同 PID 存活即拒绝接管，卡死进程先确认终止再取锁。
  - R5：父进程枚举全部 `lock.json.*.tmp`（原先按自己 pid 查，子进程残留永远查不到）；清理移入 finally 并确认子进程已退出；收窄夹具证据描述（无 HTTP、无真实 AgentTask、跑不到 10 秒心跳定时器）。
- 如实记录本轮自身失误：变异测试时用 `/tmp` 旧快照恢复现场，把刚删掉的 `exhausted` 灌了回去，导致公平性假性回退；改为按语义重写而非拷回旧文件，并清理了强杀进程遗留的 172 个夹具组织。
- 门禁 19 条全绿（含三组独立反例 16/16），日志 `plan/logs/opencode-task-011-r4/`。仍为**待验收**。
