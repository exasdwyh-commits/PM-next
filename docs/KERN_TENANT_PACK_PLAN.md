# Kern 租户配置包（Tenant Pack）计划与验收

创建：2026-09-27 · 分支 `feat/tenant-pack`（领先 `main` 两个提交，尚未提 PR）

> 本文补齐此前的文档缺口：`feat/tenant-pack` 的两个提交不在 `docs/KERN_NEXT_PHASE_PLAN.md`
> 的任何阶段里，也没有验收标准。本文只描述该工作项，进度以
> `docs/KERN_WORKING_MEMORY.md` 为准。

## 1. 目标

把 Kern 内核里写死的**健康食品行业设定**（品类毛利、剂型/宣称/成分词表、法规清单、
公司描述、表单占位符）全部移出 `src/`，集中到 `packs/<id>/`，使内核保持行业中立：
换一家公司 = 换一个 pack，不改内核代码。

`health-food` 是**标准参考模版**，原样保存最初的全部设定；新公司复制该目录再改写。

## 2. 现状（2026-09-27 实测）

| 提交 | 内容 | 规模 |
|---|---|---|
| `290cd7d` | P1：抽离为参考租户包，**行为零变化** | 16 文件 +230/−35 |
| `ea80432` | P2：剩余行业规则/占位符入包 + 行业中立守卫 | 13 文件 +119/−25 |

包结构（`packs/health-food/`）：

| 文件 | 作用 |
|---|---|
| `tenant.json` | 公司名、行业、locale、默认品类、产品描述、全部 UI 占位符 |
| `domain/categories.json` | 品类 → 目标利润率 |
| `domain/lexicon.json` | 剂型 11 / 功效宣称 16 / 成分 7 / 市场默认剂型 |
| `domain/claims.json` | 宣称风险正则（健康/强宣称/生物标志物）+ 提示文案 |
| `domain/regulatory.json` | 法规核查清单项 |
| `SOUL.md` | 公司身份层（**当前仅模版，未注入运行时 prompt**） |

加载机制（`src/modules/tenant/`）：`registry.ts` 静态 import 各 pack 的 JSON →
`index.ts` 暴露 `resolveTenantPackId()` / `getTenantPack(id)` / `listTenantPacks()`，
未知 id 抛错。改造后由 pack 供数的模块共 11 个：`cost-engine/presets`、
`research/{requirement-parser,research-run,market-research,scientific-evidence}`、
`product-development/revision`、`advisor/challenge`、`worker/executor`、
`app/layout`、`products-client`、`project-detail-client`。

实测结果（在 `feat/tenant-pack` 上运行）：

- `npm run test:tenant` → **5/5 通过**（已接入 `test:delivery-contracts` 链）
- `npx tsc --noEmit` → **0 错误**
- `npx eslint src/ tests/` → **0 问题**
- 行业中立守卫扫描 `src/` 全部 `.ts/.tsx`（排除 `*.test.ts`）→ **0 命中**

## 3. 关键设计决定及其代价

**用静态 import 而非运行时读文件。** 理由（见 `registry.ts` 注释）：客户端组件也要拿到
占位符配置，且打包时即可由 TS 结构化校验 JSON。**代价必须写明**：

1. **选择发生在构建期，不是运行期。** `NEXT_PUBLIC_KERN_TENANT_PACK` 会在 build 时被内联，
   因此**一个部署只服务一个租户**。这不是运行时多租户，文档与对外表述都不得说成 SaaS 多租户。
2. **所有已登记 pack 都会进客户端 bundle。** 一旦登记第二个 pack，A 租户的浏览器里就能读到
   B 租户的公司名与词表。多租户部署前必须先改成按 pack 分别构建，或改为服务端加载。
3. **新增 pack 需要改代码**（`registry.ts` 加一行）并重新构建，不是纯配置化。

## 4. 分期与验收标准

### P1 · 抽离为参考包 —— ✅ 已完成（`290cd7d`）

验收：`npm run test:tenant` 中「health-food 与抽离前写死值一致」通过，逐项锁定
`targetMargin` 全表、`forms.length===11`、`claims.length===16`、`ingredients` 全列表、
默认品类与产品描述；并断言 `CATEGORY_TARGET_MARGIN` 与 pack 深相等（行为零变化的硬证据）。

