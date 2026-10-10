/**
 * 面向业务使用者的枚举中文标签（集中一处）
 *
 * 为什么集中：2026-09-17 全流程可视化走查在中文界面上实际观察到这些**内部标识被直接渲染**：
 *   `PENDING`、`IN_REVIEW`、`TEST_STUB`、`FEEDBACK_CREATED`、`unknown`、
 *   `targetUserAndNeed`、`OBSIDIAN_VAULT` ……
 * 业务使用者不该看到数据库枚举、审计动作名或运行模式常量——它们既不可读，也会让人误以为
 * 系统"没做完"。集中登记还有一个好处：**新增枚举若忘了加中文标签，Code Review 时一眼可见**，
 * 不必翻遍页面找漏网之鱼。
 *
 * 约定：
 *  1. 映射不到时**回退原始值**而不是显示空白——宁可露出原始标识，也不能让界面出现空单元格。
 *     （回退值同时是"这里漏登记了一条"的信号。）
 *  2. 本模块**必须保持零依赖**：它会被客户端组件直接 import，一旦引入 prisma / server-only
 *     模块，客户端打包就会失败。因此这里只放纯字面量映射，不放类型导入。
 */

/** 运行模式：是否真的接了语言模型，直接决定使用者能否相信顾问的回答 */
export const RUN_MODE_LABELS: Record<string, string> = {
  MANUAL: "人工录入",
  TEST_STUB: "模拟运行时（未接入真实模型）",
  AUTOMATED: "自动执行",
  LLM: "真实模型生成",
};

/** 项目模式 */
export const PROJECT_MODE_LABELS: Record<string, string> = {
  NEW_PRODUCT: "新品开发",
  FIXED_PRODUCT: "指定产品开发",
};

/**
 * 项目阶段（ProjectStage）。措辞沿用界面既有约定（dashboard / war-room 在用），
 * 不另创一套——同一枚举出现两种中文，会让"阶段"这件事在跨页面时无法对齐。
 */
export const PROJECT_STAGE_LABELS: Record<string, string> = {
  DRAFT: "概念定义",
  RESEARCH: "研究验证",
  SAMPLING: "配方开发",
  PRODUCTION_PREP: "生产准备",
  PRODUCTION: "商业化生产",
  DELIVERED: "已交付",
};

/**
 * 产品生命周期阶段（ProductLifecycleStage）。
 * 注意与 ProjectStage 是**两条不同的轴**：项目轴（怎么把东西做出来）与产品轴（东西处在什么市场状态），
 * 枚举取值完全不同，不要互相套用。
 */
export const PRODUCT_LIFECYCLE_STAGE_LABELS: Record<string, string> = {
  IDEA: "想法入库",
  ANALYSIS: "分析优化",
  SAMPLING: "打样验证",
  LAUNCH_PREP: "上市准备",
  LAUNCHED: "已上市",
  REVIEW: "复盘",
  PAUSED: "暂停",
};

/** Agent 运行状态 */
export const AGENT_RUN_STATUS_LABELS: Record<string, string> = {
  QUEUED: "排队中",
  RUNNING: "运行中",
  WAITING_CONFIRMATION: "等待人工确认",
  SUCCEEDED: "已成功",
  FAILED: "已失败",
  CANCELLED: "已取消",
};

/**
 * Agent 任务状态（AgentTaskStatus）。
 * 此前只在 product-rnd-panel.tsx 本地登记一份，与本文件登记的其它枚举分裂两处；
 * 收口到这里，其它页面（如 executive-report 的专业数字员工意见）改用同一份措辞。
 * 注意与 AgentRunStatus（AGENT_RUN_STATUS_LABELS）是两个不同的枚举，取值不同，不要混用。
 */
export const AGENT_TASK_STATUS_LABELS: Record<string, string> = {
  QUEUED: "等待执行",
  RUNNING: "正在执行",
  BLOCKED: "存在阻断",
  WAITING_HUMAN: "等待人工",
  SUBMITTED: "已提交",
  SUCCEEDED: "已完成",
  FAILED: "执行失败",
  CANCELLED: "已取消",
};

