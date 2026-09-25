# Hermes 交付计划（分工版）

基线：`main` @ `a1da1237`。事实来源只认代码 / 当前 DB schema / 当前 API / 当前 CI。
不回退历史分支，不参考旧 README、旧 PR、旧 fusion 分支。

## 分工

- **架构师（Claude Opus）**：信息架构、AI 助理体验、最终前端视觉系统。见「A 类」。
- **执行 agent（GPT / DeepSeek）**：机械、可验收、单点的活。见「B 类」。

每组改完必须过：`npx tsc --noEmit`、`npm run lint`、`npm run build`。
10 条 CI 必须保持绿。测试只有在与「被刻意改掉的产品假设」冲突时才可改，且必须在 commit 里
说明这是基线变更，不是绕过失败。

## 不许重写（§14）

Governance、Evidence、QA、Gate、AgentTask、AgentRun、Decision Intelligence、
ProductVersion、Approval、Audit。这些后端已被 CI 覆盖且验证过，只在真的堵死体验时才动。

## 诚实红线（§15）

系统没做，不显示「正在执行」。没有真实结果，不显示「已完成」。
所有状态来自真实 backend state。禁止假 loading / 假 Agent / 假进度 / 假证据 /
假完成 / 假本机执行 / 假成功 / 假报告 / 假研究。
UNKNOWN 是一等状态，如实显示，不要为了好看补齐。

---

## A 类：架构师自己做

1. **AI 助理体验（最高优先）**——自然语言作为整个系统的操作层。用户不需要理解内部路由。
   `src/app/advisor/*`、`src/modules/advisor/*`。目标：说「帮我做这个」即可，Hermes 自己决定调什么。
2. **最终前端视觉系统**——层级、留白、状态、动作关系统一。桌面优先，390px 可用。
   不做重渐变 / 玻璃拟态。参考 Linear / Notion / Raycast / Stripe 的层级逻辑，不抄皮肤。
3. **首屏信息架构**——回答三个问题：今天什么最重要 / Hermes 正在替我做什么 / 我现在需要做什么。
4. **Executive Report 呈现**——结论 / 关键依据 / 最大风险 / UNKNOWN / 需要我决定 / 下一步。
   原始 agent 输出默认折叠。
5. **Desktop 助理叙事**——用户感受是「我让 Hermes 操作了我的电脑」，不是「我在调用 Desktop Runtime」。

---

## B 类：派给执行 agent

每条都是独立任务，附文件路径和验收标准。一次派一条，别合并。

### B1 移动端固定宽度（390px 溢出）— 2 个文件 / 4 处 · 前提**未被验证**
**2026-09-25 实测基线**（`WALK_BASE=http://localhost:3100` 快路径 1440/390，51 屏）：
- 产品详情默认视图（含 `?tab=cost`、`?tab=launch`）在 1440 / 390 **两档均无横向溢出**。
- 但这**不算已清**：`launch-tab.tsx:227,243` 在 `{createOpen && <Modal>}` 内（第 151 行起），
  走查没点「建立上市计划」→ **从未渲染**；`cost-calculator.tsx:532` 在 `{result && onSaveScenario && …}` 内，同样未渲染。
- 唯一被实测覆盖的是 `cost-calculator.tsx:389`：容器 334px > 220px → 单列，**不溢出**。
- `.hermes-inline` 已有 `flex-wrap:wrap`（globals.css:114），`.hermes-label` 是 `display:grid`（globals.css:108）
  → 推断这两处大概率会换行自适应，但**推断不算证据**。

坐标（已逐条核过；原稿 479 / 336 是漂的）：
- `src/app/products/[id]/launch-tab.tsx:227` — `.hermes-label` 内联 `width:120`（弹窗内·里程碑「类型」）
- `src/app/products/[id]/launch-tab.tsx:243` — `.hermes-label` 内联 `width:150`（弹窗内·里程碑「截止日」）
- `src/app/products/[id]/cost-calculator.tsx:532` — 情景名称 input 内联 `width:220`（需先算出经济性）
- `src/app/products/[id]/cost-calculator.tsx:389` — `minmax(220px,1fr)`，实测不溢出

