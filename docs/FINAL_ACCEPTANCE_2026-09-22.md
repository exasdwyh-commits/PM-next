# PM-next 最终验收基线

日期：2026-09-22
结论：远程自动化验收 PASS；本地真实环境验收 PENDING
运行时代码基线：f5e5b780

## 1. 自动化验收结论

f5e5b780 在 main 上的 8 条核心工作流全部成功：

| 验收面 | 结果 | 核心覆盖 |
| --- | --- | --- |
| Quality CI | PASS | Golden、Potential、Channel Routes、Model Gateway、Model Control、Model Runtime、Harness、Validation Decision、Decision Intelligence、Launch Authorization、typecheck、lint、build |
| Governance CI | PASS | governance typecheck、Prisma migrate deploy、Governance convergence、Research Snapshot、Formal G3 |
| Workforce CI | PASS | typecheck、Prisma migrate deploy、Workforce Kernel |
| Decision CI | PASS | typecheck、Prisma migrate deploy、DecisionRun、System Principal |
| Autopilot CI | PASS | typecheck、Prisma migrate deploy、Autopilot |
| Experience CI | PASS | typecheck、Prisma migrate deploy、Harness Experience |
| Business Event CI | PASS | typecheck、Prisma migrate deploy、Business Event Outbox |
| Golden Organization CI | PASS | typecheck、Prisma migrate deploy、AKG / 骆驼奶+AOS / AKK / Channel Route persistence |

## 2. 已验收的产品能力

### A. 产品与证据
PASS
- Product / ProductVersion；
- Evidence 来源与验证状态；
- 真实证据与 demo 数据边界；
- Product Potential / Hard Gate / Validation；
- Evidence fingerprint / assessment snapshot。

### B. 渠道规格路线
PASS
- 一个版本多渠道路线；
- 确定性渠道经济性；
- route revision / supersedes；
- ASSUMED / CONFIRMED / SUPERSEDED；
- 渠道规则 freshness；
- channel-scoped evidence；
- confirmed product version 前置；
- active-rule 并发约束；
- 数据库级 persistence regression。

### C. 模型控制
PASS
- ModelProfile / ModelPolicy；
- Agent × TaskClass binding；
- Provider Runtime；
- 显式 fallback；
- fail closed；
- ModelRun provenance；
- API Key 不入数据库；
- 配置缺失时不会伪装模型已可用。

### D. Agent / Workforce
PASS
- Agent / Skill / Squad；
- Delegation；
- task start / finish；
- review return；
- output summary；
- parent return / parent action；
- activity brief。

### E. Decision / Governance
PASS
- Decision Intelligence；
- typed rules；
- Policy Gate；
- DecisionRun；
- System Principal；
- Launch Authorization；
- Governance convergence。

### F. 自治与经验
PASS
- Autopilot durable wakeup；
- lease / cooldown；
- Business Event Outbox；
- automation causality；
- child result return；
- Evaluation Harness；
- Experience persistence；
- Golden Organization multi-case。

## 3. 本地仍必须完成的验收

自动 CI 不能替代以下真实环境检查，因此这些在本文件中保持 PENDING：

1. 真实本地 PostgreSQL 数据迁移；
2. 从干净依赖安装启动；
3. 真实浏览器人工走通关键路径；
4. 使用你实际准备采用的 provider / endpoint / key 做受控模型调用；
5. 检查 Model Control 设置页与 Runtime missing / fallback 的真实显示；
6. 使用真实产品数据建立至少一个 Channel Route；
7. 验证 Evidence → Assessment → Route → Governance 的人工可理解性；
8. 验证 Workforce / Autopilot 的 UI 回执是否符合你的使用习惯；
9. 检查桌面和平板常用宽度的视觉问题。

## 4. 缺陷分级

P0 — 必须修：
- 无法 npm ci / build / start；
- Prisma migrate deploy 失败；
- 数据破坏或跨组织数据泄露；
- 登录/权限失效；
- Governance 可被绕过；
- 核心 CI 在相同基线失败。

P1 — 收尾建议修：
- 核心业务流程无法完成；
- 关键页面/API 500；
- provider routing 与设置不一致；
- Channel Route / Workforce / Autopilot 关键交互错误；
- 用户无法理解为什么被 gate。

P2 — 下一版本：
- 纯视觉细节；
- 更高级动效；
- 非阻断信息密度问题；
- 手机端专项适配；
- 新模型、新 Agent、新数据源。

## 5. 当前接受的边界

- CI 不持有你的真实商业 provider secret，因此“真实第三方模型可调用”需要本地验证；
- 手机端不是当前交付阻塞项；
- PR #21、#8 为历史分叉，不计入当前 main 的完成状态；
- M4/M5/Jev 等属于下一版本。

## 6. 最终判定规则

满足以下条件即可把本版本判为完成：
- 8 条核心 CI 绿色；
- 本地 typecheck / lint / build 绿色；
- 本地 migrate deploy 成功；
- 核心浏览器路径走通；
- 无 P0；
- P1 均已修复或显式接受；
- 不再把下一版本功能混入当前修复。

当前远程自动化部分已经达到 PASS。下一步只需要做本地真实环境收尾。