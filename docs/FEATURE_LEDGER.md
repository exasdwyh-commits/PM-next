# HERMES 功能台账

更新时间：2026-09-23  
用途：历史 F01–F34 / J01–J03 能力映射。此表是 roadmap coverage，不等同于当前 release blocker。

状态：
- DONE：当前定义的核心能力已落地并有回归
- PARTIAL：已有可用能力，但原始大定义仍有扩展空间
- NOT_STARTED：当前版本未做
- BOUNDARY_ONLY：仅保留边界/投影契约

| ID | 功能 | 状态 | 当前实现 |
| --- | --- | --- | --- |
| F01 | 角色矩阵 | DONE | ProjectMember / Role / 权限与越权回归 |
| F02 | 新品/固定产品与项目空间 | DONE | Product / Project 持久化 |
| F03 | 里程碑、依赖、进度、阻塞 | PARTIAL | 阶段、Launch milestones、Workforce 状态已具备；完整甘特仍可扩展 |
| F04 | 版本化反馈闭环 | DONE | collaboration + review/disposition |
| F05 | 授权内自动工作与回执 | DONE | Workforce + Autopilot + durable receipts + review return |
| F06 | 主要决策门 | DONE | G1 研发/打样、G2 生产投入、G3 上市授权均正式实现 |
| F07 | Evidence 入库/来源/性质/去重 | DONE | Evidence / claims / REAL-DEMO / verify status |
| F08 | GPT 网页日常任务导入契约 | NOT_STARTED | 下一版本外部采集 |
| F09 | 日机会信号 | PARTIAL | SignalSource / SignalItem / manual+injected / Autopilot；外部源仍可扩展 |
| F10 | 周爆品推荐池 | NOT_STARTED | 下一版本 |
| F11 | 蝉妈妈接入 | NOT_STARTED | 下一版本 |
| F12 | 精选联盟/快手小店接入 | NOT_STARTED | 下一版本 |
| F13 | 需求语义与禁止项 | DONE | requirement parser |
| F14 | 深度机会/竞品/用户/技术研究 | DONE | research + evidence-grounded analysis |
| F15 | 可比路线与修订 | DONE | product routes / research alternatives |
| F16 | 同版本报告/证据/建议包 | DONE | product suggestion + version binding |
| F17 | 产品定义/规格/验证清单 | DONE | ProductVersion + suggestion package |
| F18 | 竞品/组合装/可比价格 | DONE | cost engine / market research |
| F19 | 费用、利润、成本反推 | DONE | deterministic cost engine |
| F20 | 估算/报价/BOM/目标成本差 | PARTIAL | G2 SUPPLIER_QUOTE + budget 已落地；完整 BOM variance 可扩展 |
| F21 | 包装简报/版本/审核 | PARTIAL | PACKAGING_BRIEF 当前版本 + reviewStatus + contentVersion；完整设计文件流可扩展 |
| F22 | 询价/打样/合规资料包与待回复 | PARTIAL | G2 会显式暴露缺失生产成果；完整 supplier packet 仍可扩展 |
| F23 | 工厂反馈与冲突处理 | PARTIAL | 报价/专业确认可结构化入库；专用工厂协同流仍可扩展 |
| F24 | 样品版本/评价/重验 | DONE | SAMPLE_ROUND、当前版本、PASS、accepted REAL、重新送审语义 |
| F25 | 法规/平台/达人/企业规则版本 | PARTIAL | ChannelRuleProfileRecord 已版本化；完整多类规则库仍可扩展 |
| F26 | 动态检查项 | PARTIAL | Product Hard Gates + G2/G3 required checks；通用 checklist generator 可扩展 |
| F27 | 检测报告/批次/临期 | NOT_STARTED | 下一版本质量管理 |
| F28 | 硬阻断/风险/未知复核 | DONE | Product Hard Gates + fail-closed Governance + G2/G3 blockers |
| F29 | 渠道确认/版本/数量/价格/交期 | PARTIAL | ChannelSpecRoute + confirmed rules；专用锁单确认记录可扩展 |
| F30 | 定版与生产决策包 | DONE | Formal G2 DecisionPacket 冻结版本、成果、预算、scopeHash、fingerprint |
| F31 | 生产任务/数量/交期/反馈/异常 | PARTIAL | PRODUCTION_PLAN + start + PRODUCTION_RECORD + delivery；更细异常工单可扩展 |
| F32 | 交付归档/遗留/经验 | PARTIAL | Delivery + Audit + Experience Loop；专用结项归档 UI 可扩展 |
| F33 | 负责人工作台/决策总览 | DONE | Workbench / Product / Workforce / Gate UI |
| F34 | 导出/历史恢复/运营诊断 | PARTIAL | 审计、版本历史、Model/Workforce/Autopilot 可观测；角色化导出仍可扩展 |
| J01 | 企业资料问答 | BOUNDARY_ONLY | Jarvis read-only boundary |
| J02 | 项目决策参谋 | BOUNDARY_ONLY | Jarvis read-only boundary |
| J03 | 跨项目经验比较 | BOUNDARY_ONLY | Jarvis read-only boundary |

## 当前 release 判定

当前版本的 release blocker 已经不再由“F01-F34 是否全部 DONE”决定。

当前版本正式冻结的主闭环是：

Evidence / Product Potential
→ Channel Route
→ G1
→ G2
→ Production execution / delivery
→ G3
→ Workforce / Autopilot / Experience

F20-F32 中未覆盖的供应商协同、质检、渠道锁单和结项运营细节属于下一版本扩展，不应在本地最终修复阶段扩大 scope。