import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { UnprocessableEntityError } from "@/shared/errors";
import { executeDesktopAction, describeDesktopRuntime } from "@/modules/desktop-runtime";

export async function GET(req: NextRequest) {
  try {
    // 只读能力描述，但仍须登录：与同文件 POST 口径一致
    await getServerSession(req);
    return NextResponse.json(describeDesktopRuntime());
  } catch (e) {
    return handleApiError(e, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await req.json();
    const { type, input } = body;

    if (!type) throw new UnprocessableEntityError("缺少 type");

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
