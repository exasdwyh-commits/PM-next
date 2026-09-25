# PM-next · Hermes Department OS

PM-next 是一个面向产品负责人和小型团队的 **AI 部门助理 + 数字员工团队 + 治理内核 + 本机执行 Runtime**。

产品目标不是让用户操作很多 Agent 页面，而是：

```text
告诉 Hermes 想完成什么
→ Hermes 理解公司/产品上下文
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
- 可把明确的本机任务发送到 Hermes Desktop Runtime；
- 业务事实修改仍经过 Proposal / Approval / Gate，不允许模型绕过治理。

模型未配置时，结构化查询、受控提议、治理和 Desktop Runtime 仍可工作。

### 2. Hermes Desktop Runtime

同一个 Hermes 可以在用户自己的 Mac 上执行真实工作。

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

完整说明见 `docs/HERMES_DESKTOP_RUNTIME.md`。

### 3. Digital Workforce

默认 12 个数字角色：

- Hermes PM / Department Assistant
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

### Muse / Local Model

可作为本地常驻 Department Assistant 模型位，通过 OpenAI-compatible API 接入。模型不是 PM-next 的治理真相源，也不直接拥有业务写权限。

## 本地运行

```bash
git clone https://github.com/exasdwyh-commits/PM-next.git
cd PM-next

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

最后一类开放式任务默认交给本机 Codex CLI，执行结果仍返回 Hermes 对话。

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

正式交付要求 GitHub 的主要矩阵同时为绿色：

- Quality CI
- Governance CI
- Workforce CI
- Decision CI
- Autopilot CI
- Experience CI
- Business Event CI
- Golden Organization CI

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
