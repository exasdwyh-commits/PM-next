# PM-next · 科恩 KERN · AI Chief of Staff

PM-next 是工程仓库名；对外产品统一命名为 **科恩 KERN**。科恩是面向产品负责人和小型团队的 **AI 工作总管（AI Chief of Staff）+ 数字员工团队 + 治理内核 + 本机执行 Runtime**。

产品目标不是让用户操作很多 Agent 页面，而是让科恩成为长期驻留、主动推进工作的 AI 工作总管：

```text
告诉科恩想完成什么
→ 科恩理解公司/产品上下文
→ 研究、拆解、委派数字员工
→ 必要时调用用户自己的 Mac 执行真实工作
→ 独立 QA / Evidence / Governance
→ 生成管理报告
→ 人只处理关键决策
→ 系统继续推进
```

当前可信交付入口：`main`。

## 核心能力

### 1. Department Assistant

AI 助理是主要入口：

- 直接接收业务目标，不要求用户先选 Agent / Workflow；
- 自动注入公司、产品和项目上下文；
- 支持结构化查询、研究、任务拆解和受控提议；
- 支持 Laya System-1 Shadow 判断；
- 可把明确的本机任务发送到 KERN Desktop Runtime；
- 业务事实修改仍经过 Proposal / Approval / Gate，不允许模型绕过治理。

模型未配置时，结构化查询、受控提议、治理和 Desktop Runtime 仍可工作。

### 2. KERN Desktop Runtime

同一个科恩 可以在用户自己的 Mac 上执行真实工作。

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
AI 助理
→ desktop_operator AgentTask
→ Mac Runtime claim
→ 本机真实执行
→ AgentRun / AgentTask 回执
→ 结果自动写回原 AI 助理会话
```

Mac 一次安装：

```bash
npm run desktop:install
```

完整说明见 `docs/HERMES_DESKTOP_RUNTIME.md`。该文件名及 `HERMES_*` 环境变量属于兼容命名，用户可见品牌统一为 KERN。

### 3. Digital Workforce

默认 12 个数字角色：

- 科恩 KERN / AI Chief of Staff
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

## Frontend V3

当前前端采用 Conversation-first Department OS：

主导航：

```text
今日 / 产品 / AI 助理 / 市场机会 / 公司知识 / 自动化中心 / 设置
```

核心产品流：

```text
提需求 → AI 干活 → 看结果 → 做决定 → 继续推进
```

Product 是主要业务对象；Project 作为内部执行工作区，不再作为用户必须理解的一级产品概念。

产品工作区：

```text
概览 / AI研发 / 任务 / 证据 / 决策 / 记录
```

Executive Report 优先展示：

- 是否可以继续推进；
- UNKNOWN / 缺口；
- 显式风险；
- 需负责人决策；
- 有效结论。

## 模型策略

系统采用 provider-neutral Model Control。

模型只有在 endpoint/provider/model 明确配置并显式启用后才参与模型运行。

### Laya

Laya 是 System-1 快速判断层：

- typed bounded decisions；
- 默认 Shadow；
- 无 endpoint 时保持 SHADOW_UNCONFIGURED；
- 未完成目标 workload 校准前不用于高风险自动决策。

### Local Assistant Model

可作为科恩的本地常驻模型位，通过 OpenAI-compatible API 接入。模型不是 PM-next 的治理真相源，也不直接拥有业务写权限。

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
- 模型相关（Muse / Laya 等）默认不配置；未配置时治理、数据库、Workforce、
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

安装 Mac Runtime 后，直接在 AI 助理里说：

```text
本机帮我执行 git status，并把结果告诉我
读取剪贴板
浏览器打开 https://github.com
读取文件 ~/Desktop/brief.md
终端执行 npm test
本机帮我检查当前代码仓库，把能确定的 bug 修掉，跑完测试后告诉我结果
```

最后一类开放式任务默认交给本机 Codex CLI，执行结果仍返回科恩对话。

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

> ⚠️ **CI 覆盖缺口（已知，待收敛）**：当前 10 个 GitHub workflow 覆盖 56 个
> `test:*` 条目中的 31 个。除去 `test:sweep`（扫描器自身）与 `test:critical`
> （组合别名）这两个**按设计不该进 CI** 的条目，仍有 23 个真实套件从未进 CI，
> 其中 10 个（`test:http`、`test:http-errors`、`test:authz`、`test:ui`、
> `test:ui-feedback`、`test:product-center`、`test:blueprint`、`test:acceptance`、
> `test:science`、`test:llm-e2e`）
> 需要生产构建或浏览器，单是 `next build` + Playwright 就会显著拉长 CI 时延，
> 故本轮只把 `test:product-rnd-e2e` 纳入交付 CI。
> 这些用例长期没被跑，已经积累了若干与产品行为无关的红项（路由未登记进授权矩阵、
> UI 测试硬编码浏览器绝对路径、夹具清理顺序违反外键、验收断言绑定实时模型措辞）。
> 上述问题已在 2026-09-25 修复，`npm run test:sweep` 可作为本机全量门禁；
> 把剩余套件纳入 CI 是后续工作。

正式交付要求 GitHub 的主要矩阵同时为绿色：

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

## 当前边界

当前已具备 **Mac 本机执行 Runtime**，但以下能力不能误报成已完成：

- 完整视觉 Computer Use（屏幕理解、坐标点击、拖拽、视觉恢复）；
- 任意第三方 App 的零配置 GUI 自动化；
- Laya 正式 workload benchmark / calibration；
- 全部外部科研、法规、供应链数据源适配。

AppleScript / Accessibility 通道已经预留；有稳定 API/CLI/AppleScript 的本机任务应优先使用确定性工具，不为了“像人点击”而退化成脆弱 GUI 自动化。

## 文档

优先阅读：

1. `docs/HERMES_DESKTOP_RUNTIME.md`
2. `docs/FRONTEND_V3_CONVERSATION_FIRST.md`
3. `docs/FUSION_DELIVERY_2026-09-25.md`
4. `docs/FINAL_ARCHITECTURE_BLUEPRINT_V2.md`
5. `docs/DOMAIN_CONTRACTS_V2.md`
6. `docs/TOOL_BROKER_AND_APPROVALS.md`

历史 release / fusion 分支文档仅作为演进记录，不再代表当前部署入口。