/** 分析运行类型（AnalysisRunKind） */
export const ANALYSIS_RUN_KIND_LABELS: Record<string, string> = {
  BASELINE: "基线分析",
  REVISION_REVIEW: "修订复核",
};

/**
 * 证据等级（executive-report 结论证据展示，非独立 Prisma 枚举，取值：
 * UNKNOWN / ASSUMED / SUPPORTED / VERIFIED）。UNKNOWN 在本产品中是一等状态
 * （证据尚未分级），保留「未知」而不是隐藏或含糊其辞。
 */
export const EVIDENCE_LEVEL_LABELS: Record<string, string> = {
  UNKNOWN: "未知",
  ASSUMED: "假设",
  SUPPORTED: "有支撑",
  VERIFIED: "已核实",
};

/** Squad 生命周期状态（SquadLifecycleStatus） */
export const SQUAD_LIFECYCLE_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "活跃",
  ARCHIVED: "已归档",
};

/** 渠道规则记录可信状态（ChannelRuleRecordStatus） */
export const CHANNEL_RULE_RECORD_STATUS_LABELS: Record<string, string> = {
  ASSUMED: "假设",
  CONFIRMED: "已确认",
  SUPERSEDED: "已被取代",
};

/** 渠道路线状态（`ChannelSpecRouteStatus`） */
export const CHANNEL_SPEC_ROUTE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  BLOCKED: "受阻",
  VALIDATION_READY: "待验证",
  VALIDATING: "验证中",
  CONFIRMED: "已确认",
  REJECTED: "已否决",
  SUPERSEDED: "已被取代",
};

/** 产品验证真实结果（`ProductValidationOutcomeStatus`） */
export const PRODUCT_VALIDATION_OUTCOME_LABELS: Record<string, string> = {
  SUCCESS: "成功",
  FAILURE: "失败",
  INCONCLUSIVE: "无定论",
  NOT_RUN: "未执行",
};

/** 预测回测对齐结果（`BacktestAlignmentStatus`） */
export const BACKTEST_ALIGNMENT_LABELS: Record<string, string> = {
  ALIGNED_SUCCESS: "预测成功且属实",
  ALIGNED_FAILURE: "预测失败且属实",
  FALSE_POSITIVE: "误报（预测成功但失败）",
  FALSE_NEGATIVE: "漏报（预测失败但成功）",
  ABSTAINED: "未做预测",
  INCONCLUSIVE: "无定论",
};

/** 经验候选状态（`ExperienceLessonStatus`） */
export const EXPERIENCE_LESSON_STATUS_LABELS: Record<string, string> = {
  CANDIDATE: "候选",
  APPROVED: "已批准",
  REJECTED: "已驳回",
  SUPERSEDED: "已被取代",
};

/** 知识源类型 */
export const KNOWLEDGE_SOURCE_KIND_LABELS: Record<string, string> = {
  OBSIDIAN_VAULT: "Obsidian 知识库",
  LOCAL_DIR: "本地目录",
};

/** 知识源同步状态 */
export const KNOWLEDGE_SYNC_STATUS_LABELS: Record<string, string> = {
  RUNNING: "同步中",
  SUCCEEDED: "同步成功",
  FAILED: "同步失败",
};

/** 公司事实状态 */
export const COMPANY_FACT_STATUS_LABELS: Record<string, string> = {
  PENDING: "待确认",
  CONFIRMED: "已确认",
  SUPERSEDED: "已被取代",
};

/** 证据核实状态 */
export const EVIDENCE_VERIFY_STATUS_LABELS: Record<string, string> = {
  UNVERIFIED: "未核实",
  VERIFIED: "已核实",
  REJECTED: "已驳回",
};

/** 证据属性（真实 / 演示）——演示数据不得冒充验证结论，界面上必须看得见 */
export const EVIDENCE_NATURE_LABELS: Record<string, string> = {
  REAL: "真实依据",
  DEMO: "演示数据",
};

/** 证据主张的三态（事实 / 推断 / 假设）——三者绝不能混为一谈 */
export const EVIDENCE_CLAIM_KIND_LABELS: Record<string, string> = {
  FACT: "事实",
  INFERENCE: "推断",
  ASSUMPTION: "假设",
};

