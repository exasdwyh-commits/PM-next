# KX-65 dev 多模型接入与演示数据

## 目标

在 dev 环境接入真实云端模型（Kern Gateway / Agnes / MiMo），生成可演示的数据，并用真实对话与真实任务验证接入是否顺畅。

## 演示数据

- 脚本：`scripts/dev-demo-setup.ts`（幂等，可重复执行；不会 TRUNCATE，不同于 `prisma/seed.ts`）。
- 目标组织：`zhang_pm@hermes.test` 所在组织（该账号也是组织管理员）。
- 结果：13 个 Agent；启用 4 个 CLOUD 模型档案，改写 11 条路由策略。

| 模型档案 | 模型 | 用途 |
|---|---|---|
| dev-gateway-glm | glm-5.3 | 对话 / 规划 / 汇总（首选） |
| dev-agnes-flash | agnes flash | routine-* 轻量任务 |
| dev-mimo-pro | mimo-v2.6-pro | 战略分析 / 咨询 / 技术架构 |
| dev-gateway-gpt55 | gpt-5.5 | 红队 / 决策复核 / QA |

治理说明：dev 的常驻（resident）策略打开了 `cloudAllowed`，这是一个治理开关，只用于 dev 演示；生产部署按客户数据政策决定是否允许云端模型。

密钥只写在本机 `.env`，不入库、不提交。

## 真实验证中发现并修复的问题

1. **MiMo 工具调用格式不兼容**（主要问题）。MiMo 按自己的原生格式输出工具调用（`<tool_call><function=knowledge_search><parameter=query>…`，或不带围栏的 `kern-tool` 加 JSON），Kern 只认 ```kern-tool 围栏，于是把工具调用文本当成了节点结论。QA 判定 REVISE，第二轮同样失败，最后预算耗尽、跳过汇总。
   修复：`src/modules/supervisor/tools.ts` 的 `parseToolCall` 兼容 XML `<tool_call>`（`function=工具名` 加 `parameter`、`function=kern-tool`、`<tool_call>` 内 JSON 使用 name/arguments），以及无围栏的 `kern-tool`。测试：`tests/tool-call-formats.test.ts`。
2. **推理模型返回空 content 被误判为 CONFIG**。glm-5.3 在长汇总时把 max_tokens 耗在思考上，content 为空，被归为 CONFIG（配置错误，禁止 fallback）。
   修复：`provider-runtime.ts` 把这种情况改判为 TRANSIENT，允许重试和 fallback。dev `.env` 的 Gateway max_tokens 从 4096 调到 8192，超时从 90s 调到 150s；MiMo 超时调到 180s。

## 验收

- 普通对话：glm-5.3 回复，planning 和 dialogue 两步都 SUCCEEDED。
- 完整任务：四个模型都按策略路由；修复后重跑的结果见最终报告。
