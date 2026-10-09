# P1-A · 品类元数据迁移清单

> 用途：把 V2 复制到 20+ 个 `*-rich` 组件里的 `CATEGORY_INFO` 字面量，
> 收口到 `src/modules/tenant/category-meta.ts` 的 `categoryMeta()`。
> 本清单是 **2026-10-09 实测盘点**的结论，不是推测。
>
> 判定方法：逐文件比对每个分类键的 `icon` / `color` / `gradient` 实际色值
> 与 `category-meta.ts` 里 `PRESENTATION` 的对应值（CSS 渲染等价按色值判，
> `linear-gradient(135deg,#a,#b)` 与 `linear-gradient(135deg, #a 0%, #b 100%)` 视为相同）。

## 0. 一句话结论

**24 个文件内嵌 `CATEGORY_INFO`，但只有 13 个能行为零变化直接迁移。**
原计划「20 个组件机械替换、风险低」**不成立**——其中 1 个装着监管知识（机械替换会功能损坏），
4 个含业务字段，4 个渐变色与收口模块不一致（迁移会改视觉）。

### 进度与真实基线（2026-10-09 实测）

| 阶段 | 违规行数 | 说明 |
|---|---|---|
| S1 前 | 289 | ⚠️ **这是低估** —— 守卫词表当时漏了 `classifications` |
| 词表修复后（未做 S1） | **342** | 补上分类名后显出 53 处此前不可见 |
| S1 后 | **303** | S1 净减 39 行 |
| **S2/S3/S4 后（当前）** | **270** | 再净减 33 行；累计 342 → 270 |

**基线被修正这件事必须说清**：此前所有基于「289 处」的判断都建立在坏词表上。
`categories.classifications` 里的中文品类名此前**完全不在守卫词表内**——
实测 `src/` 下有 **81 处「化妆品」从未被捕获**（分布在 40 个文件）。
守卫已修（见 §5），此后的数字才可信。

## 1. 五类判定

### 类 1 · 纯外观且色值完全一致 —— **13 个，可直接迁移（零风险）**

| 文件 | 使用点 |
|---|---|
| `src/app/muse/components/mission-conclusion-rich.tsx` | color×7 gradient×2 icon×3 name×8 |
| `src/components/billing-dashboard-rich.tsx` | color×8 gradient×1 icon×2 name×3 |
| `src/components/challenge-report-card-rich.tsx` | color×7 gradient×3 icon×4 name×9 |
| `src/components/cockpit-rich.tsx` | color×14 gradient×3 icon×6 name×7 |
| `src/components/collaboration-planner-rich.tsx` | color×6 icon×4 name×6 |
| `src/components/cost-calculator-performance.tsx` | icon×4 name×3 color×4 |
| `src/components/cost-collaboration-rich.tsx` | color×11 icon×3 name×11 |
| `src/components/dependency-graph-rich.tsx` | color×19 gradient×1 icon×3 name×6 |
| `src/components/feedback-memory-rich.tsx` | color×12 gradient×1 icon×2 name×5 |
| `src/components/glass-card.tsx` | shadow×1 gradient×1（字段集与 `categoryMeta()` 完全一致） |
| `src/components/product-rnd-panel-rich.tsx` | color×6 icon×4 name×6 |
| `src/components/project-tracking-rich.tsx` | color×13 gradient×1 icon×3 name×6 |
| `src/components/research-report-rich.tsx` | color×17 gradient×2 icon×3 name×5 |

改法：删本地 `CATEGORY_INFO`，改 `import { categoryMeta } from "@/modules/tenant"`,
把 `CATEGORY_INFO[x]` 换成 `categoryMeta(x)`。

### 类 2 · 外观一致，但混入了业务文案 —— **4 个，必须拆分**

`categoryMeta()` 只覆盖外观。业务字段**不要塞进 `category-meta.ts`**（那是表现层模块），
应另行下沉到 pack。

| 文件 | 混入的非外观字段 |
|---|---|
| `src/app/projects/[id]/components/overview-role-based-rich.tsx` | `selling`（卖点文案） |
| `src/components/daily-briefing-rich.tsx` | `selling` |
| `src/components/marketing-landing-rich.tsx` | `selling` / `price` / `cost` / `compliance` |
| `src/components/product-rnd-cockpit-rich.tsx` | `selling` / `formula` / `cost` / `compliance` |

改法：拆成两个对象——`categoryMeta(x)` 管外观，
`selling/price/cost/compliance/formula` 走 pack 新增的 `categories.<id>.copy`（或按语义拆到
`domain/` 下对应文件）。**这一步不在 P1-A 范围内**，建议另开工单。

