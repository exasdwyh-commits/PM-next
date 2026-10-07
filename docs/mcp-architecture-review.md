# Kern 架构梳理与个人助理方向评估（2026-09-29）

> 基线：`feat/kern-experience` f976753（KX-65），工作区另有 KX-66 未提交改动，本文未触碰。
> 数据来自当天对 `src/` 的静态依赖扫描（420 个 ts/tsx 文件）与 prisma schema；外部参考为 0xCodila 的 Substack 系列文章。
> 本文只给判断与建议任务，不改代码。建议任务编号 KX-70 起，写入路线图前需用户确认。

## 1. 结论（先看这里）

1. **方向是对的。** 仓库自己的目标（`docs/KERN_ARCHITECTURE_V2.md`：Personal Chief of Staff）与 0xCodila 反复讲的那套 Chief-of-Staff 智能体团队几乎是同一张图；按他的框架逐项对照，Kern 已具备约 **六成**（权限分级、连接器只读优先、复核回退、常驻与定时、凭证保管都已落地），而且权限与审计这块比文章里的做法更扎实。
2. **能复刻，但复刻的是方法，不是平台。** 他的内容是「在 Grok Bot / Claude Code / Jev 之上怎么搭」的方法论。Kern 能把方法做成产品能力；做不了、也不该做的是云电脑与自研路由模型（Jev 是 TypeSafe 的专有模型，可以用现有小模型复刻「把小判断单独交给小模型」的模式）。文章里「193 倍更快」一类数字是营销口径，只借模式不借数字。
3. **真正缺的不是更多集成，而是「可靠性闭环」**：任务契约（什么算完成）→ 结果指标（完成率、人工介入、返工轮数、耗时、单次成本）→ 三次连续成功才转定时 → 每周复盘改进。这四样 Kern 目前基本没有，而它们正是「个人助理可以放手」的前提。
4. **架构上最大的债是边界**：41 个模块里有 9 个互相依赖成一个大环，5 个空壳模块，产品/执行/对话三个概念族各自有 4–8 个重叠模块，24 个页面 / 接口文件直接访问数据库。建议先加「只许变好」的分层守卫，再逐步拆环，不做大重构。

## 2. 现状体检（数据）

| 指标 | 数值 | 说明 |
|---|---|---|
| 业务模块 / 源文件 / 数据模型 | 41 / 420 / 77 | 权限矩阵登记 123 个接口 |
| 最大强连通分量 | **9 个模块** | assistant-runtime、supervisor、worker、advisor、product-development、connectors、playbooks、response-format、visual-intelligence |
| 双向依赖对 | 12 | 另有两个 3 模块环：production↔launch↔decisions、workforce↔autopilot↔business-events |
| 被依赖最多 | identity 32 | 正常（身份是底座） |
| 依赖别人最多 | assistant-runtime 20、supervisor 13、worker 10 | 编排层吸走了太多依赖 |
| 空壳 / 仅约定 | jarvis 11 行、intelligence / economics / supply / rules 各 2 行、billing 空目录（KX-37 后） | 可直接删除 |
| 只被测试使用 | evaluation-harness（1351 行） | 产品里没有结果指标 |
| app 层直连数据库 | 24 个文件 | 绕过领域服务，权限与审计难统一 |
| 记忆 | 1 张 `KernMemory` 表 + 191 行服务 | 审计文档已指出「主要是语义记忆，不像长期助理」 |

**重叠的概念族**（同一件事多个模块在管）：

- 对话 / 助理：assistant-runtime、advisor、muse、jarvis、response-format
- 执行：supervisor、workforce、worker、work、autopilot、automation-trace、schedule、playbooks、desktop-runtime
- 产品生命周期：products、product-development、product-rnd、production、launch、decisions、decision-intelligence、research
- 模型：model-control、model-gateway、cost-engine、usage
- 知识：knowledge、memory、evidence

## 3. 目标架构：五层、单向依赖

