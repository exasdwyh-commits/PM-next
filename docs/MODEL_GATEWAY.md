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
