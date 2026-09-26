import { Prisma } from "@prisma/client";
import prisma from "@/shared/db";
import { extractExplicitMemory, rememberForUser } from "@/modules/memory";
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
  buildNewProductMissionPlan,
  decideMissionLaunch,
  launchKernMission,
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
  options?: { runId?: string }
) {
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
  });
  let mission: { missionTaskId: string; created: boolean; nodeCount: number } | null = null;
  let missionError: string | null = null;

  // “记住…” is stored as a user-visible preference, immediately.
  let memorySaved: { id: string } | null = null;
  const explicitMemory = extractExplicitMemory(content);
  if (explicitMemory) {
    const saved = await rememberForUser(session, { ...explicitMemory, source: null }).catch(() => null);
    if (saved) {
      responseMessage = await prisma.message.update({
        where: { id: result.message.id },
        data: { content: `记住了：${saved.content}\n\n之后的工作我都会按这个来。随时可以在「设置 → Kern 的记忆」里查看或删除。` },
      });
      memorySaved = { id: saved.id };
    }
  }

  // “继续 / 重试” picks up the stopped mission in this conversation instead of starting over.
  let resumed = false;
  if (!memorySaved && isResumeIntent(content)) {
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
      responseMessage = await prisma.message.update({
        where: { id: result.message.id },
        data: {
          content: note,
          citations: [{ kind: "kern-mission", ref: stoppedId, title: "Kern 工作进展" }] as Prisma.InputJsonValue,
        },
      });
    }
  }

  if (!memorySaved && !resumed && missionDecision.launch) {
    try {
      const plan =
        missionDecision.playbook === "NEW_PRODUCT"
          ? buildNewProductMissionPlan(content)
          : buildMissionPlanFromGoalPlan(goalPlanShadow);
      const launched = await launchKernMission(session, {
        plan,
        conversationId,
        sourceRunId: result.runId,
      });
      mission = { ...launched, nodeCount: plan.nodes.length };
      const team = [...new Set(plan.nodes.filter((n) => n.kind !== "SYNTHESIS").map((n) => n.agentCode))];
      const note = [
        `**我已接手这项工作。**`,
        `拆成 ${plan.nodes.length} 步，由 ${team.length} 位专业成员并行推进，经过${plan.nodes.some((n) => n.kind === "RED_TEAM") ? "红队挑战和" : ""}独立 QA 复核后，我会把结论直接发在这里。`,
        "",
        "进度在下面实时更新，你可以先去忙别的；只有涉及预算、对外发布、不可逆动作或战略取舍时我才会找你。",
      ].join("\n");
      responseMessage = await prisma.message.update({
        where: { id: result.message.id },
        data: {
          // The router's single-turn reply (e.g. an intake form) is superseded by the mission.
          content: note,
          citations: [
            { kind: "kern-mission", ref: launched.missionTaskId, title: "Kern 工作进展" },
          ] as Prisma.InputJsonValue,
        },
      });
    } catch (error: unknown) {
      missionError = error instanceof Error ? error.message : String(error);
    }
  }

  if (
    !mission && !resumed && !memorySaved &&
    collaborationPlanShadow.mode === "SPECIALIST" &&
    dispatchReadiness.eligible &&
    dispatchReadiness.state === "EXECUTOR_READY"
  ) {
    try {
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

        responseMessage = await prisma.message.update({
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
      : specialistDispatch
        ? ("AUTO" as const)
        : ("SHADOW" as const),
    missionDecision,
    missionTaskId: mission?.missionTaskId ?? null,
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
    await prisma.agentRun.update({
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
    message = await prisma.message.update({
      where: { id: result.message.id },
      data: {
        citations: asInputJson([
          ...existingCitations,
          toKernGraphCitation(visualGraphShadow),
        ]),
      },
    });
  }

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
    missionError,
    memorySaved,
    visualGraphShadow,
  };
}
