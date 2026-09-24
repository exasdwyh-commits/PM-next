import type { SessionContext } from "@/modules/identity/session";
import {
  DecisionIntelligenceKernel,
  LayaDecisionEngine,
  createDefaultDecisionSpecs,
  createLayaHttpDecisionClientFromEnv,
  decideAndPersist,
} from "@/modules/decision-intelligence";

const REFLEX_KEYS = [
  "assistant.intent",
  "assistant.complexity",
  "assistant.requires_research",
  "assistant.expert_class",
  "assistant.proactive_value",
] as const;

export type AssistantReflexMode =
  | "SHADOW_UNCONFIGURED"
  | "SHADOW"
  | "SHADOW_FAILED";

export interface AssistantReflexShadowResult {
  mode: AssistantReflexMode;
  decisions: Record<
    string,
    {
      value: unknown;
      confidence: number | null;
      decisionRunId: string;
      policyAction: string;
    }
  >;
  error: string | null;
}

export async function runDepartmentAssistantReflexShadow(
  session: SessionContext,
  input: {
    text: string;
    conversationId: string;
    productId: string | null;
    linkedProjectIds: string[];
    confirmedCompanyFactRefs: string[];
  }
): Promise<AssistantReflexShadowResult> {
  let client;
  try {
    client = createLayaHttpDecisionClientFromEnv();
  } catch (error) {
    return {
      mode: "SHADOW_FAILED",
      decisions: {},
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (!client) {
    return { mode: "SHADOW_UNCONFIGURED", decisions: {}, error: null };
  }

  const state = {
    text: input.text,
    productBound: Boolean(input.productId),
    linkedProjectCount: input.linkedProjectIds.length,
    confirmedCompanyFactCount: input.confirmedCompanyFactRefs.length,
  };

  try {
    const specs = createDefaultDecisionSpecs();
    const requests = REFLEX_KEYS.map((decisionKey) => {
      const spec = specs.get(decisionKey);
      return {
        decisionKey,
        outputType: spec.outputType,
        allowedChoices: spec.allowedChoices ? [...spec.allowedChoices] : undefined,
        minScore: spec.minScore,
        maxScore: spec.maxScore,
        state,
        criteria: {
          shadow: true,
          purpose: "Department Assistant reflex telemetry",
        },
        language: "zh-CN",
      };
    });

    const precomputed = await client.decideMany(requests);
    const kernel = new DecisionIntelligenceKernel(specs);
    kernel.registerEngine(
      new LayaDecisionEngine(
        {
          async decide(request) {
            const result = precomputed.get(request.decisionKey);
            if (!result) {
              throw new Error(
                `Missing precomputed Laya decision: ${request.decisionKey}`
              );
            }
            return result;
          },
        },
        "laya-system1/http-shadow-v1"
      )
    );

    const decisions: AssistantReflexShadowResult["decisions"] = {};
    for (const decisionKey of REFLEX_KEYS) {
      const persisted = await decideAndPersist(
        session,
        kernel,
        {
          decisionKey,
          state,
          criteria: {
            shadow: true,
            source: "department-assistant",
          },
          contextRefs: [
            `conversation:${input.conversationId}`,
            ...input.linkedProjectIds.map((id) => `project:${id}`),
          ],
          language: "zh-CN",
        },
        "MODEL"
      );
      decisions[decisionKey] = {
        value: persisted.execution.engineResult.value,
        confidence: persisted.execution.engineResult.confidence,
        decisionRunId: persisted.decisionRun.id,
        policyAction: persisted.execution.policy.action,
      };
    }

    return { mode: "SHADOW", decisions, error: null };
  } catch (error) {
    return {
      mode: "SHADOW_FAILED",
      decisions: {},
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
