# PM-next 本地同步与最终修复手册

日期：2026-09-23  
目标：同步 `release/v0.1.0-rc1`，在本地只做真实环境验收和 P0/P1 修复。

## 1. 同步

```bash
git fetch --all --prune
git switch release/v0.1.0-rc1
git status
git pull --ff-only origin release/v0.1.0-rc1
git rev-parse HEAD
```

不要从历史 feature 分支继续开发。PR #8 / #21 已关闭。

## 2. 安装

```bash
npm ci
npx prisma generate
```

API Key 只放本地环境变量 / Secret，不提交仓库。

## 3. 数据库

确认 `DATABASE_URL` 与 `TEST_DATABASE_URL` 隔离。

```bash
npx prisma migrate deploy
```

禁止对未知数据库自动 reset。

## 4. 第一层：静态门禁

```bash
npm run typecheck
npm run lint
npm run build
```

失败先修，不做 UI 扩展。

## 5. 第二层：核心回归

至少：

```bash
npm run test:golden
npm run test:potential
npm run test:channel-routes
npm run test:model-gateway
npm run test:model-control
npm run test:model-runtime
npm run test:harness
npm run test:validation-decision
npm run test:decision-intelligence
npm run test:launch-auth
npm run test:governance
npm run test:g2
npm run test:g3
npm run test:structured
npm run test:gate-boundaries
npm run test:workforce
npm run test:decision-run
npm run test:system-principal
npm run test:autopilot
npm run test:business-events
npm run test:experience
npm run test:golden-org
```

需要完整旧基线时再加：

```bash
npm run test:db
npm run test:acceptance
npm run test:critical
```

## 6. 第三层：真实模型

只启用确实配置 Runtime 的 Profile。

检查：
- provider / modelId 正确
- Runtime missing 正确
- disabled profile 不调用
- binding 后不偷跑旧 Advisor
- fallback 只在 policy 候选内
- ModelRun 记录真实 provider/modelId/attempts
- 失败时回落确定性结果

普通测试先用低成本模型。Frontier / Red Team 只做少量 smoke test。

## 7. 第四层：人工浏览器

重点：
- 登录 / 退出
- Workbench
- 产品 / Evidence
- Product Potential
- Channel Routes
- Project detail
- Production / G2
- Launch / G3
- Settings / Model Control
- Workforce
- Advisor
- Autopilot / Automation Trace

建议宽度：
- 1440
- 1280
- 1024 / 平板

手机只记录灾难性问题，不重构。

## 8. 必走业务链

建议用一个真实或脱敏产品：

1. 建产品和已确认 ProductVersion；
2. 导入并验证 Evidence；
3. 跑 Product Potential；
4. 建两个 Channel Route 并验证经济性 Hard Gate；
5. 验证研发/打样 Gate；
6. 新品完成 SAMPLE_ROUND=PASS；
7. 进入 PRODUCTION_PREP；
8. 准备并验收当前版本 REAL 成果：
   - SUPPLIER_QUOTE
   - SAMPLE_ROUND（新品）
   - PROFESSIONAL_CONFIRMATION
   - PACKAGING_BRIEF
   - PRODUCTION_PLAN
9. Owner 创建/提交 G2；
10. 用独立 Decision Maker 批准；
11. 确认 G2 APPROVED 后仍未自动进入 PRODUCTION；
12. 执行真实开工；
13. 录入并验收 PRODUCTION_RECORD；
14. 确认交付；
15. 验证 G3 对 production basis 的要求；
16. 检查 Audit / Decision / trace / Workforce 回执。

## 9. 本地修复纪律

允许：
- 复现
- 定位
- 最小修复
- 回归测试
- 对应文档更新

禁止：
- 顺手重构整层
- 换技术栈
- 重建重复能力
- 绕过 deterministic / Governance
- 把 M4/M5/Jev/P3 混入本轮

## 10. 修复出口

满足：
- 无 P0
- P1 已修或接受
- build 绿
- migrate deploy 绿
- 真实 provider smoke test 通过或明确未配置
- G1/G2/G3 业务链通过

即可停止本轮修复。

当前仓库已有 `v0.1.0-rc1` 标签。完成本地真实环境验收、精确提交 CI 复验和阻断修复后，再决定是否发布正式 `v0.1.0`；之后再开启 Issue #11 等下一版本工作。
