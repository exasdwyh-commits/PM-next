# Hermes Next Phase 3 · 执行任务书

**用途**：可直接派发给 GPT-6 / Codex 落地。
**依据**：《ACCEPTANCE_REPORT.md》（2026-09-15）+ 四路只读代码实测（43 条 API 路由 / 顾问与分析链路 / 成本与验证链路 / 知识链路）。
**当前门槛（唯一真相源 = `ACCEPTANCE_REPORT.md` §5 十项逐项表；禁止手填总数）**：**3 达成（1 / 5 / 6）· 7 部分（2 / 3 / 4 / 7 / 8 / 9 / 10）· 0 阻塞**。
**目标（由起点逐项推导，不是拍脑袋）**：门槛 **3 / 4 / 8** 由「部分」→「达成」⇒ 6 项；门槛 **7** 仅在明确建 Worker（A4b）时才算「达成」；再补齐门槛 **2**（成本引擎接线 + `DataGap` 闭环）⇒ **8 项**；门槛 **9 / 10** 视收尾 ⇒ **8~9 项实质达成**。每一项都必须有可复现证据。
**统计纪律**：任何「X 达成 / Y 部分」的数字，只允许从 §5 逐项表**推出**；提交前必须重新对账，不得沿用旧数字（本任务书上一版顶部的「5 达成 / 4 部分 / 1 阻塞」即因手填而与逐项表不符，已订正）。

> **v2 修订要点（相对上一版）**：① 统一门槛口径，§5 为唯一真相源；② **权限收口 B4/B5/B6 提前到真实模型接入之前**；③ A4 拆为 **A4a（必做）/ A4b（需先定运行架构）**；④ D 部分**减范围**（D2 最小化、D3 延期）—— 减范围 + 调顺序 + 修口径，**不新增功能**。

> 本文档中所有 `文件:行号` 均为实测结果，不是推测。执行时若发现与代码不符，**以代码为准并把本文档改对**。

---

## 0. 给执行者的九条硬约定（先读，违反等于返工）

1. **不许造数。** 没有真实输入就不显示数字，写「暂不能计算」/「未设置」/「未知」，不写占位金额、不写占位百分比。金额永远由确定性代码算，不由模型估。
2. **「已实现」≠「路径被执行过」。** 提交前必须回答：这条分支在**真实数据**下渲染过吗？库里数据恰好绕开它，就等于没验。**直接查库核实，不要读代码推断。**
3. **只隐藏按钮不算权限。** props 会随 RSC 负载到达浏览器，接口会被人直接调用。任何"非管理员看不到"的要求，必须在**服务端**落地，并用真实 HTTP 探测证明。
4. **不得为了让断言变绿而放宽断言。** 断言失败时先判定是「脚本过时」还是「源码缺陷」；是源码缺陷就修源码。禁止把失败项改成"跳过"或改成永真条件。
5. **修 UI 之前先修数据与权限。** 页面好看不能替代数据可信。
6. **验收必须覆盖正反两面。** 只测「该显示时显示」会漏掉「门禁写成常开」；只测「没有」会漏掉「该有却没有」。
7. **文档与代码冲突时以代码为准**，并把文档改对（见 §7 已知说谎清单）。
8. **不要因为加了能力就把页面做回复杂 Dashboard。** 三层阅读规则是产品决策，不是临时样式：**默认只看结论 → 再看主题 → 数据按需下钻**；每页最多一个主按钮；颜色语义 红=阻断 / 黄=关注 / 中性=缺资料不警告。
9. **门槛统计不许手填。** 唯一真相源是 `ACCEPTANCE_REPORT.md` §5 十项逐项表；本文档顶部、任何汇报、任何批次小结里的「X 达成 / Y 部分」，都必须由那张表**逐项推出**，并在提交前重新对账。**同一事实在两个地方有两种说法，等同缺陷。**

---

## 0.1 顺序纪律：先把 AI 能碰到的门锁好，再把 AI 放进去

这是本版的**核心调整**，不是建议：

- A2 / A3 会第一次让模型具备**工具调用能力**。在那之前，"某接口能被人手工访问"只是数据暴露；在那之后，同一批缺口会变成**顾问自动读取、总结甚至操作不该接触的数据**。
- 因此 **B4（产品写路由授权）/ B5（外部 id 归属校验）/ B6（RSC 与响应字段白名单）必须整体排在 A2 / A3 之前**，并且 B6 已确认要下发的内部字段（`runnerPid`、`runnerBootId`、原始 `inputJson` / `resultJson`、`fileKey`、登录响应里的 `token`）必须先收干净。
- 判断标准很简单：**在给工具之前，任何一个"模型能读到的接口/负载"都必须是已经做过服务端鉴权与脱敏的。**

---

## 1. 四条工作流的现状基线（实测）

| 工作流 | 已具备（真实可用） | 关键缺口 | 对应门槛 |
| --- | --- | --- | --- |
| **A 真实模型** | 白名单工具链、`AgentRun`/`ToolCall`/`Message` 落库、幂等回执、运行时状态通道 | **全仓没有任何模型 HTTP 调用**；无 SDK、无 API Key 读取；`runAgent` 只存在于注释里 | 3、7 |
| **B 权限** | `requireProjectRole` 是唯一权威项目级门禁；`session.ts:146-149` 生产态出现 `x-user-id` 直接 403；知识源/同步/事实写接口已 `assertOrgAdmin` | 10 个产品写路由**有身份无授权**；3 条真实泄露；组织级角色靠"项目 OWNER"近似 | 8 |
| **C 产品经营** | **`src/modules/cost-engine/` 是完整的 12 文件纯函数成本引擎**（含 426 行 golden test）；`Evidence` 已有 4 个验证字段 | 成本引擎**只被 1 处调用**、产品页零引用；无 BOM/报价/供应商模型；`DataGap` 只进不出 | 2 |
| **D 知识/Obsidian** | 同步**真实读磁盘**、按标题切分、内容哈希增量、`KnowledgeSyncRun` 计数完整 | 检索只做 ILIKE；无 wikilink 解析；无增量触发；**门槛 4 的测试用的是临时目录不是真实 Vault** | 4 |

---

## 2. 工作流 A（P0）：真实模型闭环 —— 门槛 3 + 7

> **执行位置（见 §9）**：**A4a 属 Phase 3A**（安全底座，先做）；**A1 / A2 / A3 属 Phase 3B**，必须等 B4 / B5 / B6 收口之后才可开工；**A4b 待 §8 架构决策**。

