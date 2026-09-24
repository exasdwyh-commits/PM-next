# PM-next · Department Assistant / Product R&D OS

PM-next 是一个面向产品负责人和小型团队的 **Department Assistant + 数字员工团队 + 治理内核**。

当前融合版不再把“操作很多 Agent 页面”作为最终产品形态，而是让负责人通过项目与对话发起工作，系统在后台完成拆解、专业协作、研究、证据核验、QA、报告和治理衔接。

> 当前交付候选分支：`fusion/pm-os-final`  
> 合并目标：`main`（PR #1）  
> 最终交付说明：`docs/FUSION_DELIVERY_2026-09-25.md`

## 当前核心能力

### Department Assistant

- 对话入口复用成熟 Advisor 执行路径；
- 统一注入项目/公司上下文；
- 支持 Laya System-1 Shadow 判断；
- 负责拆解、调度、监督、验证、汇报和记录；
- 不允许模型绕过业务治理。

### Digital Workforce

默认 11 个数字角色：

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

Workforce 支持：

- Agent / Skill / Squad
- delegation
- AgentTask / AgentRun
- parent/child return
- Business Event Outbox
- Autopilot
- WAITING_HUMAN
- audit trail

### AI 产品研发

项目页已有“AI 产品研发”业务入口。

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
→ G1 / G2 / G3 治理
```

ResearchRun 未发布时不会提前进入 QA；QA 成功后系统自动生成管理报告并关闭父任务，但不会自动批准业务 Gate。

同一项目只允许一个活跃研发轮次，数据库负责防止双击/并发 START 生成重复 WorkItem。

### Evidence / Truth / Governance

- FACT / INFERENCE / ESTIMATE / OPINION / FORECAST 分离；
- VERIFIED / STRONG / SUPPORTED / WEAK / UNKNOWN 分离；
- SourceCapture 持久化真实抓取回执；
- Independent Verifier 不接受调用方自造正文；
- 外部内容默认 untrusted；
- prompt injection / knowledge poisoning 可隔离；
- UNKNOWN 保持 UNKNOWN；
- 模型共识不等于证据；
- ToolBroker 管理受保护执行；
- ApprovalGrant 具备 scope 与 single-use 语义。

### Product / Business Governance

- ProductVersion
- ChannelSpecRoute
- Evidence / Validation
- Product Potential
- G1 研发/打样授权
- G2 生产投入授权
- G3 正式上市授权
- Production preparation / start / delivery
- immutable decision/audit history

## 模型策略

系统采用 provider-neutral Model Control。

当前内置的是 **禁用状态的模型槽位和策略**，不是写死供应商：

- Muse Glimmer resident slot
- routine low-cost slot
- strategic frontier slot
- red-team frontier slot
- private local slot

模型只有在 endpoint/provider/model 明确配置并显式启用后才参与运行。

### Muse Glimmer

推荐作为本地常驻 Department Assistant 模型位：

- provider: `muse-local`
- modelId: `muse-glimmer`
- 默认 disabled
- 通过 OpenAI-compatible `/v1/chat/completions` 接入

### Laya

Laya 只作为 System-1 快速判断层：

- typed bounded decisions
- 默认 Shadow
- 默认不配置 endpoint
- 没有 workload benchmark/calibration 前不得驱动高风险 AUTO

详见 `.env.example` 与交付文档。

## 本地运行

```bash
git fetch --all --prune
git switch fusion/pm-os-final
git pull --ff-only origin fusion/pm-os-final

npm ci
cp .env.example .env

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

管理员登录后：

1. 调用 `POST /api/workforce/bootstrap` 初始化默认数字团队；
2. 在 Model Control Center 安装推荐 presets；
3. 根据部署环境配置并启用真正可用的模型 profile。

模型未配置时，治理、数据库、Workforce、Evidence 和大部分结构化流程仍应保持可运行；系统不得静默切换到未知外部模型。

## 验收

基础：

```bash
npm run typecheck
npm run lint
npm run build
```

融合主链：

```bash
npm run test:fusion-core
npm run test:product-rnd-fusion
npm run test:golden-org
```

GitHub PR #1 当前 head 需要同时通过：

- Quality CI
- Governance CI
- Workforce CI
- Decision CI
- Autopilot CI
- Experience CI
- Business Event CI
- Golden Organization CI

只有当前 head 的完整矩阵全绿，才算最终可合并候选。

## 当前仍属于后续版本

以下不能对外描述为已生产完成：

- Laya workload benchmark / calibration
- Muse 在目标 Mac 上的正式部署与质量基准
- Proactive Engine A1/A2 全量运行
- Evolution Engine 自动改进闭环
- 浏览器 / Computer Use 完整生产执行器
- 语音客户端
- 多 Agent discussion room 完整 UI
- 全部外部科研/法规/供应链数据源适配

## 文档

优先阅读：

1. `docs/FUSION_DELIVERY_2026-09-25.md`
2. `docs/FINAL_ARCHITECTURE_BLUEPRINT_V2.md`
3. `docs/DOMAIN_CONTRACTS_V2.md`
4. `docs/TOOL_BROKER_AND_APPROVALS.md`
5. `docs/FORMAL_G2_PRODUCTION_GATE.md`
6. `docs/FORMAL_G3_LAUNCH_GATE.md`

旧 `release/v0.1.0-rc1` 文档保留为历史记录，不再代表当前融合版交付入口。
