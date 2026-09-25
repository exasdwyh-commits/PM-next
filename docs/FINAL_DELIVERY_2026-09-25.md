# Kern V1/Beta 最终交付验收

日期：2026-09-25  
进入本轮最终验收前的 main 基线：`9ace96db304104702ef5846b984bf1e27337d084`  
最终验收分支：`release/kern-v1-beta-final-acceptance`

> 本文件描述验收口径。最终通过条件是：**该最终验收 PR 的同一个 head 上 11 条 GitHub Actions workflow 全部绿色**。不要把不同提交的历史绿灯拼成“最终全绿”。

## 1. 产品形态

### Kern 主操作层

Kern 是日常主操作界面：

- 用户直接描述业务目标；
- Kern 根据真实公司 / 产品 / 项目上下文决定下一步；
- 受治理 Planner 只能选择白名单能力；
- 数字员工、研究、产品研发、本机执行都从同一会话回传结果；
- 只在需要人判断时用 Check-in 打断；
- 用户消息本身不等于“正在执行”。

首屏固定回答：

1. 今天什么最重要；
2. Kern 正在真实执行什么；
3. 现在需要我处理什么。

### 专业管理后台

领导层与普通员工可以只用 Kern；产品经理、项目负责人和管理员还可以进入完整传统后台：

- 产品管理；
- 项目管理；
- 工作项；
- 产品评估 / AI 研发；
- Evidence / QA；
- 决策包 / G1 / G2 / G3；
- 自动化 / Workforce；
- Audit / Trace；
- Model Control。

Kern 与后台互补，不互相替代。

## 2. 本轮已经收口的交付项

- P0：真实 AgentRun 状态驱动执行展示；无真实授权模型时不伪造本机权限开关。
- A1：`ASSISTANT_PLANNING` 接入受治理 Planner；Desktop 和写入类意图不交给模型越权选择。
- A2：Kern 主界面去重玻璃拟态，保留单一强调渐变、light/dark、reduced motion。
- A3：Today 使用真实 Workspace / AgentTask / Desktop 状态。
- A4：Executive Report 显式呈现当前结论、关键依据、最大风险、UNKNOWN、需人决策、下一步；Agent 原始意见默认折叠。
- A5：用户感知为“Kern 在使用这台 Mac”；Runtime / CLI 命令降级为实现与开发帮助。
- B1：上市弹窗和成本结果态 390px 实测 0 页面级横向溢出，因此没有假修复。
- B2：气泡 Y 轴实测 1px 裁切，手机档最小修复后为 0。
- B3：项目表单裸枚举改为共享中文 label。
- B4：关键空状态说明“为什么没有 + 下一步做什么”。
- B5：可见术语统一为 Kern / 产品 / 项目 / 工作项 / 门禁 / 决策包。
- B1b：知识库用户文案不再暴露环境变量名。

## 3. 诚实性红线

以下仍为交付硬规则：

- QUEUED 不显示“正在执行”；
- 没有真实结果不显示“已完成”；
- 没有真实证据不补造结论；
- UNKNOWN 是一等状态；
- Proposal 未确认不能写业务事实；
- Gate / Approval / Governance 不能被模型绕过；
- Mac 未连接时，本机任务明确显示排队 / 未开始；
- 所有本机结果必须来自真实领取与回执。

## 4. 最终 CI 矩阵

最终验收 PR 通过 `package.json` 改动触发 10 条核心工作流，并通过移动验收文件触发第 11 条：

1. Quality CI
2. Governance CI
3. Workforce CI
4. Decision CI
5. Autopilot CI
6. Experience CI
7. Business Event CI
8. Golden Organization CI
9. Product R&D Delivery CI
10. Desktop CI
11. Mobile Conditional Layout CI

其中 Product R&D Delivery 包含生产模式 `next start` 的真实 HTTP E2E；Desktop CI 在 macOS runner 上验证本机 Runtime 契约与启动；Mobile CI 用 Playwright 验证 Kern 主界面、上市弹窗、成本结果态和机会气泡图。

## 5. 本地快速门禁

```bash
npm run test:delivery-contracts
npm run typecheck
npm run lint
npm run build
```

有独立测试数据库与 Playwright 浏览器时：

```bash
npm run test:mobile-layout
npm run test:product-rnd-e2e
npm run test:sweep
```

## 6. 明确不冒充完成

本 V1/Beta 不把以下事项说成已经完成：

- 通用视觉 Computer Use（屏幕理解 + 坐标点击 + 拖拽 + 视觉恢复）；
- 任意第三方 App 的零配置 GUI 自动化；
- 所有外部科研 / 法规 / 供应链数据源；
- Laya 的正式高风险 workload 校准；
- 未经实际账号配置的外部模型 provider 可用性；
- 未经真实客户数据跑过的业务结论。

## 7. 最终通过规则

可以认定为“可部署、可运行、可验证、可演示、可交付”的 V1/Beta，必须同时满足：

- 最终验收 PR 同一 head 11/11 CI 绿色；
- Quality 中 typecheck / lint / production build 绿色；
- Product R&D 真实 HTTP E2E 绿色；
- Desktop CI 绿色；
- Kern 1440 / 390 页面级无横向溢出；
- 无已知 P0；
- 新发现 P1 已修复或明确登记为接受边界。

任何一条未满足，都只称“候选”，不称最终交付。