### A1. 建立模型客户端与配置层（新增，无破坏性）

**现状事实**
- `package.json:32-37` 依赖只有 `@prisma/client`、`next`、`react`、`react-dom` —— 无 `openai` / `@ai-sdk/*` / `langchain`。
- `src/` 内 `fetch(` 全部指向相对路径的内部路由，**无一指向外部域名**；无 `axios` / `undici` / `https.request`。
- 环境变量只读两个：`ADVISOR_MODEL_PROVIDER`、`ADVISOR_MODEL_ID`（`src/shared/runtime-status.ts:20-21`）。
- **`ADVISOR_BASE_URL` / `ADVISOR_API_KEY` 从未被任何代码读取** —— 只在 `src/app/settings/page.tsx:126` 的文案里被承诺为"所需环境变量"。

**要做的事**
1. 新增 `src/modules/llm/client.ts`：provider 无关的 `fetch` 封装 + `AbortController` 超时（超时常量集中定义，禁止散写）。禁止引入重 SDK；如确需依赖，先说明理由。
2. 新增 `src/modules/llm/config.ts`：读取 `ADVISOR_MODEL_PROVIDER` / `ADVISOR_MODEL_ID` / `ADVISOR_BASE_URL` / `ADVISOR_API_KEY`，并提供 `isModelConfigured()`（四项齐全才算已配置）。
3. 扩展 `src/shared/runtime-status.ts`：区分「未配置」与「已配置但**未验证可达**」（现在 `runtime-status.ts:13-14` 的注释已承认不探测可达性）。同步在 `.env.example` 补上这四个变量名与说明。

**验收判据**
- 未配置 API Key 时：`runtime-status` 仍然如实报"未配置"，且**不发起任何网络请求**（可在 client 层抛错前打日志断言）。
- 配一个不可达的 `ADVISOR_BASE_URL`：请求在超时时间内失败，返回**可读的错误原因**，不泄露 baseURL 与 Key。

---

### A2. 顾问走真实模型 + 工具调用协议

**现状事实**
- `src/modules/advisor/service.ts:434-563` 是 `sendMessage` 全流程，`runMode` **硬编码** `RunMode.TEST_STUB`（`service.ts:458`），注释原文：「未配置模型时明确标 TEST_STUB；配置了也仍走确定性工具（真实模型接入未实现）」。
- 回复由 `runTool`（`service.ts:178-432`）的 `switch` 确定性分支产出；工具白名单 7 项在 `service.ts:462-470`。
- **工具拿不到对话历史**：`runTool` 只接收 `{ conversationId, productId, text }`（`service.ts:164-168`），不读 `Message` 表。历史消息目前只用于 UI 展示与标题生成。
- 免责声明 header 在 `service.ts:527-529`，两态文案：
  - 未配置 → `（本轮未接入语言模型，以下为按白名单工具查得的真实数据）`
  - 已配置 → `（注意：已配置模型端点，但本轮仍由确定性工具回答，模型接入尚未实现）`
- `service.ts:10` 的注释称「接入真实模型后，只需替换 runAgent 中的 reply 生成部分」—— **全仓不存在 `runAgent` 函数**（仅此处注释一处出现）。

**要做的事**
1. **先修注释与实现的不一致**：要么实现 `runAgent`，要么把 `service.ts:10` 的注释改成描述真实调用点。不允许保留"声称存在但不存在"的接入点。
2. 给 `runTool` 传入最近 N 轮消息，让工具与模型都能看到上下文。
3. 把 7 个白名单工具改造成模型可调用的工具 schema（`toolWhitelist` 目前是硬编码数组 `service.ts:462-470`，应从工具注册表生成）。
4. **三态 header**：真模型 / 回退确定性工具 / 未配置，三态必须**如实可区分**。
   > ⚠️ 前端用正则 `/^（[^）]*）\n\n/` 拆解这条 header（`src/app/advisor/advisor-client.tsx:67-69`）。**改文案必须同步改前端**，否则会重现"免责声明被当成结论"的旧缺陷。
5. 模型不可用/超时：**回退到确定性工具**并把 `runMode` 与 header 标为回退态，不得静默降级。

**验收判据**
- `AgentRun.runMode` 能出现 `AUTOMATED`（该枚举成员在 `schema.prisma:322` 存在但**当前零写入方**）。
- `AgentRun.usageJson` 记录真实 token 用量（现写死 `{ note: "未接入模型，无 token 计量" }`，`service.ts:549`）；`costStatus` 不再是 `unknown`（`service.ts:550`）。
- 断网/端点不可达时：回复仍可用（回退），且 header 明确说明"本轮模型不可用，已回退确定性工具"。
- 前端仍能正确拆分「结论 / 元信息」两段。

---

### A3. 产品分析接入模型（但金额仍由代码算）

**现状事实**
- `src/modules/product-development/analysis.ts:339` 写入 `runMode: RunMode.MANUAL`（注释：规则合成，非模型调用）。
- `AnalysisRun.provider`（`schema.prisma:922`）与 `modelId`（`:923`）**恒为 null，无任何读取方** —— 已为真实模型预留但未接线。
- `AnalysisRun.status` **硬编码** `"SUCCEEDED"`（`analysis.ts:335`）；`errorReason`（`schema.prisma:927`）无写入方。
- `AnalysisRunStatus` 枚举只有 `RUNNING / SUCCEEDED / FAILED`（`schema.prisma:887-891`），**无 TIMEOUT / CANCELLED**。
- 六维权重 `scoring.ts:16-23`：需求价值 25 / 差异化 20 / 单位经济性 20 / 公司适配 15 / 交付可行性 10 / 上市准备度 10；覆盖率阈值 `PROVISIONAL_COVERAGE_THRESHOLD = 0.8`（`scoring.ts:44`）。

**要做的事**
1. 定性维度（需求价值 / 差异化 / 公司适配）允许模型参与，但**每条判断必须带 `evidenceRefs` 指向真实证据**；无证据的维度继续 `null`。
2. **单位经济性维度继续走 `scoring.ts` 的确定性代码**（`scoring.ts:97-100` 已声明"金额永远由确定性代码算，不由模型估"），不得改为模型估算。
3. 落 `provider` / `modelId` / `runMode`；失败时写 `status=FAILED` + `errorReason`，不再一律 `SUCCEEDED`。
4. 未知项保持 `null`；覆盖率 <80% 继续标「暂评」。