```text
L1 界面层      src/app 页面与 API 路由 —— 只调应用服务，不直连 prisma
L2 Kern 核心   对话 → 目标计划 → Supervisor（DAG、复核回退、预算、人工门）→ 注意力
L3 能力 / 领域 研究、知识、决策、产品生命周期（作为第一个「任务包」，不是核心）
L4 执行底座    worker（队列 / 定时 / 常驻）、ToolBroker（连接器、本机、网页、办公导出）、凭证、治理门
L5 平台        identity / tenant、model-gateway（含 control / cost / usage）、evidence / 审计 / 事件外发、db
```

规则：

- 只允许上层依赖下层；同层领域之间走事件（已有 business-events outbox）或注册表，不直接互相 import。
- **反转两条最关键的边**：
  - worker → supervisor：worker 只认「任务类型 → 处理器」注册表，由 supervisor 注册自己。
  - supervisor ↔ assistant-runtime：抽出 `kern-contracts`（纯类型 + 端口），两边都只依赖它。
- 产品生命周期模块合并为 `product/` 一个领域（子目录保留），对外只暴露服务与事件；它是 Chief of Staff 的一个任务包，而不是核心。
- **不做一次性大重构**：加一个分层守卫测试（同 LB / motion-contract 的做法），把现有违规记为基线，**只许减少、不许新增**；每次动到相关文件顺手还一条。

## 4. 个人助理方向：对照 0xCodila 的框架

他的核心主张（Grok Bot 5 步 + 自管理智能体 + Jev）：**你定任务与红线，Chief 负责拆解和委派，最小团队执行，Reviewer 精确打回，记忆保存纠正，三次连续成功后才自动化，每周复盘自我改进；目标不是最大自主，而是「权限受控的可靠自主」。**

| 他的要素 | Kern 现状 | 缺口 | 建议 |
|---|---|---|---|
| 任务契约 7 项：结果、输入、产出、频率、完成标准、约束、审批门 | goal-plan / plan 有验收字段雏形 | 不是一等对象；长任务开跑前没有让用户确认「什么算完成」；「好 / 专业」这类词没有被改写成可检查的条件 | KX-72 |
| Chief 负责拆解、委派、保上下文、检查交接 | Supervisor + goal-plan 已是 runtime owner | 与 assistant-runtime 互相依赖，边界不清 | KX-71 |
| 最小团队 + 专员章程（角色→输入→动作→产出→验收→交接） | 专员仍以硬编码为主（审计 P1） | 交接格式不统一：目标 / 产物 / 证据 / 状态 / 阻塞 / 下一步 | KX-72 |
| 绿 / 黄 / 红三级权限 | ✅ 受保护动作、KX-35 本机命令分级、KX-61 连接器三档、KX-31b 写操作单次凭据 | 已比文章严谨；只差在界面上把三档说清楚 | — |
| 工具先只读，别先接支付 / 密码 / 生产库 | ✅ KX-61 默认只读，凭证只注入不回显 | — | — |
| 看一遍就学会流程，并教异常分支 | 🟨 KX-36 把成功链路沉淀为做法 | 只存顺利路径；没有「来源不可信 / 文档冲突 / 工具不可用 / 被打回」的分支 | KX-74 |
| 图而非链：Reviewer 精确打回、三轮后上报 | ✅ QA revision loop + `maxRevisionRounds` + `revisionFeedback` | 打回时要指向具体失败的验收条，且只退给能修的专员 | KX-72 顺带 |
| **三次连续成功才自动化** | ❌ 做法和定时互相独立 | 需要「做法 → 定时」的毕业规则 | KX-74 |
| **5 个结果指标** | ❌ evaluation-harness 只在测试里用 | 完成率、人工介入、返工轮数、到结果耗时、单次成本（事件里已有原始数据） | KX-73 |
| **每周复盘，提出章程 / 记忆 / 做法修改，经批准才生效** | ❌ | 可复用 KX-34 定时 + 「需要你」审批 | KX-75 |
| 记忆：自动记下纠正，目录式按需加载 | 🟨 KX-51b 把提问答案写进记忆 | 需要程序性记忆（纠正、偏好）+ 情景记忆（做过什么）；检索按主题取片段，不整包塞进提示词 | KX-75 |
| 提示缓存：静态前缀固定顺序，日期等易变内容放后面 | persona.ts 未见日期拼接（其他拼接点未全查） | 没有守卫；换模型 / 改工具顺序会悄悄让缓存失效 | KX-76 |
| Jev：把「下一步派谁 / 证据够不够 / 能否交付」交给小模型做带概率的选择题 | router.ts 规则 + 规划模型 | 小判断混在大模型调用里，无法单独计价、审计、替换 | KX-76（可选） |
| 子智能体过滤噪音，只回一句结论 | 🟨 KX-50 工具循环 | 工具长输出要先摘要再回主线程 | KX-76 顺带 |
| 24/7 常驻、定时、主动 | ✅ KX-34a / 34b、KX-64 通知 | — | — |
| 云电脑 / 自研路由模型 | 不做 | 超出范围 | — |

