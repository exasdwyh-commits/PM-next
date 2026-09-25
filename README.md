# PM-next · Kern AI Product OS

PM-next 是一个面向产品负责人和小型团队的 **Kern 日常助理 + 数字员工团队 + 产品/项目管理后台 + 治理内核 + 本机执行能力**。

产品分为两层：

- **Kern 主操作层**：领导层和普通员工日常只需要对话。说目标，Kern 负责理解上下文、规划、研究、委派数字员工、跟进进度，并在必须由人拍板时发起 Check-in。
- **专业管理后台**：产品经理、项目负责人和管理员可进入传统管理系统，管理产品、项目、工作项、证据、评估、决策、自动化与审计。后台完整，但不要求普通用户理解内部 Agent/Runtime。

```text
告诉 Kern 想完成什么
→ Kern 理解公司 / 产品 / 项目上下文
→ 研究、拆解、委派数字员工
→ 必要时在用户自己的 Mac 上执行真实工作
→ 独立 QA / Evidence / Governance
→ Executive Report
→ 人只处理关键决策
→ Kern 继续推进
```

当前可信交付入口：`main`。Kern V1/Beta 最终验收通过的代码 head 为 `cfff5fe0`，已验证代码合并基线为 `e49491c8`；后续 docs-only 提交可继续推进 `main`，但不会改变该运行代码基线；默认用户入口仍为兼容路由 `/muse`，产品品牌统一为 **Kern**。

## 核心能力

### 1. Kern 主操作层

Kern 是主要入口：

- 直接接收业务目标，不要求用户先选 Agent / Workflow；
- 自动注入公司、产品和项目上下文；
- 支持结构化查询、研究、任务拆解和受控提议；
- 支持 Laya System-1 Shadow 判断；
- 低风险单一技术请求在 Tech Architect executor、模型策略和 provider runtime 都真实可用时，可自动排队给 Tech Architect；完成、阻断或最终失败回执会自动回到原 Kern 会话；
- 其它 Specialist、PAIR / COUNCIL 仍保持受控 Shadow/既有工作流，不因“可路由”就假装“可无人值守执行”；
- 可把明确的本机任务发送到用户自己的 Mac；
- 业务事实修改仍经过 Proposal / Approval / Gate，不允许模型绕过治理。

模型未配置时，结构化查询、受控提议、治理和确定性本机执行仍可工作。

### 2. Kern 本机执行

同一个 Kern 可以在用户自己的 Mac 上执行真实工作；用户看到的是“本机已连接 / Kern 正在用你的电脑 / 结果回到原会话”，Runtime 只是内部实现。

当前支持：

- 文件：list / read / write / mkdir / move；
- Terminal：受控 shell；
- Git：status / diff；
- Browser：打开 URL；
- macOS App：启动 App；
- Clipboard：读取 / 写入；
- macOS Notification；
- 可选 AppleScript；
- Local Agent：默认调用 Codex CLI 执行开放式本机任务，可替换为其他本机 Agent。

闭环：

```text
Kern
→ desktop_operator AgentTask
→ Mac 领取真实任务
→ 本机真实执行
→ AgentRun / AgentTask 回执
→ 结果自动写回原 Kern 会话
```

Mac 一次安装：

```bash
npm run desktop:install
```

完整说明见 `docs/HERMES_DESKTOP_RUNTIME.md`。

### 3. Digital Workforce

默认 13 个数字角色：

- Kern PM / Kern Assistant
- Product Agent
- Market Research Agent
- Scientific Evidence Agent
- Formulation Agent
- Compliance Agent
- Cost & BOM Agent
- QA Verifier
- Marketing Agent
- Supply & Ops Agent
- Red Team
- Tech Architect Agent（架构/代码审查；通过 `CODING` Model Policy 执行，默认 safe-off）
- Desktop Operator

Workforce 支持：

- Agent / Skill / Squad
- delegation
- AgentTask / AgentRun
- parent/child return
- Business Event Outbox
- Autopilot
- WAITING_HUMAN
- audit trail

### 4. AI 产品研发

标准闭环：

```text
研发 Brief
→ Department Assistant 父任务
→ 5 路专业数字员工
→ ResearchRun
→ SourceCapture / Evidence Verification
→ Independent QA
→ PRODUCT_RND_EXECUTIVE_REPORT
→ 人类审查
→ G1 / G2 / G3
```

ResearchRun 未发布不会提前进入 QA；QA 成功后管理报告自动生成，但不会自动替人批准业务 Gate。

### 5. Evidence / Truth / Governance