/**
 * 试销验证状态。
 * `VERIFIED_BY_LEAD` 的语义是「由项目负责人确认」——录入接口
 * （api/projects/[id]/opportunity PATCH）仅 OWNER 可置该状态。
 * 曾有一处把它显示成「头部客户已验证」，与枚举含义不符（不是客户验证，是负责人确认），此处为准。
 */
export const VALIDATION_STATUS_LABELS: Record<string, string> = {
  UNAPPLIED: "未启动",
  IN_PROGRESS: "验证中",
  VERIFIED_BY_LEAD: "负责人已确认",
};

/** 决策包（放行审批）状态 */
export const DECISION_PACKET_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  IN_REVIEW: "待审批",
  APPROVED: "已批准",
  CHANGES_REQUESTED: "已要求修改",
  DEFERRED: "已搁置",
  REJECTED: "已驳回",
  WITHDRAWN: "已撤回",
};

/**
 * 决策结果（DecisionOutcome）。审查决定会写进审计文案（/trace 时间线逐字渲染），
 * 必须中文化，否则界面会显示 APPROVE / REQUEST_CHANGES 这类内部标识。
 */
export const DECISION_OUTCOME_LABELS: Record<string, string> = {
  APPROVE: "批准",
  REQUEST_CHANGES: "要求修改",
  DEFER: "搁置",
  REJECT: "驳回",
  WITHDRAW: "撤回",
};

/** 上市计划状态 */
export const LAUNCH_PLAN_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  ACTIVE: "执行中",
  BLOCKED: "受阻",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
};

/** 上市里程碑状态 */
export const LAUNCH_MILESTONE_STATUS_LABELS: Record<string, string> = {
  PENDING: "未开始",
  IN_PROGRESS: "进行中",
  DONE: "已完成",
  BLOCKED: "受阻",
};

/** 工作项状态 */
export const WORK_ITEM_STATUS_LABELS: Record<string, string> = {
  TODO: "待开始",
  RUNNING: "进行中",
  SUBMITTED: "已提交",
  CHANGES_REQUESTED: "已要求修改",
  ACCEPTED: "已验收",
};

/** 工作项执行者类型（WorkExecutorType） */
export const WORK_EXECUTOR_TYPE_LABELS: Record<string, string> = {
  HUMAN: "人工执行",
  TEST_AGENT: "测试 Agent",
  DIGITAL_WORKER: "数字员工",
};

/**
 * 交付物类型。Artifact.type 在 Prisma 中是 String，不是 enum；
 * 这里登记当前项目提交 UI 与结构化成果解析器实际允许/使用的值。
 * 未登记的新类型仍由 labelOf 回退原始值，避免静默空白。
 */
export const ARTIFACT_TYPE_LABELS: Record<string, string> = {
  RESEARCH_REPORT: "研究报告",
  SAMPLE_ROUND: "样品轮次",
  SUPPLIER_QUOTE: "供应商报价",
  PROFESSIONAL_CONFIRMATION: "专业确认",
  PROFESSIONAL_ANALYSIS: "专业分析",
  PACKAGING_BRIEF: "包装确认",
  PRODUCTION_PLAN: "生产计划",
  PRODUCTION_RECORD: "生产记录",
  COST_SCENARIO: "成本情景",
  BUSINESS_OBSERVATION: "业务观察",
  HEALTHCARE_INNOVATION_BRIEF: "大健康创新简报",
};

/** 反馈（咨询台）状态 */
export const FEEDBACK_STATUS_LABELS: Record<string, string> = {
  OPEN: "待处置",
  ACCEPTED: "已采纳",
  REJECTED: "已驳回",
  NEEDS_INFO: "需补充信息",
};

/** 交付物审核状态 */
export const ARTIFACT_REVIEW_STATUS_LABELS: Record<string, string> = {
  PENDING: "待检查",
  ACCEPTED: "已检查通过",
  REJECTED: "已退回",
};

/** 交付物适用性状态 */
export const ARTIFACT_APPLICABILITY_STATUS_LABELS: Record<string, string> = {
  PENDING: "待确认适用性",
  CONFIRMED: "适用性已确认",
  REJECTED: "适用性被否",
};

