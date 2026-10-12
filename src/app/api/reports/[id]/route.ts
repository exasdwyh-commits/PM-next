import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { getExecutiveReportView } from "@/modules/product-rnd/report-view";
import { handleApiError } from "@/shared/api-handler";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    return NextResponse.json(await getExecutiveReportView(session, id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleApiError(error, req); }
}
