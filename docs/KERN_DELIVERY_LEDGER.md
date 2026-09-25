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
- A2/A4/A5 · 最终视觉系统 / Executive Report / 本机助理叙事：`9ace96db`

## 当前状态

**V1/Beta 已冻结并通过最终验收。**

- validated PR head：`cfff5fe0d30dd81fbae496d9d4e073157465d2f0`
- validated code merge baseline：`e49491c8f866771b0f01244241e538fe0e97d073`
- validated tree：`6706dd425b2345442ae3e9aff32917b9bb1e4aaf`
- PR：#14 `release: run Kern V1 beta final acceptance`
- 结果：同一 validated head 上 **11 / 11 GitHub Actions workflow 全绿**
- 2026-09-25 收口时：开放 PR = 0，开放 Issue = 0。

## 当前事实判断

- A1/A3/B1/B2/B3/B4/B5 已有代码与 CI 证据，不重新设计。
- Executive Report 的证据、风险、UNKNOWN、负责人决策和溯源能力已经存在，本批只收口阅读顺序与标签。
- Desktop Runtime 的排队 / 领取 / 回执已经真实落库，本批只优化用户叙事，不改变执行语义。
- 管理后台继续保持传统、完整、可深入；Kern 是默认日常操作层，不把后台再改成聊天壳。

## 后续工作原则

V1/Beta 不再继续“顺手优化”。后续只从真实试用反馈进入新批次：

1. 真实部署 / Demo / 使用中复现的 P0、P1；
2. 客户或内部产品经理明确提出的管理后台缺口；
3. Kern 主操作层真实使用中的对话、委派、Check-in、本机执行体验问题；
4. 下一版本功能进入独立 V1.1 规划，不直接改冻结基线。

继续工作时，先核对 `main` 是否仍包含上述 validated head，再检查当前 PR / Issue / CI。
