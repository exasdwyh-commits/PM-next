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

  registry.register(
    {
      key: "signal.should_wake_pm",
      version: "v2",
      outputType: "BOOLEAN",
      riskClass: "LOW",
      allowedEngines: ["RULES", "MODEL"],
      automation: {
        autoPolicy: "RULES_ONLY",
        escalationTarget: "AGENT",
      },
      description:
        "Wake Hermes PM only from real signal fields: high value tier plus an explicit value rationale; do not invent a continuous relevance score.",
    },
    { active: false }
  );

  registry.register({
    key: "product_version.should_red_team",
    version: "v1",
    outputType: "BOOLEAN",
    riskClass: "LOW",
    allowedEngines: ["RULES", "MODEL"],
    automation: {
      autoPolicy: "RULES_ONLY",
      escalationTarget: "AGENT",
    },
    description:
      "Wake Red Team after a published immutable ProductVersion so changed assumptions are challenged before downstream execution.",
  });

  registry.register({
    key: "evidence.should_wake_pm",
    version: "v1",
    outputType: "BOOLEAN",
    riskClass: "LOW",
    allowedEngines: ["RULES", "MODEL"],
    automation: {
      autoPolicy: "RULES_ONLY",
      escalationTarget: "AGENT",
    },
    description:
      "Wake Hermes PM when formally verified REAL evidence may change product or project conclusions.",
  });

  registry.register({
    key: "workforce.resume_parent",
    version: "v1",
    outputType: "CHOICE",
    riskClass: "LOW",
    allowedEngines: ["RULES"],
    allowedChoices: [...WORKFORCE_AGENT_CHOICES],
    automation: {
      autoPolicy: "RULES_ONLY",
      escalationTarget: "AGENT",
    },
    description:
      "Return a terminal delegated child result to the original parent Agent for review without mutating the original parent task state.",
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

  // Department Assistant reflex decisions. These are deliberately shadow-only:
  // Laya may recommend, but PolicyGate will not AUTO until benchmark/calibration
  // and an explicit policy change are approved.
  registry.register({
    key: "assistant.intent",
    version: "v1",
    outputType: "CHOICE",
    riskClass: "LOW",
    allowedEngines: ["MODEL"],
    allowedChoices: ["CHAT", "PROJECT", "RESEARCH", "ACTION"],
    automation: { autoPolicy: "DISABLED", escalationTarget: "AGENT" },
    description: "System-1 intent classification for the Department Assistant.",
  });

  registry.register({
    key: "assistant.complexity",
    version: "v1",
    outputType: "CHOICE",
    riskClass: "LOW",
    allowedEngines: ["MODEL"],
    allowedChoices: ["SIMPLE", "MEDIUM", "HARD"],
    automation: { autoPolicy: "DISABLED", escalationTarget: "AGENT" },
    description: "System-1 complexity estimate; advisory only.",
  });

  registry.register({
    key: "assistant.requires_research",
    version: "v1",
    outputType: "BOOLEAN",
    riskClass: "LOW",
    allowedEngines: ["MODEL"],
    automation: { autoPolicy: "DISABLED", escalationTarget: "AGENT" },
    description: "System-1 hint for whether fresh external research is required.",
  });

  registry.register({
    key: "assistant.expert_class",
    version: "v1",
    outputType: "CHOICE",
    riskClass: "LOW",
    allowedEngines: ["MODEL"],
    allowedChoices: [
      "NONE",
      "PRODUCT",
      "MARKET",
      "SCIENCE",
      "FORMULATION",
      "COMPLIANCE",
      "COST",
      "SUPPLY",
      "CODE",
      "QA",
    ],
    automation: { autoPolicy: "DISABLED", escalationTarget: "AGENT" },
    description: "System-1 expert class recommendation; does not itself delegate.",
  });

  registry.register({
    key: "assistant.proactive_value",
    version: "v1",
    outputType: "SCORE",
    riskClass: "LOW",
    allowedEngines: ["MODEL"],
    minScore: 0,
    maxScore: 100,
    automation: { autoPolicy: "DISABLED", escalationTarget: "AGENT" },
    description: "System-1 ranking signal for proactive work candidates.",
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

  engine.register("signal.should_wake_pm", "v2", (_spec, request) => {
    const state = stateObject(request.state);
    const highValue = str(state, "valueTier") === "HIGH";
    const hasValueReason = bool(state, "hasValueReason");
    const realSignal = str(state, "nature") === "REAL";
    const blocked = bool(state, "blocked");
    const wake = highValue && hasValueReason && realSignal && !blocked;
    return {
      value: wake,
      reasonCodes: [
        highValue ? "HIGH_VALUE_TIER" : "NOT_HIGH_VALUE",
        hasValueReason ? "VALUE_REASON_PRESENT" : "VALUE_REASON_MISSING",
        realSignal ? "REAL_SIGNAL" : "NON_REAL_SIGNAL",
        blocked ? "BLOCKED" : "NOT_BLOCKED",
      ],
    };
  });

  engine.register("product_version.should_red_team", "v1", (_spec, request) => {
    const state = stateObject(request.state);
    const versionTag = str(state, "versionTag");
    const immutable = bool(state, "isImmutable");
    const wake = versionTag.length > 0 && immutable;
    return {
      value: wake,
      reasonCodes: [
        versionTag.length > 0 ? "VERSION_TAG_PRESENT" : "VERSION_TAG_MISSING",
        immutable ? "IMMUTABLE_VERSION" : "MUTABLE_VERSION",
        bool(state, "isConfirmed") ? "BUSINESS_CONFIRMED" : "NOT_BUSINESS_CONFIRMED",
        bool(state, "hasUnknowns") ? "UNKNOWNS_PRESENT" : "NO_DECLARED_UNKNOWNS",
      ],
    };
  });

  engine.register("evidence.should_wake_pm", "v1", (_spec, request) => {
    const state = stateObject(request.state);
    const verified = str(state, "verifyStatus") === "VERIFIED";
    const real = str(state, "nature") === "REAL";
    return {
      value: verified && real,
      reasonCodes: [
        verified ? "EVIDENCE_VERIFIED" : "EVIDENCE_NOT_VERIFIED",
        real ? "REAL_EVIDENCE" : "NON_REAL_EVIDENCE",
      ],
    };
  });

  engine.register("workforce.resume_parent", "v1", (spec, request) => {
    const state = stateObject(request.state);
    const raw =
      typeof state.parentAgentCode === "string"
        ? state.parentAgentCode.trim()
        : "";
    const allowed = spec.allowedChoices ?? [];
    if (!allowed.includes(raw)) {
      throw new Error("Invalid parentAgentCode for workforce.resume_parent");
    }
    return {
      value: raw,
      reasonCodes: [
        "PARENT_AGENT_RESOLVED",
        str(state, "childOutcome") === "SUCCEEDED"
          ? "CHILD_SUCCEEDED"
          : str(state, "childOutcome") === "FAILED"
            ? "CHILD_FAILED"
            : "CHILD_TERMINAL",
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
