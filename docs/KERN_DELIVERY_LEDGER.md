# Kern 持续交付台账

> 这是 PM-next 的抗中断执行锚点。继续工作时先读本文件，再核对 main / 当前 PR / CI；聊天记录不是交付事实来源。

## 执行规则

- 主架构师：负责产品边界、信息架构、诚实性、任务拆分、合并顺序与最终验收。
- 执行单元：机械、单点、可验收任务使用独立分支；互不改同一高冲突文件。
- 一个交付批次集中完成后再触发 CI，避免每个小改动重复等待。
- 用户可见状态只能来自真实 backend state；UNKNOWN、失败、排队与未连接必须如实展示。
- Governance / Evidence / QA / Gate / AgentTask / AgentRun / Decision Intelligence / ProductVersion / Approval / Audit 不因前端收口重写。
- 稳定内部兼容标识（如 /muse、.hermes-*、hermes_pm）与用户可见品牌分离，不做无收益迁移。

## 已合并基线

- P0 · Kern 诚实状态 / 权限：`49c00d88`
- A1 · 受治理 Kern Planner：`795006dc`
- A3 · Today 真实工作聚合：`4ef9aa4c`
- B3 · 项目表单枚举本地化：`eb4a6d9c`
- B1b · 知识库用户文案：`189957ce`
- B1/B2 · 390px 条件态真实验证 + 气泡轴 1px 修复：`193f8512`
- B4 · 可行动空状态：`0fb583b8`
- B5 · Kern / 产品 / 项目 / 工作项 / 门禁 / 决策包术语收口：`3211a85c`

## 当前批次

分支：`feat/kern-delivery-batch-a2-a5`

目标：

1. **A2 最终视觉系统**：保留 Kern 对话主轴与单一强调渐变；移除主界面玻璃拟态与装饰性光晕，保持 light/dark/390px。
2. **A4 Executive Report**：明确呈现「当前结论 → 关键依据 → 最大风险 → UNKNOWN → 需要你决定 → 下一步」，专业 Agent 原始细节继续折叠。
3. **A5 Desktop 助理叙事**：主文案只表达 Kern 是否连上 Mac、是否真的执行、结果是什么；开发命令降级到二级详情。
4. CI：至少 Quality / Desktop / Product R&D；按改动路径触发的其他门禁必须全部绿。

## 当前事实判断

- A1/A3/B1/B2/B3/B4/B5 已有代码与 CI 证据，不重新设计。
- Executive Report 的证据、风险、UNKNOWN、负责人决策和溯源能力已经存在，本批只收口阅读顺序与标签。
- Desktop Runtime 的排队 / 领取 / 回执已经真实落库，本批只优化用户叙事，不改变执行语义。
- 管理后台继续保持传统、完整、可深入；Kern 是默认日常操作层，不把后台再改成聊天壳。

## 下一批

当前批次全绿合并后：

- 跑完整产品主线与本机执行验收路径。
- 更新交付/验收文档与最终基线 commit。
- 只处理验收中真实复现的问题，不再扩功能。
