# Kern 工作记忆（给未来的自己 / 接手者）

> 目的：上下文会被压缩，这份文档是**唯一可信的进度汇总**。每完成一个阶段就更新。
> 事实优先级：代码 / DB / API / CI > 本文档 > 其他历史文档。

## 1. 产品定位（用户已确认）
- Kern = 面向“做产品的人”的私人 AI / Chief of Staff + Product OS。
- 链路：机会发现 → 验证 → 研发 → 推进 → 营销 → 结果 → 复盘。
- 对标：Meta Muse 这类 personal agent：
  - 像发消息一样交代；
  - 后台持续干活；
  - 只在需要批准或有变化时回来；
  - 会记住你；
  - 免费版 + 订阅版。
- 体验原则：
  - 用户只面对 Kern；
  - 内部越复杂，外部越简单；
  - 只在涉及战略、风险、权限、预算或不可逆动作时升级给人。

## 2. 协作约定（用户明确要求）
- 每个大阶段一个分支 / PR，**不直接推 main / release**。
  - ⚠️ 2026-09-26 例外记录：分支收敛时，另一会话把 `main`、`release` 直接快进到 `193ae32c`（未经用户 review），并自行 squash 合并了 #38。当时的回退点：旧 release `85c75bbc`、旧 main `5c3d08c7`。以后不再这样做：**只开 PR，由用户 review 后合并**。
- 默认分支：**`main`**（2026-09-26 起）。`release/v0.1.0-rc1` 冻结在 `193ae32c`，只是历史指针；main 继续前进属正常。
- 仓库已开启“合并后自动删除分支”；远程只保留 `main` 与冻结的 release。
- 每阶段都要过：typecheck、tests、CI、review。
- 大改要说明：为什么改、保留什么、替换什么、风险、如何验证。
- 不频繁问“要不要继续”；只在真正的战略分歧或要删用户可能在用的页面时才问。
- Token 只在对话里出现，**绝不写入文件**。
  - 推送命令：`git push https://x-access-token:$T@github.com/exasdwyh-commits/PM-next.git <branch>`。
  - 需要 classic token，勾选 `repo` + `workflow`（fine-grained 的写权限一直没生效）。

## 3. 已交付（全部 CI 绿）
| PR | 分支 | 内容 |
|---|---|---|
| #33 | feat/kern-supervisor-runtime → release/v0.1.0-rc1 | Supervisor：目标 → mission DAG → 真实子 AgentTask → QA/红队 → 综合结论回对话 |
| #34 | feat/kern-attention-home → #33 | Attention 首页、统一视觉、安全 Markdown、受阻汇报可读 |
| #35 | feat/kern-personal-agent → #34 | 继续续跑、KernMemory、今天简报、套餐与额度（OrganizationSubscription）、authz 修复 |
| #36 | — | ❌ 关闭未合并：与 #33/#34 重复实现 generic executor / attention（没看开放 PR 就开工的教训） |
| #37 | integration/kern-v2-final → release | #33+#34+#35 集成；release 与 main 快进到 `193ae32c`，tag `v0.1.0-rc1-kern-v2` |
| #38 | → main（`d179f8f7`） | 记忆条数额度真正执行（事务 + 组织级 advisory lock）；对话里超额如实告知；文档改为实际状态。**该修复不在 `v0.1.0-rc1-kern-v2` tag 里**；下次封版打 `v0.1.0-rc2`，不移动旧 tag |

补充说明：
- 同一 `source` 的记忆更新不占新额度；用户说两次“记住…”（source=null）仍会产生两条，以后做语义去重。
- 已删除 37 个已吸收远程分支（清单见 `docs/KERN_NEXT_PHASE_PLAN.md` 附录）；无 PR 或合并后又有新提交的 2 个分支保留为 `archive/*` tag。

关键模块：
- `src/modules/supervisor/{plan,service,generic-executor,attention}.ts`
- `src/modules/memory`
- `src/modules/billing`
- `src/app/muse/*`：Kern 对话 UI
- `components/{mission,prose,sheets,shell,turn}.tsx`

