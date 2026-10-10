# PM-next · Kern AI Product OS

面向产品负责人与小团队的 AI 产品工作系统。以对话为主入口：Kern 理解目标、注入公司 / 产品 /
项目上下文、统筹数字员工与工具推进工作，并通过证据分级、独立 QA 与治理门禁保证结果可信。

- **Kern 主操作层** —— 对话即入口，用户只说目标；需要在关键处拍板时才发起确认。
- **专业管理后台** —— 产品、项目、工作项、证据、决策、自动化与审计。

## 技术栈

Next.js 15（App Router）· React 19 · TypeScript · Prisma 6 + PostgreSQL · Tailwind CSS。

后台任务由独立进程（`pm-worker`）承担。模型接入为 provider-neutral：只有显式配置并启用的
provider / model 才参与运行；未配置时系统不会静默切换到未知外部模型。

## 核心能力

- **对话与统筹**：自然语言目标 → 上下文注入 → 研究 / 拆解 / 受控提议。业务写操作一律经过
  提议 → 审批 → 门禁，模型不能绕过治理。
- **数字员工**：以 Agent / Skill / Squad 组织，覆盖产品、市场研究、科学证据、配方、合规、
  成本、QA、营销、供应链、红队、技术架构与本机执行；任务与运行可追溯（AgentTask / AgentRun）。
- **本机执行**：把明确任务发送到用户自己的 Mac 执行（文件、终端、Git、浏览器、剪贴板、
  通知、AppleScript），结果自动回到原会话。
- **证据与治理**：事实 / 推断 / 估计 / 观点 / 预测分离；来源抓取留痕；独立核验不接受调用方
  自造正文；外部内容默认不可信；UNKNOWN 保持 UNKNOWN；决策与审计历史不可变。
- **报告与成果**：研发简报、执行报告与结构化成果，支持 Word / Excel / PPT 导出。

## 本地运行

前置：Node.js 22+、PostgreSQL 14+。

```bash
git clone https://github.com/exasdwyh-commits/PM-next.git
cd PM-next
npm ci
cp .env.example .env     # 填写 DATABASE_URL / TEST_DATABASE_URL / AUTH_SECRET 等
npx prisma generate
npx prisma migrate deploy
npm run db:seed          # 可选：样例数据
npm run dev              # 默认 http://localhost:3100
```

### 环境变量

见 `.env.example`。三个要点：

- `DATABASE_URL` 与 `TEST_DATABASE_URL` **必须是两个不同的库**。测试启动时会校验隔离，
  测试账号若能连上开发库会直接拒绝运行。
- `AUTH_SECRET` 用 `openssl rand -hex 32` 生成，不要沿用示例值。
- 模型相关变量默认留空。未配置时，治理、数据库、数字员工与结构化流程仍保持可运行。

### 后台 Worker（独立进程）

关掉浏览器后仍需继续的活（任务执行、研究续跑、业务事件分发、研发对账）由独立进程承担，
**不是** `npm run dev` 的一部分：

```bash
npm run worker        # 常驻
npm run worker:once   # 单轮后退出（CI / 本地排查）
```

单实例由文件锁 + 心跳保护（锁目录 `.pm-worker/`，已忽略提交）。独立 QA 刻意不经由 Worker
执行：同一进程既执行又自证会破坏独立性。

### 数据库迁移与校验

```bash
npx prisma migrate deploy   # 应用全部迁移（幂等）
npx prisma migrate status   # 检查漂移 / 未应用迁移
npm run db:verify           # 空库全量迁移、漂移、带数据增量升级
```

## 质量校验

```bash
npm run typecheck
npm run lint
npm run build

npm run test:critical             # 关键路径
npm run test:architecture         # 架构分层
npm run test:authz                # 权限矩阵
npm run test:db                   # 数据库与迁移
npm run test:governance           # 治理与门禁
npm run test:evidence             # 证据链
npm run test:business-events      # 业务事件
npm run test:frontend-v3          # 前端契约
npm run test:product-rnd-fusion   # 研发链路（服务层直调）
npm run test:product-rnd-e2e      # 研发链路（真实 HTTP + 生产模式）
npm run test:sweep                # 本地全量扫描所有 test:*
```

需要数据库的用例要求本机有 PostgreSQL，且 `TEST_DATABASE_URL` 指向独立测试库。

## 架构图

由源码静态 import 关系确定性生成，不靠人工维护：

```bash
npm run kern:map                 # 生成架构图 JSON
npm run test:kern-project-map    # 校验区域归属与覆盖率
```

新增 `src/modules/<name>/` 需登记到 `src/modules/visual-intelligence/project-map-builder.ts`
的 `AREAS`，否则覆盖率守卫会失败。

## 目录结构

```text
src/app/          页面与 API 路由
src/modules/      内核模块（按领域分层）
src/components/   UI 组件与设计系统块
prisma/           数据模型与迁移
packs/            租户包（行业设定：品类、词表、法规、宣称）
capabilities/     数字员工技能定义
tests/            测试与源码守卫
scripts/          运维脚本（含 pm-worker）
docs/             架构与接口说明
```

## 已知限制

- 未提供完整视觉 Computer Use（屏幕理解、坐标点击、拖拽、视觉恢复）。
- 未提供任意第三方 App 的零配置 GUI 自动化。
- 外部科研、法规、供应链数据源未全部适配。
- 有稳定 API / CLI / AppleScript 的任务应优先使用确定性工具，不为了「像人点击」退化成脆弱 GUI 自动化。

## 许可

内部项目，未附开源许可；未经授权请勿再分发或用于外部产品。
