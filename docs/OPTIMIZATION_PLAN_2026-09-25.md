# PM-next 优化方案与问题台账

> 基线：main @ `7fca8ffd`（融合版）→ 本次修复提交 `de1f139d`
> 范围：本机真实验证 + 代码审计结论，不是推测性架构建议

---

## 一、总体判断

治理内核是**对的**：UNKNOWN 保留、Gate 不自动放行、ToolBroker 默认拒绝、Laya 仅 Shadow、
abstained 绝不 AUTO —— 这些边界在代码里都是硬约束，不是靠约定。这是这个项目最值钱的部分。

主要短板不在"设计"，而在**执行层的工程完备性**：

| 维度 | 现状 | 判断 |
|---|---|---|
| 治理与权限语义 | 硬约束、测试覆盖完整 | **强项，别动** |
| 数据库约束 | partial unique index 生效 | **强项** |
| 并发安全 | 部分路径 check-then-act 无锁 | **有真实 Bug** |
| 后台执行 | 无任何 worker/cron，全靠请求驱动 | **架构缺口** |
| 前端表达 | 报告 JSON 直出、无结构化渲染 | **演示短板** |
| 可观测性 | 失败只写 blockedReason，无重试/告警 | **运维短板** |

---

## 二、已修复的 Bug

### BUG-1　并发 reconcile 产生多个 QA 任务（P0，数据一致性）— 已修

| 项 | 内容 |
|---|---|
| 问题 | 并发 3 次 RECONCILE → 创建 **3 个** `qa_verifier` 任务 |
| 根因 | `advanceProductRndProgram` 中「读 childTasks → 发现无 QA → 排队」是 check-then-act，`queueProductRndQa` 的 existing 检查与创建之间无事务、无锁。两个并发请求同时看到空槽位，各自 delegate |
| 触发场景 | 用户点 RECONCILE 的同时，最后一个专家任务 finish 触发自动 advance（真实可发生） |
| 后果 | 下游 `synthesizeProductRndExecutiveReport` 用 `.find()` 只取第一个 QA，其余**静默丢弃**；若两个 QA 结论相反，报告可能采用被丢弃方的对立结论 |
| 修改文件 | `src/modules/product-rnd/orchestrator.ts` |
| 修复方式 | 新增 `claimProductRndQaSlot` / `releaseProductRndQaSlot`，用单条 `UPDATE ... WHERE qaClaim IS NULL ... RETURNING` 做 jsonb CAS 原子抢占（PostgreSQL 行锁天然串行化）；只有抢占成功者 delegate，失败者返回已排队任务；delegate 抛错时释放槽位，避免残留 claim 永久阻塞 |
| 验证 | `npm run test:qa-dedup`；回退修复实测：并发 3 次 → 3 个 QA（失败），修复后 → 1 个 |
| commit | `de1f139d` |

---

## 三、待修问题（按优先级）

### P1-1　没有任何后台 worker，链路靠前端轮询驱动

**现象**：全库搜索 `setInterval` / `node-cron` / `scheduler` / `worker` 在 `src/` 下**零命中**。
ResearchRun 的推进（`runResearchRunTasks`）只在前端请求 `/api/research-runs/[runId]` 时被调用。

**后果**：
- 负责人关掉浏览器，流程就停在原地，回来也不会自己走
- Business Event outbox 只在请求链路内同步 dispatch，失败后没有自动重试（`dispatchBusinessEvent` 有 lease 机制，但没有 worker 去扫 `PENDING` 事件）
- 演示时如果没人刷新页面，"AI 在自动干活"这件事不成立

**建议**（不改架构，补执行层）：
1. 加一个极小的 outbox drain worker：定时扫 `BusinessEvent` 中 `status=PENDING` 且 `nextAttemptAt <= now()` 的行，复用现有 `dispatchBusinessEvent` 的 lease + `FOR UPDATE` 语义，天然幂等
2. ResearchRun 推进也挂到同一个 worker 上（按 `projectId` 加 advisory lock 防并发）
3. 形态建议：独立进程 `worker.ts`（`npm run worker`），与 Next.js 解耦，避免 serverless 语义下长任务被截断