## 4. 环境备忘
- 每次开工先 `source /home/user/kern-env.sh`。
- 快照恢复后 `node_modules` 会丢，需要重跑 `npm ci`。
  - 分支也可能丢：用 `/home/user/*.bundle` 恢复。
- Postgres 17：`sudo pg_ctlcluster 17 main start`。
  - 测试库：hermes_test。
  - 预览库：kern_dev。
- 构建必须带 `NODE_OPTIONS=--max-old-space-size=1536 npx next build --no-lint`（2GB 内存）。
  - tsc 用 `--max-old-space-size=1800`。
- 预览：
  - 用 `next start -H 0.0.0.0 -p 3100`，DATABASE_URL 指向 kern_dev。
  - 账号：zhang_pm@hermes.test / kern-dev-2026。
- 需要服务端的验收测试要设置：`ACC_BUILD_NODE_OPTIONS=--max-old-space-size=1536 ACC_BUILD_FLAGS=--no-lint`。
  - 另外需要 `.env`（gitignored，从 kern-env.sh 生成）。
- 开发环境**没有模型**：所有 mission 都会以“模型服务不可用”停下。
- 注意：上面是**原开发沙箱**的备忘。其他会话的沙箱可能没有 `kern-env.sh` / bundle（例如 Postgres 需自行 `apt-get install postgresql`，按 CI 的环境变量建 `hermes_test` + `hermes_dev_guard`；build 需 `--max-old-space-size=3072`）。

## 5. 待办
- 当前阶段：**对话内全面展示（Display Layer）**。
  - 规格见 `docs/KERN_DISPLAY_SPEC.md`，grill 3 轮已完成，需求 v1 已定。
  - PR ①（事件 + 控制 + SSE，分支 `feat/kern-display-layer`）已开 PR，待用户 review：
    - `KernMissionEvent` 表（每个 mission 的 seq 严格递增，advisory lock + 唯一约束）；`src/modules/supervisor/events.ts`；
    - `controls.ts`：暂停 / 继续 / 取消 / 跳过 / 重跑 / 改计划 / 补充信息（owner-only）；新增结局 `CANCELLED`；
    - 路由：`POST /api/missions/[id]/control`、`GET …/events?after=`、`GET …/stream`（SSE，DB 轮询 1s，支持 Last-Event-ID）；
    - 模型网关还**不是流式**：`node.delta` 目前一次性发完整文本（`streamed:false`），打字效果由演示回放器做；
    - `node.cite` 类型已预留，研究节点接入（P0-B）后才会真正产生；
    - 跳过进行中的步骤：排队中的子任务会被取消，已在跑的会跑完但结果被忽略（可能多花一次模型调用）；
    - `snapshot.log` 仍保留写入，UI 在 PR ② 切到事件流后再考虑移除。
  - PR ① = #40。PR ②（分支 `feat/kern-display-ui`，叠在 #40 上）：对话进度卡（实时一句话、进度条、暂停/继续、查看过程/产出）+ 工作区抽屉（「过程」按成员分道、摘要/完整切换、重跑/跳过/移出、插一句、加步骤、QA 与红队、全部事件；「产出」结论、各步骤产出、为什么是这些成员/为什么需要你决定/消耗）。纯函数 `src/app/muse/mission-timeline.ts` 有单测。
  - 已知：Prose 不渲染 markdown 表格（显示原文），PR ③ 产出物里处理。
  - 下一步：PR ③ 演示回放、报告/对比表/图表/决策卡、一键带走（Proposal）、MD/PDF 导出。