/** 研究运行状态 */
export const RESEARCH_RUN_STATUS_LABELS: Record<string, string> = {
  RUNNING: "进行中",
  PUBLISHED: "已发布",
  FAILED: "失败",
};

/** 数据缺口状态 */
export const DATA_GAP_STATUS_LABELS: Record<string, string> = {
  OPEN: "待补证",
  FILLED: "已补证",
};

/**
 * 模型运行状态（Prisma `enum ModelRunStatus`）。
 * 与 AGENT_RUN_STATUS_LABELS 取值相近但不同义：ModelRun 多了 RESERVED（已预留配额、未真正发起），
 * 且这里的措辞要体现「计费」语义，不能直接复用 AgentRun 那一套。
 */
export const MODEL_RUN_STATUS_LABELS: Record<string, string> = {
  RESERVED: "已预留",
  RUNNING: "运行中",
  SUCCEEDED: "已成功",
  FAILED: "已失败",
};

/**
 * 项目时间线条目状态（项目跟踪视图的 timeline[].status）。
 * 与 AgentRun / WorkItem 等状态都是"进行到哪一步"的语义，但取值是小写三态，
 * 单独登记，避免界面露出 done / running / queued 英文。
 */
export const PROJECT_TIMELINE_STATUS_LABELS: Record<string, string> = {
  done: "已完成",
  running: "进行中",
  queued: "待开始",
};

/** 顾问提议状态 */
export const ACTION_PROPOSAL_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  PENDING_CONFIRMATION: "待人工确认",
  APPLIED: "已应用",
  REJECTED: "已驳回",
  SUPERSEDED: "已被新提议取代",
  EXPIRED: "已过期",
};

/**
 * 机会类型。取值定义在 `src/modules/research/opportunity-analysis.ts`（该模块会连带
 * 引入服务端链条，客户端不可直接 import），故在此登记纯字面量映射。
 */
export const OPPORTUNITY_TYPE_LABELS: Record<string, string> = {
  PENDING: "待判定（证据不足，不猜测）",
  TREND_NEW_PRODUCT: "趋势新品机会",
  FOLLOW_HIT_PRODUCT: "跟随爆品机会",
};

/**
 * 机会分析八要素。`targetUserAndNeed` 这类 camelCase 字段名只应存在于代码与接口里，
 * 不应出现在界面上（走查实际观察到「八要素」列表渲染出英文键名）。
 * 键必须与 `OpportunityElementKey` 保持一致——`tests/status-labels.test.ts` 会校验。
 */
export const OPPORTUNITY_ELEMENT_LABELS: Record<string, string> = {
  targetUserAndNeed: "目标用户与需求",
  channelFit: "渠道适配",
  competitorPricing: "竞品价格与销量",
  evidenceDifferentiator: "差异化依据",
  marketValidation: "市场验证",
  keyCounterEvidence: "反证与风险",
  dataGaps: "证据缺口",
  nextSteps: "下一步动作",
};

/**
 * 上市里程碑类型。原先只在 launch-tab 里本地定义，同一个页面另一处又用共享状态表，
 * 导致「同页两套口径」；统一到此处。
 */
export const LAUNCH_MILESTONE_KIND_LABELS: Record<string, string> = {
  MATERIAL: "素材",
  CHANNEL: "渠道",
  SUPPLY: "供货",
  COMPLIANCE: "合规",
  OTHER: "其他",
};

/**
 * 产品评分六维（AnalysisDimensionKey）。
 * 此前在 product-overview / revision-panel / briefing 各存一份完全相同的表，
 * 改一处忘一处就会让同一维度在不同页面叫不同名字。
 */
export const SCORE_DIMENSION_LABELS: Record<string, string> = {
  DEMAND_VALUE: "需求价值",
  DIFFERENTIATION: "差异化",
  UNIT_ECONOMICS: "单位经济性",
  COMPANY_FIT: "公司适配",
  DELIVERY_FEASIBILITY: "交付可行性",
  LAUNCH_READINESS: "上市准备度",
};

