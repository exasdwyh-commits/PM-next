# Formal G2 生产投入授权

日期：2026-09-22

## 语义

G2 回答的是“是否允许投入正式生产”，不是“是否已经生产”。

完整链路：

1. 新品：当前版本 SAMPLE_ROUND 经负责人验收且 verdict=PASS；
2. 显式从 SAMPLING 进入 PRODUCTION_PREP；
3. 准备并验收当前版本的报价、专业确认、包装确认、生产计划；
4. 负责人提交 DecisionPacket(PRODUCTION_GATE)；
5. 指定决策人批准/驳回，负责人禁止自批；
6. G2 批准后仍停留在 PRODUCTION_PREP；
7. 负责人记录真实开工后才进入 PRODUCTION；
8. 当前版本 PRODUCTION_RECORD 验收后，负责人确认交付，进入 DELIVERED。

固定产品从 PRODUCTION_PREP 建档，不伪造 G1 或样品历史；但仍必须提供当前版本适用的报价、专业/包装确认和生产计划。

## G2 当前冻结范围

- Project id / revision；
- 当前已确认 ProductVersion；
- 精确 Artifact id / type / contentVersion / contentHash / inputRevision；
- SUPPLIER_QUOTE；
- SAMPLE_ROUND（仅新品）；
- PROFESSIONAL_CONFIRMATION；
- PACKAGING_BRIEF；
- PRODUCTION_PLAN；
- 生产数量、预算、币种、交期、生产条件、停止条件；
- productionFingerprint（SHA-256）。

## 结构化成果规则

正式 G2 只接受当前产品版本、reviewStatus=ACCEPTED、dataNature=REAL、missingInputs=[] 的结构化成果。

报价必须仍在 validUntil 内；新品样品必须 PASS；专业确认若声明 validUntil 则不得过期；PRODUCTION_PLAN 必须引用当前选中的报价、包装和新品样品成果 ID。

## 漂移与失效

- G2 送审前重新读取 DB 真值；
- 审批时再次重算；
- 待审批期间关键输入变化，再次提交会把旧 DRAFT/IN_REVIEW 包自动置 WITHDRAWN，并写 FORMAL_G2_INVALIDATED；
- 已批准后数量/预算/规格/报价等关键输入变化，confirmProductionStart 会拒绝执行并要求重新 G2；
- 历史 APPROVED DecisionPacket / Decision 不被删除或改写。

正常生产进度和交付凭据不会反向改写原 G2 授权；它们属于批准后的执行事实。

## 执行边界

G2 APPROVED != 已开工。

confirmProductionStart 会重新验证当前 productionFingerprint 和 scopeHash，只有仍与批准快照一致时才允许 PRODUCTION_PREP -> PRODUCTION。

confirmProductionDelivery 要求当前版本、负责人验收通过、REAL 的 PRODUCTION_RECORD，并且 authorizationRef 必须指向正式 G2；然后才允许 PRODUCTION -> DELIVERED。

## 回归

```bash
npm run test:g2
npm run test:structured
```

数据库回归覆盖：

- 新品 PASS 样品才能进入生产准备；
- 生产准备不会伪造 G2；
- 负责人自批失败且零 Decision；
- 待审批报价/计划变化自动撤回旧包；
- G2 批准仍停在 PRODUCTION_PREP；
- 批准后关键输入越界时实际开工被阻断；
- 重批后真实开工进入 PRODUCTION；
- PRODUCTION_RECORD 引用 G2 后才可确认交付；
- 固定产品无需伪造 G1 / SAMPLE_ROUND。
