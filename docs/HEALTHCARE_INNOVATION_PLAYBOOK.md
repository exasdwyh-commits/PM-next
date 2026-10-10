# 大健康产品创新与项目成果展示 playbook

这份文档对应 `src/modules/visual-intelligence/healthcare-innovation-brief.ts`。它把“科学证据、市场验证、产品研发、合规门禁、增长实验和项目成果展示”收敛成一套可复用、可审计的纯函数输出。

## 适用边界

- 面向大健康方向的产品机会评估、研发流程优化、市场验证设计和项目方案展示。
- 不替代医生建议、法律意见、注册审批、广告审查或生产质量放行。
- 不抓取网页，不生成市场规模、销量、转化率或功效结论；所有数字和事实都必须来自调用方提供的可追溯输入。
- 健康功效表达必须先通过证据分级和法规边界审查。

## 核心原则

1. **事实、推断、假设、未知分开**：`FACT` 必须有来源；`INFERENCE` 要标注待验证；`ASSUMPTION` 不能伪装成事实；`UNKNOWN` 保持未知。
2. **先验证，后放大**：证据和市场信号不足时，不进入打样、投放或规模化扩张。
3. **合规是硬门禁**：未确认法规路径时，对外表达和广告投放保持 `HOLD`。
4. **产品好不好，用真实信号判断**：访谈、小规模投放、留存、复购、退款、客诉和渠道履约优先于内部评分。
5. **营销服务产品价值**：先进营销不是夸大表达，而是证据驱动、场景匹配、全生命周期运营和可测量复盘。

## 使用方式

```ts
import {
  buildHealthcareInnovationBrief,
  buildHealthcareInnovationReply,
  buildHealthcareInnovationGraph,
  toHealthcareInnovationArtifactBusinessInput,
} from "@/modules/visual-intelligence/healthcare-innovation-brief";

const brief = buildHealthcareInnovationBrief({
  idea: "做一款面向都市白领的便捷抗氧化大健康饮品",
  targetUser: "25-40 岁都市白领",
  desiredOutcome: "帮助用户建立可持续的抗氧化营养补充习惯",
  sources: [
    {
      id: "src-1",
      title: "公开发表的人体研究索引",
      url: "https://pubmed.ncbi.nlm.nih.gov/",
      trust: "external",
    },
  ],
  evidence: [
    {
      claim: "目标成分在成品剂型下显示出稳定的吸收记录",
      basis: "FACT",
      evidenceLevel: "A",
      sourceIds: ["src-1"],
      population: "成年人群",
      limitations: ["研究周期较短"],
    },
  ],
  marketSignals: [
    {
      segment: "25-40 岁都市白领",
      need: "便捷补充抗氧化营养素",
      channel: "私域社群",
      priceBand: "80-150 元/盒",
      proof: "渠道访谈与竞品价格记录",
      basis: "FACT",
      sourceIds: ["src-1"],
    },
  ],
  regulatoryConfirmed: false,
});

const reply = buildHealthcareInnovationReply(brief);
const graph = buildHealthcareInnovationGraph(brief);
const artifactBusinessInput = toHealthcareInnovationArtifactBusinessInput(brief);
```

## 研发流程

| 阶段 | 目标 | 关键交付物 | 停止条件 |
| --- | --- | --- | --- |
| 机会识别 | 收敛可验证假设 | 机会假设卡、目标人群、反证问题 | 只追热点，没有真实用户问题 |
| 证据审查 | 建立证据等级与宣称边界 | 证据清单、限制、可说/禁说 | 用动物或机制研究冒充人体结论 |
| 用户洞察 | 验证人群、场景、动机与顾虑 | 访谈纪要、支付意愿、顾虑清单 | 只凭内部判断，不做真实用户验证 |
| 产品定义 | 形成定位、卖点、价格带与不做什么 | 产品定义卡、宣称清单、成本红线 | 用疾病治疗承诺换取短期转化 |
| 技术与供应验证 | 确认配方、工艺、稳定性与供应 | 工艺方案、报价、样品计划 | 核心原料无稳定供应或放大失控 |
| 合规门禁 | 完成类目、注册/备案路径与广告审查准备 | 法规评估、标签审核、宣称白名单 | 需要药品/器械路径但团队不具备条件 |
| 最小市场验证 | 用最小成本验证真实需求与留存 | 实验设计、投放结果、复购与退款 | 转化依赖虚假承诺或退款异常 |
| 增长与迭代 | 放大有效产品并持续复盘 | 漏斗看板、实验记录、迭代决策 | 指标改善来自刷单或夸大宣传 |

