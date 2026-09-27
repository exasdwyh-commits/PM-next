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

### 已完成：Display Layer（PR #40–#43，全部 CI 绿，待 review 合并）
规格见 `docs/KERN_DISPLAY_SPEC.md`（grill 3 轮，需求 v1 已定）。四个堆叠 PR：

| PR | 分支 | 内容 |
|---|---|---|
| #40 | `feat/kern-display-layer` → main | `KernMissionEvent` 表（seq 严格递增，advisory lock + 唯一约束）、`events.ts`、`controls.ts`（暂停/继续/取消/跳过/重跑/改计划/补充信息，owner-only，新增结局 `CANCELLED`）、`POST /control`、`GET /events?after=`、`GET /stream`（SSE，DB 轮询 1s，支持 Last-Event-ID） |
| #41 | `feat/kern-display-ui` → #40 | 对话实时进度卡 + 工作区抽屉（「过程」按成员分道、摘要/完整、重跑/跳过、插一句、加步骤；「产出」结论与消耗）。纯函数 `mission-timeline.ts` 有单测 |
| #42 | `feat/kern-display-output` → #41 | 澄清卡 + 计划卡（`brief.ts`）+ 演示模式（`demo.ts`） |
| #43 | `feat/kern-display-artifacts` → #42 | 决策卡、一键带走 Proposal（`takeaway.ts`）、MD/PDF 导出 |

已知限制（诚实记录）：
- 模型网关**不是流式**：`node.delta` 一次性发完整文本（`streamed:false`），打字效果由演示回放器做；
- `node.cite` 类型已预留，研究节点接入（P0-B）后才会真正产生；
- 跳过进行中的步骤：排队中子任务被取消，已在跑的会跑完但结果被忽略（可能多花一次模型调用）；
- `snapshot.log` 仍保留写入，未来切干净再移除；
- 工作区只有「过程 / 产出」两个页签，元信息并入产出底部，未做成第三个页签；
- 图表没有专门组件（已由 Response Layer 的 `chart` 块补上）。

### 当前阶段：Response Layer（回复呈现框架）
分支 `feat/kern-response-format`，叠在 #43 上。规格 `docs/KERN_RESPONSE_SPEC.md`。

解决的问题：Display Layer 让人**看得见过程**，但"Kern 说出来的内容长什么样"没有规范，模型直接吐 Markdown，排版和质量都不可控。

- **契约** `src/modules/response-format/types.ts`：`ResponseEnvelope` + 14 种 Block（含 `progress` 流式块、`clarify` 澄清块）。模型不再产出 HTML/Markdown 长文，排版由前端唯一决定 → 对话卡 / 工作区 / 导出 PDF 长得一致。
- **harness** `validate.ts`：14 条规则，同构（Node 测试与浏览器渲染器共用一份，避免两套真相）。error 级不渲染直接回退重跑，warn 级渲染标黄。重点规则：R3 事实必须带来源角标且角标不能悬空、R4 决策卡三段齐全、R9 AI 套话黑名单、R10 UNKNOWN 必须写清缺什么源、R13 信封类型与必备块对应。
- **渲染器** `src/app/muse/response/response-view.tsx` + `response.css`：14 种块的 TSX 实现，`parseInline` 不走 `dangerouslySetInnerHTML`；harness 失败时显示诚实失败态而不是渲染不合规内容。
- **适配器** `from-mission.ts`：`MissionReport → ResponseEnvelope`。**宁可降级不许编造**——三段拿不全就不生成决策卡、信封降级为 ANSWER；没有真实来源就不生成 evidence 块也不输出 fact 要点，挂诚实 callout。这样 harness 是真守门而不是被适配器绕过。
- **CI**：`npm run test:response-format`（24 用例全绿），已挂进 `test:delivery-contracts` 与 `kern-supervisor-ci.yml`。
- 预览页 `kern-response-framework/`（不在仓库，由 `build-conversation.py` 从仓库 `response.css` 直接构建，保证预览与产品同源）。

未接线：`ResponseView` 还没有替换 `muse` 现有的 prose 渲染路径，需要 supervisor 在写结论消息时同时产出 envelope。这是下一步。

### 环境踩坑（新沙箱复现用）
- 全新沙箱没有 `kern-env.sh` / bundle：需 `apt-get install postgresql`，自建 `kern_dev` + `hermes_test`。
- `node_modules` 与 apt 包都不进快照，每次恢复都要 `npm ci` + `npx playwright install --with-deps chromium`。
- 2GB 内存下 `next build` 会 OOM，改用 `next dev`；dev server + worker + Chromium 三者同时跑仍可能被杀，截图时先停 worker。
- **演示模式在全新库上会 422**：`Kern PM agent is not active; run workforce bootstrap first`。`prisma/seed.ts` 不 bootstrap workforce，必须先 `POST /api/workforce/bootstrap`。这与"没有模型也能把整条链路演示完整"的承诺有缺口，建议补进 seed 或让演示模式自动 bootstrap。

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

## 回复格式框架 PR ⑤（feat/kern-reply-format，基于 feat/kern-display-artifacts / #43）
- 规范 + Harness + 渲染三层，详见 docs/KERN_REPLY_FORMAT.md。
- persona 版本升到 2026-09-27-v3（附加格式规范）；对话引擎模型输出入库前 normalizeReply，结果写入 toolCall.resultJson.replyFormat；任务节点产出同样规范化；综合结论改为 `##` 分节。
- 渲染器重写：嵌套列表、任务清单、表格对齐/数字列、代码块复制、5 种提示框、事实标签；修复共享正则导致的死循环（已加回归测试）。
- 验证：tsc、eslint、kern-reply-format/prose/report 单测、kern DB 套件全过；next build；桌面/手机/暗色截图 shots/r-*, z3-*。
- 下一步：P0-D 每次模型调用前查额度，跳过/取消后不再调用模型。