/**
 * 产品草案字段（ProductSpecField）。
 * 唯一来源放在共享层的原因：`modules/product-development/revision.ts` 会连带引入 prisma，
 * 客户端组件无法 import 它，只能手抄一份——那正是重复的源头。现在两边都引用这里。
 * 键必须覆盖 `ProductSpecField` 全部取值，`tests/status-labels.test.ts` 会校验。
 */
export const PRODUCT_SPEC_FIELD_LABELS: Record<string, string> = {
  coreIdea: "一句话想法",
  targetAudience: "目标人群与场景",
  coreSellingPoints: "核心卖点",
  targetChannels: "预期渠道",
  priceExpectation: "价格预期",
  formSpec: "剂型 / 规格",
  forbiddenItems: "禁用项",
  targetCost: "目标成本",
};

/**
 * 审计动作。取值来源：全仓 `action: "XXX"` 写入点的全集。
 * 新增审计动作时请一并登记，否则界面会退回显示英文常量。
 */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  CONFIRM: "人工确认",
  PRODUCT_INGESTED: "产品入库",
  PRODUCT_STAGE_ADVANCED: "产品阶段推进",
  PRODUCT_VERSION_REVISED: "产品版本修订",
  PROJECT_CREATED: "创建项目",
  PROJECT_UPDATED: "更新项目",
  EVIDENCE_CREATED: "登记证据",
  EVIDENCE_VERIFIED: "核实证据",
  ATTACHMENT_UPLOADED: "上传附件",
  MARKET_VALIDATION_UPDATED: "更新市场验证",
  DECISION_PACKET_DRAFT_CREATED: "创建决策包草稿",
  DECISION_PACKET_SUBMITTED: "提交决策包送审",
  FEEDBACK_CREATED: "登记反馈",
  FEEDBACK_DISPOSED: "处置反馈",
  WORK_ITEM_CREATED: "创建任务",
  WORK_SUBMISSION_RECEIVED: "收到任务提交",
  WORK_SUBMISSION_LATE_IGNORED: "逾期提交未计入",
  RESEARCH_RUN_STARTED: "启动研究",
  ACTION_PROPOSAL_CREATED: "顾问提议待确认",
  ACTION_PROPOSAL_APPLIED: "顾问提议已应用",
  ACTION_PROPOSAL_REJECTED: "顾问提议被驳回",
  ACTION_PROPOSAL_SUPERSEDED: "顾问提议被新提议取代",
  LAUNCH_PLAN_PREPARED: "准备上市计划",
  LAUNCH_PLAN_UPDATED: "更新上市计划",
  LAUNCH_MILESTONE_ADDED: "新增上市里程碑",
  LAUNCH_MILESTONE_UPDATED: "更新上市里程碑",
  LAUNCH_APPROVED: "上市计划获准",
  FORMAL_G3_INVALIDATED: "正式 G3 授权 / 待审批快照失效",
  PRODUCTION_PREPARED: "进入生产准备",
  FORMAL_G2_INVALIDATED: "正式 G2 待审批快照失效",
  PRODUCTION_STARTED: "确认实际生产开工",
  PRODUCTION_DELIVERED: "确认生产交付",
  LAUNCH_APPROVAL_REVOKED: "撤销上市批准",
  LAUNCH_EXECUTED: "确认实际上市",
  ACCEPT_RESULT: "接受结果",
  AGENT_MODEL_POLICY_BOUND: "绑定员工模型策略",
  AGENT_PARENT_TASK_CLOSED_FROM_RETURN: "按回执关闭上级任务",
  AGENT_RETURN_REVIEW_ACCEPTED: "回执复核：接受",
  AGENT_RETURN_REVIEW_ESCALATED: "回执复核：上报",
  AGENT_RETURN_REVIEW_REDELEGATED: "回执复核：重新委派",
  AGENT_TASK_CREATED: "创建员工任务",
  AGENT_TASK_DELEGATED: "委派员工任务",
  AGENT_TASK_FINISHED: "员工任务完成",
  AGENT_TASK_STARTED: "员工任务开始",
  ASSESS_POTENTIAL: "评估潜力",
  AUTO: "自动处理",
  AUTOPILOT_BOOTSTRAPPED: "自动驾驶初始化",
  AUTOPILOT_EVENT_FAILED: "自动驾驶事件失败",
  AUTOPILOT_EVENT_PROCESSED: "自动驾驶事件已处理",
  BIND_AGENT: "绑定员工",
  CHANNEL_RULE_PROFILE_CREATED: "创建渠道规则",
  CHANNEL_SPEC_ROUTE_EVALUATED: "评估渠道路线",
  CHANNEL_SPEC_ROUTE_STATUS_CHANGED: "渠道路线状态变更",
  CREATE_RULE: "创建规则",
  DECISION_RUN_RECORDED: "记录决策运行",
  EVALUATE_ROUTE: "评估路线",
  EXPERIENCE_LESSON_REBUILT: "重建经验候选",
  EXPERIENCE_LESSON_REVIEWED: "审核经验候选",
  INSTALL_PRESETS: "安装预设",
  KERN_MISSION_LAUNCHED: "Kern 任务启动",
  KERN_MISSION_RESUMED: "Kern 任务续跑",
  MODEL_CONTROL_PRESETS_INSTALLED: "安装模型预设",
  MODEL_POLICY_SAVED: "保存模型策略",
  MODEL_PROFILE_SAVED: "保存模型配置",
  POTENTIAL_PREDICTION_FROZEN: "冻结潜力预测",
  PRODUCT_OUTCOME_VERIFIED: "核验产品真实结果",
  PRODUCT_POTENTIAL_ASSESSED: "完成产品潜力评估",
  PRODUCT_VERSION_PUBLISHED: "发布产品版本",
  PROPOSAL_REANALYSIS_FAILED: "提案重新分析失败",
  READY_FOR_GOVERNANCE_REVIEW: "可进入治理评审",
  RECONCILE: "对账推进",
  REWORK_OR_STOP: "返工或停止",
  SAVE_POLICY: "保存策略",
  SAVE_PROFILE: "保存配置",
  START: "开始",
  TRANSITION_ROUTE: "路线状态流转",
  WORKFORCE_BOOTSTRAPPED: "员工体系初始化",
};

