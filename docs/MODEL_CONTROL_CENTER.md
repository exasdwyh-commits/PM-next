# Model Control Center V1

日期：2026-09-22

## 目标

把 Model Gateway 从“代码里的路由内核”推进到“组织可配置的模型控制平面”。

V1 解决四件事：

1. Model Profile 持久化：记录 provider、modelId、能力、成本档、延迟档、本地/云端和启用状态；
2. Model Policy 持久化：按 TaskClass 明确候选模型顺序、最低能力和 cloudAllowed；
3. Agent × TaskClass 绑定：同一个 Agent 可以在不同任务上使用不同策略；
4. 设置页配置：安装官方模板、编辑 Profile、创建自定义 Profile / Policy、绑定 Agent。

## 为什么不是 Agent = 一个模型

Hermes 的 Agent 是长期角色，模型是可替换执行能力。

同一个 Product Agent 可能：

- 日常分类走低成本快速模型；
- 产品潜力分析走 Frontier reasoning；
- 敏感资料提取走本地模型；
- 重大判断再交给 Red Team 策略复核。

因此 V1 使用：

```text
Agent
  × TaskClass
      ↓
ModelPolicy
      ↓
ordered ModelProfile candidates
      ↓
Model Gateway
```

而不是把 provider/modelId 永久写死在 Agent 上。

## 官方模板

官方模板只提供“策略骨架”，不猜当前具体模型是否可用：

- 日常低成本执行位：建议 Agnes 或同级快速低成本模型；
- 核心产品研发位：Frontier reasoning；
- 红队复核位：高质量推理优先；
- 私密本地执行位：LOCAL only。

所有 Profile 初始都是：

- provider = UNCONFIGURED
- modelId = UNCONFIGURED
- enabled = false

因此安装模板不会产生真实 API 调用，也不会静默产生费用。

## 密钥边界

V1 **不把 API Key 写进数据库**。

数据库只保存：

- provider 标识；
- modelId；
- 路由和能力元数据；
- Agent 绑定。

认证信息继续由：

- 环境变量；
- 部署平台 Secret；
- 后续 Secret Provider

承载。

设置页也不会显示或读取明文 API Key。

## 安全与费用原则

1. 未配置 Profile 不可启用；
2. cloudAllowed=false 的 Policy 只能引用 LOCAL Profile；
3. Policy 只能在显式候选列表中 fallback；
4. Strategic / Red Team 官方策略要求 REASONING；
5. 官方模板安装不会覆盖已经填写的 provider/modelId；
6. 自定义 Policy 引用不存在的 Profile 时拒绝保存；
7. Agent 绑定的 TaskClass 必须与 Policy 的 TaskClass 一致。

## 当前边界

V1 是 **configuration plane**。

现有 Advisor 的 OpenAI-compatible 调用路径暂时保持不变，原因是：

- Provider plugin 还没有全部接入 ModelRegistry；
- 还没有 ModelRun 持久化；
- 不能在配置中心刚出现时就把稳定运行路径切过去。

下一阶段是 Model Control V2：

1. 将现有 AdvisorLLMClient 包装为 ModelProviderPlugin；
2. 从 Agent × TaskClass 绑定解析 ModelPolicy；
3. ModelGateway 执行真实调用；
4. 新增 ModelRun 持久化，记录 policy/profile/provider/modelId/usage/attempts；
5. 再把 AgentRun.provider/modelId 变成执行结果，而不是预先配置；
6. 加入成本预算与组织级月度限额，但未知价格不编造费用。

## 与 Mixture of Agents 的关系

MoA 不应该等于“每次都并发调用多个贵模型”。

后续建议把它作为显式的高价值策略：

```text
Strategic task
  ↓
Primary analysis
  ↓
Independent challenger
  ↓
Synthesis / decision review
```

只有 PRODUCT_ANALYSIS / STRATEGIC_CONSULTING / RED_TEAM / DECISION_REVIEW 等高价值任务允许进入，
并且每个阶段仍受自己的 ModelPolicy、预算和 Governance 约束。


## Runtime V2：真实调用如何接通

Model Control Center 只保存非秘密路由元数据。Provider 运行时由部署环境显式提供。

假设 Profile.provider = `agnes`，运行时读取：

```bash
MODEL_PROVIDER_AGNES_BASE_URL=https://your-openai-compatible-endpoint/v1
MODEL_PROVIDER_AGNES_API_KEY=...
MODEL_PROVIDER_AGNES_TIMEOUT_MS=30000
MODEL_PROVIDER_AGNES_MAX_TOKENS=1024
MODEL_PROVIDER_AGNES_TEMPERATURE=0.2
```

Provider 名会转换为大写环境变量 token，非字母数字字符转换为下划线。例如：

- `deepseek` → `MODEL_PROVIDER_DEEPSEEK_*`
- `local-vllm` → `MODEL_PROVIDER_LOCAL_VLLM_*`

没有对应 `BASE_URL` 时，设置页显示 `Runtime missing`；即便 Profile 元数据存在，也不会假装可调用。

### 旧 Advisor 兼容桥

旧的 `ADVISOR_LLM_*` 继续保留，但只在当前任务**没有 Model Control 绑定**时使用。

一旦存在 Agent × TaskClass 绑定，Model Control 就是权威路径：

- Profile 未启用 → 使用确定性工具，不偷跑旧模型；
- Provider Runtime 缺失 → ModelRun 记录 CONFIG 失败，不偷切其它隐藏模型；
- 模型失败 → 只按该 Policy 明确候选 fallback；
- Policy 全部失败 → 顾问回落确定性工具结果，业务数据仍可用。

### ModelRun

每次通过 Model Gateway 的真实模型执行会生成独立 ModelRun，记录：

- taskClass；
- policyKey / policyVersion；
- 实际 profileKey / provider / modelId；
- attempts；
- routingSkips；
- usage；
- errorReason；
- duration。

ModelRun 不保存 API Key，也不复制完整 prompt。业务上下文继续由 AgentRun / Message 管理，避免重复存储敏感文本。

### Advisor 的默认任务分流

- 普通状态解释 → Hermes PM / SUMMARIZATION；
- 知识检索解释 → Research Agent / QUICK_RESEARCH；
- 修改/建任务提议的语言解释 → Hermes PM / QUICK_CLASSIFY；
- 证伪挑战 → Red Team / RED_TEAM。

这意味着日常顾问不会默认占用 Frontier；只有明确的高价值任务才进入更强策略。
