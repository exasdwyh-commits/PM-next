# Product Potential & Channel Fit V2

日期：2026-09-22

## 1. 为什么不把“加权总分”当开品结论

PM-next 现有 Scorecard 的六维加权分继续保留，但定位限定为“准备度/改进方向”。

单一加权总分存在四个系统性问题：

1. **可补偿性错误**：需求 95 分可能把“渠道经济性不成立”平均掉；
2. **证据质量不对称**：真实销量与模型假设不能只因为都得到 80 分就视为等价；
3. **渠道条件依赖**：同一配方在直播、私域、OEM 下合理规格和利润结构可能完全不同；
4. **假精确**：82 分不等于 82% 成功率，也不能替代真实市场验证。

因此 V2 采用：

```text
Hard Gates
  ↓
Channel Spec Fit
  ↓
Potential Assessment
  ↓
Low-cost Validation
  ↓
Evidence Update
  ↓
Re-assessment
```

评分只负责诊断，不负责越过门槛。

---

## 2. 三层判断

### 2.1 Hard Gates

以下类型不得被其它高分抵消：

- 合规/科学高风险未闭合；
- 渠道规格经济性不成立；
- 目标渠道规则未知且该规则决定价格/佣金/组合装；
- 关键交付能力被确认不可行；
- 关键产品定义与已确认公司/渠道红线冲突；
- 证据漂移导致原结论失效。

结果只有：PASS / FAIL / UNKNOWN。

FAIL → BLOCKED。
UNKNOWN → NEEDS_EVIDENCE。

### 2.2 Channel Spec Fit

产品 Agent 可以提出多套候选：

- 单盒/多盒组合；
- 零售价；
- 每盒/每条/每瓶规格；
- 包装成本；
- 订单运费；
- 产品单元成本。

确定性引擎负责：

- 渠道费率；
- 退货影响；
- 履约成本；
- 目标贡献毛利；
- 价格带；
- 组合数量上下限；
- 售卖单位约束；
- 反推可承受最大产品成本。

模型不得自己算“最终利润”。

渠道规则必须版本化，并区分：

- CONFIRMED：有真实渠道资料/负责人确认；
- ASSUMED：系统预设或业务假设。

ASSUMED 可以做方案推演，不能冒充渠道验证。

### 2.3 Product Potential Assessment

V2 建议观察七个维度：

- DEMAND：真实需求强度；
- CHANNEL_FIT：渠道适配；
- UNIT_ECONOMICS：单位经济性；
- DIFFERENTIATION：有证据的差异化；
- REPEAT_PURCHASE：复购/持续消费逻辑；
- DELIVERY_FEASIBILITY：供应交付可行性；
- COMPANY_FIT：公司资源与战略适配。

每个维度除 score 外必须记录 evidenceState：

- VERIFIED
- SUPPORTED
- ASSUMED
- UNKNOWN

输出 verdict：

- BLOCKED
- NEEDS_EVIDENCE
- DEPRIORITIZE
- VALIDATE
- PRIORITIZE_FOR_VALIDATION

不存在“AI 判定可上市”。真正上市继续走 Governance / Launch Authorization。

---

## 3. 与竞争团队“加权评分”的区别

我们不否定评分；评分适合：

- 同类方案横向比较；
- 找薄弱项；
- 形成排序视图；
- 看版本优化是否改善。

但最终开品判断使用：

```text
Evidence Quality
    +
Hard Gates
    +
Channel-specific Spec Economics
    +
Scenario Potential
    +
Real Validation
    +
Governance
```

核心差异是：**不能让数学平均掩盖致命条件，也不能让模型评分替代真实市场验证。**

---

## 4. 已落地：渠道路线持久化 V1

纯函数 Golden Cases 之后，以下对象已进入正式数据模型与产品详情“渠道路线”工作台：

### ChannelRuleProfileRecord

