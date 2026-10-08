# P5 产品研发+项目管理 UX - Task Card

## 目标
一页式产品研发驾驶舱 + 项目跟进 + 自动推进

## 验收
- /projects/[id] 一页看懂: 配方+成本+合规+供应商+证据+风险+决策，Kern自动填充，用户只决策
- 说"成本优化到8元"，Kern自动生成3方案对比+证据+风险，保存v2
- 项目跟进: 进度条+已完成/进行中/待决策+缺口+下一步+谁负责+预计上市，3秒返回
- 成本工作台: 虚拟滚动1000+ + evidence+qualification drag-drop + office export role-based

## 任务
- 产品研发驾驶舱: overview-role-based-rich + product-rnd-panel-rich + cost-calculator-modular + scenario-manager + collaboration-planner-rich甘特图
- 成本工作台性能: bom-virtual-list + cost-calculator-performance
- 项目跟进API: /api/assistant/project-tracking
- 自动推进: 成本优化3方案对比

## 文件
- src/components/product-rnd-cockpit-rich.tsx + css
- src/modules/assistant-runtime/capabilities/project-tracking.ts
- src/app/api/assistant/project-tracking/route.ts