### P1-2　advance 失败后流程永久卡死，无重试

**现象**：`finishAgentTask` 里 `advanceProductRndProgram(...).catch(...)` 失败时只把错误写进父任务
`blockedReason`，然后**什么都不做**。没有任何机制会再触发一次 advance。

**后果**：一次瞬时 DB 抖动 / 超时 → 父任务永远停在 RUNNING，用户只看到一个 `AUTO_ADVANCE_FAILED` 字符串。

**建议**：把 advance 失败也写进 outbox（复用 P1-1 的 worker 做指数退避重试），并在 UI 上把
`blockedReason` 渲染成"需要重试"的可操作提示，而不是裸字符串。

### P1-3　Executive Report 前端 JSON 直出

**现象**：`src/components/` 下无任何报告渲染组件，`PRODUCT_RND_EXECUTIVE_REPORT` 只在后端出现；
项目页直接展示 JSON。

**后果**：与"Front-end minimal / Report-first"的产品原则直接冲突 —— 目标用户是产品负责人，看不懂 JSON。

**建议**：按 `artifact-schema.ts` 已定义的字段做结构化渲染，顺序建议：
结论 → 已验证证据 → **UNKNOWN** → 风险 → 待决策 → 溯源（agentRunRefs / modelRunRefs）。
UNKNOWN 和风险必须有独立视觉区块，不能被塞进折叠面板里。

### P2-1　synthesize 用 `find()` 取第一个 QA

**现象**：`orchestrator.ts` 第 749 / 1067 行 `childTasks.find(t => t.agent.code === "qa_verifier")`。

**后果**：存量脏数据（BUG-1 修复前已产生的多 QA 项目）仍会被静默取第一个。

**建议**：改为显式断言 —— 若存在多个 `qa_verifier`，抛错或取最新且非 terminal 的那个，不要静默选第一个。

### P2-2　并发 RECONCILE 返回 409，语义可更友好

**现象**：修复后，抢占失败的并发请求返回 `409 Conflict`（因为胜者还没提交，loser 查不到已存在的 QA）。

**建议**：loser 分支加一次短时延（~150ms）重查，命中则返回 `created: false`；
仍查不到才抛 409。这样正常并发场景下用户不会看到报错。

---

## 四、架构优化建议（分阶段，不推倒重来）

### 阶段 1：让系统"自己会走"（1–2 天）
- outbox drain worker（P1-1）
- advance 失败入队重试（P1-2）
- 结果：关掉浏览器，流程照样推进到等人审

### 阶段 2：让负责人"看得懂"（2–3 天）
- Executive Report 结构化渲染（P1-3）
- 项目页用状态条表达「现在到哪一步 / 谁在处理 / 哪些还是 UNKNOWN / 需要我决定什么」
- 结果：可以真正做客户演示

### 阶段 3：让专业员工"真有脑子"（需外部依赖）
- 接一个本地 OpenAI-compatible 模型（Muse 槽位已预留）
- 把 5 个专家的输出从规则合成升级为真实生成，但**保留现有 Verifier 边界**
- 关键：模型输出只能作为 `Evidence` 的候选，不能绕过 SourceCapture

### 不建议做的
- 不要为"看起来更强大"增加 Agent 开关 —— 当前产品原则是对的，加开关会稀释 report-first
- 不要把 UNKNOWN / Gate / ApprovalGrant 改成自动通过 —— 这是项目的核心价值
- 不要为了并发安全大面积引入分布式锁 —— 单机 PG 行锁 + CAS 已足够，先补执行层

---

## 五、结论

| 问题 | 状态 |
|---|---|
| 阻断部署 | **无** |
| 阻断客户演示 | **无**（但报告 JSON 直出影响观感） |
| 数据一致性 Bug | **1 个，已修复并回归** |
| 架构缺口 | 无后台执行层（P1-1） |
| 最值得做的 3 件事 | ① outbox drain worker ② 报告结构化渲染 ③ synthesize 多 QA 显式处理 |
