# PM-next 融合版交付与本地部署说明

日期：2026-09-25  
交付候选分支：`fusion/pm-os-final`  
合并目标：`main`（PR #1）

## 1. 这版是什么

这不是旧版 “Hermes 多页面 Agent 平台” 的简单增量版本。

当前产品收口为：

> **Department Assistant + 数字员工团队 + 证据/治理/项目执行内核**

面向普通负责人时，默认入口应该是项目和对话，而不是底层 Agent 配置。专业深度由数字员工执行，Department Assistant 负责理解、拆解、调度、监督、验证、汇报和记录。

当前默认数字团队共 11 个角色：

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

## 2. 当前已完成的核心总链

### AI 产品研发

项目页已经提供“AI 产品研发”业务入口。

正常路径：

```text
负责人填写研发 Brief
→ Department Assistant 创建一个受治理的研发 WorkItem
→ 启动父 AgentTask / AgentRun
→ 并行委派 5 个专业任务
   - 市场与竞品
   - 科学证据
   - 配方与规格
   - 法规与宣称
   - 成本与 BOM
→ ResearchRun 必须先 PUBLISHED
→ 证据可通过 SourceCapture → Independent Verifier 形成正式验证记录
→ 独立 QA 自动进入
→ QA 成功后自动生成 PRODUCT_RND_EXECUTIVE_REPORT
→ 父任务自动关闭
→ 报告提交负责人审查
→ 业务 Gate 仍由现有 G1/G2/G3 治理决定
```

系统不会因为模型给出高分、多个模型一致、或 QA 文案好看，就自动批准业务动作。

### START 去重与恢复

同一项目同一时刻最多允许一个活跃的“产品研发综合评估” WorkItem。

数据库使用 PostgreSQL 部分唯一索引兜底：

- 顺序重复 START：复用已有程序；
- 并发 START：数据库阻止第二套 WorkItem；
- 如果另一请求仍在 bootstrap，返回明确冲突，重试同一 START 即可；
- 当前轮次验收为 `ACCEPTED` 后，允许开启下一轮。

## 3. 证据与安全边界

当前融合版已经完成以下关键治理：

- ToolBroker 为受保护工具执行边界；
- ApprovalGrant 具备 task/resource/action scope 与单次消费语义；
- Source Fetch 产生持久化 `EvidenceSourceCapture`；
- Independent Verifier 只读取服务端 SourceCapture，不接受调用方伪造正文；
- 外部文本默认 untrusted，可进入注入/投毒隔离；
- UNKNOWN 是合法结果，不强行补全；
- 模型输出可以提出 FACT 类型命题，但不会因此获得事实证据等级；
- Laya 只做 bounded typed decision，默认 Shadow；
- Laya 置信度只用于分类/路由，不作为事实置信度或业务授权依据；
- Muse/其他 resident 模型是可替换执行资源，不是产品身份；
- 生产、外发、数据库迁移、敏感删除等受保护动作仍需治理链。

## 4. 本地部署

### 4.1 获取代码

```bash
git fetch --all --prune
git switch fusion/pm-os-final
git pull --ff-only origin fusion/pm-os-final
npm ci
```

Node 建议使用 22.x。

### 4.2 环境配置

```bash
cp .env.example .env
openssl rand -hex 32
```

至少填写：

- `DATABASE_URL`
- `AUTH_SECRET`
- `PM_OS_APPROVAL_HMAC_SECRET`

测试环境还需要：

- `TEST_DATABASE_URL`
- `TEST_DB_ROLE`
- `DEV_DATABASE_GUARD_URL`

不要把真实 API Key、数据库口令或 HMAC secret 提交到 Git。

### 4.3 数据库

正式部署使用 migration，不使用 `prisma db push` 替代历史迁移：

```bash
npx prisma generate
npx prisma migrate deploy
```

开发环境需要样例账号/组织时可执行：

```bash
npm run db:seed
```

### 4.4 启动

```bash
npm run dev
```

默认开发端口：`3100`。

生产构建：

```bash
npm run build
npm run start
```

## 5. 首次组织初始化

登录组织管理员后，需要完成两组 bootstrap。

### Digital Workforce

调用：

`POST /api/workforce/bootstrap`

该操作为幂等 upsert，会创建/更新默认 11 个 Agent、Skills、绑定以及 `product_core` Squad。

### Model Control

在 Model Control Center 安装官方 preset。

默认所有真实模型槽位是 safe-off：

- Muse Glimmer resident slot：disabled
- routine low-cost slot：disabled
- strategic frontier slot：disabled
- red-team frontier slot：disabled
- private local slot：disabled

先完成 endpoint/provider/model 配置，再显式 enable。

## 6. Muse Glimmer 本地常驻模型

