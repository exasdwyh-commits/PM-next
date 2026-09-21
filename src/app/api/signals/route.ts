import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { createManualSignal, listOrganizationSignals } from "@/modules/signal/manual-signal";
import { handleApiError } from "@/shared/api-handler";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    return NextResponse.json(await listOrganizationSignals(session));
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await req.json();
    const signal = await createManualSignal(session, body);
    return NextResponse.json(signal, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