### P2 · 剩余规则入包 + 中立守卫 —— ✅ 已完成（`ea80432`）

验收：`tests/tenant-neutral-guard.test.ts` 遍历 `src/` 全部非测试 `.ts/.tsx`，
命中任一租户行业词即失败。词表 = 所有已登记 pack 的 剂型/宣称/成分 + 行业名 + 默认品类，
外加 9 个通用行业词（健康食品/保健/营养/膳食/食品/代餐/蛋白粉/燕窝/海参）。

**这个守卫能证明什么、不能证明什么**：它是**词表黑名单**，只能证明「已知行业词不在 `src/`」。
它不能证明内核真的行业中立——行业假设也可以不带这些词而结构性地写死在流程里。
**真正的证明是 P3 的第二个 pack 能跑通。**

### P3 · 中立性实证与运行时化 —— ⏳ 待办（本阶段的真正验收）

| # | 交付项 | 验收判据 |
|---|---|---|
| 1 | 第二个 pack（另一行业，非健康食品） | `listTenantPacks().length >= 2`；「所有 pack 结构完整」用例真正遍历到多个 pack |
| 2 | 切换有效性测试 | 同一输入在两个 pack 下，需求解析/成本目标/宣称风险的输出**可观测地不同**；且切换过程不改 `src/` 任何一行 |
| 3 | `.env.example` 登记 `NEXT_PUBLIC_KERN_TENANT_PACK` | 当前**缺失**（仅 `packs/README.md` 提到），新人无法发现该变量 |
| 4 | 守卫覆盖面扩到 `src/` 之外 | 现存残留：`tests/` 12 个文件 34 行、`prisma/seed.ts` 5 行、`scripts/` 1 行。测试夹具与种子数据可豁免，但需**显式登记豁免清单**，而不是默认不扫 |
| 5 | pack 校验从「TS 结构化」升级为运行时 schema 校验 | 新增 pack 若缺字段/类型错，报错信息指出**具体字段路径**，而不是构建期类型报错 |
| 6 | `SOUL.md` 注入运行时 prompt（或明确延后） | 目前是死文件；要么接进人设链路并加「不可放宽 CORE 硬约束」的用例，要么在计划里写明延后到哪个阶段 |
| 7 | 构建期泄露面处理 | 见 §3.2：决定「按 pack 分别构建」还是「服务端加载」，并落成一条测试或构建检查 |

## 5. 合入条件（Definition of Done）

1. `npm run test:tenant`、`npx tsc --noEmit`、`npx eslint src/ tests/` 全绿（已满足）；
2. `npm run test:delivery-contracts` 全链路绿（**尚未在本分支跑过，提 PR 前必须补**）；
3. 本文与 `docs/KERN_NEXT_PHASE_PLAN.md` 执行顺序表已登记该工作项（本次一并提交）；
4. 按协作铁律走分支 → PR → 合入 `main`，**不直接推 main**。

## 6. 新增一个 pack 的操作手册

1. `cp -r packs/health-food packs/<new-id>`，**不要修改 `health-food`**（它是参考模版基线，
   P1 的一致性用例锁的就是它）；
2. 改写 `tenant.json`（`id` 必须等于目录名，`isReferenceTemplate` 删除或置 false）与
   `domain/*.json`、`SOUL.md`；
3. 在 `src/modules/tenant/registry.ts` 登记一行；
4. 设 `NEXT_PUBLIC_KERN_TENANT_PACK=<new-id>` 并**重新构建**；
5. 跑 `npm run test:tenant`。注意：新 pack 的行业词会自动进入中立守卫词表，
   若这些词此前出现在 `src/` 里，守卫会立刻失败——这是预期行为，应把它们移进 pack。

## 7. 已知差距汇总

- 一个部署只服务一个租户；所有 pack 内容进客户端 bundle（§3）。
- 中立守卫只覆盖 `src/`，且是黑名单（§4 P2、P3-4）。
- 只有一个 pack，中立性尚未被实证（§4 P3-1）。
- `SOUL.md` 未接入运行时。
- `.env.example` 未登记 pack 选择变量。
