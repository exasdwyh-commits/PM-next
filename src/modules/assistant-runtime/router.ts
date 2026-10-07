import type { SessionContext } from "@/modules/identity/session";
import { isDesktopInstruction } from "@/modules/desktop-runtime";
import { tryResolveGatewayPolicyForAgentCode } from "@/modules/model-control/service";
import {
  executePersistedModelGateway,
  hasEnabledPolicyCandidate,
  type ModelTaskClass,
} from "@/modules/model-gateway";
import {
  buildKernPlannerMessages,
  parseKernPlannerIntent,
} from "./planner";
import {
  CHANGE_VERB,
  NEW_PRODUCT_VERB,
  PRODUCT_RND_REPORT,
  PRODUCT_RND_START,
  PRODUCT_RND_STATUS,
  TASK_VERB,
  matchField,
  parseIntakeLabels,
  parseWorkItemTask,
} from "./intent-grammar";
import type { KernCapabilityIntent } from "./capabilities/contracts";

export interface IntentRoutingDecision {
  intent: KernCapabilityIntent;
  source: "DETERMINISTIC" | "KERN_PLANNER" | "DETERMINISTIC_FALLBACK";
  plannerModelRunId: string | null;
  plannerError: string | null;
}

/** R-03：贴进来的长文本（纪要 / 周报 / 方案）是「内容」，不是一句查询。 */
export const PASTED_CONTENT_MIN_CHARS = 160;
export function isPastedContent(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length >= PASTED_CONTENT_MIN_CHARS) return true;
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 3) return true;
  return (trimmed.match(/(^|\n)\s*(?:[-*•]|\d+[.、)])\s*\S/g) ?? []).length >= 2;
}

/** 长文本只看开头一句（用户通常把「要我做什么」写在最前面），关键词查询不再扫全文。 */
function instructionHead(text: string): string {
  const firstLine = text.trim().split(/\r?\n/)[0] ?? "";
  return firstLine.split(/[。！？!?；;]/)[0].slice(0, 80);
}

export function routeIntent(
  text: string,
  productBound: boolean
): KernCapabilityIntent {
  const pasted = isPastedContent(text);
  // 先理解再分流：长文本用开头一句判断「明确指令」；状态查询类关键词对长文本一律不生效。
  const probe = pasted ? instructionHead(text) : text;
  const t = probe.toLowerCase();

  if (/挑战我的判断|证伪|最脆弱|哪里会失败|反方|复核/.test(t)) {
    return "CHALLENGE_THESIS";
  }
  if (TASK_VERB.test(probe) && parseWorkItemTask(probe)) {
    return "PROPOSE_CREATE_WORK_ITEM";
  }
  if (isDesktopInstruction(probe)) return "DESKTOP_EXECUTION";
  if (PRODUCT_RND_START.test(probe)) return "START_PRODUCT_RND";
  if (PRODUCT_RND_REPORT.test(probe)) return "PRODUCT_RND_REPORT";
  if (
    !productBound &&
    (NEW_PRODUCT_VERB.test(probe) ||
      Object.keys(parseIntakeLabels(text)).length > 0)
  ) {
    return "NEW_PRODUCT_INTAKE";
  }
  // 贴进来的内容：不猜，交给规划器 / 任务决策去理解全文。
  if (pasted) return "UNSUPPORTED";

  if (/提议|草案|待确认|待我确认/.test(t)) {
    return "PENDING_PROPOSALS";
  }
  if (PRODUCT_RND_STATUS.test(text)) return "PRODUCT_RND_STATUS";
  if (/决策|拍板|决定|审批/.test(t)) return "PENDING_DECISIONS";
  if (productBound && CHANGE_VERB.test(text) && matchField(text)) {
    return "PROPOSE_FIELD_CHANGE";
  }

  if (
    /知识|公司|制度|政策|规则|定位|红线|禁用|规范|obsidian|背景|资料|查一下|找一下/.test(
      t
    )
  ) {
    return "KNOWLEDGE_SEARCH";
  }
  if (/产品|入库|评分|上市|版本/.test(t)) return "PRODUCT_STATUS";
  if (/待办|今天|本周|进度|任务|项目/.test(t)) return "WORKSPACE_STATUS";
  return "UNSUPPORTED";
}