**验收判据**
- 库里能查到一条 `runMode=AUTOMATED` 且 `provider`/`modelId` 非空的 `AnalysisRun`。
- 模型失败时 `status=FAILED` 且 `errorReason` 非空，页面**不显示任何分数**（而非显示 0 分）。
- 同一份输入 + 同一份证据，走确定性代码的金额可复算一致。

---

### A4a. 【Phase 3A 必做】幂等占位泄漏 + 调用超时 + 失败可重试

> **边界**：本节只依赖"Next 请求内同步调模型"这一现状，**不引入任何运行架构变更**。
> 目标状态是"失败可见、可重试"，**不是**"工业级任务编排"。

**现状事实（先修，真实缺陷）**
- `IdempotencyRecord` 用 `responseStatus = 0` 表示"处理中占位"（`src/modules/advisor/proposals.ts:463-464`），但**进程崩溃后该占位记录永不清理**：清理只发生在 `catch` 分支（`proposals.ts:692,696`）。后果：同一幂等键的后续重试被**永久阻塞**（`proposals.ts:516-518`）。
  → **必须最先修**：为占位记录加时间上限（超时即视为失败、可重试）。否则后面所有"重试验证"都会被它污染。

**现状事实（超时能力缺失）**
- 全仓**无** timeout / abort / retry：`src/` 内 `AbortController`、`AbortSignal.timeout` 零命中。
- `AnalysisRun.status` **硬编码** `"SUCCEEDED"`（`analysis.ts:335`）；`AnalysisRunStatus` 枚举只有 `RUNNING / SUCCEEDED / FAILED`（`schema.prisma:887-891`），**无 TIMEOUT / CANCELLED**。

**要做的事**
1. 修幂等占位泄漏（加 TTL，超时视为失败可重试）。
2. 统一模型调用超时（与 A1 的 `AbortController` 常量同源，禁止散写）。
3. 超时 / 失败两态**真实写入** `AgentRun` / `AnalysisRun`（含 `errorReason`），不得一律 `SUCCEEDED`。

**验收判据**
- 断掉模型端点：可复现「超时 → `status=FAILED` + `errorReason` 非空 → 重试成功」完整链路。
- 进程崩溃后：同一幂等键**不被永久阻塞**，重试能成功。

---

### A4b. 【门槛 7 的"达成"部分 · 需先定运行架构】Worker / lease / heartbeat / 取消 / 崩溃接管

> ⚠️ **不要在本轮顺手接字段。** `leaseOwner` / `heartbeatAt` / `cancelRequestedAt` / `attempt` 只有在**存在独立任务执行器（Worker 或队列）**时才有真实语义。
> 否则结果就是"数据库里有一堆 worker 字段，看起来工业级，实际还是 Next 请求里同步跑模型"——**假工程化比不写更糟**，因为它会让后续审计误判门槛 7 已达成。

**现状事实（预埋但零读写）**
- 以下字段全部**零读写**：`AgentRun.leaseOwner`（`schema.prisma:1081`）、`heartbeatAt`（`:1082`）、`cancelRequestedAt`（`:1083`）、`attempt`（`:1079`）、`receiptId`（`:1093`）。
- 以下状态**无任何写入方**，即永远不会出现：`AgentRunStatus.QUEUED / WAITING_CONFIRMATION / CANCELLED`（`schema.prisma:1056-1061`）、`RunReceiptStatus.PENDING / CANCELLED`（`:313,316`）、`ActionProposalStatus.EXPIRED`（`:1129`）。
- 唯一的恢复逻辑在研究模块：`research-run.ts:340-351` `resumeResearchRun`（`startedAt < now - 2min` 且 `runnerBootId != BOOT_ID` 则重置为 QUEUED）。但 `BOOT_ID` 是**硬编码常量** `"research-run"`（`research-run.ts:26`），因此**同 boot id 的进程重启无法被识别**。

**前置决策（见 §8 第 6 条）**：本轮是否正式引入独立 Worker / 队列运行时。

- **决定「建」** → 正式建 Worker：把任务从 HTTP 请求里剥离；`lease` + `heartbeat` + 取消 + 崩溃接管**成对实现**；`BOOT_ID` 换成真实进程启动标识（pid + 启动时间戳）。
- **决定「不建」** → **本节整体延期**。门槛 7 只按 A4a 记录（比现在更实，但**仍标「部分」，不得标「达成」**）。

**验收判据（仅当决定「建」）**
- 中途取消：`cancelRequestedAt` 被写入且任务进入 `CANCELLED`。
- 杀掉 Worker 进程后：任务在 lease 超时后被**另一个 Worker 接管**并跑完，`attempt` 递增。
- 同 boot id 的重启可被识别（`BOOT_ID` 不再是常量字符串）。

---

## 3. 工作流 B（P0）：权限系统性收口 —— 门槛 8

> 对 ToB 演示系统，这一层重要性高于再加页面。
>
> **顺序是硬约束：本工作流（B1–B8）整体排在「真实模型接入 A2 / A3」之前。**
> 理由：A2/A3 会第一次让模型具备工具调用能力。在那之前，"某接口能被人手工访问"只是数据暴露；在那之后，它会变成**顾问自动读取、总结甚至操作不该接触的数据**。**先把 AI 能碰到的门锁好，再把 AI 放进去。**
>
> 以下 B1–B3 是**已实测的真实泄露**，改动小、风险低，是本阶段第一件事。

### B1. 【真实漏洞】`GET /api/knowledge/facts` 缺少管理员校验 —— 页面收口被接口绕过

**证据（已由我本人复核）**
- `src/app/api/knowledge/facts/route.ts:12-24` 的 `GET` **只有 `getServerSession`**，没有 `assertOrgAdmin`（同文件 `POST:29`、`PATCH:41` 都有）。
- 返回体含每条事实的机器 `key` 与原始 `category`（`src/modules/knowledge/facts.ts:10-20`）。
- 而页面 `src/app/knowledge/page.tsx:40-45` **明确剥离**了非管理员的 `key` / `category`。
- → 结论：**"只隐藏按钮不算权限"的教科书案例**，页面做了收口、接口裸奔。

**要做的事**：给 GET 加 `assertOrgAdmin`；若产品要求非管理员也能看事实，则必须对非管理员**剔除** `key`/`category`（与页面口径一致）。

**验收判据**：用一个非管理员会话直接 HTTP 调该接口，**拿不到 `key`**（真实探测，不是看代码）。

---

### B2. 【真实漏洞】`settings` 页审计查询缺组织过滤 —— 且同段代码其余查询都带了

