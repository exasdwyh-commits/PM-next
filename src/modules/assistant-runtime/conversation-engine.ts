import { RunMode } from "@prisma/client";
import prisma from "@/shared/db";
import { NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import type { SessionContext } from "@/modules/identity/session";
import {
  ADVISOR_LLM_SYSTEM_PROMPT_VERSION,
  buildAdvisorLLMMessages,
  createAdvisorLLMClient,
  isAdvisorLLMEnabled,
  type AdvisorLLMMessage,
} from "@/modules/advisor/llm";
import {
  modelRouteForIntent,
  resolveKernIntent,
} from "./router";
import {
  executeKernCapability,
  toolWhitelistForCapabilityKeys,
  type KernCapabilityContext,
  type KernCapabilityResult,
} from "./capabilities";
import { claimRun } from "@/modules/advisor/runs";
import { tryResolveGatewayPolicyForAgentCode } from "@/modules/model-control/service";
import {
  executePersistedModelGateway,
  hasEnabledPolicyCandidate,
  type ModelPolicy,
  type ModelProfile,
} from "@/modules/model-gateway";
import { buildDepartmentAssistantSystemPrompt } from "./persona";
import { applyExplicitChatProposal } from "./proposal-executor";
import { getKernConversation } from "./conversations";
import {
  buildKernConversationSelectionPrompt,
  resolveKernConversationRuntimeSelection,
} from "./conversation-config";
import { resolveExplicitConversationModel } from "./conversation-model";

const KERN_TOOL_WHITELIST = [
  "workspace.overview",
  "workspace.pendingDecisions",
  "products.board",
  "advisor.pendingProposals",
  "advisor.proposeFieldChange",
  "advisor.proposeWorkItem",
  "advisor.proposeProduct",
  "advisor.challenge",
  "knowledge.search",
  "desktop.runtime",
  "product-rnd.start",
  "product-rnd.status",
  "product-rnd.report",
];

/**
 * Kern owns the conversational run lifecycle.
 *
 * Kern owns intent routing and capability execution through its native registry.
 * Advisor modules are support/compatibility libraries only and must never become
 * the runtime owner again.
 */
export async function executeKernConversationTurn(
  session: SessionContext,
  conversationId: string,
  content: string,
  options?: { runId?: string }
) {
  const text = content?.trim();
  if (!text) throw new UnprocessableEntityError("消息内容不能为空");

  const conversation = await getKernConversation(session, conversationId);
  const runtimeSelection = await resolveKernConversationRuntimeSelection(
    session,
    conversation.runtimeConfig
  );

  const plannerHistoryRows = await prisma.message.findMany({
    where: { conversationId, role: { in: ["USER", "ASSISTANT"] } },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: { role: true, content: true },
  });

  const intentRouting = await resolveKernIntent(session, {
    conversationId,
    text,
    productBound: Boolean(conversation.productId),
    history: plannerHistoryRows.reverse(),
  });
  const intent = intentRouting.intent;
  const modelRoute = modelRouteForIntent(intent);
  const primaryAdvisor =
    runtimeSelection.advisors.length === 1
      ? runtimeSelection.advisors[0]
      : null;
  const requestedAgentCode = primaryAdvisor?.code ?? modelRoute.agentCode;
  const startedAt = new Date();

  let gatewayPolicy: ModelPolicy | null = null;
  let gatewayProfiles: ModelProfile[] = [];
  let gatewayAgent: { id: string; code: string; name: string } | null = null;
  let gatewayResolutionError: string | null = null;

  try {
    if (runtimeSelection.config.modelProfileKey) {
      const explicit = await resolveExplicitConversationModel({
        organizationId: session.organizationId,
        profileKey: runtimeSelection.config.modelProfileKey,
        taskClass: modelRoute.taskClass,
      });
      gatewayPolicy = explicit.policy;
      gatewayProfiles = [explicit.profile];
      gatewayAgent =
        primaryAdvisor ??
        (await prisma.agent.findFirst({
          where: {
            organizationId: session.organizationId,
            code: modelRoute.agentCode,
            status: "ACTIVE",
          },
          select: { id: true, code: true, name: true },
        }));
    } else {
      let resolved = await tryResolveGatewayPolicyForAgentCode({
        organizationId: session.organizationId,
        agentCode: requestedAgentCode,
        taskClass: modelRoute.taskClass,
      });
      if (!resolved && requestedAgentCode !== modelRoute.agentCode) {
        resolved = await tryResolveGatewayPolicyForAgentCode({
          organizationId: session.organizationId,
          agentCode: modelRoute.agentCode,
          taskClass: modelRoute.taskClass,
        });
      }
      if (resolved) {
        gatewayPolicy = resolved.policy;
        gatewayProfiles = resolved.profiles;
        gatewayAgent = resolved.agent;
      }
    }
  } catch (error: unknown) {
    gatewayResolutionError =
      error instanceof Error ? error.message : String(error);
  }

  const gatewayReady =
    !!gatewayPolicy &&
    hasEnabledPolicyCandidate({
      policy: gatewayPolicy,
      profiles: gatewayProfiles,
    });

  const legacyEnabled =
    !runtimeSelection.config.modelProfileKey &&
    !gatewayPolicy &&
    !gatewayResolutionError &&
    isAdvisorLLMEnabled();
  const modelPlanned = gatewayReady || legacyEnabled;
  const effectiveToolWhitelist = toolWhitelistForCapabilityKeys(
    runtimeSelection.config.capabilityKeys
  );

  let run;
  if (options?.runId) {
    await claimRun({ session, runId: options.runId });
    run = await prisma.agentRun.findUnique({ where: { id: options.runId } });
    if (!run) throw new NotFoundError("AgentRun not found");

    run = await prisma.agentRun.update({
      where: { id: options.runId },
      data: {
        conversationId,
        agentId: gatewayAgent?.id || null,
        goal: text.slice(0, 200),
        runMode: modelPlanned ? RunMode.LLM : RunMode.TEST_STUB,
        provider: null,
        modelId: null,
        promptTemplateVersion: modelPlanned
          ? ADVISOR_LLM_SYSTEM_PROMPT_VERSION
          : "kern-capabilities/v1",
        toolWhitelist: effectiveToolWhitelist,
        contextSnapshot: {
          capturedAt: startedAt.toISOString(),
          organizationId: session.organizationId,
          permissionScope: "own organization only",
          runtimeOwner: "KERN_ASSISTANT",
          capabilityProvider: "KERN_CAPABILITY_REGISTRY",
          llmEnabled: modelPlanned,
          modelBackend: gatewayReady
            ? "MODEL_GATEWAY"
            : legacyEnabled
              ? "LEGACY_ADVISOR_LLM"
              : "DETERMINISTIC_TOOL",
          modelTaskClass: modelRoute.taskClass,
          modelAgentCode: gatewayAgent?.code || modelRoute.agentCode,
          modelPolicyKey: gatewayPolicy?.id || null,
          selectedModelProfileKey: runtimeSelection.config.modelProfileKey,
          selectedAdvisorCodes: runtimeSelection.config.advisorCodes,
          selectedSkillKeys: runtimeSelection.config.skillKeys,
          selectedCapabilityKeys: runtimeSelection.config.capabilityKeys,
          gatewayResolutionError,
          intentRouting: {
            source: intentRouting.source,
            intent: intentRouting.intent,
            plannerModelRunId: intentRouting.plannerModelRunId,
            plannerError: intentRouting.plannerError,
          },
        },
      },
    });
  } else {
    run = await prisma.agentRun.create({
      data: {
        organizationId: session.organizationId,
        conversationId,
        userId: session.userId,
        agentId: gatewayAgent?.id || null,
        goal: text.slice(0, 200),
        status: "RUNNING",
        runMode: modelPlanned ? RunMode.LLM : RunMode.TEST_STUB,
        provider: null,
        modelId: null,
        promptTemplateVersion: modelPlanned
          ? ADVISOR_LLM_SYSTEM_PROMPT_VERSION
          : "kern-capabilities/v1",
        toolWhitelist: effectiveToolWhitelist,
        contextSnapshot: {
          capturedAt: startedAt.toISOString(),
          organizationId: session.organizationId,
          permissionScope: "own organization only",
          runtimeOwner: "KERN_ASSISTANT",
          capabilityProvider: "KERN_CAPABILITY_REGISTRY",
          llmEnabled: modelPlanned,
          modelBackend: gatewayReady
            ? "MODEL_GATEWAY"
            : legacyEnabled
              ? "LEGACY_ADVISOR_LLM"
              : "DETERMINISTIC_TOOL",
          modelTaskClass: modelRoute.taskClass,
          modelAgentCode: gatewayAgent?.code || modelRoute.agentCode,
          modelPolicyKey: gatewayPolicy?.id || null,
          selectedModelProfileKey: runtimeSelection.config.modelProfileKey,
          selectedAdvisorCodes: runtimeSelection.config.advisorCodes,
          selectedSkillKeys: runtimeSelection.config.skillKeys,
          selectedCapabilityKeys: runtimeSelection.config.capabilityKeys,
          gatewayResolutionError,
          intentRouting: {
            source: intentRouting.source,
            intent: intentRouting.intent,
            plannerModelRunId: intentRouting.plannerModelRunId,
            plannerError: intentRouting.plannerError,
          },
        },
        startedAt,
        costStatus: "unknown",
      },
    });
  }

  const ctx: KernCapabilityContext = {
    conversationId,
    productId: conversation.productId ?? null,
    text,
    capabilityKeys: runtimeSelection.config.capabilityKeys,
  };

  let historyTurns = 0;
  let conversationHistory: { role: string; content: string }[] = [];
  try {
    const historyRows = await prisma.message.findMany({
      where: { conversationId, role: { in: ["USER", "ASSISTANT"] } },
      orderBy: { createdAt: "asc" },
      select: { role: true, content: true },
    });
    conversationHistory = historyRows.map((message) => ({
      role: message.role,
      content: message.content,
    }));
    historyTurns = conversationHistory.length;
  } catch {
    conversationHistory = [];
  }

  await prisma.message.create({
    data: { conversationId, role: "USER", content: text, runId: run.id },
  });

  let result: KernCapabilityResult;
  let failed = false;
  let errorReason: string | null = gatewayResolutionError
    ? `Model Gateway 配置解析失败，已使用确定性工具：${gatewayResolutionError}`
    : null;
  let llmUsage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  } | null = null;
  let llmModelId: string | null = null;
  let actualProvider: string | null = null;
  let modelRunId: string | null = null;
  let llmAttempted = false;
  let modelOutputUsed = false;
  let executionBackend:
    | "MODEL_GATEWAY"
    | "LEGACY_ADVISOR_LLM"
    | "DETERMINISTIC_TOOL" = "DETERMINISTIC_TOOL";

  try {
    result = await executeKernCapability(session, intent, ctx);
    result = await applyExplicitChatProposal(session, {
      intent,
      runId: run.id,
      result,
    });

    const baseMessages = buildAdvisorLLMMessages({
      history: conversationHistory,
      currentQuery: text,
      toolKey: result.toolKey,
      toolResultText: result.text,
    });
    const basePersona = buildDepartmentAssistantSystemPrompt(
      modelRoute.taskClass
    );
    const selectionPrompt = buildKernConversationSelectionPrompt(runtimeSelection);
    const assistantPersona = [basePersona, selectionPrompt]
      .filter((value): value is string => Boolean(value))
      .join("\n\n");
    const llmMessages: AdvisorLLMMessage[] = assistantPersona
      ? [{ role: "system", content: assistantPersona }, ...baseMessages.slice(1)]
      : baseMessages;

    if (gatewayReady && gatewayPolicy) {
      llmAttempted = true;
      executionBackend = "MODEL_GATEWAY";
      try {
        const gatewayExecution = await executePersistedModelGateway({
          organizationId: session.organizationId,
          agentRunId: run.id,
          policy: gatewayPolicy,
          profiles: gatewayProfiles,
          request: {
            taskClass: modelRoute.taskClass,
            messages: llmMessages,
            metadata: {
              source: "kern.conversation",
              conversationId,
              intent,
            },
          },
          requestMeta: {
            source: "kern.conversation",
            intent,
            historyTurns,
          },
        });

        modelRunId = gatewayExecution.modelRunId;
        const gatewayResult = gatewayExecution.result;
        result = { ...result, text: gatewayResult.text };
        modelOutputUsed = true;
        llmModelId = gatewayResult.resolvedModelId;
        actualProvider = gatewayResult.provider;
        llmUsage = gatewayResult.usage
          ? {
              promptTokens: gatewayResult.usage.inputTokens,
              completionTokens: gatewayResult.usage.outputTokens,
              totalTokens: gatewayResult.usage.totalTokens,
            }
          : null;
      } catch (modelError: unknown) {
        errorReason =
          "Model Gateway 调用失败已回落工具原文：" +
          (modelError instanceof Error
            ? modelError.message
            : String(modelError));
      }
    } else if (legacyEnabled) {
      const llmClient = createAdvisorLLMClient();
      llmAttempted = Boolean(llmClient);
      executionBackend = llmClient
        ? "LEGACY_ADVISOR_LLM"
        : "DETERMINISTIC_TOOL";
      if (llmClient) {
        actualProvider =
          process.env.ADVISOR_MODEL_PROVIDER?.trim() || "openai-compatible";
        try {
          const llmResult = await llmClient.chat(llmMessages);
          result = { ...result, text: llmResult.text };
          modelOutputUsed = true;
          llmUsage = llmResult.usage;
          llmModelId = llmResult.modelId;
        } catch (llmError: unknown) {
          errorReason =
            "LLM 润色失败已回落工具原文：" +
            (llmError instanceof Error
              ? llmError.message
              : String(llmError));
        }
      }
    }
  } catch (error: unknown) {
    failed = true;
    errorReason = error instanceof Error ? error.message : "工具执行失败";
    result = {
      toolKey: "none",
      text: `执行失败：${errorReason}`,
      citations: [],
    };
  }

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();

  await prisma.toolCall.create({
    data: {
      runId: run.id,
      toolKey: result.toolKey,
      inputJson: { intent, query: text } as any,
      resultJson: {
        text: result.text,
        ...(result.proposal ? { proposal: result.proposal } : {}),
      } as any,
      status: failed ? "FAILED" : "SUCCEEDED",
      errorReason,
      startedAt,
      finishedAt,
      durationMs,
    },
  });

  if (result.proposal?.proposalId) {
    await prisma.actionProposal.update({
      where: { id: result.proposal.proposalId },
      data: { runId: run.id },
    });
  }

  const header = modelOutputUsed
    ? ""
    : llmAttempted
      ? "（模型调用失败，本轮已安全回落到确定性工具结果）\n\n"
      : gatewayPolicy && !gatewayReady
        ? "（模型策略已配置但暂无启用的候选 Profile，本轮使用确定性工具结果）\n\n"
        : "（本轮未接入语言模型，以下为受治理 capability 返回的真实数据）\n\n";

  const citationsWithReport: unknown[] = result.challengeReport
    ? [
        {
          kind: "challenge-report",
          ref: ctx.productId,
          title: "挑战报告",
          report: result.challengeReport,
        },
      ]
    : result.citations;

  const assistantMsg = await prisma.message.create({
    data: {
      conversationId,
      role: "ASSISTANT",
      content: header + result.text,
      runId: run.id,
      citations: JSON.parse(JSON.stringify(citationsWithReport)),
    },
  });

  const usageJson = llmUsage
    ? {
        promptTokens: llmUsage.promptTokens,
        completionTokens: llmUsage.completionTokens,
        totalTokens: llmUsage.totalTokens,
        modelId: llmModelId,
        historyTurns,
        backend: executionBackend,
        modelRunId,
        policyKey: gatewayPolicy?.id || null,
      }
    : llmAttempted
      ? {
          note: "模型已调用，但 provider 未返回 usage 或调用失败",
          modelId: llmModelId,
          historyTurns,
          backend: executionBackend,
          modelRunId,
          policyKey: gatewayPolicy?.id || null,
        }
      : {
          note: "未接入模型，无 token 计量",
          historyTurns,
          backend: executionBackend,
          policyKey: gatewayPolicy?.id || null,
        };

  await prisma.agentRun.update({
    where: { id: run.id },
    data: {
      status: failed ? "FAILED" : "SUCCEEDED",
      runMode: llmAttempted ? RunMode.LLM : RunMode.TEST_STUB,
      provider: actualProvider,
      modelId: llmModelId,
      finishedAt,
      durationMs,
      outputMessageId: assistantMsg.id,
      errorReason,
      usageJson: usageJson as any,
      costStatus: "unknown",
    },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      updatedAt: finishedAt,
      ...(conversation.title === "新对话"
        ? { title: text.slice(0, 24) }
        : {}),
    },
  });

  return {
    runId: run.id,
    message: assistantMsg,
    proposal: result.proposal ?? null,
    modelRunId,
    runtimeSelection: {
      config: runtimeSelection.config,
      advisors: runtimeSelection.advisors.map((advisor) => ({
        code: advisor.code,
        name: advisor.name,
        roleKey: advisor.roleKey,
      })),
      skills: runtimeSelection.skills.map((skill) => ({
        key: skill.key,
        name: skill.name,
      })),
    },
  };
}
