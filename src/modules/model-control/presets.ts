import type {
  ModelCapability,
  ModelCostTier,
  ModelLatencyTier,
  ModelLocality,
  ModelQualityTier,
  ModelTaskClass,
} from "@/modules/model-gateway";

export interface ModelProfilePreset {
  key: string;
  displayName: string;
  description: string;
  provider: string;
  modelId: string;
  capabilities: ModelCapability[];
  locality: ModelLocality;
  qualityTier: ModelQualityTier;
  latencyTier: ModelLatencyTier;
  costTier: ModelCostTier;
  contextWindow: number | null;
  dataPolicyNote: string | null;
  enabled: boolean;
}

export interface ModelPolicyPreset {
  key: string;
  name: string;
  description: string;
  version: string;
  taskClass: ModelTaskClass;
  candidates: Array<{ profileKey: string; priority: number }>;
  requiredCapabilities: ModelCapability[];
  cloudAllowed: boolean;
  maxContextRequirement: number | null;
}

export interface AgentModelBindingPreset {
  agentCode: string;
  taskClass: ModelTaskClass;
  policyKey: string;
}

export const MODEL_TASK_CLASSES: ModelTaskClass[] = [
  "QUICK_CLASSIFY",
  "QUICK_RESEARCH",
  "WEB_RESEARCH",
  "SUMMARIZATION",
  "STRUCTURED_EXTRACTION",
  "PRODUCT_ANALYSIS",
  "STRATEGIC_CONSULTING",
  "RED_TEAM",
  "DECISION_REVIEW",
  "CODING",
  "ASSISTANT_DIALOGUE",
  "ASSISTANT_PLANNING",
  "ASSISTANT_SYNTHESIS",
];

export const MODEL_CAPABILITIES: ModelCapability[] = [
  "TEXT",
  "VISION",
  "TOOLS",
  "STRUCTURED_OUTPUT",
  "REASONING",
  "LONG_CONTEXT",
];

/**
 * Official presets are intentionally disabled model slots.
 *
 * We do not guess a vendor's current model id, API availability or price.
 * Operators fill provider/modelId and enable the slot explicitly.
 */
export const MODEL_PROFILE_PRESETS: ModelProfilePreset[] = [
  {
    key: "muse-glimmer-resident-slot",
    displayName: "Department Assistant 本地常驻位（Muse Glimmer）",
    description: "常驻对话、规划与总结模型位。推荐配置 Muse Glimmer 或等价本地 agentic 模型；模型身份可替换，产品身份始终是 Department Assistant。",
    provider: "muse-local",
    modelId: "muse-glimmer",
    capabilities: ["TEXT", "TOOLS", "STRUCTURED_OUTPUT", "REASONING", "LONG_CONTEXT"],
    locality: "LOCAL",
    qualityTier: "BALANCED",
    latencyTier: "NORMAL",
    costTier: "FIXED_LOCAL",
    contextWindow: null,
    dataPolicyNote: "默认本地优先；未显式配置时保持禁用，不因 Muse 不可用而改变治理语义。",
    enabled: false,
  },
  {
    key: "routine-low-cost-slot",
    displayName: "日常低成本执行位",
    description: "高频分类、摘要、轻研究。建议接 Agnes 或同级低成本快速模型。",
    provider: "UNCONFIGURED",
    modelId: "UNCONFIGURED",
    capabilities: ["TEXT", "STRUCTURED_OUTPUT"],
    locality: "CLOUD",
    qualityTier: "FAST",
    latencyTier: "FAST",
    costTier: "LOW",
    contextWindow: null,
    dataPolicyNote: "仅在明确配置 provider/modelId 后启用；不得静默升级到高价模型。",
    enabled: false,
  },
  {
    key: "strategic-frontier-slot",
    displayName: "核心产品研发位",
    description: "产品战略、复杂咨询和关键方案评审。建议接当前可用的 Frontier reasoning 模型。",
    provider: "UNCONFIGURED",
    modelId: "UNCONFIGURED",
    capabilities: ["TEXT", "STRUCTURED_OUTPUT", "REASONING", "LONG_CONTEXT"],
    locality: "CLOUD",
    qualityTier: "FRONTIER",
    latencyTier: "SLOW",
    costTier: "PREMIUM",
    contextWindow: null,
    dataPolicyNote: "只用于明确的高价值任务；费用和数据边界由组织自行配置。",
    enabled: false,
  },
  {
    key: "red-team-frontier-slot",
    displayName: "红队复核位",
    description: "证伪、反例、重大决策复核。质量优先于成本。",
    provider: "UNCONFIGURED",
    modelId: "UNCONFIGURED",
    capabilities: ["TEXT", "STRUCTURED_OUTPUT", "REASONING"],
    locality: "CLOUD",
    qualityTier: "FRONTIER",
    latencyTier: "NORMAL",
    costTier: "PREMIUM",
    contextWindow: null,
    dataPolicyNote: "不得用低成本偏好覆盖红队最低能力要求。",
    enabled: false,
  },
  {
    key: "private-local-slot",
    displayName: "私密本地执行位",
    description: "禁止上云的结构化提取与内部资料处理。",
    provider: "UNCONFIGURED",
    modelId: "UNCONFIGURED",
    capabilities: ["TEXT", "STRUCTURED_OUTPUT"],
    locality: "LOCAL",
    qualityTier: "BALANCED",
    latencyTier: "NORMAL",
    costTier: "FIXED_LOCAL",
    contextWindow: null,
    dataPolicyNote: "cloudAllowed=false 的策略只能选择 LOCAL profile。",
    enabled: false,
  },
];

