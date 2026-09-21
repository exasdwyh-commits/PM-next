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
  LAUNCH_APPROVAL_REVOKED: "撤销上市批准",
  LAUNCH_EXECUTED: "确认实际上市",
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
export const labelFeedbackStatus = (k?: string | null) => labelOf(FEEDBACK_STATUS_LABELS, k);
export const labelArtifactReviewStatus = (k?: string | null) => labelOf(ARTIFACT_REVIEW_STATUS_LABELS, k);
export const labelArtifactApplicabilityStatus = (k?: string | null) => labelOf(ARTIFACT_APPLICABILITY_STATUS_LABELS, k);
export const labelResearchRunStatus = (k?: string | null) => labelOf(RESEARCH_RUN_STATUS_LABELS, k);
export const labelDataGapStatus = (k?: string | null) => labelOf(DATA_GAP_STATUS_LABELS, k);
export const labelActionProposalStatus = (k?: string | null) => labelOf(ACTION_PROPOSAL_STATUS_LABELS, k);
export const labelOpportunityType = (k?: string | null) => labelOf(OPPORTUNITY_TYPE_LABELS, k);
export const labelOpportunityElement = (k?: string | null) => labelOf(OPPORTUNITY_ELEMENT_LABELS, k);
export const labelAuditAction = (k?: string | null) => labelOf(AUDIT_ACTION_LABELS, k);
export const labelLaunchMilestoneKind = (k?: string | null) => labelOf(LAUNCH_MILESTONE_KIND_LABELS, k);
export const labelScoreDimension = (k?: string | null) => labelOf(SCORE_DIMENSION_LABELS, k);
export const labelProductSpecField = (k?: string | null) => labelOf(PRODUCT_SPEC_FIELD_LABELS, k);
