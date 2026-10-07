# KX-74 记忆 v2 + 每周复盘

> 状态：完成，`feat/kern-experience`。阶段 3 第一项。

## 1. 用户视角

1. **纠正会被记住（程序性记忆）**：在验收清单里打回一条并写意见，Kern 记成一条「纠正」：
   `做「<任务>」这类工作时：<你的意见>（针对「<验收项>」）`，带任务主题词。之后所有工作（对话与任务步骤）都会带上最相关的最多 3 条纠正，
   同一个错不再犯第二次。演示运行不记。
2. **按主题找回过往结论（情景记忆）**：每条记忆有 `topics`（确定性抽取：英文词 + 中文滑动二元组，去停用词，不调模型）。
   目标措辞不同（「宠物饮水机」vs「饮水机选型」）也能召回同主题的过往结论；文字重叠度 + 主题重叠度一起排序。
3. **本周复盘（记忆面板里）**：过去 7 天跑了几项、完成几项、验收通过几项、平均人工介入 / 返工、模型调用；
   下面是建议清单，分三类，每条都要你点「采纳」才生效，「忽略」只是本次不看：
   - **章程**：同一主题被纠正 ≥ 2 次 → 合成一条长期规则，采纳后成为置顶偏好（每次工作都遵守）。
   - **记忆**：用过 ≥ 3 次的纠正 → 置顶；30 天没用过的旧结论 → 忘掉（最多 5 条）。
   - **做法**：连续 3 次验收通过 → 提示可转定时（KX-73 闸门）；跑 ≥ 3 次完成率不到一半 → 停用。

## 2. 代码

| 位置 | 作用 |
|---|---|
| `prisma` | `KernMemoryKind` + `CORRECTION`；`KernMemory.topics String[]`（迁移 `20260929150000_memory_v2_topics_correction`） |
| `memory/index.ts` | `extractTopics` / `topicOverlap`；`selectMemories` = 置顶 / 偏好 → 纠正（主题匹配优先，最多 3）→ 召回（文字 + 0.5 × 主题）；`rememberForUser` 写 `topics` |
| `supervisor/controls.ts` | `review` 打回带意见 → 纠正记忆（`source: mission:<id>:correction:<criterionId>`，幂等） |
| `supervisor/service.ts` | 任务结论记忆带目标主题词 |
| `supervisor/weekly-review.ts` | `buildWeeklyReview`（纯函数：汇总 + 三类建议）、`reviewSummaryLine` |
| `supervisor/review-service.ts` | `computeWeeklyReview`（读本人任务 / 记忆 / 做法）、`parseProposalOp`、`applyReviewProposal`（只做本人本来就能做的事） |
| `app/api/reviews/weekly/route.ts` | GET 复盘；POST 采纳一条建议。权限矩阵 +1 路由 +2 方法（92 / 128） |
| `app/muse/components/sheets.tsx` | 记忆面板新增「本周复盘」区块；记忆类型「纠正」 |
| `tests/kern-memory.test.ts` | +2 纯单测（主题抽取；纠正随行 / 主题召回） |
| `tests/kern-weekly-review.test.ts` | 2 条纯单测（汇总；三类建议的触发与不触发），已入 regression-units |
| `tests/regression-kern-mission-controls.ts` C5b/C5c | 真库：打回 → 纠正记忆落库带主题；两条同主题纠正 → 章程建议 → 采纳 → 置顶偏好；再算不重复提；坏 op 422；他人记忆不可动 |

## 3. 决定与取舍

- **不做向量检索**：个人规模几百条，二元组主题 + 文字重叠够用；换 embedding 时只需替换 `extractTopics` / `topicOverlap`，接口不变。
- **纠正只带 3 条**：多了淹没提示词；主题匹配优先、其次最新。
- **建议不落库**：复盘随时可算，采纳即执行、不采纳就没有任何副作用，避免再造一张「提案」表；每条建议的 `apply` 就是一个自包含的操作，服务端重新校验归属。
- **没有做每周定时推送**：路线图写的是「每周复盘」，本期先做「记忆面板随时看过去 7 天」；要推送时加一个 `WEEKLY_REVIEW` 定时种类调用 `reviewSummaryLine` 即可（等窗口 B 的反馈再定要不要打扰）。
- **章程 = 置顶偏好**：不另设「章程」实体，复用用户已经理解的「置顶」。

## 4. 校验

tsc 0、eslint 0，全量回归与权限矩阵见路线图 §10 日志。
