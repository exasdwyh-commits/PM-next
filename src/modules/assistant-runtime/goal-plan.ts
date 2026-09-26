import type {
  KernCollaborationPlanShadow,
  KernModelTier,
} from "./collaboration-planner";

export type KernGoalPlanTaskKind =
  | "PRIMARY"
  | "SPECIALIST"
  | "RED_TEAM"
  | "QA"
  | "SYNTHESIS";

export interface KernGoalPlanTask {
  taskKey: string;
  kind: KernGoalPlanTaskKind;
  objective: string;
  preferredAgentCode: string;
  requiredSkills: string[];
  requiredCapabilities: string[];
  modelTier: KernModelTier;
  dependencies: string[];
  evidenceRequired: boolean;
  outputContract: "STRUCTURED_RESULT" | "QA_REVIEW" | "USER_SYNTHESIS";
}

export interface KernGoalPlanShadow {
  version: "kern-goal-plan-shadow/v1";
  status: "SHADOW";
  goal: string;
  collaborationMode: KernCollaborationPlanShadow["mode"];
  successCriteria: string[];
  tasks: KernGoalPlanTask[];
  humanGates: string[];
  executionPolicy: {
    autoCreateAgentTasks: false;
    specialistAutoDispatch: "READINESS_GATED";
    reason: string;
  };
}

const AGENT_BLUEPRINTS: Record<
  string,
  {
    objective: string;
    skills: string[];
    capabilities: string[];
  }
> = {
  product_agent: {
    objective: "形成产品定义、用户价值、定位与方案结构判断",
    skills: ["product_strategy"],
    capabilities: ["product-write"],
  },
  research_agent: {
    objective: "研究市场、竞品、用户、渠道与价格事实，并保留来源边界",
    skills: ["evidence_research"],
    capabilities: ["knowledge"],
  },
  scientific_evidence_agent: {
    objective: "审查论文、临床、机制、人群与剂量证据，并标出外推边界",
    skills: ["scientific_evidence_review", "evidence_research"],
    capabilities: ["knowledge"],
  },
  formulation_agent: {
    objective: "形成配方、剂量、剂型、规格与制造约束判断",
    skills: ["formulation_design", "product_strategy"],
    capabilities: ["product-rnd"],
  },
  compliance_agent: {
    objective: "核对法规、原料身份、宣称与渠道适用边界",
    skills: ["compliance_review", "evidence_research"],
    capabilities: ["knowledge"],
  },
  cost_bom_agent: {
    objective: "核算 BOM、加工、包材、物流、佣金与单位经济性",
    skills: ["cost_bom"],
    capabilities: ["product-rnd"],
  },
  marketing_agent: {
    objective: "形成受目标人群、渠道与证据约束的上市与营销方案",
    skills: ["go_to_market"],
    capabilities: ["workspace"],
  },
  ops_agent: {
    objective: "把方案转成供应、打样、生产、交付与里程碑动作",
    skills: ["operational_delivery"],
    capabilities: ["workspace"],
  },
  red_team: {
    objective: "证伪关键假设，寻找反例、失败路径与未覆盖风险",
    skills: ["red_team_challenge", "evidence_research"],
    capabilities: ["challenge", "knowledge"],
  },
  qa_verifier: {
    objective: "独立检查结果完整性、证据覆盖、冲突、UNKNOWN 与治理边界",
    skills: ["independent_qa"],
    capabilities: ["knowledge"],
  },
  tech_architect_agent: {
    objective: "审查系统架构、接口、数据模型、代码结构、测试策略与技术风险",
    skills: ["technical_architecture", "operational_delivery"],
    capabilities: [],
  },
};

function blueprintFor(agentCode: string) {
  return (
    AGENT_BLUEPRINTS[agentCode] ?? {
      objective: "围绕当前目标完成专业分析并返回结构化结果",
      skills: [],
      capabilities: [],
    }
  );
}

function specialistTask(
  agentCode: string,
  index: number,
  plan: KernCollaborationPlanShadow
): KernGoalPlanTask {
  const blueprint = blueprintFor(agentCode);
  return {
    taskKey: `specialist-${index + 1}-${agentCode}`,
    kind: agentCode === "red_team" ? "RED_TEAM" : "SPECIALIST",
    objective: blueprint.objective,
    preferredAgentCode: agentCode,
    requiredSkills: blueprint.skills,
    requiredCapabilities: blueprint.capabilities,
    modelTier:
      agentCode === "red_team" || agentCode === "qa_verifier"
        ? "FRONTIER"
        : plan.synthesisTier === "FAST"
          ? "BALANCED"
          : plan.synthesisTier,
    dependencies: [],
    evidenceRequired:
      plan.researchRequired ||
      ["research_agent", "scientific_evidence_agent", "compliance_agent"].includes(
        agentCode
      ),
    outputContract: agentCode === "qa_verifier" ? "QA_REVIEW" : "STRUCTURED_RESULT",
  };
}

