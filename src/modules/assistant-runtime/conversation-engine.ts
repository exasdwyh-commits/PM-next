import { ExecutionStoppedError } from "@/modules/worker/claim";
import { lockRunExecutionTx, type ConversationExecution } from "@/modules/worker/run-claim";
import { RunMode } from "@prisma/client";
import { recallForPrompt } from "@/modules/memory";
import { recallRolePreference } from "@/modules/memory/role-preference";
import { inferRoleFromText } from "./role-intelligence";
import { conversationProductGoal } from "./product-goal";
import prisma from "@/shared/db";
import { NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import type { SessionContext } from "@/modules/identity/session";
import {
  ADVISOR_LLM_SYSTEM_PROMPT_VERSION,
  buildAdvisorLLMMessages,
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
import {
  assembleCompressedHistory,
  historyKeepRecentTurns,
  rollingSummaryCache,
  summaryMaxChars,
} from "@/modules/history-compression";
import { tryResolveGatewayPolicyForAgentCode } from "@/modules/model-control/service";
import {
  executeLegacyAdvisorModel,
  hasEnabledPolicyCandidate,
  type ModelPolicy,
  type ModelProfile,
} from "@/modules/model-gateway";
import { incompleteToReason } from "@/modules/supervisor/tools";
import { runConversationToolLoop } from "./conversation-tool-loop";
import { buildDepartmentAssistantSystemPrompt } from "./persona";
import { loadTenantSoul } from "@/modules/tenant/soul";
import { KERN_REPLY_FORMAT_VERSION, normalizeReply, type NormalizedReply } from "./reply-format";
import { applyExplicitChatProposal } from "./proposal-executor";
import { getKernConversation } from "./conversations";
import {
  buildKernConversationSelectionPrompt,
  resolveKernConversationRuntimeSelection,
} from "./conversation-config";
import { resolveExplicitConversationModel } from "./conversation-model";
import { randomUUID } from "node:crypto";
import { KERN_RICH_PROMPT, describeMarkers, extractArtifacts, readArtifactCitation, type ExtractedArtifact } from "@/modules/artifacts/protocol";
import { sanitizeRichFences } from "@/modules/artifacts/rich-blocks";
import { buildArtifactPromptContext, persistReplyArtifacts } from "@/modules/artifacts/service";
import { buildKernContextLayers } from "./context-layers";

/** Model text → (artifacts pulled out first, so HTML never meets the Markdown harness) → normalised Markdown with validated kern-ui blocks. */
export function formatModelReply(raw: string): { reply: NormalizedReply; artifacts: ExtractedArtifact[]; richIssues: string[] } {
  const extracted = extractArtifacts(raw);
  const reply = normalizeReply(extracted.text);
  const rich = sanitizeRichFences(reply.text);
  return { reply: { ...reply, text: rich.text }, artifacts: extracted.artifacts, richIssues: rich.issues };
}

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
  options?: { runId?: string; execution?: ConversationExecution }
) {
  if (typeof content !== "string") {
    throw new UnprocessableEntityError("消息内容必须是非空文本");
  }
  const text = content.trim();
  if (!text) throw new UnprocessableEntityError("消息内容不能为空");

  await options?.execution?.assertActive();
  const conversation = await getKernConversation(session, conversationId);
  const acceptedRun = options?.execution ? await prisma.agentRun.findUniqueOrThrow({ where: { id: options.runId } }) : null;
  const intake = acceptedRun?.contextSnapshot as { runtimeConfig?: unknown } | null;
  const futureRuns = acceptedRun ? await prisma.agentRun.findMany({ where: { conversationId, clientMessageId: { not: null }, OR: [{ createdAt: { gt: acceptedRun.createdAt } }, { createdAt: acceptedRun.createdAt, id: { gt: acceptedRun.id } }] }, select: { id: true } }) : [];
  const unpublished = await prisma.agentRun.findMany({ where: { conversationId, clientMessageId: { not: null }, status: { in: ["QUEUED", "RUNNING", "CANCELLED"] }, outputMessageId: { not: null } }, select: { outputMessageId: true } });
  const historyFilter = { conversationId, id: { notIn: unpublished.map(r => r.outputMessageId!) }, role: { in: ["USER", "ASSISTANT"] as ("USER" | "ASSISTANT")[] }, ...(acceptedRun ? { NOT: [{ id: options!.execution!.inputMessageId }, { runId: { in: futureRuns.map(r => r.id) } }] } : {}) };
  const runtimeSelection = await resolveKernConversationRuntimeSelection(
    session,
    intake?.runtimeConfig === undefined ? conversation.runtimeConfig : intake.runtimeConfig
  );

  const plannerHistoryRows = await prisma.message.findMany({
    where: historyFilter,
    orderBy: { createdAt: "desc" },
    take: 6,
    select: { role: true, content: true },
  });

  const productDevelopmentGoal = conversationProductGoal(text, [...plannerHistoryRows].reverse());
  const intentRouting = await resolveKernIntent(session, {
    conversationId,
    text,
    productBound: Boolean(conversation.productId),
    history: plannerHistoryRows.reverse(),
    signal: options?.execution?.signal, beforeAttempt: options?.execution?.assertActive, agentRunId: options?.runId,
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
    if (!options.execution) await claimRun({ session, runId: options.runId });
    else await options.execution.assertActive();
    run = await prisma.agentRun.findUnique({ where: { id: options.runId } });
    if (!run) throw new NotFoundError("AgentRun not found");

    run = await prisma.$transaction(async tx => {
      if (options.execution) await lockRunExecutionTx(tx, options.execution.guard);
      return tx.agentRun.update({
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
  let replyFormat: NormalizedReply | null = null;
  let replyArtifacts: ExtractedArtifact[] = [];
  let richIssues: string[] = [];
  try {
    const historyRows = await prisma.message.findMany({
      where: historyFilter,
      orderBy: { createdAt: "asc" },
      select: { role: true, content: true, citations: true },
    });
    conversationHistory = historyRows.map((message) => ({
      role: message.role,
      // Persisted artifact markers become readable placeholders; the HTML itself is
      // supplied once, via the artifact context in the system prompt.
      content: describeMarkers(
        message.content,
        (Array.isArray(message.citations) ? message.citations : []).map(readArtifactCitation).filter((c): c is NonNullable<typeof c> => c !== null)
      ),
    }));
    historyTurns = conversationHistory.length;
  } catch {
    conversationHistory = [];
  }

  // C3：历史装配改为「近期原文 + 远期滚动摘要」。
  // 摘要位未配置或调用失败时 assemble 返回 summaryBlock=null，
  // 自动回退到旧行为（近期原文 + 环形截断省略声明），不抛错。
  const compressedHistory = await assembleCompressedHistory({
    turns: conversationHistory,
    keepRecentTurns: historyKeepRecentTurns(),
    maxChars: summaryMaxChars(),
    cacheKey: `conv:${conversationId}`,
    cache: rollingSummaryCache,
    // C7：真实摘要位经统一网关记账（aux 档位）所需的组织 id
    organizationId: session.organizationId,
  }).catch(() => null);
  const promptHistory = compressedHistory?.recent ?? conversationHistory;
  const historySummaryBlock = compressedHistory?.summaryBlock ?? null;

  if (!options?.execution) await prisma.message.create({
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
    await options?.execution?.assertActive();
    result = await executeKernCapability(session, intent, ctx);
    await options?.execution?.assertActive();
    result = await applyExplicitChatProposal(session, {
      intent,
      runId: run.id,
      result,
    });

    const baseMessages = buildAdvisorLLMMessages({
      history: promptHistory,
      currentQuery: text,
      toolKey: result.toolKey,
      toolResultText: result.text,
      summaryBlock: historySummaryBlock,
    });
    const basePersona = buildDepartmentAssistantSystemPrompt(
      modelRoute.taskClass,
      loadTenantSoul()
    );
    const selectionPrompt = buildKernConversationSelectionPrompt(runtimeSelection);
    const memoryPrompt = await recallForPrompt(session, text).catch(() => "");
    const rolePreference = await recallRolePreference(session).catch(() => null);
    const roleInference = inferRoleFromText(text);
    const rolePrompt = rolePreference
      ? `## 用户角色偏好（记忆）\n- 偏好角色：${rolePreference.role} (${rolePreference.confidence > 0.8 ? "高置信度" : "中等置信度"})\n- 记忆内容：${rolePreference.content}\n- 当前推断：${roleInference ? `${roleInference.role} (${Math.round(roleInference.confidence * 100)}%) - ${roleInference.reason}` : "无"}\n- 要求：按偏好角色呈现，领导层要一页看懂直观，产品研发要专业严谨可信度第一工具丰富，销售营销要卖点突出工具型。`
      : roleInference
        ? `## 检测到角色意图\n- 推断角色：${roleInference.role} (${Math.round(roleInference.confidence * 100)}%)\n- 原因：${roleInference.reason}\n- 要求：按此角色呈现（只调整详略与重点，不在正文输出角色标签或 JSON）。`
        : "";
    const artifactPrompt = await buildArtifactPromptContext(conversationId).catch(() => "");
    // 能力层 + 知识层（KX-73）：解析本轮该用哪些能力包、去哪些知识域查。
    // 永不抛错；解析失败时两个层都是空字符串，对话照常走。
    const contextLayers = await buildKernContextLayers({
      session,
      conversationId,
      text,
      intent,
      // 本轮用户消息 id：附件层靠它区分「这次传的」与「之前传的」。
      // 后台执行时它来自 run.inputMessageId；缺了就降级为不带材料，不影响其它层。
      currentMessageId: options?.execution?.inputMessageId ?? null,
      explicitSkillIds: runtimeSelection.config.capabilityPackIds ?? null,
      projectId: null,
    }).catch(() => null);
    const capabilityPrompt = contextLayers?.capabilityPrompt ?? "";
    const knowledgePrompt = contextLayers?.knowledgePrompt ?? "";
    const attachmentPrompt = contextLayers?.attachmentPrompt ?? "";
    // 授权档位：全委托时把「自己拍板、不再追问」写进口径，并强制把补全的假设标出来。
    // 只改表达与决策口径，不放宽任何工具/权限/治理边界。
    const delegationPrompt =
      runtimeSelection.config.delegationMode === "full"
        ? [
            "## 全委托模式（本轮已由用户授权）",
            "- 用户已把本轮的取舍权交给你：不要再回问确认，直接按你判断的最佳方案产出。",
            "- 缺失的细节可以自行补全，但每处补全必须以「假设：」显式标注；不得把假设写成既定事实或来源事实。",
            "- 这与证据纪律不冲突：有据的写有据，没据的按上面标注，不得为了「完整」而编造来源。",
            "- 本模式不放宽工具、权限或治理授权，只改变是否停下来征求确认。",
          ].join("\n")
        : "";
    // One output contract for the model: reply-format (in basePersona) + kern-rich/v1 (KERN_RICH_PROMPT).
    // 附件层排在知识层之前：材料是用户当轮亲手提交的，比知识库里的背景材料更贴近提问；
    // 两者冲突时应当先看材料，并向用户指出差异。
    const assistantPersona = [basePersona, KERN_RICH_PROMPT, artifactPrompt, memoryPrompt, rolePrompt, delegationPrompt, capabilityPrompt, attachmentPrompt, knowledgePrompt, selectionPrompt]
      .filter((value): value is string => Boolean(value))
      .join("\n\n");
    const llmMessages: AdvisorLLMMessage[] = assistantPersona
      ? [{ role: "system", content: assistantPersona }, ...baseMessages.slice(1)]
      : baseMessages;

    if (gatewayReady && gatewayPolicy) {
      llmAttempted = true;
      executionBackend = "MODEL_GATEWAY";
      try {
        // C2：对话的模型调用改走多步只读工具循环（复用 C1 runToolLoop 与预算口径）。
        // 模型不再是「1 次润色即终点」：它可以先查知识/先算数/先抓网页再作答；
        // 每次模型调用仍经 executePersistedModelGateway 记账（见 conversation-tool-loop）。
        const loop = await runConversationToolLoop({
          session,
          agentRunId: run.id,
          policy: gatewayPolicy,
          profiles: gatewayProfiles,
          taskClass: modelRoute.taskClass,
          messages: llmMessages,
          signal: options?.execution?.signal,
          assertActive: options?.execution?.assertActive,
          metadata: { conversationId, intent },
          // C4：本轮选中的能力包的工具约束（requiredTools/forbiddenTools 并集）
          // 进执行侧；contextLayers 为空（解析失败降级）时不约束。
          toolConstraints: contextLayers?.resolution,
        });
        modelRunId = loop.modelRunId;
        llmModelId = loop.modelId;
        actualProvider = loop.provider;
        llmUsage = loop.usage
          ? {
              promptTokens: loop.usage.inputTokens,
              completionTokens: loop.usage.outputTokens,
              totalTokens: loop.usage.totalTokens,
            }
          : null;
        if (loop.incomplete && loop.incomplete !== "EMPTY_OUTPUT") {
          // 预算耗尽（步数/token/时长）：诚实告知——回复正文就是循环给出的
          // 未完成说明（复用 C1 的 incomplete 语义），不静默截断、不硬闯、不冒充已完成。
          ({ reply: replyFormat, artifacts: replyArtifacts, richIssues } = formatModelReply(loop.text));
          result = { ...result, text: replyFormat.text, citations: [...result.citations, ...loop.citations] };
          modelOutputUsed = true;
          errorReason =
            `多步工具循环未完成：${incompleteToReason(loop.incomplete)}（已执行 ${loop.toolCalls.length} 次只读工具调用）`;
        } else if (loop.incomplete === "EMPTY_OUTPUT") {
          errorReason = "模型多步工具循环未产出内容，已回落工具原文";
        } else {
          ({ reply: replyFormat, artifacts: replyArtifacts, richIssues } = formatModelReply(loop.text));
          result = { ...result, text: replyFormat.text, citations: [...result.citations, ...loop.citations] };
          modelOutputUsed = true;
        }
      } catch (modelError: unknown) {
        if (modelError instanceof ExecutionStoppedError) throw modelError;
        options?.execution?.signal.throwIfAborted();
        errorReason =
          "Model Gateway 调用失败已回落工具原文：" +
          (modelError instanceof Error
            ? modelError.message
            : String(modelError));
      }
    } else if (legacyEnabled) {
      llmAttempted = true;
      executionBackend = "LEGACY_ADVISOR_LLM";
      try {
        const llmResult = await executeLegacyAdvisorModel({
          organizationId: session.organizationId, agentRunId: run.id,
          taskClass: modelRoute.taskClass, messages: llmMessages,
          signal: options?.execution?.signal, beforeAttempt: options?.execution?.assertActive,
          source: "kern.conversation.legacy",
        });
        modelRunId = llmResult.modelRunId;
        actualProvider = llmResult.provider;
        ({ reply: replyFormat, artifacts: replyArtifacts, richIssues } = formatModelReply(llmResult.text));
        result = { ...result, text: replyFormat.text };
        modelOutputUsed = true;
        llmUsage = llmResult.usage;
        llmModelId = llmResult.modelId;
      } catch (llmError: unknown) {
        if (llmError instanceof ExecutionStoppedError) throw llmError;
        options?.execution?.signal.throwIfAborted();
        errorReason = "LLM 润色失败已回落工具原文：" +
          (llmError instanceof Error ? llmError.message : String(llmError));
      }
    }
  } catch (error: unknown) {
    if (error instanceof ExecutionStoppedError) throw error;
    options?.execution?.signal.throwIfAborted();
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

  const assistantMsg = await prisma.$transaction(async tx => {
    if (options?.execution) await lockRunExecutionTx(tx, options.execution.guard);
  await tx.toolCall.create({
    data: {
      runId: run.id,
      toolKey: result.toolKey,
      inputJson: { intent, query: text } as any,
      resultJson: {
        text: result.text,
        ...(result.proposal ? { proposal: result.proposal } : {}),
        ...(replyFormat
          ? { replyFormat: { version: KERN_REPLY_FORMAT_VERSION, fixed: replyFormat.fixed, issues: replyFormat.issues, richIssues, artifacts: replyArtifacts.map((a) => ({ key: a.key, complete: a.complete, error: a.error, bytes: a.html.length })) } }
          : {}),
      } as any,
      status: failed ? "FAILED" : "SUCCEEDED",
      errorReason,
      startedAt,
      finishedAt,
      durationMs,
    },
  });

  if (result.proposal?.proposalId) {
    await tx.actionProposal.update({
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

  // Artifacts are versioned in the same transaction as the reply that produced them.
  const assistantMessageId = randomUUID();
  const persisted = replyArtifacts.length
    ? await persistReplyArtifacts(tx, {
        organizationId: session.organizationId, ownerId: session.userId, conversationId,
        messageId: assistantMessageId, runId: run.id, content: header + result.text, artifacts: replyArtifacts,
      })
    : { content: header + result.text, citations: [] };

  const assistantMsg = await tx.message.create({
    data: {
      id: assistantMessageId,
      conversationId,
      role: "ASSISTANT",
      content: persisted.content,
      runId: run.id,
      citations: JSON.parse(JSON.stringify([...citationsWithReport, ...persisted.citations])),
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

  await tx.agentRun.update({
    where: { id: run.id },
    data: {
      status: options?.execution ? "RUNNING" : failed ? "FAILED" : "SUCCEEDED",
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

  await tx.conversation.update({
    where: { id: conversationId },
    data: {
      updatedAt: finishedAt,
      ...(conversation.title === "新对话"
        ? { title: text.slice(0, 24) }
        : {}),
    },
  });

    return assistantMsg;
  });

  return {
    runId: run.id,
    failed,
    intent,
    productDevelopmentGoal,
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
