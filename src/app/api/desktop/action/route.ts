import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { AppError } from "@/shared/errors";
import { executeComputerUseAction, describeDesktopRuntime } from "@/modules/desktop-runtime";

/**
 * 桌面运行时能力描述。
 * 需要会话：它列出本机可执行的动作类型，属内部能力面，不应对匿名调用方公开。
 */
export async function GET(req: NextRequest) {
  try {
    await getServerSession(req);
    return NextResponse.json(describeDesktopRuntime());
  } catch (e) {
    return handleApiError(e, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    await getServerSession(req);
    const body = await req.json();
    const { type, input } = body;

    // 缺必填字段是**调用方发错了**，不是服务端崩了：
    // 此前 `throw new Error(...)` 会落到 500 兜底，与 D-011/D-012 的取向相反。
    if (!type) throw new AppError("缺少 type", "MISSING_TYPE_FIELD", 400, { type: ["type 为必填"] });

    const action = {
      id: `action_${Date.now()}`,
      type,
      input: input || {},
      status: "PENDING" as const,
    };

    const result = await executeComputerUseAction(action);

    return NextResponse.json({ action: result, runtime: describeDesktopRuntime() });
  } catch (e) {
    return handleApiError(e, req);
  }
}
