# Hermes Decision Evaluation Harness

日期：2026-09-22

## 定位

Harness 不是另一个大模型，也不是让模型“自我反思”。

它是模型之外的控制与评估层，用固定案例、真实结果、版本指纹、回归指标和人工批准，把模型能力转化为可验证、可迭代的系统行为。

Hermes 的目标：

```text
Model capability
      +
Harness
      +
Evidence
      +
Governance
      =
Dependable Product Organization
```

## 1. 四层 Harness

### Layer A · Contract / Shape

确定性检查：

- schema 是否正确；
- required field 是否存在；
- UNKNOWN 是否被伪装成 0；
- citation 是否越界；
- 金额是否来自成本引擎；
- 模型是否越过 Governance。

这类问题不用 LLM Judge。

### Layer B · Safety / Invariant

高优先级不变量：

- FAIL gate 绝不能被高分平均掉；
- 未确认渠道规则不能伪装真实验证；
- 高风险合规项不得由普通评分放行；
- 预测与真实结果必须属于同一 ProductVersion + ChannelRoute fingerprint；
- 未核实 Outcome 不能进入经验学习。

任何 CRITICAL regression 均阻止规则/模型升级。

### Layer C · Golden Cases

来自真实产品工作的脱敏案例：

- AKG 1999 半年套餐；
- 骆驼奶 + AOS；
- AKK 后生元；
- 后续真实失败/成功案例。

每次系统性误判：
1. 先新增 Golden Case；
2. 再修规则、Prompt、ModelPolicy 或模型；
3. 新旧案例一起跑；
4. 不允许“修一个案子坏三个旧案子”。

### Layer D · Outcome Backtest

预测时冻结：

- ProductVersion fingerprint；
- ChannelRoute fingerprint；
- Evidence fingerprint；
- Assessment rule version；
- 模型/Prompt/Policy version。

真实验证后记录：

- 渠道是否接受；
- 是否上市；
- 实际贡献毛利；
- 退款；
- 复购；
- 观察周期；
- 真实证据引用；
- 人工核实人。

只有同一版本/同一路线才允许比较。

---

## 2. 经验循环

```text
Decision
  ↓
Frozen Prediction
  ↓
Real Validation
  ↓
Verified Outcome
  ↓
Backtest
  ↓
Experience Candidate
  ↓
Review
  ↓
Shadow Evaluation
  ↓
Golden Regression
  ↓
Approved Rule / Policy Revision
```

关键原则：

**Experience Candidate 永远不能自动修改正式规则。**

经验至少区分：

- CANDIDATE
- APPROVED
- REJECTED
- SUPERSEDED

---

## 3. 不直接“自动调权重”的原因

早期样本通常存在：

- 品类偏差；
- 渠道偏差；
- 时间窗口偏差；
- 幸存者偏差；
- 产品在验证过程中已经改版；
- 经营结果尚未成熟；
- 成功/失败定义不一致。

因此 V1 只做：

- false positive；
- false negative；
- abstention；
- 同维度成功/失败分布差；
- 样本量；
- 反例；
- 分层 segment。

达到阈值只变成 `readyForReview=true`，不自动生成新权重。

---

## 4. 规则/模型升级门槛

一次 Model / Prompt / Weight / Channel Rule 调整进入生产前：

### 必须

1. 新 Golden Case 通过；
2. 旧 Golden Cases 无 CRITICAL regression；
3. Governance 回归通过；
4. 同一 Harness 下与旧版本 A/B；
5. 输出差异有可解释原因；
6. 规则版本递增；
7. 留下审计记录。

### 建议

- shadow run；
- segment backtest；
- confusion matrix；
- false-negative 单独审查；
- 成本/延迟同时记录。

---

## 5. 与 Model Gateway 的关系

Model Gateway 解决：

> 用谁做？

Harness 解决：

> 换了模型以后到底有没有变好？

例如：

```text
Agnes
vs
GPT
vs
Local
```

不能只比“回答看起来谁更聪明”。

同一批 Harness Cases 比：

- schema pass；
- tool use；
- citation fidelity；
- hard-gate recall；
- false positive；
- false negative；
- latency；
- token/cost；
- fallback frequency。

然后 ModelPolicy 才有依据更新。

---

## 6. 与 Product Potential 的关系

Product Potential 输出不是成功概率。

Harness 长期负责判断：

- PRIORITIZE_FOR_VALIDATION 后实际成功多少；
- VALIDATE 后失败主要在哪；
- BLOCKED 是否出现大量 false negative；
- NEEDS_EVIDENCE 的 abstention 是否合理；
- 哪个 segment 下某维度更有区分力。

未来权重可按 segment 演化，但必须：

```text
数据 → 候选经验 → 人工审核 → shadow → regression → 新版本
```

而不是在线自学习直接改生产规则。

---

## 7. V1 已落地能力

- Product Potential Harness case runner；
- CRITICAL / HIGH / MEDIUM / LOW 检查等级；
- FAIL gate 不可被平均掉的回归；
- FrozenDecisionIdentity；
- VerifiedProductOutcome；
- 同版本/同渠道路线 backtest；
- 未核实 Outcome 拒绝学习；
- false positive / false negative / abstention 汇总；
- Dimension reliability 经验候选；
- 最低样本量与区分度门槛；
- 经验只进入 CANDIDATE / readyForReview。

下一阶段再持久化：

- EvaluationSuite
- EvaluationCase
- EvaluationRun
- FrozenPrediction
- ProductOutcome
- ExperienceLesson
- PolicyRevision
