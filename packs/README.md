# Kern Tenant Packs

每个子目录是一家公司的**租户配置包**。部署时通过环境变量
`NEXT_PUBLIC_KERN_TENANT_PACK=<id>` 选择（默认 `health-food`）。

- `health-food/` —— **标准模版 / 参考实现**。它原样保存了 Kern 最初为健康食品公司
  制定的全部行业设定，新公司请复制此目录再改写，不要直接修改它。

## 目录约定

| 文件 | 作用 |
|---|---|
| `tenant.json` | 公司名、行业、默认品类、产品描述 |
| `domain/categories.json` | 品类 → 目标利润率 |
| `domain/lexicon.json` | 剂型 / 功效宣称 / 成分词表（需求解析用） |
| `domain/regulatory.json` | 法规核查清单项 |
| `SOUL.md` | 公司身份层，运行时叠加在 Kern CORE 人设之后、MODE 指令之前（不可覆盖硬约束；`>` 开头的行不进 prompt） |

新增 pack 后需要在 `src/modules/tenant/registry.ts` 登记一行。

## SOUL.md 的运行时约定

- 由 `src/modules/tenant/soul.ts` 用 fs 读取（**仅服务端**，不可从客户端组件引用）。
- 文件缺失、不可读或为空时返回 `null`，助理回落到通用 Kern 人设 —— 这是有意的降级。
  注意 `packs/` 不是 Next 的打包资源，standalone 产物可能不含它。
- 内容是部署方可编辑的外部输入，进 prompt 前会被加框并截断到 1200 字；
  其中任何放宽硬约束的表述都会被显式声明为无效。
