# 开品报告（产品开发立项报告）标准格式 v1.0

本文档对应 `src/modules/visual-intelligence/report-format.ts`（纯函数）与
`src/modules/usage/token-usage.ts`（token 用量与成本统计）。
它把「一份好的开品报告」沉淀成可执行、可测试、可审计的格式契约。

## 背景：为什么需要这份格式

本地测试反馈了两个反复出现的问题：

1. **报告停留在复述输入**：读者录入基础需求后，得到的报告缺少产品分析、成本与销售机制建议、
   风险评估、营销策略等真正有决策价值的内容。
2. **详细分析被截断，摘要与全文阅读效果不一致**：生成型任务 agent 的输出字数过多时被截断，
   读者读到的「残缺版本」和设计中的「完整报告」体验不同。

本格式用三条原则回应：

- **摘要先行**：执行摘要层可独立成篇；即使详细层被截断，摘要层也必须完整。
- **预算约束**：每章有字数预算，生成端输出与渲染端展示都在预算内收敛。
- **不伪造数字**：金额、市场规模、销量、转化率、功效结论一律「待填写 / 待验证」，未知即未知。

## 报告结构

正文（Markdown 部分）建议不超过 **8000 字**，推荐生成端 `maxTokens ≥ 6912`
（按 1 token ≈ 1.5 汉字粗略估算并留 25% 余量）。

| 章节 id | 标题 | 必需 | 摘要 ≤ | 细节总 ≤ | 单条 ≤ | 条数 ≤ |
| --- | --- | --- | --- | --- | --- | --- |
| opportunity | 机会与市场洞察 | 是 | 100 | 500 | 180 | 4 |
| positioning | 产品定位与目标用户 | 是 | 100 | 500 | 180 | 4 |
| competition | 竞品格局与差异化 | 否 | 100 | 400 | 180 | 3 |
| cost-structure | 成本结构与盈利模型 | 是 | 120 | 700 | 200 | 8 |
| sales-mechanism | 销售机制与渠道建议 | 是 | 120 | 600 | 200 | 4 |
| risk-assessment | 风险评估与缓解 | 是 | 120 | 600 | 200 | 5 |
| marketing-strategy | 营销策略 | 是 | 120 | 500 | 200 | 5 |
| compliance | 合规边界 | 是 | 100 | 300 | 150 | 3 |
| roadmap | 研发里程碑 | 是 | 100 | 400 | 150 | 6 |
| growth | 增长指标与验证 | 是 | 100 | 400 | 150 | 5 |
| token-cost | Token 与成本统计 | 否 | 120 | 400 | 160 | 4 |
| appendix | 附录：证据与未知 | 是 | 100 | 400 | 150 | 4 |

字数按 Unicode 字符计（中文 ≈ 1 字 / 字符）。

## 两层阅读结构

- **摘要层（summary layer）**：执行摘要（≤400 字）+ 每章首句摘要。只读摘要层应能掌握全文结论、
  关键缺口与成本口径。`buildExecutiveSummary` 汇总各必需章节的摘要并守预算。
- **详细层（detail layer）**：每章的细节条目，按需展开。`buildReportSection` 会把摘要和每条细节
  收敛到预算内，超出总预算或条数上限的条目丢弃。

阅读效果设计：读者先读摘要层（约 1 分钟），再按兴趣展开详细层；即使生成端输出被截断，
排在前面的摘要层也是完整的。

## 防截断规则

- `fitTextToBudget(text, maxChars)`：优先在句边界（。！？；.!?;）截断并追加省略号；
  找不到句边界时硬切并尽量避开切断英文单词。
- 生成端应遵守 `REPORT_OUTPUT_CONTRACT`（可直接拼入提示词）：先输出执行摘要，再输出详细层；
  `maxTokens` 不足时优先保摘要层完整、详细层分段输出。
- 渲染端（`buildHealthcareInnovationReply`）对整篇正文做预算收敛作为安全网，
  超出时在句边界截断并追加收敛说明。

## 内容红线（不伪造）

- 成本章节只给六类列支、占位提示与公式（单位毛利、回本周期）；金额一律「待填写」。
- 市场章节只引用调用方提供的可追溯信号；不生成市场规模、销量、转化率或功效结论。
- 健康功效表达必须绑定证据等级与来源；疾病预防、治疗、治愈类表达直接触发暂停。
- 渠道与营销建议整体标注为推断（INFERENCE），并给出最小验证方式。

## Token 与成本统计

每次模型调用的用量（模型、输入/输出 token 数）由调用方提供，记录在 `tokenUsage` 输入里：

```ts
const brief = buildHealthcareInnovationBrief({
  // ...其他输入
  tokenUsage: [
    { model: "gpt-4o", purpose: "创新简报生成", inputTokens: 8000, outputTokens: 4345 },
  ],
});
```

- 估算口径：按厂商公开参考价（`MODEL_TOKEN_PRICING`，2026-10 核对）计算美元成本；
  模型名按最长前缀匹配（`gpt-4o-2026-06-01` → `gpt-4o`）。
- 未收录定价的模型成本记为未知（`null`），不估算、不计入合计；任一调用定价未知时，
  汇总成本 `estimatedCostUsd` 为 `null`，只给出已收录部分的 `knownCostUsd`。
- 报告中以「公开参考价，实际以账单为准」标注口径，并提供 `TokenUsageTracker` 供运行时逐次记录。

## 使用方式

```ts
import {
  PRODUCT_DEVELOPMENT_REPORT_FORMAT,
  REPORT_OUTPUT_CONTRACT,
  buildExecutiveSummary,
  buildReportSection,
  estimateMaxOutputTokens,
  fitTextToBudget,
  validateReportSections,
} from "@/modules/visual-intelligence/report-format";
import {
  TokenUsageTracker,
  estimateCostUsd,
  formatTokenCostLine,
} from "@/modules/usage/token-usage";

// 校验一份报告是否符合格式
const result = validateReportSections(sections);
if (!result.ok) console.error(result.problems);
```

## 适用边界

- 本格式用于产品立项决策报告的结构与篇幅约束，不替代财务预算、法务审查或市场研究报告。
- 参考价格与 token 估算仅用于内部透明统计，不构成账单、报价或对外承诺。
- 大健康场景下，本格式不构成医疗建议、法律意见或上市批准。
