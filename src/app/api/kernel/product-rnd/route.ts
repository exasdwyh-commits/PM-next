import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { UnprocessableEntityError } from "@/shared/errors";
import { runKernelProductRnd } from "@/kernel/runtime.mjs";

export const dynamic = "force-dynamic";

/**
 * PM OS Kernel — Product R&D vertical slice entry.
 * UI must not call models/tools directly; this route is the only bridge into the kernel.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await req.json();
    const idea = typeof body?.idea === "string" ? body.idea.trim() : "";
    if (!idea) throw new UnprocessableEntityError("idea is required");

    const idempotencyHeader = req.headers.get("idempotency-key");
    const idempotencyKey =
      (typeof body?.idempotencyKey === "string" && body.idempotencyKey.trim()) ||
      (idempotencyHeader ? idempotencyHeader.slice(0, 200) : null);

    const result = await runKernelProductRnd({
      idea,
      dataClass: body?.dataClass ?? "INTERNAL",
      actor: session.userId || "department-assistant",
      idempotencyKey,
    });

    // Project view for UI: keep kernel canonical, strip huge raw blobs if any.
    const payload = {
      project: result.project
        ? {
            id: result.project.id,
            title: result.project.title,
            goal: result.project.goal,
            status: result.project.status,
            dataClass: result.project.dataClass,
            owner: result.project.owner,
            createdAt: result.project.createdAt,
          }
        : null,
      task: result.task
        ? {
            id: result.task.id,
            title: result.task.title,
            status: result.task.status,
            stage: result.task.stage,
            runId: result.task.runId,
            attempt: result.task.attempt,
            reportId: result.task.reportId,
          }
        : null,
      route: result.route
        ? {
            recommendedModel: result.route.recommendedModel,
            selectedModel: result.route.selectedModel,
            shadow: result.route.shadow,
            reason: result.route.reason,
          }
        : null,
      report: result.report
        ? {
            id: result.report.id,
            title: result.report.title,
            executiveSummary: result.report.executiveSummary,
            conclusions: result.report.conclusions,
            decisionsRequired: result.report.decisionsRequired,
            risks: result.report.risks,
            unresolvedQuestions: result.report.unresolvedQuestions,
            knowledgeDebtIds: result.report.knowledgeDebtIds,
            nextActions: result.report.nextActions,
            advisoryNotes: result.report.advisoryNotes ?? [],
            verifierIdentity: result.report.verifierIdentity,
            verifierRunId: result.report.verifierRunId,
            verifiedAt: result.report.verifiedAt,
            createdAt: result.report.createdAt,
          }
        : null,
      evidence: (result.evidence ?? []).map((e: any) => ({
        id: e.id,
        title: e.title,
        sourceType: e.sourceType,
        sourceUri: e.sourceUri,
        sourceName: e.sourceName,
        trustTier: e.trustTier,
        httpStatus: e.httpStatus,
        contentHash: e.contentHash,
        injectionScanResult: e.injectionScanResult,
        untrustedInput: e.untrustedInput,
      })),
      knowledgeDebt: (result.knowledgeDebt ?? []).map((d: any) => ({
        id: d.id,
        topic: d.topic,
        status: d.status,
        importance: d.importance,
        occurrences: d.occurrences,
        reason: d.reason,
      })),
      provider: result.provider,
      recoveryRequired: Boolean((result as { recoveryRequired?: boolean }).recoveryRequired),
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function GET(req: NextRequest) {
  try {
    await getServerSession(req);
    const { listKernelProductRnd } = await import("@/kernel/runtime.mjs");
    const state = listKernelProductRnd();
    return NextResponse.json(state);
  } catch (error) {
    return handleApiError(error, req);
  }
}
