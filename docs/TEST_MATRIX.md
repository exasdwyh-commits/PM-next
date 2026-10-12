# 测试矩阵

本文件是 `test:*` 脚本归属的**唯一事实表**：`package.json` 里的每一个测试脚本
都必须且只能属于下面四个档位中的一个。新增脚本时请同步登记，否则视为未验收。

> 口径：档位按「是否需要真实数据库 / 网络 / 大模型」与「是否已进 CI」划分，
> 由静态分析得出（见每档的判定标准）。**尚未用实测耗时校准**，
> 校准动作见文末「待办」。

## 档位定义

| 档位 | 触发时机 | 判定标准 |
|---|---|---|
| **Gate** | 每个 PR | 无外部依赖、秒级到分钟级、覆盖治理 / 证据 / 安全 / 契约 |
| **Nightly** | 每日定时 + 发布前 | 需要 Postgres service、真实 HTTP 服务、或大模型调用 |
| **Weekly** | 每周定时 | 全量回归，耗时长，不进 PR 门禁 |
| **归档 / 别名** | 不单独跑 | 已被取代，或只是其它脚本的聚合入口 |

## 分布

| 档位 | 数量 |
|---|---:|
| Gate（已进 CI） | 68 |
| Gate 候选（游离，建议补进 CI） | 3 |
| Nightly | 39 |
| Weekly | 2 |
| 归档 / 别名 | 2 |
| **合计** | **114** |

## 一、Gate — 已进 CI（68）

按工作流分组：

### `autopilot-ci.yml`

- `test:autopilot`

### `business-event-ci.yml`

- `test:business-events`

### `core-ux-ci.yml`

- `test:frontend-v3`
- `test:healthcare-innovation`
- `test:home-experience`
- `test:kern-project-map`
- `test:report-format`
- `test:source-guards`
- `test:token-usage`

### `decision-ci.yml`

- `test:decision-run`
- `test:system-principal`

### `desktop-ci.yml`

- `test:desktop-runtime`

### `experience-ci.yml`

- `test:experience`
- `test:kern-autonomy`
- `test:kern-conversation-controls`
- `test:kern-goal-plan`
- `test:kern-project-map`
- `test:kern-runtime-architecture`
- `test:source-guards`
- `test:visual-intelligence`

### `golden-organization-ci.yml`

- `test:golden-org`

### `governance-ci.yml`

- `test:g2`
- `test:g3`
- `test:gate-boundaries`
- `test:governance`
- `test:research-snapshot`
- `test:structured`

### `kern-supervisor-ci.yml`

- `test:execution-abort`
- `test:golden-org`
- `test:kern-brief`
- `test:kern-execution-control`
- `test:kern-execution-delivery`
- `test:kern-memory-quota`
- `test:kern-message-execution`
- `test:kern-mission-controls`
- `test:kern-node-ask`
- `test:kern-readiness`
- `test:kern-supervisor`
- `test:kern-supervisor-plan`
- `test:kern-takeaway`
- `test:local-login`
- `test:metaso`
- `test:model-call-quota`
- `test:model-cancellation`
- `test:model-execution-facts`
- `test:provider-attempt-quota`
- `test:research-lineage`
- `test:response-format`
- `test:worker-failure-cleanup`
- `test:worker-fairness`
- `test:worker-heartbeat`
- `test:worker-r2-boundaries`
- `test:worker-r3-boundaries`
- `test:worker-review-probes`
- `test:workforce`

### `product-rnd-delivery-ci.yml`

- `test:product-rnd-e2e`
- `test:product-rnd-fusion`
- `test:qa-dedup`
- `test:qa-retry`
- `test:worker`

### `quality-ci.yml`

- `test:channel-routes`
- `test:decision-intelligence`
- `test:desktop-runtime`
- `test:frontend-v3`
- `test:fusion-core`
- `test:golden`
- `test:harness`
- `test:healthcare-innovation`
- `test:kern-project-map`
- `test:launch-auth`
- `test:model-control`
- `test:model-gateway`
- `test:model-runtime`
- `test:potential`
- `test:report-format`
- `test:token-usage`
- `test:validation-decision`

### `workforce-ci.yml`

- `test:workforce`

## 二、Gate 候选 — 游离但应当进门禁（3）

这三个脚本无外部依赖、实测可离线跑完，且覆盖治理 / 契约，属于「本该在门禁里」。

| 脚本 | 实测结果（2026-10-12） | 说明 |
|---|---|---|
| `test:architecture` | 12/12 通过 | 架构分层 + 提示词前缀静态守卫 |
| `test:mission-story` | 4/4 通过 | 任务叙事契约 |
| `test:tenant` | 11 项中 10 通过 / 1 失败 | 租户包契约；失败项是租户中立守卫，见「已知红灯」 |

## 三、Nightly — 需外部依赖（39）

以下脚本需要 Postgres / 真实 HTTP 服务 / 大模型，不适合放进 PR 门禁，
应放入带 Postgres service 的定时任务：

- `test:acceptance`
- `test:api-errors`
- `test:assistant-persona`
- `test:authz`
- `test:blueprint`
- `test:db`
- `test:evidence`
- `test:form-input-validation`
- `test:gate-boundaries-http`
- `test:http`
- `test:http-errors`
- `test:kern-connector-approval`
- `test:kern-conversation-manage`
- `test:kern-desktop-confirm`
- `test:kern-library`
- `test:kern-playbook`
- `test:kern-schedule`
- `test:kern-vault`
- `test:kern-worker-recovery`
- `test:launch-owner-candidates`
- `test:llm-e2e`
- `test:mobile-layout`
- `test:model-contracts`
- `test:model-scenarios`
- `test:opportunity`
- `test:p1`
- `test:partial`
- `test:product-center`
- `test:r1`
- `test:r2`
- `test:r3`
- `test:revision`
- `test:science`
- `test:signal`
- `test:ui`
- `test:ui-feedback`
- `test:ui-motion`
- `test:unknown-injection`
- `test:version-consistency`

## 四、Weekly — 全量回归（2）

- `test:regression-units` — node --import tsx --test tests/kern-capability-directory.test.ts tests/kern-task-contract.test.ts tests/kern-mission-met
- `test:sweep` — node scripts/run-sh.js scripts/run-test-sweep.sh

## 五、归档 / 别名（2）

这两条只是把其它脚本串起来跑，不产生独立断言，不应单独计入覆盖：

- `test:critical` → 聚合 4 个子脚本
- `test:delivery-contracts` → 聚合 10 个子脚本

## 六、已知红灯

| 脚本 | 状态 | 处理 |
|---|---|---|
| `test:tenant` | **失败**：`src/` 下 219 行命中行业词 | 已在治理计划中跟踪；守卫只能在违规消失后转绿，**不接受放宽守卫** |

除这一项外，本次盘点未发现其它「已知红但仍在仓库里」的测试。

## 待办（本表尚未完成的部分）

1. **实测校准耗时**：本表的档位由静态分析得出。跑一次全量 `test:sweep`，
   记录每个脚本的实际通过 / 失败 / 耗时，据此确认档位划分。
2. **建立 Nightly 工作流**：为上面 39 个脚本建一个带 Postgres service 的定时任务。
3. **补齐 Gate**：把「Gate 候选」三项加入 PR 门禁。
4. **清空归档档**：本表暂未列出被取代的脚本——需要一次逐项判定才能确认。