当前 preset：

- provider：`muse-local`
- modelId：`muse-glimmer`
- locality：LOCAL
- 默认：disabled

运行时要求 OpenAI-compatible `/v1/chat/completions`。

本地服务实际启动后再配置：

```env
MODEL_PROVIDER_MUSE_LOCAL_BASE_URL="http://127.0.0.1:8080/v1"
MODEL_PROVIDER_MUSE_LOCAL_API_KEY=""
MODEL_PROVIDER_MUSE_LOCAL_TIMEOUT_MS=30000
MODEL_PROVIDER_MUSE_LOCAL_MAX_TOKENS=2048
MODEL_PROVIDER_MUSE_LOCAL_TEMPERATURE=0.2
```

然后在 Model Control 中启用 `muse-glimmer-resident-slot`。

没有 Muse 时系统治理、项目、Workforce、Evidence、Golden 测试仍应成立；不得因 resident 模型不可用而改变权限边界。

## 7. Laya System-1

Laya 是快速反射/判断层，不是主 Assistant。

默认不配置 endpoint，等同于不启用 HTTP Laya。

本地 Laya 服务启动后：

```env
LAYA_BASE_URL="http://127.0.0.1:8000"
LAYA_API_KEY=""
LAYA_MODEL=""
LAYA_TIMEOUT_MS=1500
LAYA_ALLOW_REMOTE=false
```

本仓库已包含 `services/judgment-runtime/` 本地 Laya 服务。默认监听 `127.0.0.1:8000`；`LAYA_MODEL` 留空时由 Router 使用其默认 checkpoint，中文可在服务侧配置 `LAYA_DEFAULT_MODEL=multilingual`。\n\n当前用于 Shadow typed decisions，包括：

- assistant.intent
- assistant.complexity
- assistant.requires_research
- assistant.expert_class
- assistant.proactive_value

在没有任务级 benchmark/calibration 前，不允许把 Laya 结果升级成高风险 AUTO。

远端 Laya 默认禁止；只有完成数据策略与审计后才考虑 `LAYA_ALLOW_REMOTE=true`。

## 8. 本地验收

静态与构建：

```bash
npm run typecheck
npm run lint
npm run build
```

核心融合测试：

```bash
npm run test:fusion-core
npm run test:product-rnd-fusion
npm run test:golden-org
```

完整 CI 关注以下 8 条：

- Quality CI
- Governance CI
- Workforce CI
- Decision CI
- Autopilot CI
- Experience CI
- Business Event CI
- Golden Organization CI

PR #1 只有在当前 head 的 8 条检查全部成功后，才视为最终合并候选。

## 9. Product R&D 人工验收建议

至少真实走一遍：

1. 创建/打开一个项目；
2. 在项目页“AI 产品研发”填写 Brief 并启动；
3. 确认只生成一个产品研发 WorkItem；
4. 确认 Department Assistant 父任务为 RUNNING；
5. 确认 5 个专业任务存在；
6. 确认 ResearchRun 未 PUBLISHED 时不会提前进入 QA；
7. 补充/验证至少一条真实 Evidence；
8. 确认 QA 成功后自动生成 `PRODUCT_RND_EXECUTIVE_REPORT`；
9. 确认报告中的 UNKNOWN、风险和待决策项没有被自动消掉；
10. 确认父任务自动关闭，但 G1/G2/G3 没有自动批准。

## 10. 当前明确不是“已完成”的部分

以下仍属于后续版本，不应伪装成当前已生产化：

- Laya 的真实 workload benchmark / calibration；
- Muse Glimmer 在目标 Mac 上的正式模型部署与质量基准；
- 所有第三方模型 Provider 的生产凭证与 SLA 验证；
- 浏览器/Computer Use 的完整生产运行时；
- Proactive Engine A1/A2 全量运行；
- Evolution Engine 自动改进闭环；
- 语音客户端与多 Agent 讨论室完整 UI；
- 外部真实科研/法规/供应链数据源的全部适配。

这些不会阻止当前版本作为 **受治理的 Product R&D / Department Assistant 可交付基线** 使用，但不能在对外材料中描述为已完成。

## 11. 上线前额外检查

当前 CI 安装阶段仍会输出 npm audit 风险提示。它目前不是 required CI gate，但互联网暴露或正式客户部署前应单独完成依赖漏洞复核，不建议为了“清零数字”直接执行 `npm audit fix --force` 并跳过回归。

同时确认：

- `DEV_MOCK_AUTH=false`
- 所有 secrets 只存在部署环境
- PostgreSQL 使用最小权限角色
- Laya/Muse 未启动时 URL 保持空
- 对外 Provider 的数据分类与隐私策略明确
- 备份与恢复流程已实际演练

