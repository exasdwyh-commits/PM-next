# Kern → 可商业化的私人 Agent · 任务清单

目标形态（对标 Meta Muse 这类 personal agent，但聚焦“做产品的人”）：
像发消息一样交代目标 → Kern 在后台持续干活（关掉页面也继续）→ 有变化或需要批准时回来找你 →
从对话和结果中学习你 → 每天主动给你一份“今天”简报。免费档可用，订阅档解锁更多额度。

状态：✅ 完成 · 🚧 进行中 · ⏳ 待做

## P0 · 能用（不做就不能给真实用户）
| # | 问题 | 方案 | 状态 |
|---|---|---|---|
| 1 | 消息头暴露 `PRODUCT_LEAD`、ISO 时间戳 | 只显示 “Kern · 10:32”，内部角色进轨迹 | ✅ |
| 2 | 任务卡标题永远是“正在推进”，与“需要你处理”矛盾 | 标题随状态：正在推进 / 已完成 / 需要你 | ✅ |
| 3 | 任务受阻后说“继续”无效，只能重开 | 同对话中“继续/重试”→ 重跑受阻节点（resumeKernMission） | ✅ |
| 4 | 没配模型时，用户要到任务失败才知道 | 首页与输入框上方显示“先连接模型”一次性引导，链接设置 | ✅ |
| 5 | 没有记忆：Kern 不认识你、不记得结论 | KernMemory：任务结论/用户偏好自动写入，注入后续任务；设置页可查看/删除 | ✅ |
| 6 | 不主动：只有你问它才动 | “今天”首页：**打开 Kern 时**动态生成 需要你·进展·建议（Attention 分级）。⚠️ 尚无 Daily Brief Job / 持久化 Brief / 定时触达，见 #6b | 🚧 |
| 7 | 没有额度与套餐，无法商业化 | 套餐 + 任务准入额度 + 记忆条数额度（2026-09-26 补 enforcement）。⚠️ 模型调用只在**任务启动时**检查一次，不是逐次扣减，见 #7b | 🚧 |
| 6b | 简报不会主动来 | Daily Brief Job → 持久化 Brief（去重）→ 渠道触达 | ⏳ |
| 7b | 模型调用可在单个任务内冲破月度上限 | 统一 UsageLedger（mission_started / model_call / research_call / desktop_action）+ Billing Policy 原子检查，在 Model Gateway 调用前扣减 | ⏳（商业化前必做，内部 Beta 不阻塞） |
| 8 | 11 个既有测试失败（http/ui/authz/blueprint…） | 逐个定位：环境依赖 vs 真缺陷；真缺陷修掉，环境依赖进 CI 条件 | ✅ |

## P1 · 好用
| # | 问题 | 方案 | 状态 |
|---|---|---|---|
| 9 | 研究节点只靠模型常识，没有来源 | 研究节点接 ResearchRun / web 抓取，结论附来源 | ⏳ **→ 升为 P0，见 docs/KERN_NEXT_PHASE_PLAN.md** |
| 10 | 产品研发(product-rnd)能力藏在工作台 | 合并进 NEW_PRODUCT playbook，结果可一键“建成产品” | ⏳ **→ 升为 P0** |
| 11 | 工作台页面重叠（/advisor /consultation /war-room /dashboard /manage） | 信息架构收敛：Kern / 产品 / 项目 / 设置 | ⏳ |
| 12 | 学习闭环：用户纠正不影响下次 | 反馈（👍/纠正）→ 记忆 + harness 评估样本 | ⏳ |

## P2 · 可运营
| 13 | 支付接入（Stripe）与账单页 | ⏳ |
| 14 | 多渠道触达（邮件/企业微信/WhatsApp 推送简报与审批） | ⏳ |
| 15 | 可观测性：任务成本、失败率、每用户用量看板 | ⏳ |

## P0 完成记录（2026-09-26）
- 1/2 消息头只显示 “Kern · 时间”；任务卡标题随状态变化。
- 3 `resumeKernMission` + 对话里说“继续/重试”原地续跑（保留已完成节点、补预算、最多 3 次）。
- 4 `isKernModelReady` 探针 + Kern 顶部一次性提示；文案不再让普通用户去配 API Key（模型由部署方提供）。
- 5 `KernMemory` 表 + `src/modules/memory`：任务完成自动记结论、“记住…”存偏好、注入每个任务节点与对话；Kern 顶栏「记忆」可查看/置顶/忘掉。
- 6 首页 = 今天：问候 + 需要你（含逾期/受阻里程碑）+ Kern 正在做 + 过去一天完成数。
- 7 `OrganizationSubscription` + `src/modules/billing`：Free 5 项/月、Pro 60 项/月、Team 不限；超额时诚实拒绝并给升级路径；设置页「套餐与用量」；`npm run kern:set-plan`。
- 8 既有失败测试：全部定位。
  - 环境：缺 `.env`、2GB 内存下构建 OOM → `acc-server.sh` 支持 `ACC_BUILD_NODE_OPTIONS/ACC_BUILD_FLAGS`。
  - 真缺陷（已修）：runtime-config 对他人会话返回 422 而非 404；原生 `window.prompt` 拒绝理由 → 应用内 RejectSheet；Kern 任务进展原本同组织任何人可读 → 仅发起人。
  - 过期断言（已按现行策略更新）：blueprint 的“显式创建任务=自动执行+回执”；UI 证据测试的“任务”标签已更名“工作项”；authz 矩阵登记新路由。
  - 仍依赖外部：`test:llm-e2e`（需真实模型 + 更大内存）。
