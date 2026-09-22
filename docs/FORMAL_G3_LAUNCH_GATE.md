# Formal G3 上市授权

日期：2026-09-22

## 目标

正式 G3 把“上市准备就绪”和“允许上市”拆成两个不同状态：

- LaunchPlan / 里程碑负责表达准备状态；
- DecisionPacket（gate=LAUNCH_GATE）表达正式上市授权；
- 负责人只能提交；
- Project.decisionMakerId 指定的独立决策人负责批准或驳回；
- G3 批准不会自动把产品标记为已上市；
- 实际上市仍由 confirmLaunchExecution 记录真实动作。

## 冻结范围

G3 创建/送审时冻结：

- LaunchPlan id；
- LaunchPlan governanceRevision；
- 当前有效的正式 G2 决策包；
- 当前产品版本、已验收 REAL 的 PRODUCTION_RECORD 及内容指纹；
- 项目必须已完成真实生产交付并处于 DELIVERED；
- 计划标题、负责人、目标日期、备注；
- 全部里程碑及状态；
- Project id / revision；
- 当前 ProductVersion；
- 以上内容的 SHA-256 指纹。

审批时重新读取数据库真值并复算。如果上市计划、产品版本、正式 G2 或生产交付记录任一关键内容发生变化，旧快照不得继续批准。G3 因此不能绕过 G2 或仅靠“上市里程碑已完成”取得授权。

## 并发与失效

LaunchPlan 新增 governanceRevision 作为 CAS 令牌。

基本信息或里程碑发生实质修改时：

1. governanceRevision + 1；
2. 清空当前有效 formalG3PacketId / formalG3ApprovedAt；
3. 正在 DRAFT / IN_REVIEW 的 G3 包转为 WITHDRAWN；
4. 历史 APPROVED DecisionPacket 与 Decision 保持不变；
5. 写入 FORMAL_G3_INVALIDATED 审计。

因此“历史上曾经批准”与“当前仍有效”是两个不同事实。

## 角色边界

- Project OWNER：建立/修改上市计划，提交 G3；
- Project DECISION_MAKER：批准或驳回 G3；
- OWNER 不得自批；
- 其他角色只读或按既有产品权限工作。

## 实际上市

confirmLaunchExecution 只接受当前有效的 Formal G3。

历史 approvedAt（LEGACY_APPROVAL）不再能绕过正式 G3。确认实际上市后，原 LaunchPlan / 里程碑进入历史状态，不允许回头改写；后续业务变化应进入复盘流程。

## 回归

```bash
npm run test:launch-auth
npm run test:g3
```

数据库回归覆盖：

- 负责人自批失败且零 Decision；
- 送审后修改计划，旧 IN_REVIEW 包自动撤回；
- 指定决策人批准后产生正式 G3；
- G3 不错误推进 ProjectStage；
- 正式 G3 后修改计划，当前授权失效但历史 Decision 保留；
- 失效后不能确认实际上市；
- 重新审批后可以确认实际上市；
- 缺正式 G2 / 真实生产交付时不能提交 G3；
- 仅有旧 approvedAt 不能上市；
- 实际上市后禁止篡改历史上市计划。

## G2 状态

PRODUCTION_GATE 仍保持 fail-closed。正式 G3 合并后，下一治理包实现 G2 生产门，而不是绕开它。
