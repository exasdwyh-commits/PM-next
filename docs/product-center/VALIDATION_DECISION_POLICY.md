# Product Validation Decision Policy

日期：2026-09-22

## 目标

把“产品值得不值得继续”从主观打分推进到可验证的实验决策。

Product Potential 回答：

> 现在看起来是否值得验证？

Validation Decision 回答：

> 验证跑完后，真实数据是否支持进入下一层治理复核？

它们不是同一件事。

## 1. Goal 与 Guardrail 分开

### Goal

希望产品验证达成的正向目标，例如：

- 渠道接受率
- 试销转化
- 用户复购意愿
- 关键体感反馈
- 渠道继续排期意愿

### Guardrail

即使 Goal 很漂亮，也不能突破的边界，例如：

- 退款率
- 负贡献毛利
- 合规问题
- 客诉率
- 供应稳定性
- 交付失败率
- 安全/科学证据红线

因此：

```text
Goals all green
+
Refund guardrail red
=
REWORK_OR_STOP
```

绝不做加权平均。

## 2. 五种建议

- REWORK_OR_STOP
- READY_FOR_GOVERNANCE_REVIEW
- REVIEW
- CONTINUE_VALIDATION
- DATA_INCOMPLETE

注意：

`READY_FOR_GOVERNANCE_REVIEW` 不是批准进入下一阶段，更不是上市批准。

它只是说明实验数据已经足够明确，可以提交现有 Governance Kernel。

## 3. 正向判断必须等观察窗口成熟

早期 7 天卖得好，不代表 30/60/90 天结果成立。

因此：

- 明确 Guardrail 失败可以提前停止；
- 正向结果在 minimumObservationDays 之前只能 CONTINUE_VALIDATION；
- 样本不足 / 来源缺失 / 查询错误均为未决，不能当 PASS。

## 4. 两个默认策略

### STRICT_PRODUCT_SIGNAL

适合高成本、高风险或正式产品验证：

- 任一 Guardrail FAIL → REWORK_OR_STOP
- 任一 Goal FAIL → REWORK_OR_STOP
- 全部 Goal PASS 且无 Guardrail FAIL → READY_FOR_GOVERNANCE_REVIEW
- 未决数据阻断正向结论

### DO_NO_HARM_VALIDATION

适合低成本探索：

- Guardrail 仍是硬门
- Goal 可作为学习信号，不作为硬门
- 无 Guardrail harm 后才可进入治理复核

## 5. 与 Harness 的关系

每次策略、阈值或模型建议改变：

1. 先固定 Validation Case；
2. 跑旧策略；
3. 跑新策略；
4. 比 false positive / false negative；
5. 任何 Guardrail recall 下降都视为高风险 regression；
6. 再决定是否升版本。

## 6. 后续

下一步持久化 ValidationPlan / ValidationMetricDefinition / ValidationObservation，
并让 Product Agent 生成“验证设计草案”，但阈值、指标来源与最终结果仍由确定性引擎和人工确认控制。