**派单契约（照做，不许跳）**：
1. 先用 playwright 在 390×844 **打开这两个状态**，量 `documentElement.scrollWidth - clientWidth` + 越界元素，数字写进交付说明。
2. **未复现就一行都别改**，如实回报「未复现 + 实测值」。存在性没证实的改动 = 假修复（§15）。
3. 只有复现了才改：抽 CSS 类 + `≤520` 分档兜底（globals.css 已有 520 档），别删列。
4. 只改可见布局，不动 `value=` / key / 比较 / 载荷字段。

验收：复现的状态在 390 无溢出，1440 布局不变，`npx tsc --noEmit` + `npm run lint` 过。

### B1b 实测确有的 390px 溢出：`/knowledge`（20px）— ✅ 已修（2026-09-25）
**根因**：`KNOWLEDGE_SAMPLE_MODE_BANNER`（`src/shared/content-mode.ts:26`）文案里含一个不可断行的长 token
`HERMES_KNOWLEDGE_SAMPLE_MODE=false`。`.hermes-banner` 默认 `overflow-wrap:normal`，该 token 的 min-content
（实测 ≈306–336px）把内容列撑到 336 → `.hermes-content` 是 flex item（`min-width:auto`，见 `globals.css:15` / `:727`）
压不下去 → `documentElement.scrollWidth 410 > clientWidth 390`。
（我原先猜的「缺 `min-width:0`」方向对，但真正的撑点是这条横幅——`page-heading` / `hermes-tabs` / `hermes-panel`
 只是被撑大的列撑满到 336 的**受害者**，不是根因。）

**修法**：`.hermes-banner` 加 `overflow-wrap:anywhere`（`src/app/globals.css:121` 附近，+3 行中文注释）。
未用 `overflow-x:hidden` 掩盖。

**实测**：修复前 410 / 390 / **溢出 20px** → 修复后 **390 / 390 / 溢出 0**。走查 51 屏 `scrollW == clientW` 全零、
`G3/G5/G6 + H1` 全过、`npx tsc --noEmit` + `npm run lint` 过。

**遗留（转 A 类 / B5）**：这句横幅本质是**对着用户讲环境变量**。`overflow-wrap:anywhere` 只解决断行，
没解决「内部机制出现在面向用户的文案里」。根治要从 `content-mode.ts:26` 那句里拿掉 env 名（改成
「如需关闭本声明请联系管理员」之类），那是文案问题不是布局问题。

### 跑法（B1 / B1b 共用）
`bash scripts/ui-walk.sh`（自起服务于 3182，产出 `/tmp/hermes-ui-walk/report.md` + `red-baseline.md` + `screens/`）。
已有 dev server 时**不要**再起第二个（两个 next 抢 `.next`），直接对它跑：
`NODE_OPTIONS= WALK_BASE=http://localhost:3100 ./node_modules/.bin/tsx scripts/verify-ui-walkthrough.ts`
登录：dev 库口令用 `NODE_OPTIONS= ./node_modules/.bin/tsx scripts/_set-dev-password.ts <口令>` 重置；
走查默认账号 `li_vp@hermes.test`。**不登录时走查会静默跳过产品/项目详情页并报「溢出屏 0」= 假绿**，先确认登录成功。

### B2 `.hermes-board` 与气泡轴标签 — 原稿两条前提**都不成立**（2026-09-25 核）
- `.hermes-board`（`globals.css:225`）**已经有 `overflow-x:auto`**，「降级为可横滚」是**已经做过**的，
  不是待办。实测 390 档 `/products` 看板列=7、无横向溢出。→ 这条建议直接删，除非你指的是别的症状。