**方向风险**：Kern 同时是「个人 Chief of Staff」和「产品研发 OS」。产品生命周期相关的 5 个模块合计约 1 万行，是 PM 专用的。建议明确主次：**核心 = Chief of Staff；Product OS = 第一个任务包 / 做法领域**，否则每个新能力都要在两套心智之间折中。

## 5. 建议任务（待用户确认后写入路线图 §7）

| ID | 任务 | 线 | 依赖 | 风险 | 验收 |
|---|---|---|---|---|---|
| KX-70 | 分层守卫（基线 + 只许减少）+ 删除 5 个空壳模块 | A | KX-66 收尾 | 低 | `tests/architecture-layers.test.ts` 进 source-guards；tsc / 全量回归通过 |
| KX-71 | 拆 9 模块大环：worker 处理器注册表、`kern-contracts` 反转 supervisor ↔ assistant-runtime | A | KX-70 | 中 | 强连通分量 ≤ 3；test:sweep 全绿 |
| KX-72 | 任务契约一等化（7 项 + 可检查的完成标准）+ 统一交接格式；Reviewer 按条打回 | C | KX-71 | 中 | 长任务开跑前出契约卡；打回记录指向具体条目 |
| KX-73 | 结果指标：5 项指标由现有事件计算，工作台展示；evaluation-harness 进产品 | C | KX-72 | 低 | 指标与真实库回归一致 |
| KX-74 | 三次连续成功才毕业：做法 → 定时；做法记录异常分支 | C | KX-73 | 中 | 未满 3 次不能开定时；有测试 |
| KX-75 | 记忆 v2（程序性 + 情景，按主题检索）+ 每周复盘提案（经批准生效） | C | KX-74 | 中 | 同类纠正第二次不再出现（回归用例） |
| KX-76 | 提示缓存纪律守卫（静态前缀稳定）+ 可选：小判断走小模型选择题 | C | KX-66 | 低 | 同一会话两次调用的前缀哈希一致 |
| KX-77 | app 层去直连数据库（24 个文件，按基线逐步还） | A | KX-70 | 低 | 基线数只减不增 |

建议顺序：**KX-66 收尾 → KX-70 → KX-72 / KX-73（先让「放手」有依据）→ KX-74 / KX-75 → KX-71（有守卫兜底后再拆环）→ KX-76 / KX-77**。前端 B 线（KX-21 ~ 26）可与之并行。

## 6. 参考

- 0xCodila：Grok Bot Agents（5 步 Chief-of-Staff 智能体图）、Build self-managed agent system（上下文出窗口、子智能体、自动记忆、缓存纪律）、Jev Engineering（System One 选择题模型，分离智能与执行）、Loop / Graph Engineering。
- 仓库内：`docs/KERN_ARCHITECTURE_V2.md`、`docs/KERN_SYSTEM_MAP_AUDIT_2026-09-26.md`、`docs/mcp-astron-agent-reference.md`、`docs/mcp-kern-experience-roadmap.md`。
