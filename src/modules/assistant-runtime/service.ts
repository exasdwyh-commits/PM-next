import { lockRunExecutionTx, type ConversationExecution } from "@/modules/worker/run-claim";
import { Prisma } from "@prisma/client";
import prisma from "@/shared/db";
import { UnprocessableEntityError } from "@/shared/errors";
import { getUsage, UsageLimitError } from "@/modules/usage";
import { extractExplicitMemory, rememberForUser } from "@/modules/memory";
import { detectRolePreferenceIntent, rememberRolePreference } from "@/modules/memory/role-preference";
import { inferRoleFromText } from "./role-intelligence";
import type { SessionContext } from "@/modules/identity/session";
import { executeKernConversationTurn } from "./conversation-engine";
import { buildDepartmentAssistantContext } from "./context-builder";
import { runDepartmentAssistantReflexShadow } from "./reflex";
import { buildKernCollaborationPlanShadow } from "./collaboration-planner";
import { buildKernGoalPlanShadow } from "./goal-plan";
import { resolveKernDispatchReadiness } from "./dispatch-readiness";
import {
  enqueueKernSpecialistDispatch,
  type KernSpecialistDispatchResult,
} from "./specialist-dispatch";
import {
  buildMissionPlanFromGoalPlan,
  briefCitation,
  createBriefForMessage,
  decideMissionLaunch,
  findResumableMission,
  isKernModelReady,
  resumeKernMission,
} from "@/modules/supervisor";
import {
  buildKernCouncilGraph,
  shouldAttachKernCouncilGraph,
  toKernGraphCitation,
} from "@/modules/visual-intelligence";

function asJsonObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

const RESUME_RE = /^\s*(继续|接着(做|来|推进)?|重试|再试(一次)?|继续推进|开始吧?|go on|continue|resume|retry)\s*[。.!！]?\s*$/i;
export function isResumeIntent(text: string): boolean {
  return RESUME_RE.test(text);
}

/**
 * Stable conversational entry point for the final product.
 *
 * Kern owns the conversation lifecycle, routing and capability execution.
 * Advisor modules are compatibility/support libraries only.
 */
