# Kern 富回复 / HTML 成果 —— 本地运行与验收（2026-10-09）

入口只有正式的 `/muse`。本文记录如何在本机把真实链路跑起来（浏览器 → API → Worker → 模型 → 入库 → 渲染），
以及在**没有真实模型**时如何用「固定样例」模型服务替代。固定样例的回复与数字全部写在
`scripts/fixtures/kern-rich-samples.cjs`，不是模型生成，截图和导出文件均标注「固定样例」。

## 1. 环境变量（`.env`，不入库）

在 `.env.example` 的基础上补充（口令/密钥请自行填写，不要提交）：

```
DATABASE_URL=postgresql://<dev_user>:<dev_pass>@127.0.0.1:5432/hermes_next_dev?schema=public
DEV_DATABASE_GUARD_URL=<同 DATABASE_URL>
TEST_DATABASE_URL=postgresql://hermes_test:<test_pass>@127.0.0.1:5432/hermes_next_test?schema=public
AUTH_SECRET=<随机串>
PM_OS_APPROVAL_HMAC_SECRET=<随机串>
ADVISOR_LLM_ENABLED=false

# 固定样例模型服务（scripts/mock-kern-rich-llm.cjs，OpenAI 兼容）
MODEL_PROVIDER_AGNES_BASE_URL=http://127.0.0.1:3189/v1
MODEL_PROVIDER_AGNES_API_KEY=fixed-sample
# 成果 HTML 较长：默认 1024 不够，接真实模型时也需要 ≥ 16000
MODEL_PROVIDER_AGNES_MAX_TOKENS=16000
```

## 2. 一次性准备

```
npm ci
npx prisma generate
npx prisma migrate deploy                     # 开发库
DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy   # 测试库
npx playwright install chromium               # 浏览器验收用
npm run dev:models                            # 开发模式：所有模型策略 → dev-agnes-flash（provider agnes）
npx tsx scripts/create-user.ts ...            # 建一个可登录的开发账号（参数见脚本）
```

## 3. 启动（三个进程）

```
node scripts/mock-kern-rich-llm.cjs           # 固定样例模型，127.0.0.1:3189（MOCK_LLM_DELAY_MS 默认 1800）
npm run dev                                   # next dev -p 3100
NODE_ENV=production PM_WORKER_LOCK_DIR=.pm-worker-dev npx tsx scripts/pm-worker.ts --loops=conversation
```

打开 `http://localhost:3100/login` 登录后进入 `/muse`。可直接发送的样例提示词见
`scripts/fixtures/kern-rich-samples.cjs` 的 `PROMPTS`：

| 样例 | 内容 | 产出 |
| --- | --- | --- |
| compare | 两个协作工具套餐对比 | 结论 + 对比卡片/矩阵 + 未知项 + 成果 `plan-compare` v1 |
| compareEdit | 「把对比里加一行数据导出…」 | 同一成果 `plan-compare` → v2 |
| cost | 拿铁单杯成本 | KPI + 瀑布图（带来源）+ 计算表 + 成果 `latte-cost` |
| plan | 官网改版排期 | 时间线 + 依赖链 + 风险 + 成果 `site-revamp-plan`（甘特） |
| short | SSO 是什么意思？ | 纯文字短答，不加卡片 |
| `[mock:artifact-fail] …` | 截断的 HTML | 成果 FAILED，文字保留，可「重新生成」 |
| productCompare（V2 验收） | 产品方案 A 自建 SaaS / B 私有化部署 / 备选 C 渠道代理 | 对比块 + 未知项 + 成果 `plan-compare` v1 |
| productCompareEdit | 「突出风险，把第二个方案换掉。」 | 同一成果 `plan-compare` → v2（B 换成 C，风险突出） |
| `[mock:artifact-fail:plan-compare] …` | 对已有成果的截断输出 | 新版本 FAILED，当前版本仍是上一个 READY |
| 「请重新生成可视化成果「…」（key=plan-compare）…」 | 重试 | 同一成果新 READY 版本 |

未匹配的消息会得到一句「固定样例服务没有对应样例」的说明，而不是编造的回答。

## 4. 验证

```
NODE_OPTIONS=--max-old-space-size=1700 npm run typecheck
npm run lint
npm run test:source-guards
npm run test:frontend-v3
npm run test:response-format
npx tsx scripts/run-test.ts tests/kern-rich-artifacts.test.ts

# 浏览器验收（生产构建 + 隔离测试库 + 独立端口）
ACC_BUILD_NODE_OPTIONS=--max-old-space-size=1800 ACC_BUILD_FLAGS=--no-lint \
  bash scripts/acc-server.sh --port 3236 3237 tests/ui-kern-rich-artifacts.ts tests/ui-kern-conversation-ux.ts
```

- 无 Mac Chrome 时两份 UI 测试使用 Playwright 自带 Chromium；可用 `CHROME_PATH=` 指定。
- 小内存机器（≈2GB）上 `next build` 的类型检查会 OOM，需要上面的 `ACC_BUILD_NODE_OPTIONS`；
  类型检查已由 `npm run typecheck` 单独覆盖，所以构建时可 `--no-lint`。
- `tests/ui-kern-rich-artifacts.ts` 把固定样例经 `formatModelReply → persistReplyArtifacts`（与引擎相同的生产管线）
  写入测试库，再在 `/muse` 上验证：v1/v2 版本、阅读区、沙箱隔离（cookie/storage/fetch/父页面均被阻断）、
  伪造 postMessage 被忽略、离线 HTML 下载与仅本人可访问、刷新恢复、失败重试不重复、1440/768/390、深浅色、减少动态。
  截图与导出样例写到 `docs/screenshots/kern-rich/`。

### V2 分支的两份端到端验收

```
# 数据库回归：真实引擎链路（acceptKernMessage → executeAcceptedKernMessage → 模型网关 → 入库 → read-model）
npx tsx scripts/run-test.ts tests/regression-kern-rich-artifacts.ts

# 浏览器实链路：起好上面三个进程后（开发库，需 npm run seed && npm run dev:models），从 /muse 输入框真实发送
UI_BASE_URL=http://127.0.0.1:3100 npx tsx tests/ui-kern-muse-live.ts    # 截图与导出 → docs/screenshots/kern-v2-muse/
```

## 5. 已知限制

- 没有逐字流式：Worker 一次性写入回复，前端轮询；等待期间显示真实的排队/处理状态和已用时间。
- `tests/regression-kern-message-execution.ts` 在基线 `6111283` 上即因 P2002 失败（conversations.ts upsert），与本改动无关。
- 意图路由的关键词（产品/版本、任务/项目/进度、决策、知识/公司/规则、草案、复核/反方）会把消息导向其它能力；
  样例提示词已避开这些词。
- 多专家（PAIR/COUNCIL）提示词会由任务规划器另外提出一份「任务简报」：富回复与成果保留，简报作为可选项附在后面
  （确认前不开工、不消耗额度）。记忆保存与「继续」恢复两个分支仍会替换回复正文（极少与成果同时出现）。
- 模型 `maxTokens` 默认 1024（`MODEL_PROVIDER_<X>_MAX_TOKENS` / `ADVISOR_LLM_MAX_TOKENS`）。成果 HTML 需要 ≥ 16000，
  否则会被截断并如实标记为 FAILED。
