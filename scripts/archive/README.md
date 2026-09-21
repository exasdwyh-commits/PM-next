# scripts/archive/ —— 一次性过程脚本归档

本目录存放**已经用毕的一次性过程脚本**，仅供追溯（provenance），**不属于产品运行时，
也不应被再次执行**。

## 为什么要单独归档

`src/app/globals.css` 的「残留死类」审计（`scripts/audit-css-usage.mjs`）默认把
`src/** + tests/** + scripts/**` 一起当作「引用语料」。以下一次性脚本里还写着若干
**已经从产品源码中删除、其 CSS 规则也已清理**的选择器（`.hermes-hero` / `.hero-copy` /
`.hero-image` / `.hermes-decision-strip` / `.hermes-metrics` / `.hermes-projects-panel` /
`.hermes-workspace` / `.tiny-avatar` / `.user-chip-avatar`）。

它们并不是产品对这些类的「使用」，却会让默认扫描把这些**真死类**误判成
`仅脚本引用(scriptOnly)`。把它们移出 `scripts/` 根目录（并让扫描器跳过本 `archive/` 目录）
后，默认口径与 `--product-scope` 口径一致，均为「真死」。

> 纪律：**不得**为了这些过程脚本而保留死 CSS。产品引用语料只认 `src/**`
> （`node scripts/audit-css-usage.mjs --product-scope`）。

## 归档清单

| 文件 | 原用途 | 状态 |
|------|--------|------|
| `_tokenize-quiet-enterprise.mjs` | 把 `globals.css` 的字面量 hex/rgba 批量替换为 Quiet Enterprise 语义令牌（一次性迁移） | **已应用**，勿重跑 |
| `_probe_layout.mjs` | 用 Playwright 度量指定路由若干选择器的布局盒（诊断） | 已用毕 |
| `_small-screen-struct.mjs` | 小屏电脑自适应的结构度量（侧栏/内容/列显隐等，诊断） | 已用毕 |

## ⚠️ 勿重跑警告（尤其 `_tokenize-quiet-enterprise.mjs`）

- 该脚本是**一次性迁移**，其正则会**重新注入** `--ink:var(--ink)` 这类**同名自引用**——
  这会构成 CSS 自定义属性循环依赖并整体失效（见 `globals.css` 顶部注释的明令禁止）。
- 它按旧版 `globals.css` 的原始选择器做 `String.replace`，对当前文件已是 no-op，
  但仍可能产生副作用。
- 正确做法：如需再次令牌化，请新写一支幂等迁移脚本，并先跑 `--dry-run`。

## 诊断脚本的正确替代

- CSS 使用/死类审计：`node scripts/audit-css-usage.mjs --product-scope`
- 行为中性证明：`node scripts/_css-neutral.mjs snapshot|verify ...`
- 全流程走查：`bash scripts/ui-walk.sh`
