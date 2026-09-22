# Model Gateway Core

日期：2026-09-22

## 目标

Hermes 不绑定任何一家模型厂商。

Agent 定义“职位、职责、Skills、工具权限和业务边界”；Model Gateway 决定某次任务实际使用哪个模型。

```text
Agent / Advisor / Autopilot
        ↓
     TaskClass
        ↓
    ModelPolicy
        ↓
    ModelGateway
        ↓
┌────────┼─────────┬────────┐
GPT    Agnes      Qwen     Local
└────────┴─────────┴────────┘
```

## 核心原则

1. 业务代码不得直接调用具体模型厂商；
2. Agent 不永久绑定 provider/modelId；
3. ModelPolicy 显式列出候选顺序，禁止静默升级到策略外模型；
4. 每个 ModelProfile 描述能力、成本档、延迟档、本地/云端、健康状态；
5. 私密任务可设置 cloudAllowed=false；
6. Provider 失败只允许在同一策略候选中 fallback；
7. 模型调用结果以后独立记录 ModelRun，不能只依赖 AgentRun；
8. Governance 不因更换模型而改变。

## 第一版 TaskClass

- QUICK_CLASSIFY
- QUICK_RESEARCH
- WEB_RESEARCH
- SUMMARIZATION
- STRUCTURED_EXTRACTION
- PRODUCT_ANALYSIS
- STRATEGIC_CONSULTING
- RED_TEAM
- DECISION_REVIEW
- CODING

## 推荐初始策略

### Routine / 高频后台任务

优先：
- 免费或低成本快速模型（例如 Agnes 类）

Fallback：
- 通用快速云模型

### Strategic / 咨询 / 产品经理工作

优先：
- Frontier GPT 类模型

Fallback：
- 其它高质量 Reasoning 模型

### Red Team / 高风险复核

要求：
- REASONING
- STRUCTURED_OUTPUT（可用时）
- 不以“免费”作为首要路由条件

### Private Local

- cloudAllowed=false
- 只允许 LOCAL profile

## 当前阶段

本 PR 只建设纯 Model Gateway 内核，不改变现有 Advisor 行为。

下一阶段：
1. 将现有 AdvisorLLMClient 包装为 provider plugin；
2. 新增 ModelProfile / ModelPolicy / ModelRun 持久化；
3. Workforce 收口后把 Agent.provider/modelId 改成 modelPolicyId；
4. AgentRun 保留实际 provider/modelId 历史；
5. 设置页增加 Provider / Profile / Policy 管理。


## Runtime Health / Circuit Breaker

Model Gateway V2 增加运行期健康隔离：

- `RATE_LIMIT`：立即进入短 cooldown，可在显式 ModelPolicy 候选中 fallback；
- `AUTH`：立即进入较长 cooldown，等待配置修复；
- `TIMEOUT / SERVICE_UNAVAILABLE / TRANSIENT / UNKNOWN`：达到连续失败阈值后 cooldown；
- `BAD_REQUEST`：视为请求契约问题，不记坏模型健康，也不 fallback；
- `CONTENT_POLICY`：禁止通过切换模型绕过内容策略；
- `CONFIG`：启用 Profile 却没有 Provider 插件时 fail closed，禁止静默烧其它模型。

任何 fallback 都必须仍在 ModelPolicy 的候选列表中。

### 当前实现边界

V2 的 `InMemoryModelHealthStore` 是**单进程运行时实现**，用于先验证状态机与行为契约；
它不声称提供跨实例共享健康状态。

接口已经异步抽象为 `ModelHealthStore`，未来部署多实例 Runtime 时可替换为
PostgreSQL / Redis 实现，而不改变 ModelGateway 和业务层调用方式。

### 为什么不把所有失败都算坏模型

下列失败主要是请求本身的问题：

- BAD_REQUEST
- CONTENT_POLICY
- CONFIG

若把它们累计进 provider failure streak，会错误地把“某个请求不合法”解释成
“整个模型服务不健康”，导致正常任务也被熔断。

因此 Hermes 将**任务错误**与**模型可用性错误**分开。