export async function resolveKernIntent(
  session: SessionContext,
  input: {
    signal?: AbortSignal;
    beforeAttempt?: () => Promise<void>;
    agentRunId?: string;
    conversationId: string;
    text: string;
    productBound: boolean;
    history: { role: string; content: string }[];
  }
): Promise<IntentRoutingDecision> {
  const deterministic = routeIntent(input.text, input.productBound);
  if (deterministic !== "UNSUPPORTED") {
    return {
      intent: deterministic,
      source: "DETERMINISTIC",
      plannerModelRunId: null,
      plannerError: null,
    };
  }

  try {
    const plannerPlan = await tryResolveGatewayPolicyForAgentCode({
      organizationId: session.organizationId,
      agentCode: "hermes_pm",
      taskClass: "ASSISTANT_PLANNING",
    });

    if (
      !plannerPlan ||
      !hasEnabledPolicyCandidate({
        policy: plannerPlan.policy,
        profiles: plannerPlan.profiles,
      })
    ) {
      return {
        intent: "UNSUPPORTED",
        source: "DETERMINISTIC_FALLBACK",
        plannerModelRunId: null,
        plannerError: plannerPlan
          ? "ASSISTANT_PLANNING policy has no enabled candidate"
          : "ASSISTANT_PLANNING policy is not configured",
      };
    }

    const planned = await executePersistedModelGateway({
      organizationId: session.organizationId,
      agentRunId: input.agentRunId,
      policy: plannerPlan.policy,
      profiles: plannerPlan.profiles,
      request: {
        signal: input.signal, beforeAttempt: input.beforeAttempt,
        taskClass: "ASSISTANT_PLANNING",
        messages: buildKernPlannerMessages({
          text: input.text,
          productBound: input.productBound,
          history: input.history,
        }),
        metadata: {
          source: "kern.intent-planner",
          conversationId: input.conversationId,
          productBound: input.productBound,
        },
      },
      requestMeta: {
        source: "kern.intent-planner",
        conversationId: input.conversationId,
      },
    });

    const intent = parseKernPlannerIntent(planned.result.text);
    if (!intent) {
      return {
        intent: "UNSUPPORTED",
        source: "DETERMINISTIC_FALLBACK",
        plannerModelRunId: planned.modelRunId,
        plannerError: "Planner returned an invalid or out-of-whitelist intent",
      };
    }

    return {
      intent: intent as KernCapabilityIntent,
      source: "KERN_PLANNER",
      plannerModelRunId: planned.modelRunId,
      plannerError: null,
    };
  } catch (error: unknown) {
    input.signal?.throwIfAborted();
    await input.beforeAttempt?.();
    return {
      intent: "UNSUPPORTED",
      source: "DETERMINISTIC_FALLBACK",
      plannerModelRunId: null,
      plannerError:
        error instanceof Error
          ? error.message.slice(0, 800)
          : String(error).slice(0, 800),
    };
  }
}

export function modelRouteForIntent(intent: KernCapabilityIntent): {
  agentCode: string;
  taskClass: ModelTaskClass;
} {
  if (intent === "CHALLENGE_THESIS") {
    return { agentCode: "red_team", taskClass: "RED_TEAM" };
  }
  if (intent === "KNOWLEDGE_SEARCH") {
    return { agentCode: "research_agent", taskClass: "QUICK_RESEARCH" };
  }
  if (
    intent === "PROPOSE_FIELD_CHANGE" ||
    intent === "PROPOSE_CREATE_WORK_ITEM" ||
    intent === "NEW_PRODUCT_INTAKE"
  ) {
    return { agentCode: "hermes_pm", taskClass: "QUICK_CLASSIFY" };
  }
  return { agentCode: "hermes_pm", taskClass: "ASSISTANT_DIALOGUE" };
}
