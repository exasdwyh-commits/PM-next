# Kern 回复呈现规范（Response Rendering Spec v1）

状态：🟢 v1 草案　日期：2026-09-27　配套实现：`kern-response-framework/`

> 这份文档定义 **Kern 说话的样子**：模型产出什么结构、界面怎么排版、什么内容不许出现。
> 它是 Display Layer 的"最后一公里"——Display Layer 解决"看得见过程"，本规范解决"看得漂亮且可信"。

---

## 0. 三条铁律

1. **结构先于文采。** 模型不直接产出 HTML/Markdown 长文，而是产出 **Response Envelope（结构化信封）**；排版由前端唯一决定。这样同一份内容在对话卡、工作区、导出 PDF 里长得一致。
2. **事实与推断必须分色。** 任何一句判断都要标 `fact` / `inference` / `unknown`。没有来源的事实一律降级为 `unknown`，不许伪装成结论。
3. **密度分层。** 默认「摘要」，一键「完整」。摘要层永远能独立读懂，完整层只增加证据，不改变结论。

---

## 1. Response Envelope

```jsonc
{
  "v": 1,
  "kind": "ANSWER | BRIEF | PROGRESS | CONCLUSION",
  "demo": false,                  // true 时全局显示「演示数据」且禁止带走
  "lede": "一句话结论，≤ 60 字，不带修饰词",
  "confidence": "HIGH | MEDIUM | LOW",
  "blocks": [ /* 见 §2 */ ],
  "ask": {                        // 可选：需要人拍板的事
    "question": "...",
    "why_you": "为什么必须你来决定",
    "options": [{ "label": "...", "consequence": "..." }]
  },
  "meta": {
    "model": "kern-demo（示例数据）",
    "elapsedMs": 48210,
    "steps": 9,
    "quota": { "used": 3, "limit": 20 },
    "memoriesUsed": ["只做跨境电商", "预算上限 5 万"],
    "sources": 0
  }
}
```

## 2. Block 类型（12 种，够用且封闭）

| type | 用途 | 排版要点 |
|---|---|---|
| `prose` | 富文本段落 | 行宽 ≤ 38 汉字 / 68ch；段间距 > 行距；不允许出现"作为一个 AI" |
| `keypoints` | 要点列表 | 每条 ≤ 40 字，前置 `fact/inference/unknown` 色点 |
| `table` | 对比表（竞品 / BOM / 渠道） | 列 ≤ 6；数字右对齐且用等宽数字；窄屏自动转卡片 |
| `chart` | 柱状 / 趋势 / 占比 | 纯内联 SVG，无外部依赖；必须带单位与数据来源 |
| `checklist` | 验证计划 / 上市排期 | 每项含 方法 / 通过线 / 周期 / 预算 四列 |
| `timeline` | 里程碑 | 阶段 + 时间 + 交付物 |
| `evidence` | 引用来源 | URL / 抓取时间 / trust 分级；外部内容默认 untrusted |
| `unknown` | 缺口清单 | 明写"缺什么源才能回答"，不许空着 |
| `decision` | 决策卡 | **必须**三段齐全：推荐 / 反对理由 / 风险 |
| `qa` | QA 与红队 | 展示"被打回 → 修订后通过"的轨迹 |
| `callout` | 提示 / 警告 / 阻断 | 四色：info / ok / warn / blocked |
| `code` | 代码与命令 | 等宽、可选行号、不换行折叠 |

## 3. 排版契约

### 3.1 度量
- 正文行宽 **68ch**（中文约 34–38 字），超出即分栏或转卡片。
- 行高 **1.78**（中文），标题 1.25。
- 垂直节奏基准 **8px**；块间距 24px，段间距 14px。
- 数字一律 `font-variant-numeric: tabular-nums`，表格数字右对齐。

### 3.2 中西文混排
- 中文与拉丁字母/数字之间插入 **0.15em** 视觉间隙（`text-spacing-trim` + 手工 margin）。
- 标点挤压：行首禁则（，。）、行尾禁则（「（）。
- 字体栈：`Inter` → `PingFang SC` → `Noto Sans SC` → system-ui，避免宋体正文。

### 3.3 色彩语义（不靠颜色单独传意，必须配图标/文字）
| 语义 | 用途 |
|---|---|
| brand 靛蓝 | Kern 自身动作、主操作 |
| ok 绿 | 事实、通过、已完成 |
| warn 琥珀 | 推断、需注意、等待 |
| bad 红 | 风险、被打回、阻断 |
| violet 紫 | 演示数据（全局唯一标识色） |
| ink 中性 | 一切正文 |

### 3.4 密度分层
- `data-density="summary"`：只渲染 `lede` + `keypoints` + `decision` + `ask`。
- `data-density="full"`：全部块 + `evidence` + `meta`。
- 切换**不重新请求**，纯 CSS/DOM 显隐，保证瞬时。

### 3.5 自适应
- ≥ 1100px：正文列 + 右侧证据边栏（sidenote 对齐到引用行）。
- 640–1100px：单列，证据折叠为脚注。
- < 640px：表格转卡片，图表降为数据表 + 迷你条。

### 3.6 可访问性
- 对比度 ≥ 4.5:1；焦点环 2px 实心；表格有 `<caption>` 与 `scope`。
- 支持 `prefers-reduced-motion`（关闭打字动画）与 `prefers-color-scheme`。
- 打印样式：去背景、展开全部、显示 URL 全文。

## 4. 禁止事项（harness 会拦截）

1. 出现"作为一个 AI / 我无法 / 希望这对你有帮助"等套话。
2. 无来源的数字被写成事实（必须 `inference` 或 `unknown`）。
3. `decision` 缺少反对理由或风险。
4. 段落超过 280 字不分段。
5. 表格超过 6 列，或数字列左对齐。
6. `demo: true` 却没有全局演示标识。
7. `meta` 缺 model / elapsedMs / quota。
8. emoji 出现在正文（仅允许状态徽章内）。

## 5. Harness

`validate(envelope)` 对照 §4 输出 `issues[]`，每条含 `rule` / `level`(error|warn) / `path` / `fix`。

- **error** → 不渲染，退回"我这次没答好"并请求重跑。
- **warn** → 渲染，但在完整层显示黄条。

CI 接入：`npm run test:response-format`，用 `fixtures/*.json` 做金样本回归，任何排版/规范改动必须同步更新金样本。
