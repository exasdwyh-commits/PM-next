import type { SessionContext } from "@/modules/identity/session";
import { applyProposal } from "@/modules/advisor/proposals";
import { assessChatProposalAutonomy } from "./autonomy";

export interface KernProposalBackedResult {
  text: string;
  citations: { kind: string; ref: string; title: string }[];
  proposal?: {
    proposalId: string;
    created: boolean;
    actionType: string;
  } | null;
}

export async function applyExplicitChatProposal<
  T extends KernProposalBackedResult,
>(
  session: SessionContext,
  input: {
    intent: string;
    runId: string;
    result: T;
    targetResolved?: boolean;
  }
): Promise<T> {
  const proposal = input.result.proposal;
  if (!proposal) return input.result;

  const autonomy = assessChatProposalAutonomy({
    intent: input.intent,
    actionType: proposal.actionType,
    targetResolved: input.targetResolved,
  });

  if (autonomy.decision !== "AUTO") {
    return input.result;
  }

  try {
    const receipt = await applyProposal(session, proposal.proposalId, {
      idempotencyKey: `kern-chat:${input.runId}:${proposal.proposalId}`,
      reason: `Kern autonomy=AUTO (${autonomy.reasons.join(",")}); user explicitly authorized this internal action in chat`,
    });

    const label =
      proposal.actionType === "UPDATE_FIELD"
        ? "已按你的指令更新产品方案，并保留版本与审计回执。"
        : proposal.actionType === "CREATE_WORK_ITEM"
          ? "已按你的指令创建内部工作项，并写入审计回执。"
          : proposal.actionType === "CREATE_PRODUCT"
            ? "已按你在本次对话中给出的信息创建产品、初始版本和项目，并继续绑定在这个会话里。"
            : "已执行。";

    return {
      ...input.result,
      text: label,
      citations: [
        ...input.result.citations.filter((citation) => citation.kind !== "proposal"),
        {
          kind: "action-receipt",
          ref: receipt.proposalId,
          title: `执行回执：${proposal.actionType}`,
        },
      ],
      proposal: null,
    };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ...input.result,
      text: `我理解你的执行指令，但这次没有完成：${reason}`,
      proposal: null,
    };
  }
}
