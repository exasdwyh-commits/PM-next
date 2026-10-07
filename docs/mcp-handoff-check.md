# 接手核对（2026-09-29）

> 新 agent 接手时按交接说明逐条核对的结果。只读核对 + 本地校验，没有改动源码、没有提交。
> 事实以代码 / 数据库 / 测试为准。

## 1. 仓库状态

- 分支 `feat/kern-experience`，HEAD `540e650 [KX-64] 浏览器系统通知`，与 `docs/mcp-kern-experience-roadmap.md` §10 最后一条一致。
- stash 为空；未推送（机密阶段，只在本地提交）。
- **KX-65 尚未提交**，工作区里的相关改动：

| 文件 | 状态 | 说明 |
|---|---|---|
| `src/modules/model-gateway/provider-runtime.ts` | 已修改 | 空 content 由 CONFIG 改判 TRANSIENT |
| `src/modules/supervisor/tools.ts` | 已修改 | `parseToolCall` 兼容 XML `<tool_call>` 与无围栏 `kern-tool` |
| `tests/tool-call-formats.test.ts` | 未跟踪 | 7 个用例；**尚未接入任何 npm 脚本** |
| `scripts/dev-demo-setup.ts` | 未跟踪 | 演示数据脚本（只连 `_dev` 库，幂等，不含密钥） |
| `docs/mcp-kx65-dev-models-demo.md` | 未跟踪 | KX-65 文档 |
| `scripts/_kx60~65-*.mjs`（10 个） | 未跟踪 | 本地临时脚本（截图 / 驱动 / 诊断），含演示账号 |
| `.env.bak-kx65` | 未跟踪 | 环境备份，含密钥，不能提交 |

## 2. 与交接说明不一致的地方

| 项 | 交接说明 | 实际 |
|---|---|---|
| authz 基线 | 86 路由 / 121 方法 | `tests/acceptance-authz-matrix.test.ts` 中 `BASELINE_ROUTES = 90`、`BASELINE_METHODS = 125`（KX-64 之后） |
| 路线图 §7 任务表 | — | 没有 KX-38、KX-60 ~ KX-65 的行，只在 §10 日志里有；KX-65 日志也还没写 |
| 路线图头部 | — | 「最后更新」仍是 2026-09-28 |
| KX-65 验收 | 文档写「修复后重跑的结果见最终报告」 | 仓库内没有找到这份报告；下面第 4 节用数据库记录补了证据 |

## 3. 本地校验（针对未提交的 KX-65 改动）

| 检查 | 结果 |
|---|---|
| `npx tsc --noEmit -p .` | 0 错误 |
| eslint（两个改动文件 + 新测试 + dev-demo-setup） | 0 问题 |
| `node --import tsx --test tests/tool-call-formats.test.ts` | 7 / 7 |
| `npm run test:kern-autonomy` | 16 / 16 |
| `npm run test:delivery-contracts`（含 model-runtime） | 8 个子套件全过 |
| 测试里对 `missing non-empty` / CONFIG 的文本断言 | 无，改判不影响现有断言 |

## 4. 模型接入现状（数据库只读统计，近 48 小时 ModelRun）

| provider | model | 成功 | 失败 |
|---|---|---|---|
| kern-gateway | glm-5.3 | 35 | 2 |
| kern-gateway | gpt-5.5 | 7 | 0 |
| mimo | mimo-v2.6-pro | 19 | 0 |
| agnes | agnes-3.0-flash | 1 | 0 |

- 另有 1 条 provider / model 为空、状态 RUNNING 的记录，疑似中断遗留，需排查是否会被孤儿接管。
- agnes 只跑过 1 次，routine-* 路由覆盖不足。
- `.env` 中已配置的模型位（只看键名，不看值）：KERN_GATEWAY、AGNES、MIMO、MUSE_LOCAL，以及 ADVISOR_LLM、LAYA。

## 5. 下一步建议

### KX-65 收尾（本地提交）

1. `tests/tool-call-formats.test.ts` 接入 `test:regression-units`。
2. 路线图补 §7 行（KX-38、KX-60 ~ KX-65）、§10 日志、头部日期；交接里的 authz 基线更正为 90 / 125。
3. `[KX-65]` 提交，只 `git add` 源码、测试、`dev-demo-setup.ts`、文档、`package.json`；不提交 `.env.bak-kx65` 和 `scripts/_*.mjs`。

### KX-66 接入大模型的分层测试

| 层 | 内容 | 依赖真实模型 | 产出 |
|---|---|---|---|
| L1 契约 | 扩展 mock LLM：MiMo XML 工具调用、推理模型空 content、超时 / 429 / 5xx、超长输出，断言重试、fallback 与错误分类 | 否 | 可离线重跑的回归，纳入 CI |
| L2 示例 | 把 `_kx65-drive` 规范成场景脚本：普通对话、工具检索、完整产品研发任务、节点提问、连接器写审批、Office 导出、定时重跑；用 mock 与 dev 模型各跑一遍 | 可选 | 场景清单 + 每步事件 / 耗时报告 |
| L3 真实 | 四个云端模型按路由策略跑 L2 场景集，统计成功率、fallback 次数、耗时、QA 打回率，对比模型并做失败归因 | 是（会产生 API 调用费用） | `docs/mcp-kx66-model-eval.md` + 可重跑脚本 |

## 6. 需要用户确认

1. `scripts/_kx60~65-*.mjs` 这批本地脚本是否也永远不提交（与 `_restore-env.sh` 等同处理）。
2. KX-65 是否按第 5 节收尾并本地提交。
3. L3 真实测试的调用量 / 费用上限，以及是否每个场景都跑四个模型。
