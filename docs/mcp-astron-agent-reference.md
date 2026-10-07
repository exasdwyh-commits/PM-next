# Astron Agent 对照：Kern 个人助理可借鉴点

> 来源：https://github.com/iflytek/astron-agent（Apache-2.0，2026-09-23 版本，main 分支）。
> 只借鉴机制，不引入代码与依赖；Kern 仍是 TypeScript 单体，不拆 Python 微服务。

## 1. Astron 是什么

企业级 Agentic Workflow 平台：`core/` 下分 agent（chat / cot / cot_process 三种推理节点）、
workflow（DSL 引擎 + 27 类节点）、knowledge、memory、plugin（aitools / link / rpa）、tenant。
定位是「开发者搭流程」，与 Kern「用户只面对一个助理」相反，所以**不借它的画布与配置台**，只借运行时机制。

## 2. 值得借的 6 个机制

| # | Astron 机制 | 位置 | Kern 现状 | 借鉴方式 |
|---|---|---|---|---|
| A1 | 问答节点中断 / 恢复：`option` 或 `direct` 两种提问，恢复事件 `resume / ignore / abort`，带超时 | `workflow/engine/nodes/question_answer` | 只有任务开头一次 CLARIFY；执行中节点缺信息只能 BLOCKED 后整体升级 | 节点级 `node.ask` 事件：Agent 在执行中可暂停单个节点向用户提问（选项/自由），其余节点继续；用户可回答 / 忽略（按默认假设继续）/ 中止；超时自动按「忽略」处理并在结果里标注假设 |
| A2 | 统一流式回调：`on_node_start / process / interrupt / end`，每帧带 `progress` 与耗时，按节点有序输出 | `workflow/engine/callbacks/callback_handler.py` | `KernMissionEvent` + SSE 已有，但无 progress 数值与 interrupt 帧 | 事件补 `progress`（按依赖图已完成路径估算）与 `node.interrupt`；前端进度条用真实数值，不用计数 |
| A3 | CoT Process 推理节点：思考 → 工具调用 → 观察循环 | `agent/engine/nodes/cot_process` | generic-executor 只做单次 LLM 调用，Agent 不会用工具；`node.tool` 事件只有演示数据在发 | 给执行器加有上限的工具循环（最多 N 步），首批工具：知识库检索（已有 knowledge 模块）、网页检索、计算；每步发 `node.tool`，让「过程」页展示真实调用 |
| A4 | MCP 节点 + 插件：外部工具以 MCP 接入 | `workflow/engine/nodes/mcp`、`plugin/` | 无 | 工具注册表统一抽象（内置 + MCP），按组织开关；高风险工具（写外部系统、花钱）一律走 governance 审批 = 现有「受保护高风险操作」按钮 |
| A5 | 决策 / 条件 / 迭代 / 循环节点 | `nodes/decision`、`if_else`、`iteration`、`loop` | 计划是静态 DAG + QA 打回 | 只借「条件分支」：计划节点可带 `when`（如「合规结论=禁止 → 跳过营销」），由 Supervisor 判定并发 `node.skipped(reason)`；不做通用循环 |
| A6 | 出站安全：SSRF 防护（URL、解析地址、重定向、下载目标校验），追踪载荷压缩 | 2026-08/09 的 security 提交 | 网页检索工具尚未存在 | 做 A3 网页检索时同步做 SSRF 校验；长任务事件 payload 设上限并截断 |

## 3. 不借的

- 可视化流程画布、节点配置台、Bot 发布：与「用户只面对 Kern」冲突。
- RPA：个人助理场景当前无刚需，且不可逆操作风险高；等 A4 审批链稳定后再议。
- 多服务拆分（Python 微服务 + Casdoor）：本仓库 2GB 级开发机与单体架构不适合。

## 4. 建议任务（已并入路线图 §7，编号 KX-50–54；A4 并入既有 KX-31）

| ID | 内容 | 依赖 | 验收 |
|---|---|---|---|
| KX-51 | A1 节点级提问：`node.ask` / `node.answered` 事件、controls 增加 answer/ignore/abort、聊天内问题卡、超时按默认假设 | 现有 events / controls | 单测：一节点提问时其余节点继续；忽略后结果标注假设 |
| KX-53 | A2 真实进度 + interrupt 帧 | KX-51 | reducer 单测 + 进度条截图 |
| KX-50 | A3 工具循环 + 知识库检索 / 计算两件内置工具 | — | 过程页出现真实 `node.tool`；步数上限与失败降级单测 |
| KX-31 | A4 工具注册表 + MCP 客户端 + 高风险工具审批（并入既有连接器任务） | KX-30、KX-12 | 未审批的高风险工具调用被拦截并出现在「需要你」 |
| KX-52 | A6 网页检索工具 + SSRF 校验 | KX-50 | 内网地址、重定向到内网均被拒的单测 |
| KX-54 | A5 条件跳过 | — | 合规=禁止时营销节点被跳过且写明原因 |

建议顺序：先完成 KX-20 与修复线，再做 KX-50 → KX-51 → KX-52，最后 KX-53、KX-54。
理由：工具循环（KX-50）是「Agent 真的在干活」的前提，收益最大；节点级提问（KX-51）直接提升「只在需要时打扰」。
