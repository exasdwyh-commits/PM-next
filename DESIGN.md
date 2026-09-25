# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-09-20
- Primary product surfaces: 科恩主工作台、产品中心、专业管理后台、机会与知识中心、审批与追溯。
- Evidence reviewed: `README.md`、`src/app/dashboard/*`、`src/app/globals.css`、`src/app/theme/quiet-enterprise.css`、`src/components/ui.tsx`、现有浏览器验收与截图产物。

## Brand
- Product name: **科恩 KERN**。
- Role: **AI 工作总管 / AI Chief of Staff**。中文交互优先称“科恩”，英文与系统级 wordmark 使用 `KERN`。
- Naming contract: 用户可见界面、演示、产品文档不得再把 `Hermes` 或 `Muse` 当产品名；它们只允许作为暂时保留的内部兼容标识。详见 `docs/KERN_BRAND.md`。
- Personality: 冷静、专业、证据驱动；像高级产品团队的决策操作台，而不是泛用聊天机器人。
- Trust signals: 来源、状态、责任人、时间、审批与可追溯记录始终可见；AI 建议必须能解释、能复核、能被人接管。
- Avoid: 紫色渐变、装饰性光晕、无意义指标墙、卡片套卡片、把每一项内容都做成高亮 CTA、AI 生成感的插画堆砌。

## Product goals
- Goals: 让食品新品团队在一个清晰工作区中发现机会、形成证据、作出打样门决策并持续追踪交付。
- Non-goals: 把业务工作台做成营销落地页；用炫技动效替代信息可读性；让 AI 在未说明依据时替用户拍板。
- Success signals: 用户能在首屏判断“当前最重要的事、为什么重要、下一步谁来做”；关键决策可在两次交互内进入详情或处理。

## Personas and jobs
- Primary personas: 产品经理、研发/合规协作者、管理者/审批人。
- User jobs: 发现优先事项、判断项目风险、审查 AI 建议和证据、推进或阻断下一阶段、复盘责任链路。
- Key contexts of use: 桌面端深度工作为主；会议/现场查看需在平板和手机上快速读懂状态与待办。

## Information architecture
- Primary navigation: 工作台作为日常入口；产品与项目承载对象详情；AI 顾问承载建议和审查；机会、知识、追溯与设置提供支撑。
- Core routes/screens: Dashboard、Products、Projects、Advisor、Opportunities、Knowledge、Trace、Settings。
- Content hierarchy: 页面结论/关键动作 → 风险与进度 → 支撑证据与历史。一个页面只允许一个主要行动。

## Design principles
- 先结论，后证据: 首屏呈现经营/项目判断与可执行下一步，细节按需展开。
- AI 是协作方，不是黑箱: AI 输出必须带状态、证据、影响范围和人工确认/撤回入口。
- 用克制建立高级感: 通过排版、密度、留白、表面层级与语义色建立品质，不靠大量渐变或发光。
- 工作流优先于页面装饰: 每个模块都要缩短“看到异常 → 理解原因 → 采取行动”的路径。
- Tradeoffs: 允许少量有意义的环境层与微动效，但不牺牲加载、对比度、表格扫描效率或可访问性。

## Visual language
- Color: 延续 Quiet Enterprise 的冷灰白基底、墨蓝文本和蓝色动作强调；绿色/琥珀/红色只表达状态，不充当装饰。所有新色必须先进入 `quiet-enterprise.css`。
- Typography: 中文正文使用系统无衬线；关键页面标题使用现有中文衬线标题栈，营造编辑式、权威而非科技玩具化的气质。
- Spacing/layout rhythm: 以 8px 基础节奏；页面首屏减少并列卡片，优先一条明确的主叙事线与一条行动队列。
- Shape/radius/elevation: 继承现有 9–14px 圆角与 hair/card/lift 三级表面深度；高层浮面只用于可操作内容。
- Motion: 150–220ms 的状态确认、展开与位置过渡；不使用循环装饰动画；尊重 `prefers-reduced-motion`。
- Imagery/iconography: 优先真实产品、包装、证据或数据图形；图标只用于加速扫描，并保留文本标签或可访问名称。

## Components
- Existing components to reuse: `src/components/ui.tsx` 的基础控件，以及现有的 dashboard、产品、顾问与可视化组件。
- New/changed components: 决策摘要、AI 建议卡、证据/可信度条、风险行动队列、页面级空状态应逐步归并为可复用模式。
- Variants and states: 每个高价值模块必须覆盖 loading、empty、error、success、disabled 与 AI-processing 状态；状态不能只靠颜色传达。
- Token/component ownership: `src/app/theme/quiet-enterprise.css` 是颜色、排版、几何的唯一令牌来源；组件不得新增临时硬编码色值。

## Accessibility
- Target standard: WCAG 2.1 AA。
- Keyboard/focus behavior: 所有可点击元素均可键盘到达，有明确焦点环；抽屉、弹窗、命令面板必须管理焦点并支持 Escape。
- Contrast/readability: 正文以 15px 左右为基准；状态文本与背景必须保持足够对比；长数据表支持行扫描和窄屏替代布局。
- Screen-reader semantics: 图标按钮含可读名称；状态变化使用恰当的 live region；图表提供文字摘要。
- Reduced motion and sensory considerations: 支持减少动效；不以闪烁、自动播放或颜色单独表达告警。

## Responsive behavior
- Supported breakpoints/devices: 桌面优先；平板用于会议查看；390px 手机保证浏览、筛选和高优先级处理。
- Layout adaptations: 桌面保留上下文与行动队列并列；平板压缩为单主栏；手机优先显示结论、状态与一个主要行动，次级证据折叠。
- Touch/hover differences: 所有 hover 信息有触摸替代入口；触控目标不小于 44px。

## Interaction states
- Loading: 使用结构化骨架屏，保留内容层级，禁止全屏无说明等待。
- Empty: 解释该模块的价值并给出唯一、明确的下一步。
- Error: 说明影响范围、保留用户输入、提供重试或回退操作。
- Success: 以简短确认与可追溯链接反馈，不打断用户工作流。
- Disabled: 明确说明前置条件或所需权限。
- Offline/slow network, if applicable: 将数据刷新状态与上次更新时间显示在关键经营/决策模块。

## Content voice
- Tone: 简明、有判断、有证据；使用业务语言而非模型术语。
- Terminology: 统一使用“建议、证据、风险、决策、待办、负责人、状态”；避免“智能洞察”等空泛词。
- Microcopy rules: 按“发生了什么 → 为什么重要 → 可以做什么”写；按钮使用动词；不要用模糊的“提交”“确定”。

## Implementation constraints
- Framework/styling system: Next.js 15、React 19、TypeScript、Tailwind CSS；保持现有服务端/客户端边界。
- Design-token constraints: 新增或变更视觉值先写入 `quiet-enterprise.css`；复用现有 `ui.tsx` 与主题类，避免页面级视觉分叉。
- Performance constraints: 首屏避免重型图表和纯装饰媒体；动效不得阻塞交互；图片必须有明确内容价值。
- Compatibility constraints: 不破坏现有鉴权、审计、证据和审批业务语义。
- Test/screenshot expectations: 每轮高频页面改造提供桌面和 390px 视口验收；检查空、错、加载和键盘焦点状态。

## Open questions
- [ ] 首轮视觉基准应以工作台、产品中心还是 AI 顾问为主？默认按工作台 → 产品中心 → AI 顾问推进。
- [ ] 是否有现成品牌摄影、包装图或品牌手册可作为真实视觉资产？若无，先以数据和产品对象建立识别度。
- [ ] 管理层和执行层是否需要不同的默认仪表盘密度？
