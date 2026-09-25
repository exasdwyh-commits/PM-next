import type { AssistantReflexShadowResult } from "./reflex";

export type KernCouncilMode =
  | "SOLO"
  | "SPECIALIST"
  | "PAIR"
  | "COUNCIL"
  | "RED_TEAM"
  | "FULL_RND";

export type KernModelTier = "FAST" | "BALANCED" | "FRONTIER";

export interface KernCollaborationPlanShadow {
  version: "kern-collaboration-shadow/v1";
  mode: KernCouncilMode;
  experts: string[];
  synthesisTier: KernModelTier;
  researchRequired: boolean;
  independentFirstPass: boolean;
  qaRequired: boolean;
  redTeamRequired: boolean;
  source: "REFLEX" | "DETERMINISTIC" | "HYBRID";
  reasons: string[];
}

/**
 * Shadow-only collaboration recommendation.
 *
 * This function never creates AgentTasks, never selects a concrete model profile,
 * and never changes governance. It only records what Kern *would* recommend so
 * routing quality can be evaluated before any mode is allowed to AUTO.
 */
export function buildKernCollaborationPlanShadow(input: {
  text: string;
  productBound: boolean;
  reflex: AssistantReflexShadowResult;
}): KernCollaborationPlanShadow {
  const text = input.text.trim();
  const upper = text.toUpperCase();
  const reasons: string[] = [];
  const experts = new Set<string>();

  const reflexValue = (key: string): unknown => input.reflex.decisions[key]?.value;
  const reflexExpert =
    typeof reflexValue("assistant.expert_class") === "string"
      ? String(reflexValue("assistant.expert_class")).toUpperCase()
      : null;
  const reflexComplexity =
    typeof reflexValue("assistant.complexity") === "string"
      ? String(reflexValue("assistant.complexity")).toUpperCase()
      : null;
  const reflexResearch = reflexValue("assistant.requires_research") === true;

  const add = (code: string, reason: string) => {
    experts.add(code);
    reasons.push(reason);
  };

  const expertMap: Record<string, string> = {
    PRODUCT: "product_agent",
    MARKET: "research_agent",
    SCIENCE: "scientific_evidence_agent",
    FORMULATION: "formulation_agent",
    COMPLIANCE: "compliance_agent",
    COST: "cost_bom_agent",
    SUPPLY: "ops_agent",
    QA: "qa_verifier",
    CODE: "hermes_pm",
  };
  if (reflexExpert && reflexExpert !== "NONE" && expertMap[reflexExpert]) {
    add(expertMap[reflexExpert], `REFLEX_EXPERT_${reflexExpert}`);
  }

  const keywordRules: Array<[RegExp, string, string]> = [
    [/(市场规模|市场需求|市场竞争|竞品|用户需求|渠道|价格带|成交价)/, "research_agent", "MARKET_SIGNAL"],
    [/(论文|临床|科学证据|机制|人群|剂量证据)/, "scientific_evidence_agent", "SCIENCE_SIGNAL"],
    [/(配方|剂量|剂型|原料组合|规格设计|相容性)/, "formulation_agent", "FORMULATION_SIGNAL"],
    [/(法规|合规|宣称|备案|进口|跨境|允许添加)/, "compliance_agent", "COMPLIANCE_SIGNAL"],
    [/(成本|BOM|毛利|佣金|MOQ|报价|单位经济)/i, "cost_bom_agent", "COST_SIGNAL"],
    [/(供应商|打样|生产|交期|供应链|产能)/, "ops_agent", "SUPPLY_SIGNAL"],
    [/(产品定义|价值主张|定位|产品策略|规格路线)/, "product_agent", "PRODUCT_SIGNAL"],
    [/(证伪|反方|红队|失败路径|挑战.*判断|哪里会失败)/, "red_team", "RED_TEAM_SIGNAL"],
  ];
  for (const [pattern, code, reason] of keywordRules) {
    if (pattern.test(text)) add(code, reason);
  }

  const explicitFullRnd =
    input.productBound &&
    /(?:完整|全面|正式|系统).{0,8}(?:产品研发|研发评估|开品评估)|(?:产品研发|研发评估).{0,8}(?:完整|全面|正式|系统)/.test(text);

  if (explicitFullRnd) {
    for (const code of [
      "research_agent",
      "scientific_evidence_agent",
      "formulation_agent",
      "compliance_agent",
      "cost_bom_agent",
    ]) {
      experts.add(code);
    }
    reasons.push("EXPLICIT_FULL_RND");
  }

  const explicitRedTeam = /(证伪|反方|红队|失败路径|挑战.*判断|哪里会失败)/.test(text);
  const deterministicComplexity =
    explicitFullRnd || experts.size >= 3 || text.length >= 220
      ? "HARD"
      : experts.size >= 1 || text.length >= 80
        ? "MEDIUM"
        : "SIMPLE";
  const complexity = ["SIMPLE", "MEDIUM", "HARD"].includes(reflexComplexity || "")
    ? reflexComplexity!
    : deterministicComplexity;

  const highRisk =
    /(法规|合规|审批|预算|发布|上线|合同|承诺|安全|医疗|临床|高风险)/.test(text);
  const researchRequired =
    reflexResearch ||
    [...experts].some((code) =>
      ["research_agent", "scientific_evidence_agent", "compliance_agent"].includes(code)
    ) ||
    /(最新|现在|当前|数据|证据|研究|竞品|法规)/.test(text);

  let mode: KernCouncilMode;
  if (explicitFullRnd) mode = "FULL_RND";
  else if (explicitRedTeam) mode = "RED_TEAM";
  else if (experts.size >= 3 || (complexity === "HARD" && experts.size >= 2)) mode = "COUNCIL";
  else if (experts.size === 2) mode = "PAIR";
  else if (experts.size === 1) mode = "SPECIALIST";
  else mode = "SOLO";

  const synthesisTier: KernModelTier =
    mode === "FULL_RND" ||
    mode === "RED_TEAM" ||
    mode === "COUNCIL" ||
    complexity === "HARD" ||
    highRisk
      ? "FRONTIER"
      : mode === "PAIR" || mode === "SPECIALIST" || complexity === "MEDIUM"
        ? "BALANCED"
        : "FAST";

  const source =
    input.reflex.mode === "SHADOW" && reasons.some((reason) => reason.startsWith("REFLEX_"))
      ? reasons.length > 1
        ? "HYBRID"
        : "REFLEX"
      : "DETERMINISTIC";

  if (highRisk) reasons.push("HIGH_RISK_DOMAIN");
  if (researchRequired) reasons.push("RESEARCH_REQUIRED");
  reasons.push(`COMPLEXITY_${complexity}`);

  return {
    version: "kern-collaboration-shadow/v1",
    mode,
    experts: [...experts].slice(0, 5),
    synthesisTier,
    researchRequired,
    independentFirstPass: experts.size > 1,
    qaRequired: mode === "FULL_RND" || mode === "COUNCIL" || highRisk,
    redTeamRequired: mode === "RED_TEAM" || (mode === "FULL_RND" && highRisk),
    source,
    reasons: [...new Set(reasons)],
  };
}