export const MODEL_POLICY_PRESETS: ModelPolicyPreset[] = [
  {
    key: "assistant-dialogue-resident",
    name: "Department Assistant 日常对话",
    description: "本地常驻对话策略；首版只使用显式配置的本地 resident 模型，不静默出云。",
    version: "2026-09-24-v1",
    taskClass: "ASSISTANT_DIALOGUE",
    candidates: [{ profileKey: "muse-glimmer-resident-slot", priority: 10 }],
    requiredCapabilities: ["TEXT"],
    cloudAllowed: false,
    maxContextRequirement: null,
  },
  {
    key: "assistant-planning-resident",
    name: "Department Assistant 规划",
    description: "任务拆解、上下文理解和委派规划；本地优先且要求结构化输出与推理。",
    version: "2026-09-24-v1",
    taskClass: "ASSISTANT_PLANNING",
    candidates: [{ profileKey: "muse-glimmer-resident-slot", priority: 10 }],
    requiredCapabilities: ["TEXT", "STRUCTURED_OUTPUT", "REASONING"],
    cloudAllowed: false,
    maxContextRequirement: null,
  },
  {
    key: "assistant-synthesis-resident",
    name: "Department Assistant 汇总",
    description: "把已验证结果组织成管理者可读输出；不允许模型改变证据等级或绕过业务治理。",
    version: "2026-09-24-v1",
    taskClass: "ASSISTANT_SYNTHESIS",
    candidates: [{ profileKey: "muse-glimmer-resident-slot", priority: 10 }],
    requiredCapabilities: ["TEXT", "REASONING"],
    cloudAllowed: false,
    maxContextRequirement: null,
  },
  {
    key: "routine-quick-classify",
    name: "日常分类",
    description: "高频低成本分类；失败只能在该策略候选内 fallback。",
    version: "2026-09-22-v1",
    taskClass: "QUICK_CLASSIFY",
    candidates: [{ profileKey: "routine-low-cost-slot", priority: 10 }],
    requiredCapabilities: ["TEXT"],
    cloudAllowed: true,
    maxContextRequirement: null,
  },
  {
    key: "routine-quick-research",
    name: "日常轻研究",
    description: "低成本研究与信息整理，不自动升级 Frontier。",
    version: "2026-09-22-v1",
    taskClass: "QUICK_RESEARCH",
    candidates: [{ profileKey: "routine-low-cost-slot", priority: 10 }],
    requiredCapabilities: ["TEXT"],
    cloudAllowed: true,
    maxContextRequirement: null,
  },
  {
    key: "routine-summarization",
    name: "日常摘要",
    description: "批量摘要和内部简报的低成本执行策略。",
    version: "2026-09-22-v1",
    taskClass: "SUMMARIZATION",
    candidates: [{ profileKey: "routine-low-cost-slot", priority: 10 }],
    requiredCapabilities: ["TEXT"],
    cloudAllowed: true,
    maxContextRequirement: null,
  },
  {
    key: "strategic-product-analysis",
    name: "核心产品分析",
    description: "产品潜力、规格路线和关键商业判断使用高质量推理模型。",
    version: "2026-09-22-v1",
    taskClass: "PRODUCT_ANALYSIS",
    candidates: [{ profileKey: "strategic-frontier-slot", priority: 10 }],
    requiredCapabilities: ["TEXT", "STRUCTURED_OUTPUT", "REASONING"],
    cloudAllowed: true,
    maxContextRequirement: null,
  },
  {
    key: "strategic-consulting",
    name: "战略顾问",
    description: "复杂咨询与跨模块综合判断，默认 Frontier 质量优先。",
    version: "2026-09-22-v1",
    taskClass: "STRATEGIC_CONSULTING",
    candidates: [{ profileKey: "strategic-frontier-slot", priority: 10 }],
    requiredCapabilities: ["TEXT", "REASONING"],
    cloudAllowed: true,
    maxContextRequirement: null,
  },
  {
    key: "red-team-review",
    name: "红队挑战",
    description: "关键假设证伪与失败路径分析。",
    version: "2026-09-22-v1",
    taskClass: "RED_TEAM",
    candidates: [{ profileKey: "red-team-frontier-slot", priority: 10 }],
    requiredCapabilities: ["TEXT", "REASONING"],
    cloudAllowed: true,
    maxContextRequirement: null,
  },
  {
    key: "decision-review",
    name: "重大决策复核",
    description: "关键决策二次复核；候选顺序显式，不允许策略外升级。",
    version: "2026-09-22-v1",
    taskClass: "DECISION_REVIEW",
    candidates: [
      { profileKey: "red-team-frontier-slot", priority: 10 },
      { profileKey: "strategic-frontier-slot", priority: 20 },
    ],
    requiredCapabilities: ["TEXT", "REASONING"],
    cloudAllowed: true,
    maxContextRequirement: null,
  },
  {
    key: "private-local-extraction",
    name: "本地私密提取",
    description: "敏感内容禁止上云，只允许本地模型。",
    version: "2026-09-22-v1",
    taskClass: "STRUCTURED_EXTRACTION",
    candidates: [{ profileKey: "private-local-slot", priority: 10 }],
    requiredCapabilities: ["TEXT", "STRUCTURED_OUTPUT"],
    cloudAllowed: false,
    maxContextRequirement: null,
  },
];

