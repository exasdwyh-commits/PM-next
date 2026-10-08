# P4 日常助理 UX - Task Card

## 目标
成为公司日常助理，打开即用，主动推送，Personal Chief of Staff

## 验收
- /muse Daily Briefing: KPI 4列+donut+bar+一句话结论+boss-summary+快捷操作，4类+role自适应，动效，3秒首屏
- 说"今天有什么需要我决策的"，3秒返回2个决策卡+证据表+风险+下一步，领导极简，研发严谨，销售卖点突出
- 角色自动推荐: 根据时间/上下文自动切视角
- 主动推送: 风险预警 + 下一步建议

## 任务拆解
1. Daily Briefing组件 - executive-report-rich + cockpit-rich + overview-role-based-rich组合
2. 快捷操作聚合 - role-tools-rich + cost-calculator-modular + compliance + supplier
3. 主动推送 - 风险预警 + 下一步建议逻辑
4. 上下文记忆 - projectId + 4类偏好 + 角色偏好
5. 对话增强 - 左侧摘要+右侧Artifact双路渲染

## 4类专用 + 角色自适应
- 4类: 🍪普通 #f59e0b 39.9 / 💊保健 #7c3aed 199 / 🌍跨境 #0891b2 129 / 💄化妆品 #db2777 299
- 角色: 👔领导直观 / 🔬研发严谨 / 💼销售卖点突出 + auto+manual+Kern对话驱动

## 文件
- src/components/daily-briefing-rich.tsx + css
- src/app/muse/components/daily-briefing.tsx
- src/modules/assistant-runtime/capabilities/daily-briefing.ts
- src/app/api/assistant/daily-briefing/route.ts
