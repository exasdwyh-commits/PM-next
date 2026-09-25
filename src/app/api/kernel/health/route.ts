import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { getKernelRuntime } from "@/kernel/runtime.mjs";

export const dynamic = "force-dynamic";

/** Read-only kernel health for the product R&D vertical slice. */
export async function GET(req: NextRequest) {
  try {
    await getServerSession(req);
    const rt = getKernelRuntime();
    const reports = rt.repositories.reports.list({ limit: 1 });
    return NextResponse.json({
      ok: true,
      kernel: "pm-os",
      dbFile: rt.dbFile,
      hasApprovalService: Boolean(rt.approvalService),
      verifierIdentity: rt.verifier.identity,
      sampleReportCount: reports.length,
    });
  } catch (error) {
    return handleApiError(error, req);
  }
}
