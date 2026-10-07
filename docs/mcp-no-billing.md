# KX-37 去付费化

**决定（用户，2026-09-28）**：产品内不做付费。合作走 toB 定制，单独签约付费，不在产品里设计。

## 改了什么

| 删除 | 替代 |
|---|---|
| `src/modules/billing`（套餐 FREE / PRO / TEAM、价格 ¥149/月、按订阅日计算账期） | `src/modules/usage`：只统计用量，外加可选的部署上限 |
| 表 `OrganizationSubscription`、枚举 `KernPlanTier`（迁移 20260928200000 删表） | 无，不需要 |
| `scripts/kern-set-plan.ts` | 无 |
| 设置页「套餐与用量」，含套餐卡和“请联系我们升级” | 「本月用量」：只显示 Kern 接手的工作数和模型调用数 |
| 错误码 `QUOTA_EXCEEDED` 402，文案“升级套餐” | `USAGE_LIMIT_REACHED` 429，文案“联系管理员” |
| 简报里的“本月任务额度 a/b → c/b” | “本月第 N 项工作”；只有部署设置了上限时，才附带“（上限 X）” |
| 演示模式的“不消耗额度” | “不调用模型、不写入业务数据” |

## 保留什么，为什么

- **用量统计**：让用户和部署方都看得到 Kern 本月干了多少活、调用了多少次模型，这是透明度的需要，与收费无关。统计周期是上海时区的自然月，演示运行不计入。
- **部署级安全上限（可选，默认不限）**：toB 定制部署需要一道防止模型花费失控的闸，由部署方用环境变量设置：
  - `KERN_LIMIT_MISSIONS_PER_MONTH`
  - `KERN_LIMIT_MODEL_CALLS_PER_MONTH`
  - `KERN_LIMIT_MEMORY_ITEMS`

  空值、非法值或负数一律视为不限。触发上限时，对话照常回答，只是不开新的工作，并提示联系管理员。

## 验证

- `tests/kern-usage.test.ts`：环境变量解析、上海时区的自然月（含跨月、跨年）。
- `test:kern-memory-quota`（npm 名称和 CI 保持不变）：用 `KERN_LIMIT_MEMORY_ITEMS=20` 测上限、并发不超、删除一条后腾出名额；不设置时不限。
- `test:kern-supervisor` S8：达到上限时拒绝开新工作，回复中包含“联系管理员”，并且断言不出现“套餐”或“升级”字样。
- 同时跑过：
  - tsc、eslint
  - regression-units、kern-supervisor-plan、kern-autonomy、delivery-contracts
  - source-guards、gate-boundaries
  - kern-brief、kern-schedule
  - ui-feedback（73 项）
  - schema 与迁移一致性检查