export async function sendDepartmentAssistantMessage(
  session: SessionContext,
  conversationId: string,
  content: string,
  options?: { runId?: string; execution?: ConversationExecution }
) {
  if (typeof content !== "string" || !content.trim()) {
    throw new UnprocessableEntityError("消息内容必须是非空文本");
  }
  const updateMessage = async (args: Prisma.MessageUpdateArgs) => prisma.$transaction(async tx => {
    if (options?.execution) await lockRunExecutionTx(tx, options.execution.guard);
    return tx.message.update(args);
  });
  await options?.execution?.assertActive();
  const context = await buildDepartmentAssistantContext(session, conversationId);
  const reflexPromise = runDepartmentAssistantReflexShadow(session, {
    text: content,
    conversationId,
    productId: context.productId,
    linkedProjectIds: context.linkedProjectIds,
    confirmedCompanyFactRefs: context.confirmedCompanyFactRefs,
  });
  const result = await executeKernConversationTurn(
    session,
    conversationId,
    content,
    options
  );
  await options?.execution?.assertActive();
  const reflex = await reflexPromise;
  const plannedCollaboration = buildKernCollaborationPlanShadow({
    text: content,
    productBound: Boolean(context.productId),
    reflex,
    selectedAdvisorCodes: result.runtimeSelection.config.advisorCodes,
  });
  const dispatchReadiness = await resolveKernDispatchReadiness({
    organizationId: session.organizationId,
    plan: plannedCollaboration,
  });
  const collaborationPlanShadow = {
    ...plannedCollaboration,
    autoDispatchEligible: dispatchReadiness.eligible,
  };
  const goalPlanShadow = buildKernGoalPlanShadow({
    goal: content,
    collaboration: collaborationPlanShadow,
  });

  let specialistDispatch: KernSpecialistDispatchResult | null = null;
  let specialistDispatchError: string | null = null;
  let responseMessage = result.message;

  // Supervisor: goal-shaped / multi-agent work becomes a real mission.
  const missionDecision = decideMissionLaunch({
    text: content,
    intent: result.intent,
    collaboration: collaborationPlanShadow,
    productBound: Boolean(context.productId),
  });
  let mission: { missionTaskId: string; created: boolean; nodeCount: number } | null = null;
  let missionError: string | null = null;
  let briefCreated: { messageId: string; stage: string } | null = null;

  // --- Role Preference Memory: 记住角色偏好 ---
  let rolePreferenceSaved: { role: string; id: string } | null = null;

  // “记住…” is stored as a user-visible preference, immediately.
  let memorySaved: { id: string } | null = null;
  // True once a "记住…" turn has been answered (saved, or honestly refused by
  // quota) so it is not re-interpreted as a resume / mission request.
  let memoryHandled = false;
  const explicitMemory = extractExplicitMemory(content);
  if (explicitMemory) {
    await options?.execution?.assertActive();
    let memoryQuotaNote: string | null = null;
    const saved = await rememberForUser(session, { ...explicitMemory, source: null }).catch(
      (error: unknown) => {
        if (error instanceof UsageLimitError) memoryQuotaNote = error.message;
        return null;
      }
    );
    if (!saved && memoryQuotaNote) {
      // Honest: never pretend it was remembered.
      responseMessage = await updateMessage({
        where: { id: result.message.id },
        data: { content: `这条我没能记住：${memoryQuotaNote}。` },
      });
      memoryHandled = true;
    }
    if (saved) {
      responseMessage = await updateMessage({
        where: { id: result.message.id },
        data: { content: `记住了：${saved.content}\n\n之后的工作我都会按这个来。随时可以在「设置 → Kern 的记忆」里查看或删除。` },
      });
      memorySaved = { id: saved.id };
      memoryHandled = true;
    }
  }

  // “继续 / 重试” picks up the stopped mission in this conversation instead of starting over.
  let resumed = false;
  if (!memoryHandled && isResumeIntent(content)) {
    await options?.execution?.assertActive();
    const stoppedId = await findResumableMission(session, conversationId).catch(() => null);
    if (stoppedId) {
      resumed = true;
      const ready = await isKernModelReady(session.organizationId);
      let note: string;
      if (!ready) {
        note = "模型服务还没恢复，我先不重跑，免得白白消耗额度。恢复后再跟我说“继续”就行。";
      } else {
        const r = await resumeKernMission(session, stoppedId).catch((e: unknown) => ({ resumed: false, reason: e instanceof Error ? e.message : String(e) }));
        note = r.resumed
          ? `**好的，接着推进。** 已完成的部分保留，重跑 ${"resetKeys" in r && r.resetKeys ? r.resetKeys.length : 0} 个环节，进度在下面。`
          : r.reason === "RESUME_LIMIT"
            ? "这项工作已经重试过多次仍未成功。我建议换个角度重新描述目标，或告诉我哪一部分可以先跳过。"
            : "这项工作目前不需要继续。";
        if (r.resumed) mission = { missionTaskId: stoppedId, created: false, nodeCount: 0 };
      }
      responseMessage = await updateMessage({
        where: { id: result.message.id },
        data: {
          content: note,
          citations: [{ kind: "kern-mission", ref: stoppedId, title: "Kern 工作进展" }] as Prisma.InputJsonValue,
        },
      });
    }
  }

  if (!memoryHandled && !resumed && missionDecision.launch) {
    await options?.execution?.assertActive();
    try {
      // Display Layer: clarify → plan card → the user confirms (or runs a demo).
      // Nothing runs and no quota is used until the user presses 开始.
      const playbook = missionDecision.playbook === "NEW_PRODUCT" ? "NEW_PRODUCT" : "GENERIC";
      const brief = await createBriefForMessage(session, {
        messageId: result.message.id,
        goal: content,
        playbook,
        goalPlan: playbook === "GENERIC" ? buildMissionPlanFromGoalPlan(goalPlanShadow) : undefined,
      });
      briefCreated = { messageId: result.message.id, stage: brief.stage };
      // 部署设置了安全上限且已到顶时提前说明——简报仍可调整计划、做演示运行。
      const usage = await getUsage(session.organizationId).catch(() => null);
      const quotaFull =
        usage && usage.limits.missionsPerMonth !== null && usage.used.missions >= usage.limits.missionsPerMonth
          ? `\n\n> 注意：本月已接手 ${usage.used.missions} 项工作，达到本部署设置的上限 ${usage.limits.missionsPerMonth}。你仍可以先确认需求、用**演示运行**看效果；要调整上限请联系管理员。`
          : "";
      const note0 =
        brief.stage === "CLARIFY"
          ? [
              "**这件事我来牵头。** 开工前先确认几件事，这样团队不会跑偏：",
              brief.memoriesUsed.length ? "标着「我记得」的是我从之前的对话里记下的，不对可以直接改。" : "",
            ].filter(Boolean).join("\n\n")
          : "**这件事我来牵头。** 下面是我拟的计划，你确认后团队就开工；也可以先调整，或用演示模式看看效果。";
      const note = note0 + quotaFull;
      responseMessage = await updateMessage({
        where: { id: result.message.id },
        data: {
          // The router's single-turn reply (e.g. an intake form) is superseded by the brief.
          content: note,
          citations: JSON.parse(JSON.stringify([briefCitation(result.message.id, brief)])) as Prisma.InputJsonValue,
        },
      });
    } catch (error: unknown) {
      missionError = error instanceof Error ? error.message : String(error);
    }
  }

  if (
    !mission && !briefCreated && !resumed && !memoryHandled &&
    collaborationPlanShadow.mode === "SPECIALIST" &&
    dispatchReadiness.eligible &&
    dispatchReadiness.state === "EXECUTOR_READY"
  ) {
    try {
      await options?.execution?.assertActive();
      specialistDispatch = await enqueueKernSpecialistDispatch({
        session,
        conversationId,
        sourceRunId: result.runId,
        goal: content,
        readiness: dispatchReadiness,
      });

      if (specialistDispatch) {
        const dispatchNote = [
          "Kern 协作路由：已将这条低风险技术请求交给 Tech Architect。",
          `当前任务状态：${specialistDispatch.status}。专家完成后，回执会自动追加到本会话。`,
        ].join("\n");
        const originalContent = result.message.content;
        const nextContent = originalContent.includes("Kern 协作路由：")
          ? originalContent
          : `${originalContent}\n\n——\n${dispatchNote}`;
        const existingCitations = Array.isArray(result.message.citations)
          ? result.message.citations
          : [];

        responseMessage = await updateMessage({
          where: { id: result.message.id },
          data: {
            content: nextContent,
            citations: [
              ...existingCitations,
              {
                kind: "agent-task",
                ref: specialistDispatch.taskId,
                title: "Tech Architect · " + specialistDispatch.status,
              },
            ] as Prisma.InputJsonValue,
          },
        });
      }
    } catch (error: unknown) {
      specialistDispatchError =
        error instanceof Error ? error.message : String(error);
    }
  }

  const routingReceipt = {
    version: "kern-routing-receipt/v2" as const,
    runId: result.runId,
    phase: mission
      ? ("MISSION" as const)
      : briefCreated
        ? ("BRIEF" as const)
        : specialistDispatch
        ? ("AUTO" as const)
        : ("SHADOW" as const),
    missionDecision,
    missionTaskId: mission?.missionTaskId ?? null,
    briefMessageId: briefCreated?.messageId ?? null,
    missionError,
    authority: collaborationPlanShadow.authority,
    recommendedMode: collaborationPlanShadow.mode,
    recommendedExperts: collaborationPlanShadow.experts,
    synthesisTier: collaborationPlanShadow.synthesisTier,
    researchRequired: collaborationPlanShadow.researchRequired,
    qaRequired: collaborationPlanShadow.qaRequired,
    redTeamRequired: collaborationPlanShadow.redTeamRequired,
    autoDispatchCandidate: collaborationPlanShadow.autoDispatchCandidate,
    autoDispatchEligible: collaborationPlanShadow.autoDispatchEligible,
    dispatchReadiness,
    dispatchedAgentCodes: specialistDispatch
      ? [specialistDispatch.agentCode]
      : ([] as string[]),
    dispatchTaskId: specialistDispatch?.taskId ?? null,
    dispatchTaskStatus: specialistDispatch?.status ?? null,
    dispatchError: specialistDispatchError,
    goalPlanVersion: goalPlanShadow.version,
  };
  const visualAllowed =
    result.runtimeSelection.config.capabilityKeys === null ||
    result.runtimeSelection.config.capabilityKeys.includes("visualize");
  const visualGraphShadow =
    visualAllowed &&
    shouldAttachKernCouncilGraph(content, collaborationPlanShadow)
    ? buildKernCouncilGraph({
        graphId: `${result.runId}:council-shadow`,
        goal: content,
        plan: collaborationPlanShadow,
      })
    : null;

  const run = await prisma.agentRun.findUnique({
    where: { id: result.runId },
    select: { contextSnapshot: true },
  });
  if (run) {
    await prisma.$transaction(async tx => {
      if (options?.execution) await lockRunExecutionTx(tx, options.execution.guard);
      return tx.agentRun.update({
      where: { id: result.runId },
      data: {
        contextSnapshot: asInputJson({
          ...asJsonObject(run.contextSnapshot),
          assistantRuntime: context.runtimeVersion,
          collaborationMode: context.collaborationMode,
          linkedProjectIds: context.linkedProjectIds,
          confirmedCompanyFactRefs: context.confirmedCompanyFactRefs,
          reflexMode: reflex.mode,
          reflexDecisions: reflex.decisions,
          reflexError: reflex.error,
          collaborationPlanShadow,
          goalPlanShadow,
          routingReceipt,
          dispatchReadiness,
          specialistDispatch,
          mission,
          missionError,
          visualGraphShadow,
          conversationRuntimeConfig: result.runtimeSelection.config,
          selectedAdvisors: result.runtimeSelection.advisors,
          selectedSkills: result.runtimeSelection.skills,
        }),
      },
    });
    });
  }

  let message = responseMessage;
  if (visualGraphShadow) {
    const existingCitations = Array.isArray(responseMessage.citations)
      ? responseMessage.citations.filter((citation) => {
          if (!citation || typeof citation !== "object" || Array.isArray(citation)) {
            return true;
          }
          return (citation as Record<string, unknown>).kind !== "kern-graph";
        })
      : [];
    message = await updateMessage({
      where: { id: result.message.id },
      data: {
        citations: asInputJson([
          ...existingCitations,
          toKernGraphCitation(visualGraphShadow),
        ]),
      },
    });
  }

  await options?.execution?.assertActive();
  return {
    ...result,
    message,
    assistantRuntime: context.runtimeVersion,
    reflexMode: reflex.mode,
    collaborationPlanShadow,
    goalPlanShadow,
    routingReceipt,
    dispatchReadiness,
    specialistDispatch,
    specialistDispatchError,
    mission,
    brief: briefCreated,
    missionError,
    memorySaved,
    visualGraphShadow,
  };
}