- FACT / INFERENCE / ESTIMATE / OPINION / FORECAST 分离；
- VERIFIED / STRONG / SUPPORTED / WEAK / UNKNOWN 分离；
- SourceCapture 持久化真实抓取回执；
- Independent Verifier 不接受调用方自造正文；
- 外部内容默认 untrusted；
- prompt injection / knowledge poisoning 可隔离；
- UNKNOWN 保持 UNKNOWN；
- 模型共识不等于证据；
- ApprovalGrant 有 scope 与 single-use 语义；
- ProductVersion / ChannelSpecRoute / Validation / G1 / G2 / G3；
- immutable decision / audit history。

## 前端与信息架构

### Kern 主操作层

默认入口是单一、安静的对话画布，不是密集仪表盘。首屏只回答三件事：

1. 今天什么最重要；
2. Kern 正在真实执行什么；
3. 现在需要我处理什么。

用户不需要先理解 Agent、AgentTask、AgentRun、Gate、Runtime 等内部对象。Kern 只在真实 RUNNING 时显示“正在执行”，排队、失败、未连接和 UNKNOWN 都按真实状态显示。

### 专业管理后台

产品经理 / 项目负责人可以进入 `/manage` 及专业页面：

```text
管理总览 / 产品管理 / 项目管理 / 市场机会 / 公司知识 / 自动化中心 / 设置
```

**产品**是业务主对象，**项目**是可独立进入的执行管理对象，Prisma `WorkItem` 在用户界面统一称为**工作项**。

项目工作区：

```text
概览 / AI 研发 / 工作项 / 证据 / 决策 / 记录
```

Executive Report 默认按以下顺序阅读：

```text
当前结论 → 关键依据 → 最大风险 → UNKNOWN → 需要你决定 → 下一步
```

专业数字员工意见和完整溯源默认折叠，需要时再下钻。

## 模型策略

系统采用 provider-neutral Model Control。

模型只有在 endpoint/provider/model 明确配置并显式启用后才参与模型运行。

### Laya

Laya 是 System-1 快速判断层：

- typed bounded decisions；
- 默认 Shadow；
- 无 endpoint 时保持 SHADOW_UNCONFIGURED；
- 未完成目标 workload 校准前不用于高风险自动决策。

### 常驻快速模型 / Local Model

Kern 可通过 Model Gateway 使用本地常驻模型或外部模型；具体 provider 只是可替换执行资源。模型不是治理真相源，也不直接拥有业务写权限。

## 本地运行

首次检出：

```bash
git clone https://github.com/exasdwyh-commits/PM-next.git
cd PM-next
```

已有检出更新到最新交付：

```bash
git fetch --all --prune
git switch main
git pull --ff-only origin main
```

安装依赖并启动：

```bash
npm ci
cp .env.example .env
# 填写 DATABASE_URL / AUTH_SECRET 等环境变量

npx prisma generate
npx prisma migrate deploy
npm run dev
```

默认端口：`3100`。

开发环境需要样例数据时：

```bash
npm run db:seed
```

### 环境变量

关键变量见 `.env.example`：

- `DATABASE_URL`：应用连接串（开发库，本机默认 `.../hermes_next_dev`）；
- `TEST_DATABASE_URL`：测试专用库，**必须与开发库不同**——测试启动时会做隔离校验，
  测试账号若能连上开发库会直接拒绝运行；
- 模型相关（Kern Assistant / Laya 等）默认不配置；未配置时治理、数据库、Workforce、
  Evidence 与结构化流程仍应保持可运行，系统不得静默切换到未知外部模型。

### 后台 Worker（独立进程）

关掉浏览器后还要继续推进的活（AgentTask 执行、ResearchRun 续跑、Business Event
分发、Product R&D reconcile）由独立的 `pm-worker` 进程承担，它**不是** `npm run dev`
的一部分：

```bash
npm run worker        # 常驻：executor 5s / research 30s / event 10s / reconcile 60s
npm run worker:once   # 单轮跑完即退出（CI 与本地排查用）
```

- 单实例保护：靠文件锁 + 心跳（锁目录 `.pm-worker/`，已在 `.gitignore` 中），
  已有活跃 Worker 时第二个进程会拒绝启动；陈旧锁可被接管；
- 独立 QA（`qa_verifier`）**刻意不由 Worker 执行**——同一进程既执行又自证会破坏
  独立性，QA 由独立路径收口；
- 没有真实输入的专家任务会诚实地停在 `BLOCKED` 并落 `DataGap`，不会编造数字。

### 数据库迁移与验证

```bash
npx prisma migrate deploy          # 应用全部迁移（幂等）
npx prisma migrate status          # 检查是否有未应用迁移 / 漂移
npm run db:verify                  # 空库全量迁移 / 漂移 / 带数据的增量升级
```