## 科学证据规则

- 证据级别沿用项目内 A/B/C/D 语义：A 级需要更强的人体研究基础，B 级至少有人体研究但不满足 A 级条件，C 级证据较弱，D 级主要是机制、传统经验或专家意见。
- 原料研究不等于成品研究；机制研究不等于人体功效。
- 每条 `FACT` 必须绑定来源；冲突证据并列，不静默覆盖。
- 高风险表达命中疾病、治疗、治愈、诊断、处方、药品、肿瘤等语义时，建议直接暂停。

## 市场验证规则

市场信号至少应覆盖：人群、需求、渠道、价格带、竞品和验证方式。没有真实渠道反馈、销售记录或用户研究时，市场结论保持“待验证”。不要用模型评分替代市场验证。

## 好产品标准

一个值得继续推进的大健康产品，至少应同时满足：

1. 有真实、可感知的用户问题和使用场景；
2. 功效表达与证据能力匹配；
3. 产品定义、价格、成本和渠道互相成立；
4. 配方、工艺、供应和质量风险可控；
5. 法规路径、标签和广告表达可审查；
6. 最小验证指标、样本、窗口和停止条件清晰；
7. 留存、复购、退款和客诉能反哺产品迭代。

## 先进营销理念

这里的“先进”不是更会夸大，而是更会把增长建立在信任和可测量证据上：

- **证据先于表达**：先说证据能支撑什么，再说产品价值。
- **人群场景驱动**：不同人群、场景和渠道使用不同利益点和证明材料。
- **全生命周期运营**：获客、首次价值、留存复购、收入利润和口碑推荐分别设计。
- **渠道匹配价值**：内容、价格、佣金、履约和售后能力匹配，不盲目铺货。
- **合规是增长底线**：广告发布前完成审查，不做疾病治疗承诺。
- **可测量、可复盘**：每个投放动作有指标、窗口、样本和停止条件。
- **信任资产优先**：公开证据、退换规则、客服路径和风险提示。

推荐增长指标包括：有效触达成本、首单转化率、30/60/90 日留存、复购率、客单价、毛利率、渠道费用率、回本周期、退款率、客诉率、推荐率和内容复访率。具体目标值必须来自真实业务预算和实验设计，不能由本模块编造。

## 报告深度：不止复述输入

简报在证据与市场信号之上，追加四类有决策价值的分析（全部纯函数推导，数字一律待填写、不臆造）：

- **产品分析**（`productAnalysis`）：一句话定位、价值主张（绑定 A/B 级证据；证据不足时明确指出表达须降级）、差异化方向（标注推断）、使用场景与明确不做什么。
- **成本结构与盈利模型**（`costStructure`）：六类列支（研发打样、原料代工、检测认证备案、包装仓储物流、渠道佣金营销、合规客服储备），每类给出待填写内容与口径；另给两条公式——单位毛利 = 零售价 − 单位完全成本，回本周期 = 固定投入 ÷ 月度毛利。
- **销售机制与渠道建议**（`salesMechanism`）：按市场信号里的渠道优先排序，给出私域社群/内容电商、平台电商、药店商超、经销代理等选项的适合条件、优劣势、合规提示与最小验证方式；整体标注 INFERENCE。
- **风险登记册**（`riskRegister`）：在原有风险列表之上，追加类别（证据/合规/市场/供应/财务/隐私伦理/声誉/运营）、可能性、影响、缓解措施、负责人与可观测触发信号；成本未填写恒记为一条财务高风险。
- **营销策略**（`marketingStrategy`）：按获客、首次价值、留存复购、收入与利润、口碑推荐五阶段给出具体动作，每条绑定指标、guardrail 与依据的营销原则。

