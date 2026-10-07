# KX-50 工具循环

## 为什么做

以前执行器每个节点只调用一次模型，模型只能凭上下文空想。结果是数字全靠推断，也用不上公司知识库。现在专家节点和红队节点可以自己查资料、做计算，再给出结论。

## 保留什么、替换什么

- **保留**：模型网关、演示模式、测试替身 `setMissionModelInvokerForTest`，以及节点结果格式。
- **替换**：`runMissionNodeAgent` 里原来的单次 `invoker(...)`，在 SPECIALIST / RED_TEAM 节点上换成 `runToolLoop`。
- **不改**：QA 和综合节点不使用工具，演示模式也不走工具循环。

## 协议（`src/modules/supervisor/tools.ts`）

- 模型在回复中输出一个 kern-tool 代码块，内容是 JSON：`{"tool":"calculate","input":{"expression":"199*0.4"}}`。
- 执行器运行工具后，把结果作为 user 消息回喂给模型。回复里不含工具块时，就当作最终答案。
- 每个节点最多调用 `MAX_TOOL_STEPS = 4` 次工具。最后一次工具结果要求模型直接给答案；若模型仍请求工具，节点明确标记 `OUTPUT_INCOMPLETE:TOOL_LIMIT` 并停下，保留工具记录，不能当作完成。
- 未知工具、JSON 非法、工具抛错，都作为观察结果回喂给模型，不会让节点失败。
- 模型返回空内容，或格式整理后没有可显示内容，节点标记 `OUTPUT_INCOMPLETE:EMPTY_OUTPUT`；结果回到原会话，说明重跑方式。
- 内置工具：
  - `knowledge_search`：检索公司事实和知识库（`searchKnowledge`，limit 5）。
  - `calculate`：安全的算式解析器，不使用 eval。单项输入 `expression`；多方案测算可输入 `expressions` 字符串数组，一次最多八项，减少重复模型往返。批量输入仍拒绝非法算式、除零与超量项。

## 事件

- 每次模型调用：`node.tool {tool:"model_call", ok, latencyMs, provider, model, modelRunId}`。
- 每次工具调用：`node.tool {tool, ok, step, input(≤300), output(≤800), latencyMs}`。
- 知识命中：`node.cite {title, ref, url:null}`。
- 节点结果：`toolCalls[]` 和 `modelCalls`，只在确实用过工具时写入。

## 界面

- `mission-timeline.ts`：LaneAttempt 新增 `toolCalls`，时间线文案为「使用工具：知识库检索「…」」。
- 过程页 kv 列表：工具默认一行摘要，展开后看结果。

## 验证

- `tests/kern-tool-loop.test.ts`（TL1–TL8）已加入 `test:regression-units`。
- 已有的 supervisor / mission-controls / brief / takeaway 回归测试全部通过：这些测试的替身不输出工具块，所以事件序列和改动前一致。

## 风险

- 真实模型可能不按协议输出工具块。这种情况下行为退化为单次调用，不会报错。
- 工具步骤会让节点耗时和模型费用增加，最多 5 倍。配额按任务计，不按调用次数计。
