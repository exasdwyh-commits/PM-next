# KX-70 分层守卫与清理（2026-09-29）

> 阶段 1 地基的第一项。目的：给架构边界装一个「只许变好」的闸门，然后才敢在 KX-71 拆环。
> 数据来自 `tests/helpers/architecture-layers.ts` 对 `src/` 的静态扫描；基线在 `tests/fixtures/`。

## 1. 做了什么

| 项 | 内容 | 位置 |
|---|---|---|
| 分层依赖守卫 | 46 个单元归入五层；跨层向上的 import 记基线，只许减少 | `tests/architecture-layers.test.ts`、`tests/helpers/architecture-layers.ts`、`tests/fixtures/architecture-baseline.json` |
| app 层直连数据库 | 页面 / 接口文件 import `@/shared/db` 或 `@prisma/client` 的记基线，不许新增 | 同上（AL3） |
| 提示词静态前缀守卫 | persona 纯函数、静态在前易变在后、改前缀必须升版本 | `tests/prompt-prefix.test.ts`、`tests/helpers/prompt-prefix.ts`、`tests/fixtures/prompt-prefix-baseline.json` |
| 删空壳模块 | `jarvis`（11 行只读约定）、`intelligence` / `economics` / `supply` / `rules`（各 2 行 `BOUNDARY_ONLY` 常量）、`billing`（KX-37 后的空目录）；src / tests / scripts 零引用 | AL5 防复活 |
| 命令 | `npm run test:architecture`（单独跑）；已并入 `test:source-guards`；`npm run arch:baseline` 重写基线 | `package.json` |

## 2. 层的划分

```text
L1 界面     app/pages  app/api  components
L2 Kern 核心 assistant-runtime  supervisor  advisor  muse  response-format  visual-intelligence  memory  playbooks  workspace
L3 领域     research  knowledge  decisions  decision-intelligence  products  product-development  product-rnd  production  launch
            projects  collaboration  signal  workforce  autopilot  evaluation-harness
L4 执行底座 worker  schedule  connectors  desktop-runtime  vault  governance  automation-trace  notify  work
L5 平台     identity  tenant  model-gateway  model-control  cost-engine  usage  evidence  business-events  shared  config
```

规则：只允许依赖同层或更下层。同层之间互相 import 目前不计违规（那是 KX-71 的范围）。
新模块必须先在 `UNIT_LAYERS` 里落户，否则 AL1 直接红。

两处归层说明：

- `workforce` / `autopilot` 放 L3：它们是产品研发流程（任务包）的编排，不是 Kern 核心；`supervisor` 才是核心编排。
- `work`（工作项 / 回执 / 交付物）放 L4：它是执行的记账底座，被 knowledge、cost-engine、product-* 共用。

## 3. 基线数字（feffaa5 之后、本任务提交时）

| 指标 | 数值 | 说明 |
|---|---|---|
| 跨层向上 import | **20 条**（仅类型 3） | 分布：L4→L2 6、L4→L3 6、L3→L2 3、L2→L1 2、L5→L4 2、L5→L3 1 |
| app 层直连数据库 | **26 个文件** | 评估文档写 24，差异是本扫描把 `@prisma/client` 类型导入也算上 |
| 最大模块环（运行时导入） | **12 个** | advisor, assistant-runtime, autopilot, business-events, desktop-runtime, playbooks, product-development, product-rnd, products, response-format, supervisor, workforce |
| 最大模块环（含类型导入） | 19 个 | 上面 12 个 + connectors, evidence, governance, muse, schedule, visual-intelligence, worker |
| 其他环 | decisions ↔ launch ↔ production（3）；muse ↔ schedule（2） | |

评估文档说的「9 个模块大环」是在 f976753 上的口径；本守卫的口径固定为「任何 import，含类型」记违规、「运行时 import」算环。KX-71 的验收以此为准：**运行时最大环 ≤ 3，越界条数只降不升**。

20 条越界里最关键的两组，正是 KX-71 要反转的边：

- `worker → supervisor / workforce / research / product-rnd`（7 条）：worker 应只认「任务类型 → 处理器」注册表。
- `connectors / schedule / playbooks / workforce → supervisor`（6 条）：抽 `kern-contracts` 纯类型 + 端口后两边都只依赖它。

其余：`muse/read-model.ts` 与 `supervisor/takeaway.ts` 反向引了 `src/app/muse` 的类型和标签（L2→L1，应把类型下沉）；`business-events/dispatcher.ts → autopilot`（L5→L3，应改成注册订阅者）；`evidence → governance`、`cost-engine → work`（L5→L4）。

## 4. 提示词前缀守卫说明

现状本来就是对的，守卫只是把它锁住：

- 对话：`assistantPersona = [basePersona, memoryPrompt, selectionPrompt]`，静态 persona 排第一（PP2）。
- 任务节点：`buildMissionNodeMessages` 的 system 只有角色 / 技能 / 节点类型 / 工具说明；记忆、组织事实、上游产出、QA 打回、用户补充都在 user 消息里（PP3）。
- `buildDepartmentAssistantSystemPrompt` 换时间、换时区、重复调用逐字相同，且不含日期 / 时刻 / 「今天」（PP1）。
- 三个 ASSISTANT_* 任务类的前缀哈希与 `DEPARTMENT_ASSISTANT_PERSONA_VERSION` 一起记基线；前缀变了版本没升，PP4 红（PP4）。

没有做的：模型网关层的「工具列表顺序稳定」守卫（工具目录在 KX-71 统一后再加）。

## 5. 怎么用

- 平时：什么都不用做，`test:source-guards` 会跑。红了就说明新代码越界，改成走下层服务 / 事件 / 注册表。
- 还掉一条违规后：`npm run arch:baseline`，把基线文件一起提交，提交信息写明还了哪条。基线只减不增，AL4 保证基线不会留下已修好的旧条目。
- 有意改 persona 文案：先升 `DEPARTMENT_ASSISTANT_PERSONA_VERSION`，再 `npm run arch:baseline`。

## 6. 验证

见路线图进度日志同日条目（tsc / eslint / source-guards / regression-units / delivery-contracts / kern-autonomy）。