`npm run db:verify`（`scripts/verify-db-chain.sh`）会在本机 PostgreSQL 上创建两个独立
验证库（`hermes_migrate_verify`、`hermes_upgrade_verify`），验证「从零建库能跑通全部迁移」
以及「既有库增量升级不丢存量数据」，不改动 dev/test 库。

## 首次组织初始化

管理员登录后，Workforce 可通过：

```text
POST /api/workforce/bootstrap
```

初始化默认数字团队。

当管理员首次从 AI 助理发起本机任务且 `desktop_operator` 尚不存在时，系统也会尝试自动补齐默认 Workforce；普通成员不会获得隐式管理员能力。

## 桌面助理示例

安装 Kern 本机执行后，直接在 Kern 里说：

```text
本机帮我执行 git status，并把结果告诉我
读取剪贴板
浏览器打开 https://github.com
读取文件 ~/Desktop/brief.md
终端执行 npm test
本机帮我检查当前代码仓库，把能确定的 bug 修掉，跑完测试后告诉我结果
```

最后一类开放式任务默认交给本机 Codex CLI，执行结果仍返回原 Kern 对话。

## 验收

基础：

```bash
npm run typecheck
npm run lint
npm run build
```

核心业务：

```bash
npm run test:fusion-core
npm run test:product-rnd-fusion
npm run test:golden-org
npm run test:frontend-v3
npm run test:desktop-runtime
```

产品研发 / 数字员工链路（数据库相关）：

```bash
npm run test:qa-retry            # QA fencing token（F1–F6）
npm run test:qa-dedup            # 并发排队去重
npm run test:worker              # Executor + Worker（W1–W9）
npm run test:product-rnd-fusion  # 端到端融合 + 报告诚实性注入
npm run test:product-rnd-e2e     # 实时端到端冒烟：真实 HTTP + 生产模式 next start
```

`test:product-rnd-e2e` 与 `test:product-rnd-fusion` 的分工（两者不可互相替代）：

| | `test:product-rnd-fusion` | `test:product-rnd-e2e` |
| --- | --- | --- |
| 入口 | 全部服务函数直调 | **产品面全部走真实 HTTP**（生产模式 `next start` + 真实会话） |
| 范围 | 编排 + QA + 报告合成 | 登录 → START → 状态 → 证据录入/核验 → SYNTHESIZE 全入口 |
| 后台 | 同进程 | Worker 走库入口、独立 QA 走独立身份（与设计一致） |
| 目的 | 锁业务语义与不变量 | 锁 HTTP 契约、鉴权边界与整链路可跑通 |

全量扫描（跑完 `package.json` 里所有 `test:*`，逐项退出码 + 日志）：

```bash
npm run test:sweep
```

需要数据库的测试要求本机有 PostgreSQL，且 `TEST_DATABASE_URL` 指向独立测试库。

> GitHub Actions 当前有 **11 条工作流**：10 条核心业务 / 质量工作流，加 1 条 Mobile Conditional Layout CI。最终交付 PR 会在**同一个 head**上跑齐 11 条。更广的历史 `test:*` 套件仍可用 `npm run test:sweep` 做本地全量扫描；没有进入 CI 的历史测试不自动等于生产能力已验收。

正式交付要求 GitHub 的同一最终验收 head 上以下矩阵同时为绿色：

- Quality CI
- Governance CI
- Workforce CI
- Decision CI
- Autopilot CI
- Experience CI
- Business Event CI
- Golden Organization CI
- Product R&D Delivery CI
- Desktop CI
- Mobile Conditional Layout CI

## 当前边界

当前已具备 **Mac 本机执行 Runtime**，但以下能力不能误报成已完成：

- 完整视觉 Computer Use（屏幕理解、坐标点击、拖拽、视觉恢复）；
- 任意第三方 App 的零配置 GUI 自动化；
- Laya 正式 workload benchmark / calibration；
- 全部外部科研、法规、供应链数据源适配。

AppleScript / Accessibility 通道已经预留；有稳定 API/CLI/AppleScript 的本机任务应优先使用确定性工具，不为了“像人点击”而退化成脆弱 GUI 自动化。

## 文档

优先阅读：

1. `docs/FINAL_DELIVERY_2026-09-25.md`
2. `docs/KERN_DELIVERY_LEDGER.md`
3. `docs/FRONTEND_V3_CONVERSATION_FIRST.md`
4. `docs/HERMES_DESKTOP_RUNTIME.md`（历史文件名保留兼容，内容对应 Kern 本机执行）
5. `docs/FUSION_DELIVERY_2026-09-25.md`

历史 release / fusion 分支文档仅作为演进记录，不再代表当前部署入口。