**证据（已由我本人复核）**：`src/app/settings/page.tsx:25-46` 的同一个 `Promise.all` 里，`knowledgeSource` / `agentRun` / `signalItem` / `product` 四个查询**都**带 `where: { organizationId: session.organizationId }`，**只有** `prisma.auditEvent.findMany({ orderBy, take: 10 })`（`:37-41`）**没有 where** → 取全库最新 10 条审计事件。

**要做的事**：补组织过滤。若 `AuditEvent` 无 `organizationId` 列，则按 actor 的组织关系过滤（先确认 schema，**不要靠加列绕过**）。

**验收判据**：跨组织数据不再出现在该页；补一条跨组织审计事件后可复现"过滤生效"。

---

### B3. 【真实漏洞】`/api/health` 无鉴权且回传内部信息

**证据（已由我本人复核）**：`src/app/api/health/route.ts` 全文无任何 session 调用（43 条路由中，匿名可达是**有意**的），返回 `database`（库名）、`version`（PG 版本），`catch` 里把 `error.message` 原样回传。

**要做的事**：拆成「公开的最小状态」与「需鉴权的详情」；错误信息不回传原文。

**验收判据**：未登录 GET 只拿到 `{ status }`，无库名、无版本、无原始错误。

---

### B4. 10 个"有身份、无授权"的产品写路由

**证据**：以下路由**只校验组织归属、没有任何角色/成员校验**，即**本组织任意用户可改任意产品**：

| 路由 | 方法 | 校验现状 |
| --- | --- | --- |
| `src/app/api/products/route.ts` | GET / POST | GET 返回本组织**全部**产品（不按成员过滤）；POST 无角色 |
| `src/app/api/products/ingest/route.ts` | POST | 无角色；且调用者自动成为新项目 OWNER（`products/service.ts:226-228`） |
| `src/app/api/products/[id]/versions/route.ts` | POST | 仅 org（`products/service.ts:54`） |
| `src/app/api/products/[id]/analyses/route.ts` | POST | 仅 org（`analysis.ts:88`），会写 `AnalysisRun` 并推进生命周期 |
| `src/app/api/products/[id]/revisions/route.ts` | GET / POST | 仅 org（`revision.ts:165,332,652`）；POST 可改任意产品方案字段并新建版本 |
| `src/app/api/products/[id]/revisions/compare/route.ts` | GET | 仅 org（`revision.ts:564`） |
| `src/app/api/signals/route.ts` | GET / POST | 仅 org（`manual-signal.ts:69,92`） |

**要做的事**：新增 `requireProductRole(session, productId, roles)`，**复用 `requireProjectRole` 的既有模式**（`src/modules/identity/session.ts:266-296`：先查 `ProjectMember`，再校验 `member.project.organizationId === session.organizationId`，最后校验角色白名单）。注意产品可能关联多个项目，需明确取哪一个的成员关系（建议：该产品所属任一项目具备所需角色即通过，并把这条口径写进注释）。

**验收判据**：非成员 / 低角色调用上述写接口返回 403；组织隔离仍然正确（不可跨组织）。

---

### B5. 请求体直写外部 id，未校验归属

**证据**：
- `src/modules/launch/service.ts:288`（`ownerId: params.ownerId`）、`:359`（update 同）、`:408` / `:440`（里程碑 `ownerId`）、`:413` / `:444`（`workItemId`）—— **均直接采信请求体**，未校验该 user 属本组织、该 WorkItem 属同一项目。
- `src/modules/knowledge/facts.ts:56`（`sourceDocId`）、`:103`（`supersededById`）—— 同样未校验归属。
- 对照**做对的反例**：`src/modules/projects/service.ts:40-50` 校验了 `decisionMakerId` 同组织；`src/modules/work/service.ts:31-43` 对依赖项做了同项目校验。

**要做的事**：按反例补齐归属校验。

**验收判据**：传入外组织的 `ownerId` / 其它项目的 `workItemId` 被拒（422 或 403，且错误文案说明原因）。

---

### B6. RSC 整对象下发与内部字段泄露

**证据**：
- `src/modules/research/research-run.ts:354-371` 用 `include` **无 `select`**，返回整行 → `runnerPid`（`schema.prisma:777`）、`runnerBootId`（`:778`）、原始 `inputJson`（`:774`）/`resultJson`（`:775`）**直接下发到浏览器**（经 `api/research-runs/[runId]/route.ts:21-29` 与 `api/projects/[id]/research-runs/route.ts:34-42`）。**进程 PID 与启动标识属内部实现细节。**
- 10+ 页面用 `JSON.parse(JSON.stringify(整个 prisma 对象))` 作为 props：`src/app/page.tsx:34-36`、`war-room/page.tsx:47-49`、`projects/[id]/page.tsx:169-175`、`products/[id]/page.tsx:36-37`、`products/page.tsx:49-51`、`consultation/page.tsx:51-54`、`advisor/page.tsx:92-98`、`opportunities/page.tsx:28-30`、`dashboard/page.tsx:62`、`trace/page.tsx:52-54`。其中 `projects/[id]/page.tsx:169` 下发的 `project` 含全部 `receipts`、`submissions.artifacts`、`decisionPackets.snapshot`、`evidences` 全字段（含 `hash`/`fileKey`/`mimeType`）。
- `src/app/api/auth/session/route.ts:61-67` 登录响应体**同时回传 `token`**（同时另设了 httpOnly cookie，`70-76`）→ token 可被 JS 读取。
- `src/app/api/projects/[id]/suggestions/route.ts:21,50` 绕过 `handleApiError` 自行返回 `err.message`，**不受 `src/shared/api-handler.ts:26` 的生产态降级保护**。

**要做的事**
1. `research-run` 加 `select` 白名单，剔除 `runnerPid` / `runnerBootId` / 原始 JSON（只给已发布的快照）。
2. 上述页面逐个改为 `select` 白名单，只下发 UI 真正需要的字段。
3. 登录响应体不再回传 `token`（已有 httpOnly cookie 足够）；若为兼容非浏览器客户端需要 token，走独立路径并记录理由。
4. `suggestions` 路由改用统一 `handleApiError`。

**验收判据**：抓页面**原始 HTML / RSC 负载** grep `runnerPid`、`runnerBootId`、`rootPath`、绝对路径，**零命中**；登录响应体无 token（除非显式走独立路径）。

---

### B7. 组织级角色（根治，需业务方拍板）

