# KX-66 大模型分层测试（日常只用免费的 agnes flash）

> 状态：✅（2026-09-29）。依赖 KX-65。用户决定：日常与真实测试默认只用 `agnes-3.0-flash`（`dev-agnes-flash`），付费模型只在明确要求时跑。

## 1. 三层测试

| 层 | 命令 | 连什么 | 花钱 | 说明 |
|---|---|---|---|---|
| L1 契约 | `npm run test:model-contracts` | 本机 mock 端点 | 否 | 15 个用例，已接入 `test:regression-units` 与 `test:model-runtime` |
| L2 示例场景 | `npm run test:model-scenarios` | dev 服务器 + 开发库 | 只用免费档 | 对话 / 知识库对话 / 完整任务 / 三种导出 |
| L3 真实模型 | 同 L2 | agnes 免费档 | 否 | 报告写到 `outputs/kx66/<时间>/report.{json,md}`（已被 .gitignore 忽略） |

### L1：`tests/kern-model-contracts.test.ts`

在 127.0.0.1 起 OpenAI 兼容 mock，按 model id 返回各家真实遇到过的形态，走真实 HTTP → provider-runtime → ModelGateway：

- MC1 请求契约：`/chat/completions`、模型名、`max_tokens`、鉴权头；无 key 不带鉴权头。
- MC2 推理模型空 content / null content → TRANSIENT，可 fallback。
- MC3 MiMo 原生 XML 工具调用原文透传，`parseToolCall` 能识别。
- MC4 429 → RATE_LIMIT：有其他候选时立即 fallback，主候选立即冷却。
- MC5 5xx / 200 但返回 HTML / 超时 → 可 fallback。
- MC6 401 → AUTH：长冷却（≥15 分钟），错误信息不回显密钥。
- MC7 内容安全 / 请求契约错误 / 超长输出 → 禁止 fallback。
- MC8 全部失败：抛 `ModelGatewayExecutionError`，保留每次尝试的分类。
- MC9–MC15 只剩一个候选时的限流处理（见 §3）与 `Retry-After` 解析。

### L2 / L3：`scripts/kx-model-scenarios.ts`

```bash
npm run dev:models            # 默认 free：只用 agnes；--mode=full 恢复 KX-65 四模型路由
npm run dev                   # :3100
npm run worker:supervised     # 任务场景需要
npm run test:model-scenarios  # 可加 -- --only=chat,mission  --allow-providers=agnes  --mission-timeout-min=20
```

- 只允许对 `_dev` 库运行；口令从 `DEV_LOGIN_PASSWORD` / `SEED_PASSWORD` / `.env` 读取，不打印不落盘。
- 检查项：HTTP 2xx、回复非空、**回复来自模型而不是确定性回落**、没有把工具调用原文当回复、任务在时限内结束且结果为 COMPLETED、没有失败节点、事件里没有残留 `<tool_call>`、导出 HTTP 200 且 SHA-256 与 `X-Kern-SHA256` 一致。
- 报告：按任务类型 / provider / 模型统计成功、失败、p50 / p95，换模型 fallback 次数，429 次数与等待重试次数，失败明细，超时未结束的 ModelRun。
- 退出码：0 通过；1 有场景失败；2 出现不在允许清单里的 provider（可能产生了付费调用）。

## 2. free 模式（`scripts/dev-demo-setup.ts`）

- 付费模型位一律停用；agnes 标为 FREE。
- 11 条策略只保留 `dev-agnes-flash` 一个候选，允许云端。
- agnes 不具备的能力要求（REASONING）在开发库里临时放宽，逐条打印；`--mode=full` 恢复。
- 策略行写入 `failurePolicy = { rateLimitCooldownMs: 10s, rateLimitRetries: 5, rateLimitMaxWaitMs: 120s }`；full 模式清空。
  （2026-10-03 从 3 次 / 45s 放宽：kx66 2026-09-30 报告显示 synthesis 在并发节点下吃满限流仍失败。）
- 已知缺口：Tech Architect 的 CODING 调用在请求级要求 REASONING（`executor.ts`），free 模式下会被路由拒绝。

## 3. 实测发现与修复

| 发现 | 处理 |
|---|---|
| agnes 免费档约每分钟 10 次，超出返回 429；free 模式只有一个候选，429 后冷却 60 秒，期间所有调用直接失败，对话退回模板、任务简报出不来 | 网关：只剩一个候选时，429 按 `Retry-After`（没有就 5s → 10s → 20s 退避）在同一模型上有限重试，重试用完才冷却；路由时所有候选都处于**限流**冷却且冷却在预算内结束，就等到结束再走。有其他候选时行为不变。默认 2 次 / 20 秒；鉴权冷却、停用、缺能力不等 |
| 持久化策略的 `failurePolicy` 列从未被读取 | `resolveGatewayPolicyForAgent` 读取该列（可只写部分字段，非法值整体回落默认） |
| agnes 默认 30 秒超时，红队 / 综合等长输出超时 | 经用户同意，`.env` 追加 `MODEL_PROVIDER_AGNES_TIMEOUT_MS=120000` |
| 模型调用失败时回复写「当前尚未接入语言模型」，与事实不符 | 改为「这一轮没有拿到语言模型的回复……」 |
| 场景触发：普通「市场分析」不会升级为任务 | 场景改用命中 NEW_PRODUCT 剧本的说法（见 `decideMissionLaunch`） |
| `.env.bak-kx65`（含密钥）未被忽略 | `.gitignore` 增加 `.env.bak*` |

改动文件：`src/modules/model-gateway/{types,health,provider-runtime,gateway}.ts`、`src/modules/model-control/service.ts`、`src/modules/assistant-runtime/capabilities/knowledge.ts`、`scripts/dev-demo-setup.ts`、`scripts/kx-model-scenarios.ts`、`tests/kern-model-contracts.test.ts`、`package.json`（`test:model-contracts`、`test:model-scenarios`、`dev:models`）、`.gitignore`。

## 4. 实跑结果（2026-09-29，free 模式）

最后一次全量：对话、知识库对话、导出 ✅；任务 12.4 分钟结束，结果 COMPLETED，9 个节点中 8 个成功。模型调用 74 次，全部 agnes，无付费调用；429 共 3 次，全部等待重试后成功。

未通过项：合规节点失败——agnes 连续两次 429 后返回 HTTP 500（「请求上游失败」），5xx 不在同模型重试范围内。用户决定这部分暂不处理，以下只记录：

- 单候选时 5xx 是否也在同模型重试一次（未做）。
- 节点失败时 `node.finished` 事件的 `reason` 为空，原因只在 AgentRun.errorReason 里（未做）。

## 5. 校验

`tsc` 0、eslint 0；`test:model-contracts` 15 / 15、`test:model-gateway` 9 / 9、`test:model-control` 6 / 6、`test:regression-units` 250 / 250、`test:kern-autonomy` 16 / 16、`test:delivery-contracts` 8 组全绿。
