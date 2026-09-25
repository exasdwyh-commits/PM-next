/**
 * Kern conversation-first autonomy policy.
 *
 * The user should not have to approve the same low-risk instruction twice.
 * This policy only covers deterministic chat commands that already passed
 * existing authorization/version checks through ActionProposal.
 *
 * Protected business gates, destructive/external actions and ambiguous
 * operations stay outside this list and continue to require human control.
 */

export type KernAutoApplyProposalAction =
  | "UPDATE_FIELD"
  | "CREATE_WORK_ITEM"
  | "CREATE_PRODUCT";

const AUTO_APPLY_BY_INTENT: Record<string, ReadonlySet<KernAutoApplyProposalAction>> = {
  PROPOSE_FIELD_CHANGE: new Set(["UPDATE_FIELD"]),
  PROPOSE_CREATE_WORK_ITEM: new Set(["CREATE_WORK_ITEM"]),
  NEW_PRODUCT_INTAKE: new Set(["CREATE_PRODUCT"]),
};

export function shouldAutoApplyChatProposal(input: {
  intent: string;
  actionType: string;
}): boolean {
  const allowed = AUTO_APPLY_BY_INTENT[input.intent];
  return Boolean(
    allowed &&
      allowed.has(input.actionType as KernAutoApplyProposalAction)
  );
}

export const KERN_HUMAN_GATE_PRINCIPLE =
  "Only interrupt the user for protected, irreversible, external-commitment, payment, permission, destructive, production-release, or genuinely ambiguous actions.";