**证据**：schema **无 `OrganizationMember` 表**；`Role` 枚举 6 值（`schema.prisma:39-46`）含 `ORG_ADMIN`，但**全库无人持有**；`User` 上**没有** role 字段，角色只能挂在 `ProjectMember.role`（`:110`，非空）。因此 `isOrgAdmin`（`src/modules/identity/admin.ts:24-37`）实际等价于「是否为本组织**任一项目**的 OWNER」，且**仅 3 处消费**（`api/knowledge/sources/route.ts:12,23`、`sources/[id]/sync/route.ts:13`、`api/knowledge/facts/route.ts:29,41`、`knowledge/page.tsx:26`）。`launch/service.ts:76-90` 又用了另一套近似（OWNER 或 DECISION_MAKER）。

**要做的事**：新建组织级成员/角色模型，把 `isOrgAdmin` 与 `assertLaunchWritePermission` 统一到同一口径。这是**架构决定，需业务方确认**（见 §8）。

**验收判据**：存在一个"不是任何项目 OWNER 但是组织管理员"的用户，且其权限与 OWNER 不同 —— 证明两者已解耦。

---

### B8. 建立**自动化**越权矩阵（不靠人肉埋 canary）

**现状**：门槛 8 目前只有"知识接口 + 知识页"的实证，且靠人肉建会话 + 埋 canary。

**要做的事**：写表驱动脚本，遍历 **路由 × 角色 × 组织**（4 类角色 × 2 个组织），逐条对比期望码，输出矩阵。

**验收判据**：43 条路由全覆盖；任一新增路由未登记鉴权口径即判定失败（防止回归）。

**状态：✅ 已实施（2026-09-15，PC-0 / B8）**
- `tests/authz-matrix.ts`：43 路由 / 60 方法全登记，含 `validationFirst`（先校验后鉴权）标记与 owner 门禁期望。
- `tests/acceptance-authz-matrix.test.ts`：① 登记覆盖（文件系统有而未登记 → 失败）② 逐格状态码 ③ 跨租户响应体不得含他组织标记 ④ 内部字段（`fileKey`/`runnerPid`/`runnerBootId`/各 `*ById`）不得下发 ⑤ **零写入断言**（跨组织与匿名整轮跑完后相关表计数与既有行指纹不变）。
- 结果：**434/434 通过，连续两次复跑一致**。
- 顺带实测登记 3 项缺陷（**已登记未修**，见 `docs/contracts/PRODUCT_CENTER_CONTRACTS.md` §7.3）：`Product.identityCode` 唯一冲突返回 500 而非 409；手工 `SignalItem` 的 `hash` 未按组织隔离 → 跨组织同标题返回 422「该信号已属于其他组织」（泄露存在性）；`isOrgAdmin` 近似为"任一项目 OWNER"导致自升权（= B7）。

---

## 4. 工作流 C（P1）：产品经营数据层 —— 门槛 2

### C1. 【最高杠杆】把已有的成本引擎接到产品页

**现状事实（本次最重要的发现）**
- `src/modules/cost-engine/` 是一个**完整、可运行的 12 文件纯函数成本引擎**：`calcCost`（`index.ts:48`）、`CostInput`（`types.ts:50`）、六层成本 `layer1Material…layer6Allocation` + `totalBomCost` / `totalChannelCost` / `totalCost`（`types.ts:173-193`）、16 项税费（`types.ts:196-229`）、利润指标（净利率 / BOM 毛利率 / 盈亏平衡量）与供应商报价（保底价 / 建议价 / 顶价）（`types.ts:232-251`）、渠道预设 `CHANNEL_PRESETS`（`presets.ts:229`）、自检 `checkCost`、**426 行 golden test**。
- **生产代码只有一个调用点**：`src/modules/products/product-suggestion.ts:165`（项目侧"产品建议包"）。产品详情「成本与供应」页签**零引用**（已 grep 确认）。
- 该页签是**内联 JSX 常量** `costTab`（`src/app/products/[id]/product-overview-client.tsx:482-533`），并非空壳：`hasCostInput = !!currentVersion?.targetCost`，无输入时显示「**暂不能计算**」（`:494`）。六层模型只在文案里被提到（`:498-499`），**没有任何一层被渲染**。

**要做的事**
1. 写 adapter：`ProductVersion.specs` / `targetCost` / `currency` + 渠道与报价输入 → `CostInput`。
2. 在 `costTab` 渲染六层结果与利润指标。**有输入才算，无输入继续「暂不能计算」**。
3. 不改 `cost-engine` 的计算语义（它有 golden test 保护），只做接线。

**验收判据**
- 给定输入时，页面上六层数字与 `calcCost` 直算结果**一致**（用同一输入跑脚本比对）。
- 无输入时页面上**没有任何**金额数字。

> ⚠️ 附带：`docs/plans/2026-09-14-module-experience-execution-report.md:47` 声称"成本与供应页签 目标成本 ¥55.84 真实连通"，但 `¥55.84` 在 `prisma/seed.ts` 与源码中**均不存在**，无法复现（见 §7）。

---

### C2. 新建成本/供应数据模型

**现状**：以下模型在 `schema.prisma` 与 6 个迁移中**均不存在** —— `BomRecord`、`Quote`（报价：供应商 / 单价 / 有效期）、`Supplier`、`CostRecord`、`ChannelCost`。
现有可用的只有：`ProductVersion.targetCost`（`schema.prisma:253`，`Decimal(12,2)`）与 `currency`（`:254`）。
`DecisionPacket.budgetAmount`（`:636`）是**预算**不是成本，不要混用。

**要做的事**：加模型 + 录入 UI。**报价有效期（`quoteValidUntil`）是 G4 打样硬门槛之一，必须落库。**

**验收判据**：报价有效期为空 / 已过期时，打样门槛**不放行**（服务端拒绝，不是按钮禁用）。

---

### C3. 验证与风险台账

**现状事实**
- `Evidence` 上**已有 4 个验证字段**：`validationSampleSize` / `validationTimeRange` / `validationLimitations` / `validationStatus`（`schema.prisma:498-504`），并有 `ValidationStatus` 枚举 `UNAPPLIED / IN_PROGRESS / VERIFIED_BY_LEAD`（`:467-471`）。
- **但「验证与风险」页签只读了 `validationStatus`**，另 3 个字段完全没渲染 → 已有数据被浪费。
- 缺 `SalesValidation`、缺 `Risk` 模型；当前"风险"是运行期派生（`products/service.ts:368-371` 取 `AnalysisDimension.gaps` 前 3 条）。