## 开品报告格式与防截断

报告遵循 `docs/PRODUCT_DEVELOPMENT_REPORT_FORMAT.md` 定义的开品报告标准格式（`report-format.ts`）：

- 报告被组织为 12 个固定章节（`reportSections`），每章有字数预算；`validateReportSections` 可独立校验。
- 回复采用「执行摘要先行 + 分组详细展开」两层结构：执行摘要（≤400 字）可独立阅读，每章首句是该章摘要，只读首句即可掌握全文。
- 正文整体收敛在 8000 字预算内（`PRODUCT_DEVELOPMENT_REPORT_FORMAT.maxBodyChars`）；超出时在句边界截断并追加说明，避免半句截断。
- `REPORT_OUTPUT_CONTRACT` 是给生成型任务 agent 的输出契约文本，可直接拼入提示词约束输出篇幅与结构。

## Token 与成本统计

在输入里提供 `tokenUsage`（每次模型调用的模型、用途、输入/输出 token 数），报告会自动生成「Token 与成本统计」章节：

- 调用次数、总 tokens（输入/输出拆分）、分模型用量；
- 按厂商公开参考价估算美元成本（`src/modules/usage/token-usage.ts`，2026-10 核对）；未收录定价的模型不估算、不计入合计；
- 口径恒标注「公开参考价，实际以账单为准」；未提供用量时明确写「未提供」，不得估算。

```ts
const brief = buildHealthcareInnovationBrief({
  // ...其他输入
  tokenUsage: [
    { model: "gpt-4o", purpose: "创新简报生成", inputTokens: 8000, outputTokens: 4345 },
  ],
});
```

## 项目成果展示

`buildHealthcareInnovationReply` 使用现有 `kern-ui` rich blocks 输出决策、准备度、流程、策略对比、成本结构表、单位经济与回本表、渠道建议表、风险评估矩阵表、分阶段营销策略表、Token 成本指标、风险、来源、未知项、下一步和关键事实；`buildHealthcareInnovationGraph` 输出 `kern-graph/v1`，可复用现有项目图谱卡片展示已确认、推断和未知关系。

`toHealthcareInnovationArtifactBusinessInput` 可作为 `HEALTHCARE_INNOVATION_BRIEF` 结构化成果的业务字段。写入结构化成果时仍必须走服务端信封：组织、项目、来源、指纹、数据性质、记录人和确认状态由服务端推导，不能由模型或请求体自行伪造。

## 合规参考（不构成法律意见）

- 中国广告法：保健食品广告不得涉及疾病预防、治疗功能，不得声称或暗示为保障健康所必需，应显著标明“本品不能代替药物”。参见国家药监局页面收录的《中华人民共和国广告法》：<https://www.nmpa.gov.cn/directory/web/nmpa/////////xxgk/fgwj/flxzhfg/20230328161808137.html>
- 食品经营许可和备案：仅销售预包装食品实行备案，其他食品经营项目依法取得食品经营许可。参见国家市场监督管理总局《食品经营许可和备案管理办法》：<https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/fgs/art/2023/art_91a91c26ae464a2f898952d5b84f62c6.html>
- 科学证据方法：可参考 Cochrane Handbook 的系统评价、证据分级与偏倚评估方法：<https://training.cochrane.org/cochrane-handbook-systematic-reviews-interventions>
- WHO 强调健康创新应围绕真实未满足需求、用户中心和证据转化，参见 WHO Research for Health：<https://www.who.int/our-work/science-division/research-for-health>
- 美国 FTC 对健康产品广告要求“真实、不误导，并在发布前具备 competent and reliable scientific evidence”：<https://www.ftc.gov/business-guidance/resources/health-products-compliance-guidance>

具体产品上市前，必须由具备资质的法规、质量、医学和法务负责人根据产品类目、目标市场和最新法规完成正式审查。