- Display Layer 实现时要预留给后续阶段的接口：
  - `node.cite` 事件带 `sourceCaptureId` / URL / fetchedAt，引用能从研究节点一直传到结论卡与导出（为 citation lineage 预留）；
  - 快照里已加 `demo` 标记，事件表也有 `demo` 列；演示 mission **不能**用 `kern-mission/v1` schema（billing 按它计任务数），或在计费查询里显式排除 `demo=true`；
  - 事件里记录每次模型调用的耗时与额度，作为后续 cost guard / tracing 的数据来源。
- P1（顺序与验收细节见 `docs/KERN_NEXT_PHASE_PLAN.md`）：
  - 研究结论附来源：ResearchRun 与 mission 幂等绑定（`missionId + nodeKey + revisionRound`，续跑不重抓网页、不重复付费）；引用全链传递；安全边界（来源正文只当数据、SSRF / 私网拒绝、大小与超时上限、保留 URL / fetchedAt / hash、法规结论带辖区与日期）；
  - 每次模型调用前原子扣额度（**真实模型试用之前做**）+ 最小 tracing；
  - product-rnd 并入 playbook：新任务走 playbook，在途旧 run 按原路径跑完，旧 API 保留为 adapter，稳定一个周期后再删旧编排器；
  - 信息架构收敛（Kern / 产品 / 项目 / 设置）；
  - 反馈学习。
- Beta 验收：Worker 常驻（崩溃自动重启、开机自启、租约恢复、防重复 Worker、模型 / DB 断线恢复），然后打 `v0.1.0-rc2`。
- P1 Desktop Intelligence：屏幕理解、坐标点击、拖拽、视觉恢复还没有，不能把 Desktop Runtime 说成已完成的 Computer Use。
- P2：
  - 支付；
  - 多渠道推送；
  - 可观测性。

## Display Layer PR ③ 第一部分（feat/kern-display-output，基于 feat/kern-display-ui）
- 新增：任务简报（supervisor/brief.ts）——新产品先出澄清卡（2–3 题，可点选项；记忆命中显示「我记得」可改），确认后出计划卡（步骤/成员/为什么/预估额度，可删步），再「开始」或「演示运行」。
- 演示模式（supervisor/demo.ts）：同一套 UI，明确标注，不写业务数据、不计入任务额度。
- assistant-runtime：launch 决策改为先生成简报，不再直接开跑；额度满时提示可演示运行。
- API：GET/POST /api/missions/brief/[messageId]。
- 显示修复：工作区标题只取目标首行；侧栏预览去掉 Markdown 符号；产出步骤行对齐。
- 验证：tsc、eslint、kern-brief(B1–B6)、kern-supervisor(S5 走简报)、mission-controls、memory-quota、unit 全过；next build 通过；截图 shots/p3-*。
- 下一步：产出（表格/决策卡）、带走（Proposal，演示禁止）、MD/PDF 导出；再 P0-D 每次调用额度检查。

## Display Layer PR ④ 产出与带走（feat/kern-display-artifacts，基于 feat/kern-display-output / #42）
- `supervisor/report-format.ts`（纯函数，前后端共用）：目标首行、约束解析、「需要你决定」抽取、推荐方向、Markdown 表格、安全 MD→HTML、报告 MD。
- `supervisor/takeaway.ts`：读取节点完整产出（executorResult.output，而非 4000 字摘要）；一键生成提案——对话未绑定产品时「新建产品并立项」(CREATE_PRODUCT)，已绑定时「加到项目作为工作项」(CREATE_WORK_ITEM)；幂等；确认前不写业务；演示任务与未完成任务拒绝；仅本人。
- API：GET /api/missions/[id]/export?format=md|pdf（pdf = 可打印页，自动弹打印对话框），GET/POST /api/missions/[id]/takeaway。
- UI：产出页顶部「需要你决定」卡 + 「带走」栏（提案回执、导出 MD/PDF、演示说明）；Prose 支持表格。
- 验证：tsc、eslint、kern-report 单测、test:kern-takeaway（T1–T7）及既有 kern 套件全过；next build；截图 shots/p4-*。
- 下一步：P0-D 每次模型调用前查额度，跳过/取消后不再调用模型。