export const AGENT_MODEL_BINDING_PRESETS: AgentModelBindingPreset[] = [
  { agentCode: "hermes_pm", taskClass: "ASSISTANT_DIALOGUE", policyKey: "assistant-dialogue-resident" },
  { agentCode: "hermes_pm", taskClass: "ASSISTANT_PLANNING", policyKey: "assistant-planning-resident" },
  { agentCode: "hermes_pm", taskClass: "ASSISTANT_SYNTHESIS", policyKey: "assistant-synthesis-resident" },
  // Hermes PM can choose a cheap routine policy for ordinary cockpit/advisor work
  // and reserve Frontier for explicit strategic consulting.
  { agentCode: "hermes_pm", taskClass: "QUICK_CLASSIFY", policyKey: "routine-quick-classify" },
  { agentCode: "hermes_pm", taskClass: "QUICK_RESEARCH", policyKey: "routine-quick-research" },
  { agentCode: "hermes_pm", taskClass: "SUMMARIZATION", policyKey: "routine-summarization" },
  { agentCode: "hermes_pm", taskClass: "STRATEGIC_CONSULTING", policyKey: "strategic-consulting" },
  { agentCode: "product_agent", taskClass: "PRODUCT_ANALYSIS", policyKey: "strategic-product-analysis" },
  { agentCode: "research_agent", taskClass: "QUICK_RESEARCH", policyKey: "routine-quick-research" },
  { agentCode: "scientific_evidence_agent", taskClass: "QUICK_RESEARCH", policyKey: "routine-quick-research" },
  { agentCode: "scientific_evidence_agent", taskClass: "DECISION_REVIEW", policyKey: "decision-review" },
  { agentCode: "formulation_agent", taskClass: "PRODUCT_ANALYSIS", policyKey: "strategic-product-analysis" },
  { agentCode: "compliance_agent", taskClass: "QUICK_RESEARCH", policyKey: "routine-quick-research" },
  { agentCode: "compliance_agent", taskClass: "DECISION_REVIEW", policyKey: "decision-review" },
  { agentCode: "cost_bom_agent", taskClass: "PRODUCT_ANALYSIS", policyKey: "strategic-product-analysis" },
  { agentCode: "qa_verifier", taskClass: "DECISION_REVIEW", policyKey: "decision-review" },
  { agentCode: "qa_verifier", taskClass: "RED_TEAM", policyKey: "red-team-review" },
  { agentCode: "marketing_agent", taskClass: "SUMMARIZATION", policyKey: "routine-summarization" },
  { agentCode: "ops_agent", taskClass: "QUICK_CLASSIFY", policyKey: "routine-quick-classify" },
  { agentCode: "red_team", taskClass: "RED_TEAM", policyKey: "red-team-review" },
];
