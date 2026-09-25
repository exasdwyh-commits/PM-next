# Kern V1/Beta Release Notes

日期：2026-09-25  
状态：**DELIVERABLE / FINAL ACCEPTANCE PASS**

## 版本定位

Kern V1/Beta 是 PM-next 当前冻结交付基线。

它不是“一个更漂亮的项目管理后台”，而是两层产品：

1. **Kern 主操作层**：领导层、普通员工、产品负责人日常通过对话直接交代目标、看进展、收结果、做关键决策。
2. **专业管理后台**：产品经理、项目负责人和管理员可进入完整传统后台，管理产品、项目、工作项、证据、评估、决策、自动化和审计。

## 冻结基线

- validated PR head：`cfff5fe0d30dd81fbae496d9d4e073157465d2f0`
- validated code merge baseline：`e49491c8f866771b0f01244241e538fe0e97d073`
- validated tree：`6706dd425b2345442ae3e9aff32917b9bb1e4aaf`
- final acceptance PR：#14
- GitHub Actions：11 / 11 PASS

## 最适合演示的主线

### 路径 A：Kern 日常助理

1. 登录后直接进入 Kern。
2. 给一个业务目标，例如“帮我把这个产品推进到可以评审的状态”。
3. 查看 Kern 基于真实上下文返回的计划 / 研究 / 委派。
4. 只有真实 RUNNING 状态才显示正在执行。
5. 出现业务写入或高风险动作时，通过 Check-in 由人确认。
6. 最终查看 Executive Report，再由人决定是否继续推进。

### 路径 B：产品经理后台

1. 从 Kern 进入管理系统。
2. 产品管理查看产品全局信息。
3. 项目管理进入具体项目。
4. 在“概览 / AI 研发 / 工作项 / 证据 / 决策 / 记录”中下钻。
5. 查看产品评估、Evidence、独立 QA、Decision / Gate、Audit。
6. 需要讨论时随时回到 Kern，并带产品 / 项目上下文继续沟通。

### 路径 C：Mac 本机执行

1. 启动 Kern 本机执行。
2. 在 Kern 中说“本机帮我检查这个仓库，把能确定的 Bug 修掉并告诉我结果”。
3. 未连接时任务只显示排队，不冒充执行。
4. Mac 真实领取任务后才显示 Kern 正在使用电脑。
5. 结果、失败、产物和 receipt 回到原 Kern 会话。

## 已验收关键能力

- Conversation-first Kern 主界面；
- Kern Today 真实状态聚合；
- Governed Planner；
- Digital Workforce；
- Product R&D；
- Evidence / Independent QA；
- Executive Report；
- Product / Project / WorkItem 管理；
- G1 / G2 / G3；
- Decision Intelligence；
- Governance / Audit；
- Model Gateway；
- Mac Desktop Runtime；
- 390px 主操作界面与关键条件态；
- PostgreSQL migration chain；
- production `next start` Product R&D HTTP E2E。

## 当前明确边界

V1/Beta **不宣称**：

- 已具备通用视觉 Computer Use；
- 任意第三方桌面 App 都可零配置操作；
- 所有科研 / 法规 / 供应链数据源均已接通；
- 所有模型 provider 都已配置可用；
- Laya 已完成高风险业务 workload 校准；
- 未经真实客户数据验证的业务结论已经成立。

## 本地部署

```bash
git fetch --all --prune
git switch main
git pull --ff-only origin main

npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
npm run dev
```

开发环境默认端口：`3100`。

## 快速验收

```bash
npm run test:delivery-contracts
npm run typecheck
npm run lint
npm run build
```

完整本地测试：

```bash
npm run test:sweep
```

移动 / 条件态：

```bash
npm run test:mobile-layout
```

## 后续版本规则

从这个冻结点开始，不再为“看起来更完整”继续堆功能。

V1.1 只接受：

- 真实部署反馈；
- 真实客户 Demo 反馈；
- 产品经理实际工作时暴露的后台缺口；
- Kern 主操作体验中的高频阻塞；
- 可明确验证价值的扩展能力。

任何新源代码提交都必须重新建立自己的 CI / 验收证据，不能直接继承本次 V1/Beta PASS。