- `bubble-axis-x` / `bubble-axis-y`（`globals.css:540-541`）**本来就在 `.bubble-scroll` 里**
  （`src/components/viz.tsx:284-288`，那两个 span 就是 `bubble-scroll` 的子节点），不存在「挪进容器」。
  真正可疑的是 `.bubble-axis-y { left:-28px }`：绝对定位 + 负 left 放进 `overflow-x:auto` 的容器里，
  **左侧会被裁掉**（走查的 `leftOver` 量的就是这个；快路径没覆盖气泡图，得自己点开量）。

结论：B2 目前**没有可复现的症状**。要派就先派「在 390 量 `.bubble-axis-y` 是否被裁」这一步；
量到 `leftOver > 0` 再改，量不到就作废。别凭 CSS 观感直接改。

### B3 表单 `<option>` 里的裸枚举
`src/app/projects/[id]/project-detail-client.tsx:1687-1688, 1705-1712, 1756-1757`
——运行模式、产物类型、证据性质的 `<option>` 文本仍是原始枚举。
产物类型在 `src/shared/status-labels.ts` 里还没有 label map，需要新增。

规则：照该文件现有风格加 `XXX_LABELS` + `labelXxx`；成员必须对 `prisma/schema.prisma` 核实，不许猜。
**只改可见文本，不动 `value=`、比较、key、载荷字段。**

坐标 2026-09-25 核过（**准确**，是 B 类里除 B1b 外唯一坐标全对的一条）。两点补充：
- 同文件另有 2 处同类漏网：`:1058-1059`（`进行中 (IN_PROGRESS)` / `负责人已确认 (VERIFIED_BY_LEAD)`）、
  `:1634-1636`（`人工执行 (HUMAN)` / `测试 Agent (TEST_AGENT)` / `数字员工 (DIGITAL_WORKER)`）。派单时定要不要一起收。
- 该文件**混着两种风格**：`:1634-1636` 用的是「中文 (ENUM)」内联括注，而 `shared/status-labels.ts` 是 label map。
  派单前先定「该文件现有风格」指哪一种，否则产出会和既有代码打架。
- **机器验收已有**：走查报告的 §4「英文枚举泄漏分布」会列出泄漏项（当前 `/settings` 有 `LOW` ×2）。
  修完该节应变空或只剩已登记豁免项 —— 别靠肉眼翻页。

### B4 空状态与错误态巡查
逐页检查：没有数据时是否说了「为什么没有」和「你现在该做什么」，而不是只画个空框。
禁止把「无数据」写成「已完成」或「暂无问题」。

### B5 文案一致性巡查
同一个概念在不同页面是否同名（Product / Project / WorkItem / 门禁 / 决策包）。
输出一份「同义词冲突表」再改，别边看边改。

---

## 验证路径（交付前必须真跑）

**路径 1 · 产品主线**：新用户 → 看懂 Hermes → 给一个产品想法 → Product 建立 →
AI 研发 → 多 agent 研究 → Evidence/QA → Executive Report → 决策 → Hermes 继续推进。

**路径 2 · 本机执行**（已验证过一次）：对话里说「本机帮我检查这个代码仓库，把能确定的 Bug 修掉」
→ desktop 任务 → Mac runtime → Codex → 真实执行 → receipt → 结果回到原对话。
跑法：`npm run dev`（:3100）另开一个终端 `npm run desktop:once`，
需要 `HERMES_DESKTOP_EMAIL` / `HERMES_DESKTOP_PASSWORD`。
开发库密码用 `scripts/_set-dev-password.ts` 设。

## 预留扩展（不现在做）

架构要给 发现机会 → 研究 → Product → 开发 → 测试 → 交付物 → 发布 → 运营 留口子。
差异化能力保留：企业记忆、Product Context、多专业 Agent、Evidence、独立 QA、
Decision、Governance、Desktop Runtime、Audit。