### 类 3 · 渐变色与收口模块不一致 —— **4 个，迁移会改视觉，需决策**

| 文件 | 差异 |
|---|---|
| `src/components/custom-chart.tsx` | **4 个分类全不同**：用的是同色系深浅渐变，如 `regular_food` `#f59e0b→#d97706`；收口模块是浅色底 `#fffbeb→#fef3c7` |
| `src/components/executive-report-rich.tsx` | health_food `#f3f0ff/#e9d5ff`、cross_border `#ecfeff/#a5f3fc`、cosmetics `#fdf2f8/#fbcfe8` 三项不同 |
| `src/modules/cost-engine/html-report-rich.ts` | 同上三项 |
| `src/modules/cost-engine/html-report.ts` | 同上三项 |

**这是设计问题，不是笔误**：图表用深色系渐变、报告用另一套浅色，和 UI 组件的浅色底渐变
本就是三套不同的视觉语言。**收口到一个 `categoryMeta()` 会强行统一它们。**

建议：给 `categoryMeta()` 增加**可选的预设参数**（如 `categoryMeta(key, fallback, { tint: "deep" })`），
而不是二选一硬替换。具体方案需产品/设计确认。

### 类 4 · 命名陷阱 —— **1 个，机械替换会功能损坏**

`src/components/cost-calculator-modular.tsx` 的 `CATEGORY_INFO` **不是外观元数据**，
装的是**监管要求与成本知识**：

```ts
regular_food: { compliance: "SC认证 + 标签审核", notes: "普通食品，成本较低，重点在原料和包装" },
health_food:  { compliance: "蓝帽子备案/注册 + 功能声称 + 多项检测",
                notes: "保健食品，原料贵、检测多、备案费高(5-20万)，需摊销" },
```

若按类 1 的规则替换，**合规提示会变成颜色值**（`compliance: "#f59e0b"`），功能直接损坏。

正确处理：这份内容属于**行业监管知识**，应下沉到 `packs/health-food/domain/regulatory.json`
（该文件已存在），本轮**不动**。

> 教训：变量名叫 `CATEGORY_INFO` **不代表它是外观元数据**。批量迁移前必须逐个看内容。

### 类 5 · 结构不同 —— **1 个，需手工拆分**

`src/components/role-tools-rich.tsx`：

```ts
const CATEGORY_INFO: Record<string, { icon; name; color;
  tools: { id; label; icon; desc }[] }> = { ... }
```

- `icon` / `name` / `color` → 可走 `categoryMeta()`
- `tools[]`（每个分类推荐哪些工具，含「SC合规成本 39.9元竞品」这类文案）→ 另一套下沉

## 2. 执行顺序与进度

| 阶段 | 范围 | 状态 | 效果 |
|---|---|---|---|
| **S1** | 类 1 的 13 个 | ✅ 完成 | 违规 342 → **303**（净减 39 行） |
| **S2** | 类 5 的 1 个（`role-tools-rich`） | ✅ 完成 | 303 → — |
| **S3** | 类 2 的 4 个（业务字段下沉 pack） | ✅ 完成 | — → **282** |
| **S4** | 类 3 的 4 个（改用 tint 预设） | ✅ 完成 | 282 → **270** |
| — | 类 4 的 1 个（`cost-calculator-modular`） | 不动 | 改为下沉 `regulatory.json` |

**累计：342 → 270 行**（S2/S3/S4 提交净减 70 行，+91/−161）。

设计决策已由用户拍板（详见 `docs/P1A-后续设计提案.md`）：
合规措辞**保留多档**不统一；渐变三套**并存**（有意视觉分层），
故新增 `packs/health-food/domain/category-content.json` 与
`categoryMeta(key, fallback, { tint })`。

### S1 已完成，做法与两处必须留意的细节

迁移脚本以「删除本地 `CATEGORY_INFO` 定义 → 用 `categoryMeta()` 替换使用点 →
在 import 区插入 `import { categoryMeta } from "@/modules/tenant"`」三步走，
并内置**残留守卫**（替换后若仍有 `CATEGORY_INFO` 字样则拒绝写入）。
dry-run 13/13 就绪后才实际写入。

两处不看代码就一定会做错的地方：

1. **`product-rnd-panel-rich.tsx` 的 fallback 是 `regular_food`**，而 `categoryMeta()`
   的默认 fallback 是 `health_food`。必须写成 `categoryMeta(category, "regular_food")`，
   否则该文件的兜底品类会从「普通食品」变成「保健食品」——**行为变了但测试不会报**。