- organizationId
- channelKey
- version
- status: ASSUMED / CONFIRMED / SUPERSEDED
- effectiveFrom / effectiveUntil
- sourceRefs
- price band
- commission/platform/marketing/return rules
- bundle constraints
- target contribution margin
- packaging/fulfillment constraints

### ChannelSpecRoute

同一个 ProductVersion 可以有多个渠道路线：

- channelRuleProfileId
- retailPrice
- bundleQuantity
- unitLabel
- packageSpec
- cost assumptions
- evaluation snapshot
- status

不要把“一个产品 = 一个全球规格”写死。

### PotentialAssessmentRecord

- productVersionId
- channelRouteId?
- ruleVersion
- dimensionSnapshot
- gateSnapshot
- evidenceFingerprint
- diagnosticIndex
- coverageRatio
- verdict
- createdAt

历史评估不可覆盖，新评估通过 supersedes 链关联。

### V1 已实现的业务保护

- 渠道规则是组织级资产，只有组织管理员可创建版本；
- CONFIRMED 规则必须至少有一条来源引用；
- 新 ASSUMED 草案只替代旧草案，不会提前作废仍有效的 CONFIRMED 规则；
- 新 CONFIRMED 版本发布后才替代同渠道上一版确认规则，并使旧规则路线进入“需重评”状态；
- 数据库用 partial unique index 兜底并发写入：同组织+同渠道最多一条当前 CONFIRMED、最多一条当前 ASSUMED；
- effectiveFrom / effectiveUntil 不在当前生效窗口时，规则不能把路线推进到验证就绪；
- 产品路线由 OWNER / DECISION_MAKER 保存，每次重算形成新的 revision；
- 路线保存确定性 evaluationSnapshot，模型不负责计算利润；
- 路线经济性失败自动成为 CHANNEL_ROUTE_ECONOMICS = FAIL；
- ASSUMED、已被替代、尚未生效或已过期的渠道规则自动让 CHANNEL_RULE_CONFIDENCE 保持 UNKNOWN；
- 维度标记 VERIFIED 时，至少一个 sourceRef 必须对应当前产品已核实的 REAL Evidence，不能由 Agent 自报“已验证”；
- marketValidationVerified 不接受前端或 Agent 自报，只从 REAL + VERIFIED + VERIFIED_BY_LEAD Evidence 推导；
- 绑定渠道路线时，真实市场验证必须与该路线的 channelKey / label 匹配，不能拿私域证据去确认快手路线；
- 路线生命周期受控：VALIDATION_READY → VALIDATING → CONFIRMED，确认前必须存在同渠道真实验证；也可保留原因进入 REJECTED；
- PotentialAssessmentRecord 保存 evidenceFingerprint，便于后续判断证据变化后旧结论是否需要重跑。

---

## 5. Golden Case 演进

现有 AKG / 骆驼奶+AOS / AKK 案例继续扩展：

### AKG 1999 半年套餐

不仅验证科学风险，还验证：

- 1999 是否适配目标渠道；
- 佣金/检测成本/履约成本后的贡献空间；
- 半年 186 条规格是否造成包装、体验、退货问题；
- 若渠道规则未知，不得只凭高客单和故事性给高潜力结论。

### 骆驼奶+AOS

比较：

- 299 / 12 盒
- 499 / 24 盒
- 不同供货成本

输出不是“哪个分更高”，而是：

- 哪个渠道路线经济上成立；
- 可承受最大单盒成本；
- 哪些参数仍是待确认假设。

### AKK 后生元

即使需求/差异化高，只要营销红线未闭合，Hard Gate 直接失败。

---

## 6. 与 Model Gateway 的关系

模型层负责：

- 提取渠道需求；
- 生成候选规格路线；
- 解释潜力评估；
- 找反证；
- 给低成本验证建议。

确定性领域层负责：

- 渠道费率计算；
- 成本/贡献计算；
- Hard Gate；
- 证据状态；
- 版本/审计；
- Governance。

模型换成 GPT、Agnes、Qwen 或本地模型，不改变上述业务契约。
