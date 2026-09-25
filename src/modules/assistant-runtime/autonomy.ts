/**
 * Kern risk-based autonomy policy.
 *
 * Product rule: a clear user instruction is already authorization for ordinary
 * internal work. Ask again only when the capability itself carries a protected
 * side effect or the target is genuinely ambiguous.
 */

export type KernAutonomyDecision = "AUTO" | "ASK" | "DENY";
export type KernReversibility = "REVERSIBLE" | "COMPENSATABLE" | "IRREVERSIBLE";

export interface KernCapabilityRisk {
  capability: string;
  explicitUserInstruction: boolean;
  targetResolved: boolean;
  reversibility: KernReversibility;
  externalSideEffect: boolean;
  financialImpact: boolean;
  permissionSensitive: boolean;
  productionRelease: boolean;
  formalBusinessGate: boolean;
  destructive: boolean;
}

export interface KernAutonomyAssessment {
  decision: KernAutonomyDecision;
  reasons: string[];
}

export function assessKernCapabilityRisk(
  input: KernCapabilityRisk
): KernAutonomyAssessment {
  const reasons: string[] = [];

  if (!input.explicitUserInstruction) {
    return { decision: "ASK", reasons: ["EXPLICIT_INSTRUCTION_REQUIRED"] };
  }
  if (!input.targetResolved) {
    return { decision: "ASK", reasons: ["AMBIGUOUS_TARGET"] };
  }

  if (input.financialImpact) reasons.push("FINANCIAL_IMPACT");
  if (input.externalSideEffect) reasons.push("EXTERNAL_SIDE_EFFECT");
  if (input.permissionSensitive) reasons.push("PERMISSION_SENSITIVE");
  if (input.productionRelease) reasons.push("PRODUCTION_RELEASE");
  if (input.formalBusinessGate) reasons.push("FORMAL_BUSINESS_GATE");
  if (input.destructive) reasons.push("DESTRUCTIVE");
  if (input.reversibility === "IRREVERSIBLE") reasons.push("IRREVERSIBLE");

  if (reasons.length > 0) {
    return { decision: "ASK", reasons };
  }

  return {
    decision: "AUTO",
    reasons: [
      input.reversibility === "REVERSIBLE"
        ? "INTERNAL_REVERSIBLE"
        : "INTERNAL_COMPENSATABLE",
    ],
  };
}

type ProposalAutonomyProfile = {
  intent: string;
  actionType: string;
  risk: Omit<KernCapabilityRisk, "capability" | "explicitUserInstruction" | "targetResolved">;
};

const PROPOSAL_AUTONOMY_PROFILES: ProposalAutonomyProfile[] = [
  {
    intent: "PROPOSE_FIELD_CHANGE",
    actionType: "UPDATE_FIELD",
    risk: {
      reversibility: "REVERSIBLE",
      externalSideEffect: false,
      financialImpact: false,
      permissionSensitive: false,
      productionRelease: false,
      formalBusinessGate: false,
      destructive: false,
    },
  },
  {
    intent: "PROPOSE_CREATE_WORK_ITEM",
    actionType: "CREATE_WORK_ITEM",
    risk: {
      reversibility: "REVERSIBLE",
      externalSideEffect: false,
      financialImpact: false,
      permissionSensitive: false,
      productionRelease: false,
      formalBusinessGate: false,
      destructive: false,
    },
  },
  {
    intent: "NEW_PRODUCT_INTAKE",
    actionType: "CREATE_PRODUCT",
    risk: {
      reversibility: "COMPENSATABLE",
      externalSideEffect: false,
      financialImpact: false,
      permissionSensitive: false,
      productionRelease: false,
      formalBusinessGate: false,
      destructive: false,
    },
  },
];

export function assessChatProposalAutonomy(input: {
  intent: string;
  actionType: string;
  targetResolved?: boolean;
}): KernAutonomyAssessment {
  const profile = PROPOSAL_AUTONOMY_PROFILES.find(
    (candidate) =>
      candidate.intent === input.intent &&
      candidate.actionType === input.actionType
  );

  if (!profile) {
    return { decision: "ASK", reasons: ["NO_AUTO_PROFILE"] };
  }

  return assessKernCapabilityRisk({
    capability: `proposal:${input.actionType}`,
    explicitUserInstruction: true,
    targetResolved: input.targetResolved ?? true,
    ...profile.risk,
  });
}

/** Compatibility helper for the current proposal executor. */
export function shouldAutoApplyChatProposal(input: {
  intent: string;
  actionType: string;
  targetResolved?: boolean;
}): boolean {
  return assessChatProposalAutonomy(input).decision === "AUTO";
}

export const KERN_HUMAN_GATE_PRINCIPLE =
  "Ask only for protected, irreversible, external, financial, permission-sensitive, production-release, formal-gate, destructive, or genuinely ambiguous actions.";