**要做的事**
1. **先做低成本项**：把已存在的 3 个验证字段渲染出来（样本量 / 时间范围 / 局限）。
2. 再建试销验证模型（停止线阈值需业务方给，见 §8）。
3. 铁律：**停止线是硬约束，触线即建议停止**；结论由人确认并必附依据。

**验收判据**：样本量/时间范围/局限三项在页面上可见；无数据的项目显示"未建档"而非空白。

---

### C4. 【真实断链】`DataGap` 只进不出

**现状事实**
- `DataGap` 模型（`schema.prisma:562-580`）含 `status(OPEN|FILLED)`、`resolvedByEvidenceId`、`resolvedAt`。
- **`resolvedByEvidenceId` / `resolvedAt` 在全仓 `src/` 下零引用**（已由我本人 grep 确认）→ 缺口**永远停在 OPEN**，闭环在"关闭"这一步断了。
- 唯一写入口是 **GET 的副作用**：`src/app/api/projects/[id]/evidence-gaps/route.ts:38-45`（upsert，只写 OPEN，`update: {}`）。
- `getProductOverview` 已 select 出 `dataGaps`（`products/service.ts:334-336`），但**产品页从不渲染**。
- **"缺口 → 任务"链路不存在**：`WorkItem` 的四处真实创建入口（`work/service.ts:16`、`advisor/proposals.ts:618-630`、`products/product-suggestion.ts:409`、`collaboration/service.ts:84`、`decisions/service.ts:560`）**没有一处读 `DataGap`**。现有动作只有：抛错阻断（`product-suggestion.ts:286`）与生成方案草案（`revision.ts:186-194`）。
- `computeEvidenceGaps`（`research/evidence-claims.ts:185`）的 `fieldKey` 只硬编码 6 个市场字段（`:192-199`：price / salesVolume / netWeight / dosageForm / targetAudience / channel），**没有成本 / 报价 / 合规字段域**。
- `DataGap` 挂在 `Project` 上（`:564,573`），产品页是 Product 层，无直接归属。

**要做的事**
1. 补证后回填 `resolvedByEvidenceId` / `resolvedAt` 并置 `FILLED`。
2. 产品页渲染缺口（现成数据，零成本）。
3. 实现"缺口 → `WorkItem`"转换（标题/目标由 `DataGap.fieldName` / `description` 映射），并让验收通过后回写缺口状态。
4. 把缺口字段域从 6 个扩到成本 / 报价 / 合规。

**验收判据**：录入一条证据关闭缺口后，`DataGap.status=FILLED` 且 `resolvedByEvidenceId` 指向该证据；从缺口能一键生成 `WorkItem`。

---

## 5. 工作流 D（P1）：企业知识 / Obsidian —— 门槛 4

> **本轮 scope（重要 —— 防止把 Phase 3 做成"半个自研 Obsidian / RAG"）**
>
> 本部分只确保五件事：
> ① 挂在**真实 Vault** 上（D5）；② `include` / `exclude` / `enabled` 真正生效（D1）；③ 检索**稳定不漏召**（D4 的 `orderBy`，一行改动）；④ 内容更新后顾问能**引用到新版本**；⑤ **引用来源可追踪**（能说明某条事实 / 切片来自哪个文件的哪个版本）。
>
> **降级 / 延期**：D2（wikilink / alias / properties / 完整 YAML）**只做最小必要部分**；D3（增量 watcher、rename identity）**本轮延期** —— "重命名表现为软删 + 新增"不是本阶段的产品价值门槛，不要为它造半个 Obsidian。
>
> 判断标准：**Hermes 能不能正确引用企业知识**，而不是 Hermes 能不能变成一个笔记软件。

### D1. 同步是真的（保留），但这四点没接线

`syncKnowledgeSource`（`src/modules/knowledge/sync.ts:145-329`）**真实读磁盘**：路径取自数据库字段 `KnowledgeSource.rootPath`（`schema.prisma:1189`，非环境变量、非写死），`scanMarkdownFiles`（`:125-143`）递归扫描并跳过 `.` 开头目录 / `node_modules` / `.trash`，只收 `.md` / `.markdown`。

未接线的字段：
- `includeGlobs` / `excludeGlobs`（`schema.prisma:1191-1192`）**存而不用** —— `scanMarkdownFiles` 没有任何 glob 过滤。
- `enabled` / `readOnly`（`:1190, :1194`）**未被同步逻辑消费**。
- `kind`（`OBSIDIAN_VAULT` vs `LOCAL_DIR`，`:1186`）**同步逻辑无任何分支** —— 两者行为完全相同。

**验收判据**：配置 `excludeGlobs` 后，被排除的文件不出现在文档列表；`enabled=false` 的来源同步被拒。

### D2. Obsidian 语义缺失【本轮只做最小必要部分】

- **无 `[[wikilink]]` 解析**（蓝图 `docs/plans/2026-09-13-hermes-next-product-and-advisor-blueprint.md:125` 明确要求处理内部链接）；无 tag / alias / properties 识别。
- frontmatter 是**手写单层 YAML 解析**（`sync.ts:31-46`），不支持列表 / 嵌套 / 多行 / 日期类型。

> **本轮范围**：只要求"**解析能力不足以支撑引用**"不再是一个会丢数据的隐患 —— 即复杂 frontmatter 不能让文件解析失败、不能让正文被截断。**wikilink 图、alias 索引、properties 检索一律延期**。

**验收判据（本轮最小）**：含 `[[双链]]` 与 YAML 列表的 md 文件能**不报错、不丢正文**地入库（原始正文完整可检索）。wikilink / 属性的结构化入库与检索**不作为本轮判据**。

### D3. 无增量同步【本轮延期，仅记录】

> **本轮不做。** 理由：增量 watcher 与 rename identity 属于"自研半个 Obsidian"的范围；本阶段的门槛是"内容更新后能引用到新版本"（由 D5 在真实 Vault 上用**手动触发同步**验证即可）。
> 下面保留现状事实，供后续阶段取用；**执行者不得因"顺手"而把它拉进本轮**。

- 每次同步**全目录重扫**（`sync.ts:179`）；`mtime` 取了但**不用作跳过依据**（`:195,202`），每次全文读。
- 全仓 `chokidar|fs.watch|setInterval|cron|schedule` 在 `src/` 下**零命中** → 同步只能人工点按钮（`knowledge-client.tsx:97-115`）。
- **重命名会被当成「软删 + 新建」两条记录**（唯一键 `@@unique([sourceId, relativePath])`，`schema.prisma:1231`）。