/**
 * 顾问回答里的引用来源类型（`Message.citations[].kind`）。
 * 取值是小写 slug（见 `modules/advisor/service.ts`），此前直接在回答下方以 chip 打印原始 slug
 * （页面上出现「decision · 待决策事项…」）。此处收口为唯一来源。
 */
export const CITATION_KIND_LABELS: Record<string, string> = {
  decision: "决策事项",
  product: "产品",
  proposal: "变更提案",
  challenge: "挑战",
  "challenge-report": "挑战报告",
  knowledge: "知识库",
  "desktop-task": "本机任务",
  "agent-task": "专家任务",
};

/** 统一的查询入口：映射不到时回退原始值（不显示空白） */
export function labelOf(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return "—";
  return map[key] ?? key;
}

export const labelCitationKind = (k?: string | null) => labelOf(CITATION_KIND_LABELS, k);

export const labelRunMode = (k?: string | null) => labelOf(RUN_MODE_LABELS, k);
export const labelProjectMode = (k?: string | null) => labelOf(PROJECT_MODE_LABELS, k);
export const labelProjectStage = (k?: string | null) => labelOf(PROJECT_STAGE_LABELS, k);
export const labelProductLifecycleStage = (k?: string | null) => labelOf(PRODUCT_LIFECYCLE_STAGE_LABELS, k);
export const labelAgentRunStatus = (k?: string | null) => labelOf(AGENT_RUN_STATUS_LABELS, k);
export const labelAgentTaskStatus = (k?: string | null) => labelOf(AGENT_TASK_STATUS_LABELS, k);
export const labelAnalysisRunKind = (k?: string | null) => labelOf(ANALYSIS_RUN_KIND_LABELS, k);
export const labelEvidenceLevel = (k?: string | null) => labelOf(EVIDENCE_LEVEL_LABELS, k);
export const labelSquadLifecycleStatus = (k?: string | null) => labelOf(SQUAD_LIFECYCLE_STATUS_LABELS, k);
export const labelChannelRuleRecordStatus = (k?: string | null) => labelOf(CHANNEL_RULE_RECORD_STATUS_LABELS, k);
export const labelKnowledgeSourceKind = (k?: string | null) => labelOf(KNOWLEDGE_SOURCE_KIND_LABELS, k);
export const labelKnowledgeSyncStatus = (k?: string | null) => labelOf(KNOWLEDGE_SYNC_STATUS_LABELS, k);
export const labelCompanyFactStatus = (k?: string | null) => labelOf(COMPANY_FACT_STATUS_LABELS, k);
export const labelEvidenceVerifyStatus = (k?: string | null) => labelOf(EVIDENCE_VERIFY_STATUS_LABELS, k);
export const labelEvidenceNature = (k?: string | null) => labelOf(EVIDENCE_NATURE_LABELS, k);
export const labelEvidenceClaimKind = (k?: string | null) => labelOf(EVIDENCE_CLAIM_KIND_LABELS, k);
export const labelValidationStatus = (k?: string | null) => labelOf(VALIDATION_STATUS_LABELS, k);
export const labelDecisionPacketStatus = (k?: string | null) => labelOf(DECISION_PACKET_STATUS_LABELS, k);
export const labelDecisionOutcome = (k?: string | null) => labelOf(DECISION_OUTCOME_LABELS, k);
export const labelLaunchPlanStatus = (k?: string | null) => labelOf(LAUNCH_PLAN_STATUS_LABELS, k);
export const labelLaunchMilestoneStatus = (k?: string | null) => labelOf(LAUNCH_MILESTONE_STATUS_LABELS, k);
export const labelWorkItemStatus = (k?: string | null) => labelOf(WORK_ITEM_STATUS_LABELS, k);
export const labelWorkExecutorType = (k?: string | null) => labelOf(WORK_EXECUTOR_TYPE_LABELS, k);
export const labelArtifactType = (k?: string | null) => labelOf(ARTIFACT_TYPE_LABELS, k);
export const labelFeedbackStatus = (k?: string | null) => labelOf(FEEDBACK_STATUS_LABELS, k);
export const labelArtifactReviewStatus = (k?: string | null) => labelOf(ARTIFACT_REVIEW_STATUS_LABELS, k);
export const labelArtifactApplicabilityStatus = (k?: string | null) => labelOf(ARTIFACT_APPLICABILITY_STATUS_LABELS, k);
export const labelResearchRunStatus = (k?: string | null) => labelOf(RESEARCH_RUN_STATUS_LABELS, k);
export const labelDataGapStatus = (k?: string | null) => labelOf(DATA_GAP_STATUS_LABELS, k);
export const labelModelRunStatus = (k?: string | null) => labelOf(MODEL_RUN_STATUS_LABELS, k);
export const labelProjectTimelineStatus = (k?: string | null) => labelOf(PROJECT_TIMELINE_STATUS_LABELS, k);
export const labelActionProposalStatus = (k?: string | null) => labelOf(ACTION_PROPOSAL_STATUS_LABELS, k);
export const labelOpportunityType = (k?: string | null) => labelOf(OPPORTUNITY_TYPE_LABELS, k);
export const labelOpportunityElement = (k?: string | null) => labelOf(OPPORTUNITY_ELEMENT_LABELS, k);
export const labelAuditAction = (k?: string | null) => labelOf(AUDIT_ACTION_LABELS, k);
export const labelChannelSpecRouteStatus = (k?: string | null) => labelOf(CHANNEL_SPEC_ROUTE_STATUS_LABELS, k);
export const labelProductValidationOutcome = (k?: string | null) => labelOf(PRODUCT_VALIDATION_OUTCOME_LABELS, k);
export const labelBacktestAlignment = (k?: string | null) => labelOf(BACKTEST_ALIGNMENT_LABELS, k);
export const labelExperienceLessonStatus = (k?: string | null) => labelOf(EXPERIENCE_LESSON_STATUS_LABELS, k);
export const labelLaunchMilestoneKind = (k?: string | null) => labelOf(LAUNCH_MILESTONE_KIND_LABELS, k);
export const labelScoreDimension = (k?: string | null) => labelOf(SCORE_DIMENSION_LABELS, k);
export const labelProductSpecField = (k?: string | null) => labelOf(PRODUCT_SPEC_FIELD_LABELS, k);
