# P4-P6 3 Demo 场景

## 场景1: 公司日常助手 (P4)
- 入口: /muse 或 /api/assistant/daily-briefing?category=health_food&role=leadership
- 步骤:
  1. GET daily-briefing -> 返回 todos/decisions/gaps/risks/evidenceRate/workRate + suggestions + generatedAt
  2. 富组件 DailyBriefingRich 渲染: 领导视角 KPI 4列 + 一句话结论 + 快捷操作 3个 (去补证据/去做决策/查看AI研发)
  3. 快捷操作: onAction("evidence") -> 跳转 /projects/[id]?tab=evidence
  4. 主动推送: POST /api/assistant/active-push -> 返回 briefing + pushResults (inbox) + memoryContext + nextPushAt + personalized
  5. 上下文记忆: KernMemory PREFERENCE/CORRECTION 影响 suggestions，pinned 优先
  6. Cron: 工作日 9:00/18:00 自动推送，描述在 PUT /api/assistant/active-push
- 验收: 领导直观，4类专用，动效 fadeInUp/growWidth/drawDonut，3s内加载

## 场景2: 产品研发+项目管理 (P5)
- 入口: /projects/[id] -> ProductRndCockpitRich
- 步骤:
  1. 一页式 R&D cockpit: 总览 tab 显示 KPI 4列 (配方完成度/成本/合规/风险) + 配方/成本/合规/供应商 4 section + 成本优化3方案对比 + 时间线5项 + 关键路径
  2. 成本工作台 perf: CostCalculatorPerformance 包含 MemoKpiCard + LazyChart (React.lazy) + VirtualEvidenceList (IntersectionObserver, 虚拟滚动 1000+)
  3. 项目跟踪: ProjectTrackingRich 3视图切换 timeline/graph/list
     - timeline: 5项时间线 + 关键路径
     - graph: DependencyGraphRich 7节点 SVG连线 + 依赖关系 + 自动推进按钮 + 阻塞自动重试描述
     - list: 任务卡片网格
  4. 自动推进: describeAutoAdvance(blockedReason) + 依赖图 auto-advance 按钮
  5. 依赖图: 配方→成本→合规→供应商→测试→上市，关键路径高亮，进度62%
- 验收: 专业严谨可信度优先，15组件+8动效，4类差异化卖点，虚拟滚动1000+不卡顿

## 场景3: 营销落地 (P6)
- 入口: /projects/[id]/marketing 或 MarketingLandingRich 组件
- 步骤:
  1. 一键生成: 按钮 "一键生成销售材料 · 保健食品专用" -> 1500ms 后生成
  2. 6 tabs: PPT(4 slides: 封面KPI/卖点/证据合规/成本利润) + 话术3版本(专业/简洁/促单) + Battlecard(成本/卖点/合规/留存率 4维度 vs 竞品) + 报价单(原料/制造/物流/总成本/供货价/零售价/利润率) + 市场图(2022-2025 100亿→260亿 +30%) + 合规清单(蓝帽子/多酚/功能声称/标签)
  3. 4类专用: regular_food 39.9/health_food 199/cross_border 129/cosmetics 299 差异化成本/卖点/合规
  4. 快问快答: 3秒返回，3卡片 Q:卖点/为什么值/合规吗，复制即用
  5. 导出: PDF/Word/HTML 一键导出，包含全部6项
- 验收: 卖点突出工具导向，15组件+8动效，移动端3s，4cat role-adaptive

## Harness R1-R17 验证
- R1 双路渲染: html-report + rich 均存在
- R2 4类专用: regular_food/health_food/cross_border_food/cosmetics
- R3-R5 角色自适应: leadership/product/sales
- R6 15组件: executive-report-rich, product-rnd-panel-rich, collaboration-planner-rich, overview-role-based-rich, role-tools-rich, cost-comparison-charts, cost-html-report-rich, bom-import, compliance-checklist, compliance-evidence, supplier-qualification, supplier-quote, cost-approval, cost-collaboration-rich, cost-office-export, challenge-report-card-rich, cockpit-rich, mission-conclusion-rich + 新增 dependency-graph-rich, project-tracking-rich, marketing-landing-rich, daily-briefing-rich, product-rnd-cockpit-rich
- R7 8动效: fadeInUp/growWidth/drawDonut/shimmer/scaleIn/slideIn/pulse/float
- R8 projectId过滤: GET /api/cost/scenarios?projectId
- R9-R10 drag-drop: BOM/evidence/qualification
- R11 role-based export: html/docx/pdf
- R12 Kern调度: POST /api/kern/dispatch
- R13 审批流: DRAFT→PENDING→APPROVED/REJECTED
- R14 协作@+版本: comments/versions API
- R15 证据A/B/C/D: verifiedRate
- R16 4类差异化: SC/蓝帽子/进口/备案
- R17 对话驱动角色切换: useRole + inferRoleFromText + Kern prompt

运行: GET /api/harness/validate?category=health_food&role=product