/**
 * 将现有 Collaboration Shadow 转换为未来可执行 Supervisor 的稳定计划协议。
 *
 * 重要：当前仍是 shadow。它不会创建 AgentTask，也不会扩大权限。
 * 这样先把 Goal → Task DAG 的语义固定并纳入回归测试，再单独启用执行层。
 */
export function buildKernGoalPlanShadow(input: {
  goal: string;
  collaboration: KernCollaborationPlanShadow;
}): KernGoalPlanShadow {
  const goal = input.goal.trim();
  const collaboration = input.collaboration;
  const specialists = [...new Set(collaboration.experts)];
  const tasks = specialists.map((agentCode, index) =>
    specialistTask(agentCode, index, collaboration)
  );

  if (
    collaboration.redTeamRequired &&
    !tasks.some((task) => task.preferredAgentCode === "red_team")
  ) {
    tasks.push(specialistTask("red_team", tasks.length, collaboration));
  }

  if (tasks.length === 0) {
    tasks.push({
      taskKey: "kern-primary",
      kind: "PRIMARY",
      objective: "由 Kern 直接完成当前目标，必要时调用受治理 capability",
      preferredAgentCode: "hermes_pm",
      requiredSkills: ["pm_orchestration"],
      requiredCapabilities: [],
      modelTier: collaboration.synthesisTier,
      dependencies: [],
      evidenceRequired: collaboration.researchRequired,
      outputContract: "STRUCTURED_RESULT",
    });
  }

  const firstPassKeys = tasks.map((task) => task.taskKey);

  if (collaboration.qaRequired) {
    tasks.push({
      taskKey: "qa-review",
      kind: "QA",
      objective: blueprintFor("qa_verifier").objective,
      preferredAgentCode: "qa_verifier",
      requiredSkills: blueprintFor("qa_verifier").skills,
      requiredCapabilities: blueprintFor("qa_verifier").capabilities,
      modelTier: "FRONTIER",
      dependencies: firstPassKeys,
      evidenceRequired: true,
      outputContract: "QA_REVIEW",
    });
  }

  tasks.push({
    taskKey: "kern-synthesis",
    kind: "SYNTHESIS",
    objective: "由 Kern 综合已完成工作，只把事实、推断、UNKNOWN、关键风险与真正需要用户决定的事项带回对话",
    preferredAgentCode: "hermes_pm",
    requiredSkills: ["pm_orchestration", "product_strategy"],
    requiredCapabilities: [],
    modelTier: collaboration.synthesisTier,
    dependencies: collaboration.qaRequired ? ["qa-review"] : firstPassKeys,
    evidenceRequired: collaboration.researchRequired,
    outputContract: "USER_SYNTHESIS",
  });

  const successCriteria = [
    "完成用户目标或明确说明仍然阻塞的真实原因",
    "事实、推断与 UNKNOWN 分离，不以模型共识替代证据",
    "所有已执行动作都有真实 Run / Tool / Receipt 来源",
    "只有真正的受保护动作或战略取舍升级给用户",
  ];
  if (collaboration.researchRequired) {
    successCriteria.push("需要外部或组织知识支持的结论必须带可追溯来源");
  }
  if (collaboration.qaRequired) {
    successCriteria.push("综合结论必须经过独立 QA 后再返回用户");
  }

  return {
    version: "kern-goal-plan-shadow/v1",
    status: "SHADOW",
    goal,
    collaborationMode: collaboration.mode,
    successCriteria,
    tasks,
    humanGates: [
      "PAYMENT_OR_FINANCIAL_COMMITMENT",
      "EXTERNAL_PUBLISH_OR_SEND",
      "IRREVERSIBLE_DELETE_OR_OVERWRITE",
      "SENSITIVE_PERMISSION_CHANGE",
      "FORMAL_BUSINESS_GATE",
      "LEGAL_OR_CONTRACT_COMMITMENT",
      "STRATEGIC_VALUE_TRADEOFF",
    ],
    executionPolicy: {
      autoCreateAgentTasks: false,
      specialistAutoDispatch: "READINESS_GATED",
      reason:
        "整张 GoalPlan DAG 仍保持 Shadow，不自动批量建任务；仅允许经过幂等、单专家、低风险、真实 executor/model/provider readiness 校验的 specialist 试点独立 AUTO。",
    },
  };
}