2. **`dependency-graph-rich.tsx` 在类型层引用了它**：
   `category?: keyof typeof CATEGORY_INFO | string`。删定义会编译失败。
   已改为 `CategoryKey | string`——因为 `CATEGORY_INFO` 是 `Record<string, T>`，
   `keyof typeof` 它本就等于 `string`，两者**类型上完全等价**，不是行为变更。
   import 相应变为 `import { categoryMeta, type CategoryKey } from "@/modules/tenant";`

## 3. 前置条件（已全部满足）

`categoryMeta()` 的三处接线已补齐，`tsc --noEmit` **exit 0**（commit `4c66b34`）：

| # | 文件 | 内容 | 状态 |
|---|---|---|---|
| 1 | `src/modules/tenant/types.ts` | `categories.classifications` 字段 | ✅ |
| 2 | `packs/health-food/domain/categories.json` | `classifications` 数据 | ✅ |
| 3 | `src/modules/tenant/index.ts` | `export { categoryMeta, ... } from "./category-meta"` | ✅ |

⚠️ **接线 #2 必须同步补数据，不能只补类型**：`categoryName()` 的兜底是
`classifications[resolved] ?? resolved` —— pack 里没有该键时，
UI 会从显示「保健食品」变成显示英文键名 `health_food`，**那是功能回退**。
本次 `classifications` 取值就是原 `CATEGORY_INFO` 的 `name`
（`普通食品` / `保健食品` / `跨境食品` / `化妆品`），故为**行为零变化**——
`tenant-pack` 用例「health-food 与抽离前写死值一致」在 S1 之后仍然通过。

## 4. 与「全清全部违规」的关系

本清单只覆盖 `CATEGORY_INFO` 这条线（24 文件）。`tenant-neutral-guard` 当前实测
**303 处违规行**的其余部分分三类，**不在 P1-A 范围**：

- `cost-engine` 的品类模板 / 合规清单（业务数据，需真下沉 pack）
- `kern-prompts` 的提示词内容（**定性存疑**，见 `KERN_TENANT_PACK_PLAN.md` §4 P3-6：
  `SOUL.md` 尚未注入运行时，提示词下沉机制不存在，硬清会降低效果）
- demo 页面的示例数据（或许可豁免，但需**显式登记豁免清单**而非默认不扫）

> 计划书已写明：中立守卫是**词表黑名单**，只能证明「已知行业词不在 `src/`」，
> **不能证明内核真中立——真正的证明是 P3 的第二个 pack 能跑通。**
> 因此不要为刷绿守卫去做纯词表清理。

## 5. 守卫自身的修复（本次一并做）

`tests/tenant-neutral-guard.test.ts` 的扫描词表原先**只取**
`lexicon.{forms,claims,ingredients}` + `company.industry` + `defaults.categoryName`，
**没有取 `categories.classifications`**。后果：

- 四个分类显示名（`普通食品`/`保健食品`/`跨境食品`/`化妆品`）**全部不在词表内**；
- 其中只有 **`化妆品`** 未被 `EXTRA` 与 lexicon 覆盖，属**完全不可见**——
  实测 `src/` 下 **81 处「化妆品」从未被捕获**，分布在 40 个文件
  （`cost-engine/registry.ts` 10 处、`kern-orchestrator-prompt.ts` 7 处、`compliance-checklist.ts` 6 处……）。

已把 `classifications` 并入词表。这不是「为了让守卫更严」，而是**修一个测量错误**：
修之前所有基于违规数的判断都建立在漏报的基线上。

### 写这段时踩到的坑（已记入代码注释）

`Object.values(...)` **必须用 `...` 展开**。写成数组字面量里的一个元素会得到
`(string | string[])[]`，运行时把**整个数组对象**塞进 `Set`——词表「看起来补了，实则没补」。
tsc 会报 `TS2345` 抓到它（若漏掉 typecheck，则会安静地一直漏报）。
正确写法：

```ts
[...p.lexicon.forms, ...,
 ...Object.values(p.categories.classifications ?? {})].forEach((w) => w && set.add(w));
```

### 守卫的计数语义（影响后续降幅预期）

命中判定是 `W.find((x) => l.includes(x))` —— **每行只记第一个命中的词**。
所以：

- 同一行有多个行业词，违规数也只 +1，报告里只会显示其中一个；
- 逐行修复会出现「删掉一个词、该行仍因另一个词红」的阶梯下降，**降幅比直觉慢**；
- 评估进度应看**违规行数**，不要按词数估算。
