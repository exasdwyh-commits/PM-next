import { DecisionSpecRegistry } from "./registry";
import {
  RulesDecisionEngine,
  type RuleDecisionHandler,
} from "./rules-engine";

export const WORKFORCE_AGENT_CHOICES = [
  "hermes_pm",
  "product_agent",
  "research_agent",
  "marketing_agent",
  "ops_agent",
  "red_team",
] as const;

export const INTELLIGENCE_LEVEL_CHOICES = ["L0", "L1", "L2", "L3"] as const;
export const COMPLETION_STATUS_CHOICES = [
  "COMPLETE",
  "VERIFY_MORE",
  "INCOMPLETE",
  "WAITING_HUMAN",
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

  registry.register(
    {
      key: "workforce.route_agent",
      version: "v2",
      outputType: "CHOICE",
      riskClass: "LOW",
      allowedEngines: ["RULES", "MODEL"],
      allowedChoices: [...WORKFORCE_AGENT_CHOICES],
      automation: {
        autoPolicy: "RULES_ONLY",
        escalationTarget: "AGENT",
      },
      description:
        "Provider-ready route contract. Provider judgment may advise, but only deterministic rules may auto-route until benchmark policy is explicitly enabled.",
    },
    { active: false }
  );

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

  registry.register(
    {
      key: "workforce.needs_human",
      version: "v2",
      outputType: "BOOLEAN",
      riskClass: "MEDIUM",
      allowedEngines: ["RULES", "MODEL"],
      automation: {
        autoPolicy: "RULES_ONLY",
        escalationTarget: "HUMAN",
      },
      description:
        "Provider-ready human-escalation contract with the same fail-closed business boundaries as v1.",
    },
    { active: false }
  );

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

  registry.register({
    key: "intelligence.route_level",
    version: "v1",
    outputType: "CHOICE",
    riskClass: "LOW",
    allowedEngines: ["RULES", "MODEL"],
    allowedChoices: [...INTELLIGENCE_LEVEL_CHOICES],
    automation: {
      autoPolicy: "RULES_ONLY",
      escalationTarget: "AGENT",
    },
    description:
      "Choose the bounded L0-L3 intelligence tier. This routes compute; it does not approve a business mutation.",
  });

  registry.register({
    key: "completion.status",
    version: "v1",
    outputType: "CHOICE",
    riskClass: "MEDIUM",
    allowedEngines: ["RULES", "MODEL"],
    allowedChoices: [...COMPLETION_STATUS_CHOICES],
    automation: {
      autoPolicy: "RULES_ONLY",
      escalationTarget: "HUMAN",
    },
    description:
      "Triage whether an execution has enough evidence to be complete, needs more verification, is incomplete, or is waiting for a human. It does not merge code or approve a business gate.",
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

function finiteNumber(
  state: Record<string, unknown>,
  key: string
): number | null {
  return typeof state[key] === "number" && Number.isFinite(state[key])
    ? Number(state[key])
    : null;
}

const routeAgentRule: RuleDecisionHandler = (_spec, request) => {
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
};

const needsHumanRule: RuleDecisionHandler = (_spec, request) => {
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
};

export function createDefaultRulesDecisionEngine(): RulesDecisionEngine {
  const engine = new RulesDecisionEngine();

  engine.register("workforce.route_agent", "v1", routeAgentRule);
  engine.register("workforce.route_agent", "v2", routeAgentRule);

  engine.register("workforce.needs_human", "v1", needsHumanRule);
  engine.register("workforce.needs_human", "v2", needsHumanRule);

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

  engine.register("intelligence.route_level", "v1", (_spec, request) => {
    const state = stateObject(request.state);
    const requested = str(state, "requestedMode");

    if (bool(state, "forceDeepCouncil") || requested === "L3") {
      return { value: "L3", reasonCodes: ["DEEP_COUNCIL_EXPLICIT"] };
    }
    if (
      bool(state, "coreProduct") ||
      bool(state, "deepAnalysis") ||
      requested === "L2"
    ) {
      return { value: "L2", reasonCodes: ["CORE_ANALYSIS_REQUIRED"] };
    }
    if (
      bool(state, "complex") ||
      bool(state, "previousFailure") ||
      requested === "L1"
    ) {
      return { value: "L1", reasonCodes: ["STRONG_SINGLE_MODEL_REQUIRED"] };
    }
    return { value: "L0", reasonCodes: ["ROUTINE_EXECUTION"] };
  });

  engine.register("completion.status", "v1", (_spec, request) => {
    const state = stateObject(request.state);
    const blockingFindings = finiteNumber(state, "blockingFindings") ?? 0;

    if (bool(state, "waitingHuman")) {
      return { value: "WAITING_HUMAN", reasonCodes: ["WAITING_HUMAN"] };
    }
    if (
      blockingFindings > 0 ||
      state.requiredChecksPassed === false ||
      state.acceptanceMet === false
    ) {
      return {
        value: "INCOMPLETE",
        reasonCodes: [
          blockingFindings > 0 ? "BLOCKING_FINDINGS" : "NO_BLOCKING_FINDINGS",
          state.requiredChecksPassed === false
            ? "REQUIRED_CHECK_FAILED"
            : "REQUIRED_CHECK_NOT_FAILED",
          state.acceptanceMet === false
            ? "ACCEPTANCE_NOT_MET"
            : "ACCEPTANCE_NOT_REJECTED",
        ],
      };
    }
    if (bool(state, "verificationPending")) {
      return {
        value: "VERIFY_MORE",
        reasonCodes: ["VERIFICATION_PENDING"],
      };
    }
    if (
      state.requiredChecksPassed === true &&
      state.acceptanceMet === true
    ) {
      return {
        value: "COMPLETE",
        reasonCodes: ["REQUIRED_CHECKS_PASSED", "ACCEPTANCE_MET"],
      };
    }
    return {
      value: "VERIFY_MORE",
      reasonCodes: ["COMPLETION_EVIDENCE_INSUFFICIENT"],
    };
  });

  return engine;
}