**验收判据**：**本轮无判据（延期项）**。若后续启用：文件重命名后不产生重复的"删除 + 新增"两条记录。

### D4. 检索：只做 ILIKE，且有一个静默漏召【本轮必做：① 补 `orderBy`】

- 检索是 Prisma `contains + mode: "insensitive"`（即 `ILIKE '%kw%'`）：事实查询 `search.ts:98-110`、切片查询 `search.ts:113-129`。
- **无 `tsvector` / GIN / `pg_trgm` / pgvector**，无 embedding 字段、无 embedding 调用。
- **切片查询 `take: 40` 且 `orderBy` 缺失**（`search.ts:128-129`）→ 取哪 40 条由数据库返回顺序决定，规模变大后**静默漏召**。
- 中文靠应用层 2-gram 手切（`search.ts:36-55`）；`tokens` 是 `length/2` 估算（`sync.ts:230,262`）。

**要做的事（按性价比排序）**：① 补 `orderBy` 消除静默漏召（**先做，一行改动**）；② 加 `tsvector` + GIN 索引迁移；③ 向量检索作为可选增强，不作为门槛前置。

**验收判据**：同一查询在数据量翻倍后召回条数稳定；一个关键词命中在正文中段时仍能被召回。

### D5. 门槛 4 的"达成"必须挂真实 Vault

**现状**：门槛 4 的验收测试用的是 `os.tmpdir()` 临时目录（`tests/acceptance-blueprint-journey.test.ts:184-207`），**不是在真实 Vault 上**。因此"Obsidian 更新后可引用新版本"只能用临时目录模拟（同文件 `240-245`）。

**要做的事**：挂一个真实 Vault 目录，验证「修改一个 md → 重新同步 → 顾问检索到新版本」完整链路。

**验收判据**：在**真实 Vault** 上完成上述链路并留下证据（截图 + `KnowledgeSyncRun` 计数 + 顾问引用新版本原文）。在此之前，门槛 4 不得标「达成」。

---

## 6. 工作流 E（P2）：门槛 9 / 10 收尾

| 编号 | 事项 | 现状 | 验收判据 |
| --- | --- | --- | --- |
| E1 | **加载态 / 失败态逐页验证**（门槛 9） | 未逐一验证 | 每个入口页覆盖 空 / 加载 / 失败 / 正常 四态，且有截图 |
| E2 | **旧路由 → 新入口重定向**（门槛 10） | 未做 | 旧链接可定位到新入口，无 404 |
| E3 | 回归测试补全 | `tests/regression-signal.ts` 仅覆盖信号路径 | 成本引擎接线、DataGap 闭环、权限矩阵各有回归用例 |
| E4 | **运行时状态文案统一** | 5 处页面**硬编码** `{ tone: "neutral", label: "模型未配置", detail: "仅结构化能力可用" }`：`dashboard/page.tsx:64`、`consultation/page.tsx:48`、`trace/page.tsx:56`、`organization/page.tsx:48`、`projects/[id]/project-detail-client.tsx:346` —— 与 `getRuntimeStatus()` 的 `tone:"warn"` + 「规则分析可用 · 顾问对话未接入」**不一致** | 全部改走 `getRuntimeStatus()`，文案与色调一致 |

> E4 虽小，但属"同一事实在界面上有两种说法"，会直接损害可信度，建议随手修掉。

---

## 7. 已知"文档说谎"清单（必须修，否则下次审计还会踩）

| # | 位置 | 文档声称 | 实测 |
| --- | --- | --- | --- |
| 1 | `docs/plans/2026-09-14-module-experience-execution-report.md:47` | "成本与供应页签 目标成本 **¥55.84** 真实连通" | `¥55.84` 在 `prisma/seed.ts` 与源码中**均不存在**，无法复现 |
| 2 | 同上 `:65` | 打勾"门槛 4 Obsidian Markdown 导入…引用" | 测试用的是 `os.tmpdir()`（`tests/acceptance-blueprint-journey.test.ts:184-207`），**非真实 Vault** |
| 3 | `docs/plans/2026-09-13-...blueprint.md:38` | 引用 `src/lib/obsidian-review-sync.ts` | **该文件与 `src/lib/` 目录都不存在** |
| 4 | `src/modules/advisor/service.ts:10` | "接入真实模型后只需替换 **runAgent** 中的 reply 生成" | **全仓无 `runAgent` 函数** |
| 5 | `src/app/settings/page.tsx:126` | 所需环境变量含 `ADVISOR_BASE_URL`、`ADVISOR_API_KEY` | 二者**从未被任何代码读取** |
| 6 | `src/modules/cost-engine/types.ts:49` | 注释"对应 **CostRecord** 表" | 该表在 schema 中**不存在** |
| 7 | `prisma/schema.prisma:1046` | `Message.citations` 含 `path` / `hash` | 实际只写 `{ kind, ref, title }`（`service.ts:537`） |
| 8 | `prisma/schema.prisma:963` | `AnalysisDimension.evidenceRefs` 为 `[{evidenceId, hash, claimId, fieldKey}]` | 实际写入 `{evidenceId, fieldKey, fieldName, value, source}`（`analysis.ts:132-141`） |
| 9 | **本报告 §4** | "成本与供应 / 验证与风险 | 未接入（NotWired）| **不呈现任何数字**" | 两个页签**确实渲染真实数据**（目标成本、版本基线、证据数、已核实 X/Y），只是缺关键输入。措辞应改为"关键输入未接线" |

> 第 9 条是本次调研对**我们自己的验收报告**的纠正。文档修正本身也是交付物的一部分。

---

## 8. 需业务方拍板（GPT-6 不要自己决定）

1. **可用模型端点、真实 `modelId`、`baseURL`、API Key** —— 否则门槛 **3 / 7** 无法推进（当前 `ADVISOR_*` 全部未配置）。门槛 5（提议幂等回执）已达成，不依赖模型。
2. **是否新建组织级角色模型** —— 决定是否需要根治 `isOrgAdmin` 的"项目 OWNER 近似"。
3. **真实 Vault 路径** —— 门槛 4 达成的前提。
4. **评分与上市放行的裁决权归属**（谁有权拍板）。
5. **试销停止线阈值** —— 数值必须由业务给定，不得由代码猜。
6. **本轮是否正式引入独立 Worker / 队列运行时** —— 直接决定 **A4b 做还是延期**，进而决定**门槛 7 本轮能否标「达成」**：
   - **建** → 门槛 7 可冲「达成」；代价是要新增一个可部署的运行单元。
   - **不建** → A4b 整体延期，门槛 7 保持「部分」（但 A4a 后必须比现在更实：超时 / 失败 / 可重试可复现）。
   - **不接受第三种做法**：不建 Worker 却把 `lease` / `heartbeat` 字段接上一半。

