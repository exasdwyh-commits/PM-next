# KX-60 浅色主题改色（参考 MediSync 蓝）

## 目标
浅色主题对齐用户提供的参考图：蓝色主色、浅蓝灰画布、白色卡片。深色主题保持不变。

## 改动
- `src/app/theme/kern-design.css`：浅色 `:root` 新配色。
  - 画布 `#EEF2F8`，卡片 `#FFFFFF`，线条 `#E4EAF3`。
  - 文字 `#0F1B33` / `#334155` / `#64748B` / `#94A3B8`。
  - 主色 `#2563EB`，辅色 `#3B82F6`，浅底 `#EAF1FE`；成功 `#15803D`，错误 `#DC2626`。
  - 新增 `--k-tint-blue/green/violet`（含 `-line`），深浅色都有。
  - 阴影改为偏蓝，光晕改为冷蓝。
- `src/app/theme/quiet-enterprise.css`：末尾的 `:root` 覆盖层原先写的是旧色值字面量（`#3D63F5`、`#F7F7F9` 等），它排在前面的映射之后，所以生效的一直是它。现在 28 个令牌全部指向 `--k-*`。
  - 顺带修复：之前深色模式下工作台会漏出这些浅色字面量，现在跟随令牌正常切换。
- `src/app/muse/muse.css`：`.muse::before` 光晕和浅色 `--g-*`（画布、光晕、玻璃、阴影）改为引用 `--k-*`。深色块未动。
- `src/app/muse/response/response.css`：`.kr-response` 的品牌色改为 `var(--k-brand*)`，带兜底值。

## 验证
- 截图（1440×900，浅色和深色各一套：/muse、/、/projects、/products）已人工与参考图比对。
- tsc、frontend-v3、response-format 结果见提交说明。

## 未做
- `[data-palette="paper"]` 回退块仍会被覆盖（既有行为，本次未改）。
