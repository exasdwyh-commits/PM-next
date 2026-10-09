# P1-A 后续 · 剩余三类的设计提案（需拍板）

> 结论先行：**S2 / S3 / S4 现在都不能直接做**，全部卡在三个**内容与设计决策**上。
> 下面把证据、方案与推荐摆出来，选定后再动手 —— 否则做一半返工，且会把现有的
> 数据矛盾原样搬进 pack。

## 0. 现状

`tenant-neutral-guard` 实测 **303 违规行**。类 1（13 个纯外观文件）已在
`1fd46be` 收口完毕。剩余与本提案相关的：

| 类 | 文件 | 卡在哪 |
|---|---|---|
| S2 | `role-tools-rich.tsx` | 外观可收口，但 `tools[]` 与销售话术是内容 |
| S3 | 类 2 的 4 个 | 业务字段语义不统一（见 §1） |
| S4 | 类 3 的 4 个 | 三套不同视觉语言，是否要统一属设计决策 |

## 1. 三个必须先解决的阻塞点（均已实测取证）

### 1.1 同一概念有多种措辞，pack 只能存一种

「普通食品的合规要求」在四处有**三种不同写法**：

| 出处 | 措辞 |
|---|---|
| `src/components/cost-calculator-modular.tsx:38` | `SC认证 + 标签审核` |
| `src/components/marketing-landing-rich.tsx:8` | `SC资质+标签合规` |
| `src/modules/assistant-runtime/capabilities/marketing-landing.ts:30` | `SC资质+标签合规` |
| `src/components/product-rnd-cockpit-rich.tsx:11` | `SC合规` |

**这是内容决策不是技术决策**：下沉时选哪个？其余的删掉还是保留为「简版/详版」两个字段？

### 1.2 `cost` 是两个不同性质的东西，不能塞进同一个字段

| 出处 | 值 | 性质 |
|---|---|---|
| `marketing-landing-rich` | `"10.2"` | 一个**数值**，用于展示成本占比 |
| `product-rnd-cockpit-rich` | `"原料0.98+加工1.2+包装1.1+物流4.1+渠道35% 零售39.9"` | 一段**成本构成明细**字符串 |

两者同时存在于同一个业务概念「成本」下但用途完全不同。
若在 pack 里合并成一个 `cost` 字段，必然有一处显示错。

### 1.3 同一份数据被复制在两处

`marketing-landing-rich.tsx` 与 `assistant-runtime/capabilities/marketing-landing.ts`
**逐字相同**地各存了一份 `selling` / `cost` / `price` / `compliance`。

→ 这其实是**好消息**：下沉到 pack 后两处都能读，收益翻倍；
且 `540e24f`（Capability Registry）这条新线方向上，能力模块本就不该自带业务常量。

## 2. 方案选项

### 2.1 pack 结构：三种取向

| 方案 | 形状 | 优点 | 代价 |
|---|---|---|---|
| **A · 单文件 `category-content.json`** | `{ [key]: { selling, price, costSummary, costBreakdown, complianceShort, complianceDetail, formula, tools } }` | 一次看清某个品类的全部内容；新增字段最直观 | 需要先解决 §1.1 / §1.2 的语义统一 |
| **B · 拆分到既有语义文件** | `selling`/`price` 进 `domain/categories.json`；`compliance` 进 `domain/regulatory.json`；`tools` 进 `domain/toolbox.json` | 语义分域，与现有 pack 结构一致 | 同一品类的信息散在多个文件，改 pack 时容易漏 |
| **C · 只下沉明确无争议的字段** | 先只放 `selling` 与 `tools`，其余留在 src/ | 立刻可做，不阻塞 | 收益有限，行业词没清干净 |

**我的推荐：A**。理由：`selling` / `compliance` / `tools` 都是「按品类的营销与合规内容」，
天然属于同一维度；B 的分散结构会让「换租户要改几个文件」变得难以回答，
这正是 `KERN_TENANT_PACK_PLAN.md` §1 想解决的问题。

### 2.2 类 3 的三套渐变：统一还是保留

实测三套并存：

| 场景 | `regular_food` 的 gradient |
|---|---|
| UI 组件（13 个已迁） | `#fffbeb → #fef3c7`（浅色底） |
| 图表 `custom-chart` | `#f59e0b → #d97706`（同色系深浅） |
| 报告 `html-report` ×2 | `#f3f0ff → #e9d5ff`（另一套浅色，三项色值都不同） |

- **统一**：改 4 个文件的观感，可能不是设计本意；
- **保留**：给 `categoryMeta()` 加可选预设参数，如
  `categoryMeta(key, fallback, { tint: "deep" })`，各场景显式声明用哪套；
- **第三种**：确认那 4 个文件其实该跟随 UI（= 视觉本就该一致，属历史漂移）。

**需要你判断**：这三套是有意的视觉分层，还是历史漂移？
若是前者 → 选「保留 + 预设参数」；若是后者 → 选「统一」。

## 3. 选定后我会做什么

1. 按选定方案扩 `packs/health-food/domain/`（并同步 `src/modules/tenant/types.ts` 的类型）
2. 迁移 S2 + S3 的 5 个文件，读 pack 取业务字段，外观走 `categoryMeta()`
3. 类 3 按 §2.2 结论处理
4. 每一步跑 `tsc --noEmit` + `source-guards` + `tenant-pack`，
   其中 `tenant-pack` 的「与抽离前写死值一致」用例是**行为零变化的硬证据**
5. 更新本清单与 §0 基线数字

## 4. 需要你回答的两个问题

1. **§1.1 的措辞**：合规说明保留「简版 + 详版」两档，还是统一成一种？统一的话选哪种措辞？
2. **§2.2 的渐变**：三套是有意的视觉分层，还是历史漂移？

其余（§2.1 选 A、§1.2 拆成 `costSummary` + `costBreakdown`）我按推荐执行，
除非你另有指示。