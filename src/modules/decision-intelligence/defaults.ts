import { DecisionSpecRegistry } from "./registry";
import { RulesDecisionEngine } from "./rules-engine";

export const WORKFORCE_AGENT_CHOICES = [
  "hermes_pm",
  "product_agent",
  "research_agent",
  "marketing_agent",
  "ops_agent",
  "red_team",
] as const;

export function createDefaultDecisionSpecs(): DecisionSpecRegistry {
  const registry = new DecisionSpecRegistry();

  registry.register({
    key: "workforce.route_agent",
    version: "v1",
    outputType: "CHOICE",
    riskClass: "LOW",
    allowedEngines: ["RULES", "MODEL"],
    allowedChoices: [...WORKFORCE_AGENT_CHOICES],
    automation: {
      autoPolicy: "RULES_ONLY",
      escalationTarget: "AGENT",
    },
    description: "Route a low-risk work item to the best workforce Agent.",
  });

  registry.register({
    key: "workforce.needs_human",
    version: "v1",
    outputType: "BOOLEAN",
    riskClass: "MEDIUM",
    allowedEngines: ["RULES", "MODEL"],
    automation: {
      autoPolicy: "RULES_ONLY",
      escalationTarget: "HUMAN",
    },
    description: "Determine whether a workflow must stop for human judgment.",
  });

  registry.register({
    key: "signal.should_wake_pm",
    version: "v1",
    outputType: "BOOLEAN",
    riskClass: "LOW",
    allowedEngines: ["RULES", "MODEL"],
    automation: {
      autoPolicy: "RULES_ONLY",
      escalationTarget: "AGENT",
    },
    description: "Decide whether a signal is actionable enough to wake Hermes PM.",
  });

  registry.register({
    key: "workforce.task_priority",
    version: "v1",
    outputType: "SCORE",
    riskClass: "LOW",
    allowedEngines: ["RULES", "MODEL"],
    minScore: 0,
    maxScore: 100,
    automation: {
      autoPolicy: "RULES_ONLY",
      escalationTarget: "AGENT",
    },
    description: "Assign a deterministic queue priority score.",
  });

  return registry;
}

function stateObject(state: unknown): Record<string, unknown> {
  return state && typeof state === "object" && !Array.isArray(state)
    ? (state as Record<string, unknown>)
    : {};
}

function bool(state: Record<string, unknown>, key: string): boolean {
  return state[key] === true;
}

function str(state: Record<string, unknown>, key: string): string {
  return typeof state[key] === "string"
    ? String(state[key]).trim().toUpperCase()
    : "";
}

export function createDefaultRulesDecisionEngine(): RulesDecisionEngine {
  const engine = new RulesDecisionEngine();

  engine.register("workforce.route_agent", "v1", (_spec, request) => {
    const state = stateObject(request.state);
    if (
      bool(state, "requiresChallenge") ||
      bool(state, "redTeam") ||
      str(state, "taskClass") === "RED_TEAM"
    ) {
      return { value: "red_team", reasonCodes: ["RED_TEAM_REQUIRED"] };
    }
    if (bool(state, "needsResearch") || str(state, "taskClass") === "RESEARCH") {
      return { value: "research_agent", reasonCodes: ["RESEARCH_WORK"] };
    }
    if (str(state, "taskClass") === "MARKETING") {
      return { value: "marketing_agent", reasonCodes: ["MARKETING_WORK"] };
    }
    if (str(state, "taskClass") === "OPS") {
      return { value: "ops_agent", reasonCodes: ["OPS_WORK"] };
    }
    if (str(state, "taskClass") === "PRODUCT") {
      return { value: "product_agent", reasonCodes: ["PRODUCT_WORK"] };
    }
    return { value: "hermes_pm", reasonCodes: ["DEFAULT_PM_ROUTE"] };
  });

  engine.register("workforce.needs_human", "v1", (_spec, request) => {
    const state = stateObject(request.state);
    const reasonCodes: string[] = [];
    for (const [flag, code] of [
      ["businessMutation", "BUSINESS_MUTATION"],
      ["budgetApproval", "BUDGET_APPROVAL"],
      ["governanceGate", "GOVERNANCE_GATE"],
      ["highRisk", "HIGH_RISK"],
      ["externalCommitment", "EXTERNAL_COMMITMENT"],
    ] as const) {
      if (bool(state, flag)) reasonCodes.push(code);
    }
    return {
      value: reasonCodes.length > 0,
      reasonCodes:
        reasonCodes.length > 0 ? reasonCodes : ["NO_HUMAN_GATE_TRIGGERED"],
    };
  });

  engine.register("signal.should_wake_pm", "v1", (_spec, request) => {
    const state = stateObject(request.state);
    const actionable = bool(state, "actionable");
    const duplicate = bool(state, "duplicate");
    const blocked = bool(state, "blocked");
    const relevance =
      typeof state.relevanceScore === "number"
        ? state.relevanceScore
        : 0;
    const wake = actionable && !duplicate && !blocked && relevance >= 70;
    return {
      value: wake,
      reasonCodes: [
        actionable ? "ACTIONABLE" : "NOT_ACTIONABLE",
        duplicate ? "DUPLICATE" : "NOT_DUPLICATE",
        blocked ? "BLOCKED" : "NOT_BLOCKED",
        relevance >= 70 ? "RELEVANCE_THRESHOLD_MET" : "LOW_RELEVANCE",
      ],
    };
  });

  engine.register("workforce.task_priority", "v1", (_spec, request) => {
    const state = stateObject(request.state);
    let score = 40;
    const reasons: string[] = ["BASE_PRIORITY"];
    if (bool(state, "blocking")) {
      score += 25;
      reasons.push("BLOCKING");
    }
    if (bool(state, "customerImpact")) {
      score += 15;
      reasons.push("CUSTOMER_IMPACT");
    }
    if (bool(state, "timeSensitive")) {
      score += 10;
      reasons.push("TIME_SENSITIVE");
    }
    if (bool(state, "lowConfidence")) {
      score -= 10;
      reasons.push("LOW_CONFIDENCE");
    }
    return {
      value: Math.max(0, Math.min(100, score)),
      reasonCodes: reasons,
    };
  });

  return engine;
}