---

## 9. 执行阶段与批次（顺序是硬约束，不得按"文件不重叠"自行对调）

> 相对上一版的核心调整：**权限收口 B4 / B5 / B6 从原「批次 4」提前到「模型接入之前」。**
> 执行原则一句话：**先把 AI 能碰到的门锁好，再把 AI 放进去。**

| 阶段 | 批次 | 内容 | 为什么在这个位置 | 依赖 |
| --- | --- | --- | --- | --- |
| **3A 安全底座** | 1 | B1 / B2 / B3（三条已实测真实泄露） | 一行到几行的改动，收益立即可见 | 无 |
| | 2 | **B4 / B5 / B6**（产品写路由授权 + 外部 id 归属校验 + RSC / 响应字段白名单） | **必须早于 A2 / A3**：模型一旦能调工具，这些路由就是它的可达面 | 批次 1 |
| | 3 | B8（表驱动越权矩阵，43 路由 / 60 方法 × 角色 × 组织）**已完成** | 把安全底座变成**可回归**的，防止后续新增路由重开洞 | 批次 2 |
| | 4 | **A4a**（幂等占位 TTL + 调用超时 + `FAILED` 可重试） | 修掉"崩溃后幂等键永久阻塞"，否则污染后面所有重试验证 | 无（可与 1–3 并行） |
| **3B 接入 AI** | 5 | A1（模型客户端与配置）→ A2（顾问真模型 + 工具协议）→ A3（产品分析真模型） | 门已锁好；**金额继续完全走确定性代码** | 批次 2 / 3 / 4 |
| **3C 产品经营** | 6 | C1（成本引擎接页面）→ C3（已有验证字段渲染）→ C4（`DataGap` 闭环） | C1 纯增量、最高杠杆；C4 修断链 | 无强依赖，建议在 3A 之后 |
| **3D 企业知识** | 7 | D1 + D4 → D5（真实 Vault） | 先让既有同步参数生效、检索不漏召，再挂真 Vault | D1 / D4 无依赖；**D5 需业务方给真实 Vault** |
| **3E 收尾与清债** | 8 | E1 / E2 / E4 + C2 + §7 文档修正（+ A4b，仅当决定建 Worker） | 收尾；A4b 需要 §8 第 6 条的架构决策 | 批次 5–7；A4b 另需业务方决策 |

> - **批次 1 / 2 / 4 之间文件重叠极少**，可并行；批次 3 依赖 2；**批次 5 必须等 2 + 3 + 4 完成**（这是本版最重要的一条依赖）。
> - **不要把 A4b 塞进 3A**：没有 Worker 就没有 lease / heartbeat 的真实语义（见 A4b 与 §8 第 6 条）。
> - 3C / 3D / 3E 与 3B 的文件重叠也少，可在 3B 开工后再并行推进。
> - **不得以"规划很完整"为由一次性铺开全部批次。** 每个批次独立提交、独立出证据；上一批未出证据就不开下一批。

---

## 10. 全局完成定义（DoD）

1. **门槛推进（数字一律由 `ACCEPTANCE_REPORT.md` §5 逐项表推出，禁止手填）**：
   - **起点**：3 达成（1 / 5 / 6）· 7 部分（2 / 3 / 4 / 7 / 8 / 9 / 10）。
   - 门槛 **3 / 4 / 8** 必须由「部分」→「达成」⇒ 6 项。
   - 门槛 **7** 只有在**明确建 Worker（A4b）**时才可标「达成」；只做 A4a 时保持「部分」，但必须比现在更实（超时 / 失败 / 可重试已真实可复现）。
   - 门槛 **2** 补齐成本引擎接线 + `DataGap` 闭环 ⇒ 7 项。
   - 门槛 **9 / 10** 视 E 阶段完成度 ⇒ **目标 8~9 项实质达成**。
   - **禁止**为了凑数把未达成的项标成「达成」；宁可标 8。
2. **证据可复现**：每个批次提交时附可复现命令与输出；**未执行项必须单列**（延续验收报告 §0.7 的做法），不得用"全绿"掩盖跳过。
3. **类型与构建**：`tsc --noEmit` 0 error；`NEXT_DIST_DIR=.next-verify` 构建通过。
4. **验收脚本**：`verify.cjs` / `verify-round2.cjs` / `verify-themes.cjs` 全绿，**并新增越权矩阵脚本（B8）**全绿。
5. **不造假**：所有新增数值可由输入复算；无占位金额；无证据的维度保持 `null`。
6. **不退化**：三层信息结构（结论 → 主题 → 数据下钻）与"每页最多一个主按钮"在新增能力后仍然成立。
7. **文档同步（含口径对账）**：每次提交后更新 `ACCEPTANCE_REPORT.md` §5 门槛逐项表与 §0.7 未执行项，并**由 §5 重新推出本文档顶部的统计数字**；修正 §7 清单中的措辞。
   **同一事实在报告与任务书之间出现两种说法，视为返工项**（本轮已修掉一处：报告 §5 门槛 2 写「NotWired」而 §4 已写「关键输入未接线（部分真实）」）。

---

## 附：如果只能先做三件

1. **B1** —— `GET /api/knowledge/facts` 补管理员校验（页面收口正被接口绕过，一行改动）。
2. **B4 + B5 + B6** —— 把产品写路由的授权、外部 id 归属、RSC / 响应字段白名单一次收掉。**这三件必须在 A2 / A3 之前**：模型有工具调用能力后，"接口能被人访问"会升级成"AI 自动读取、总结甚至操作不该碰的数据"。
3. **A4a 的幂等泄漏 + 调用超时** —— 崩溃后同一幂等键被永久阻塞（真实缺陷），而超时缺失会让 A2 / A3 的失败路径**根本无法验证**。

> **C1（成本引擎接线）** 仍是最高性价比的**能力增量**，但它不属于"只能做三件"里的安全项。它在 **3A 收口后即可开工**（3C，与 3B 文件不重叠，可并行）—— 是把 Demo 推向"产品负责人"的单点收益最大处。
