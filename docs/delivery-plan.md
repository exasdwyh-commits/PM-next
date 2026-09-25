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

### B1b 实测确有的 390px 溢出：`/knowledge`（20px）
全站 390 档唯一溢出，已定位到元素链（`/tmp/hermes-ui-walk/red-baseline.md` §R1）：
`/knowledge` scrollWidth 410 / clientWidth 390；越界者自 `section.hermes-content` 下
`div.hermes-stack:nth-of-type(2)` 起：`div.hermes-page-heading`、`div.hermes-banner.is-info`、
`section.hermes-theme-section`、`div.hermes-tabs`、`div.hermes-glass.hermes-panel` 均 right@410、
scrollW/clientW 334/334（即被横向推了 ~76px），内层 `div` / `p.eyebrow` / `h1` right@406。
这是**唯一有实测数字**的移动端溢出项，优先级高于 B1。定位到根因再改，禁止用 `overflow-x:hidden` 掩盖。

### 跑法（B1 / B1b 共用）
`bash scripts/ui-walk.sh`（自起服务于 3182，产出 `/tmp/hermes-ui-walk/report.md` + `red-baseline.md` + `screens/`）。
已有 dev server 时**不要**再起第二个（两个 next 抢 `.next`），直接对它跑：
`NODE_OPTIONS= WALK_BASE=http://localhost:3100 ./node_modules/.bin/tsx scripts/verify-ui-walkthrough.ts`
登录：dev 库口令用 `NODE_OPTIONS= ./node_modules/.bin/tsx scripts/_set-dev-password.ts <口令>` 重置；
走查默认账号 `li_vp@hermes.test`。**不登录时走查会静默跳过产品/项目详情页并报「溢出屏 0」= 假绿**，先确认登录成功。

### B2 `.hermes-board` 与气泡轴标签
- `.hermes-board` 7×140px 在窄屏挤但没坏 — 降级为可横滚或减列
- `bubble-axis-*` 的 nowrap 标签在 `.bubble-scroll` 外 — 挪进滚动容器

验收：390px 下标签不被裁切。

### B3 表单 `<option>` 里的裸枚举
`src/app/projects/[id]/project-detail-client.tsx:1687-1688, 1705-1712, 1756-1757`
——运行模式、产物类型、证据性质的 `<option>` 文本仍是原始枚举。
产物类型在 `src/shared/status-labels.ts` 里还没有 label map，需要新增。

规则：照该文件现有风格加 `XXX_LABELS` + `labelXxx`；成员必须对 `prisma/schema.prisma` 核实，不许猜。
**只改可见文本，不动 `value=`、比较、key、载荷字段。**

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
