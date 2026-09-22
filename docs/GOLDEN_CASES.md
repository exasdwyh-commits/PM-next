# HERMES Golden Cases

日期：2026-09-22

## 目的

Golden Cases 不是展示样例，而是 HERMES 的业务回归基线。它们来自实际产品研发中反复出现的需求模式，并经过脱敏/抽象化，用来回答一个问题：

> 系统升级后，是否仍然能正确理解真实业务约束、识别证据缺口，并阻止高风险结论被当成已验证事实？

## V1 覆盖

### G01 · 高客单抗衰套餐

验证：

- 35 岁以上年龄约束；
- 私域/会销渠道；
- 1999 元半年套餐；
- 甲基化年龄/减龄诉求；
- 高客单 + 强功效宣称必须触发高风险科学审查；
- 命中营销禁语时不得继续按普通产品方案放行。

### G02 · 骆驼奶 + AOS 多档套餐

验证：

- 中老年人群；
- 299 元/12 盒、499 元/24 盒多档套餐结构化；
- 总成本上限；
- 私域/会销渠道；
- 明确禁止成分；
- 没有匹配科学证据时必须如实标记证据缺口并暂停，而不是补造证据。

### G03 · AKK 后生元直播产品

验证：

- 直播/快手渠道；
- 200–300 元价格带；
- “禁止宣称减肥”必须留在 forbidden，不得反向污染为 requested claim；
- 禁止活菌/益生菌约束；
- 若后续文案重新出现“减肥”类宣称，Challenge 必须识别营销红线。

## 运行

```bash
npm run test:golden
```

该套件为纯业务规则测试，不依赖数据库、外部模型或网络，因此会进入 Quality CI。

## 后续扩展原则

每次真实项目暴露一个系统性误判，应优先新增/更新 Golden Case，再修实现。不要只修某个页面或某一句提示词而不留下回归证据。

后续计划逐步增加：

- 证据冲突与版本更新；
- 成本/渠道佣金情景；
- Proposal → Revision → Decision Gate 的端到端黄金路径；
- 真实 LLM 输出的结构契约与反例集；
- 多组织与多角色下的同一业务案例。


## V2 · ResearchRun 冻结需求快照

新增研究编排一致性门槛：

- ResearchRun 启动时把本轮研究问题、Project 目标/约束、Product 定义和 ProductVersion 关键字段合并为 `requirement-context/v2`；
- 完整需求上下文写入 `scopeSnapshotJson`，与 `inputRevision` 一起冻结；
- 后续市场研究优先读取冻结上下文，不再直接依赖执行时的 live Product / Project 字段；
- 旧 ResearchRun 没有 v2 快照时才走兼容回退。

数据库回归会在 ResearchRun 启动后故意把 1999 元改成 99 元、35 岁改成 18 岁、私域改成快手直播；当前研究结果仍必须保持启动时输入，证明不存在“半路换题”。

运行：

```bash
npm run test:research-snapshot
```


## V3 · 组织级开品闭环 Golden Case

V3 不再只验证纯函数，而是用真实数据库与服务层跑一条完整产品组织链路。

当前首个案例：**AKG 钙高客单半年套餐**。

覆盖：

```text
高价值 Signal
  → Hermes PM
  → Product + ProductVersion
  → Red Team
  → Channel Spec Economics
  → Product Potential
  → Scientific / Compliance Hard Gate
  → FrozenPrediction
  → VERIFIED Evidence
  → Hermes PM Re-evaluation
  → Specialist Delegation
  → Result Summary
  → Parent Review
  → Harness waits for real Outcome
```

关键验收点：

- Signal 可以唤醒 PM，但 UNVERIFIED signal 不能被自动升级成 verified evidence；
- 产品入库必须原子创建 Product / ProductVersion / Project；
- 新不可变 ProductVersion 必须触发 Red Team；
- 渠道经济性即使成立，也不能平均掉科学/合规硬门；
- 高诊断指数不等于成功概率；
- 强功效宣称命中硬门时 verdict 必须 BLOCKED；
- 修正高风险宣称后，缺少成品验证只能从 FAIL 改进到 UNKNOWN / NEEDS_EVIDENCE，不能直接 PASS；
- REAL Evidence 正式 VERIFIED 后自动唤醒 Hermes PM 复核，但不自动批准产品；
- 专业 Agent 完成委派必须返回 resultSummary，父 Agent 可审计复核；
- 没有真实 ProductOutcome 时，Harness 不得生成“成功/失败学习标签”。

运行：

```bash
npm run test:golden-org
```

该测试使用隔离 PostgreSQL，进入 Golden Organization CI。

后续新增真实开品案例时，优先按“**一个案例 = 一条完整组织行为链**”扩展，而不是重复堆函数断言：

- G-ORG-02 · 骆驼奶 + AOS：多档规格 / 渠道经济性 / 证据不足；
- G-ORG-03 · AKK 后生元：直播渠道 / 营销红线 / Claim 修正；
- G-ORG-04 · HMB 老年营养：人群适配 / 体感目标 / 复购验证；
- G-ORG-05 · 真实失败复盘：FrozenPrediction → D30/D90 Outcome → ExperienceLesson。
