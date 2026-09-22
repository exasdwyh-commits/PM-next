# PM-next 本地同步与最终修复手册

日期：2026-09-22
目标：把 GitHub main 作为冻结基线同步到本地，只做最终验收与 P0/P1 修复。

## 1. 同步前原则

不要从历史 feature 分支继续开发。
不要直接合并 PR #21 或 PR #8。
不要在本轮加入新 Agent、新模型架构、新数据源、新大页面。

先把 main 跑通。

## 2. 同步 main

    git fetch --all --prune
    git switch main
    git status
    git pull --ff-only origin main

如果本地 main 有未提交修改，先单独保存或建分支，不要直接覆盖。

建议记录同步后的 SHA：

    git rev-parse HEAD

## 3. 安装与生成

    npm ci
    npx prisma generate

确认 .env / 本地 secret 使用你自己的真实配置，不要把 API Key 提交到 Git。

## 4. 数据库

先确认 DATABASE_URL 和 TEST_DATABASE_URL 指向不同数据库。

生产式迁移检查：

    npx prisma migrate deploy

测试环境必须继续满足：
- TEST_DATABASE_URL 明确存在；
- 测试库与开发库隔离；
- 不允许测试脚本猜测或重置未知数据库。

## 5. 第一层：静态门禁

依次运行：

    npm run typecheck
    npm run lint
    npm run build

任何一项失败先修，不要继续做 UI 美化。

## 6. 第二层：核心功能回归

建议至少运行：

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
    npm run test:workforce
    npm run test:decision-run
    npm run test:system-principal
    npm run test:autopilot
    npm run test:business-events
    npm run test:experience
    npm run test:golden-org

数据库/旧 B01 基线如果你准备做完整回归，再补：
    npm run test:db
    npm run test:acceptance
    npm run test:critical

## 7. 第三层：真实模型测试

在设置页只启用你确实已经配置 Runtime 的 Profile。

检查：
- Profile provider / modelId 正确；
- Runtime missing 能正确显示；
- 未配置 Profile 不会被调用；
- Model Control binding 存在时不会偷跑旧 Advisor 路径；
- fallback 只发生在 Policy 显式候选中；
- ModelRun 能记录实际 provider/modelId/attempts；
- 失败时业务仍能回到确定性结果。

先用 Agnes 或你当前可用的低成本模型做普通路径。
Frontier / Red Team 只测试少量高价值任务，避免本地验收无意义消耗额度。

## 8. 第四层：人工浏览器验收

重点页面：
- 登录 / 退出；
- 首页 / Workbench；
- 产品库 / 产品详情；
- Evidence；
- Product Potential；
- Channel Routes；
- Settings / Model Control；
- Workforce；
- Advisor；
- 与 Autopilot / Automation trace 有关的状态反馈。

建议至少看：
- 1440
- 1280
- 1024 / 平板宽度

手机端本轮只记录明显灾难性问题，不做全面重构。

## 9. 必走的一条业务链

建议使用一个真实或脱敏产品：
1. 建立产品/版本；
2. 建立或导入证据；
3. 完成验证；
4. 运行 Product Potential；
5. 创建两个不同渠道的 Channel Route；
6. 检查经济性 Hard Gate；
7. 修改渠道规则并确认旧 Route 是否正确进入重新验证；
8. 检查 Governance / Decision 结果；
9. 触发一条 Workforce / Autopilot 路径；
10. 检查 trace、result summary 与 parent return。

这条链跑通，比继续增加几十个功能更重要。

## 10. 修复纪律

本地模型只允许：
- 复现；
- 定位；
- 最小修复；
- 加回归测试；
- 更新对应文档。

禁止：
- 顺手重构整层；
- 换技术栈；
- 新建第二套相同能力；
- 为了“更智能”绕过 deterministic / governance；
- 把 M4/M5/Jev 混进本轮。

## 11. 修复提交建议

每个缺陷尽量一个小提交：

    fix(local): <problem>
    test(regression): <problem>
    docs(closeout): <clarification>

每次修复后至少重跑受影响测试 + typecheck。

## 12. 收尾出口

当满足：
- 无 P0；
- P1 已关闭或接受；
- 本地 build 绿色；
- migrate deploy 绿色；
- 核心业务链跑通；
- 真实 provider 受控调用通过或明确保持未配置；

即可停止修复。

之后再：
- 关闭/清理历史 PR；
- 视需要打 v0.1.0-rc1；
- 开启下一版本 M4/M5/Jev backlog。

本轮目标是把 PM-next 变成稳定基线，而不是继续无限优化。