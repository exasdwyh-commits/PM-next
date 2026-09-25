# 本地可用性 / 环境检查清单

日期：2026-09-24

## 先做这 3 步

```bash
# 1. 启动独立 Postgres（5433）
bash scripts/pg_hermes_start.sh

# 2. 启动应用
npm run dev
# http://127.0.0.1:3100

# 3. 登录
# 本地可先统一口令：
npx tsx scripts/_set-dev-password.ts 'DevPass123!'
# 账号：zhang_pm@hermes.test / li_vp@hermes.test / wang_eval@hermes.test
```

## 产品研发评估（PM OS Kernel）

入口：更多 → 产品研发评估（`/product-rnd`）

已验证：
- 登录后可跑通
- 使用 Agnes 模型时会产出真实 claims
- 无独立官方来源时 `evidenceLevel=UNKNOWN`（正确，不是 bug）
- 幂等键重复不会新建第二个 Project

## 常见“不能用”原因

| 现象 | 原因 | 处理 |
|---|---|---|
| 打不开 / 一直跳登录 | Postgres 未启动 | `bash scripts/pg_hermes_start.sh` |
| 登录 401 | seed 口令是随机生成或未同步 | `npx tsx scripts/_set-dev-password.ts '<8+位>'` |
| 报告全是固定 4 条、很空 | Kernel 没吃到模型配置（原只认 `OPENAI_COMPATIBLE_*`） | **已修**：自动回退读 `MODEL_PROVIDER_AGNES_*` / `ADVISOR_*` |
| 浏览器预览页点了没反应 | 预览页无 cookie，且 `DEV_MOCK_AUTH=false` | 在 PM-next 内登录后用 `/product-rnd`；或临时 `DEV_MOCK_AUTH=true` |
| 模型说了很多但仍 UNKNOWN | Verifier 不把 model output 当证据 | 需要 allowlist 官方 URL 抓取，这是设计 |

## 我还需要你确认的配置（可选）

1. **是否允许本地 `DEV_MOCK_AUTH=true`**（方便免密开发登录；生产必须 false）
2. **独立 source fetch**：是否要在本机真的抓 `fda.gov / nmpa.gov / pubmed…`（需要出网）
3. 若 Agnes 偶发 429/超时：可告诉我，我可以加 fallback / 重试策略
4. 你主要卡住的入口是哪个？  
   - A. 产品研发评估 `/product-rnd`  
   - B. 产品开发 / War Room 旧页面  
   - C. AI 顾问  
   - D. 整站都要顺一遍

## 当前健康状态（本机实测）

- `POST /api/kernel/product-rnd` → 200，真实模型产出 6 条 claims
- `/product-rnd` 页面 200
- `npm run typecheck` / `npm run test:kernel` PASS
