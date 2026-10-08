import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { executeDesktopAction, describeDesktopRuntime } from "@/modules/desktop-runtime";

export async function GET() {
  return NextResponse.json(describeDesktopRuntime());
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await req.json();
    const { type, input } = body;

    if (!type) throw new Error("缺少 type");

    const action = {
      id: `action_${Date.now()}`,
      type,
      input: input || {},
      status: "PENDING" as const,
    };

    const result = await executeDesktopAction(action);

    return NextResponse.json({ action: result, runtime: describeDesktopRuntime() });
  } catch (e) {
    return handleApiError(e, req);
  }
}
