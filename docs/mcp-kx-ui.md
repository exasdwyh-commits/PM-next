# Kern 前端组件库（kx）

入口：`import { … } from "@/components/kx";`（`src/components/kx/index.tsx`，样式 `src/components/kx/kx.css` 随入口自动引入）。
动效原语仍在 `@/components/motion`（`play` / `stagger` / `flip`、`useReveal`、`useBtnState`、`HoldToConfirm`）。
设计与动效约束：`docs/mcp-kern-experience-roadmap.md` §4 / §5，动效原则：`docs/mcp-motion-principles.md`。

## 组件

| 组件 | 用途 | 关键属性 | 已用于 |
|---|---|---|---|
| `Tag` | 状态标签（带圆点） | `tone`: ok / warn / bad / brand / "" | 工作台、设置、执行报告 |
| `Count` | 计数徽标 | `n`，`bad`（>0 时标红） | 同上 |
| `Dot` | 列表前的状态圆点 | `tone` | 同上 |
| `EmptyLine` | 一行空态说明（圆点 + 文字） | `tone` | 工作台 |
| `Meter` | 用量条，`limit=null` 表示不限，达到上限变红 | `label` `used` `limit` | 设置 |
| `Drawer` | 右侧抽屉：Esc / 点遮罩关闭，打开聚焦关闭按钮，关闭后焦点回到触发者，锁滚动 | `title` `open` `onClose` | 设置 |
| `PublicFooter` | 未登录页面页脚：K 标 + 说明 + 版本 + 年份，不放空链接 | `version` `note` | 登录页 |
| `SidebarStatus` | App 侧栏底部状态区：系统状态 + 用量 / 账户入口 + 版本 | `label` `detail` `version` | `app-shell.tsx` |
| `StoryRail` | 故事轨：固定几站，当前站圆点长成带文字的 pill，其余站文字只给读屏 | `steps` `current` `tone` `label` | 任务卡 |
| `Notch` | 动态岛：K 标 + 此刻在做什么；进行中有呼吸点，结束即停 | `text` `state`: live / warn / done / idle | 任务卡 |
| `Terminal` | 执行日志：只渲染传入的真实事件，最新一条升起 | `title` `lines` `max` | 任务卡 |
| `Bento` | 示例任务阵列：第一块占满一行，其余各占一半；≥44px | `tiles` `onPick` `label` | Muse 空态 |
| `Beats` | 诚实节拍：推断 / 被推翻 / 已收回 | `beats` `max` | 任务卡 |

版本号：`import { APP_VERSION } from "@/shared/app-version"`（`next.config.ts` 构建时从 package.json 注入）。

## 添加新组件的约定

1. 先确认页面里有至少一处真实用法；没有用法的组件不进库。
2. 类名统一 `kx-*`；颜色 / 圆角 / 阴影 / 字号只用 `theme/kern-design.css` 令牌，动效只用 `--m-*` 令牌。
3. 动画只动 `transform` / `opacity` / 颜色类；单次 ≤ 600ms；新增循环动画要登记到 `tests/motion-contract.test.ts` 的 `INFINITE_ALLOWLIST` 并写明理由；`kx.css` 的 `prefers-reduced-motion` 分支同步补上。
4. 手机上可点区域 ≥ 44px（`kx.css` 末尾的 720px 断点）。
5. 组件不取数据、不造状态：数据由页面传入；需要推导的状态写成纯函数并配测试（例：`src/app/muse/mission-story.ts`）。
6. 在本文的表里登记一行。
