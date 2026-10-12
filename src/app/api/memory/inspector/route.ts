/**
 * GET /api/memory/inspector — Memory Inspector（C7 第二阶段，只读）。
 *
 * 列出当前用户自己的记忆并附 provenance（来源 / 是否原地改过 / 是否已
 * 遗忘），回答「Kern 到底记得我什么、哪些已经被忘掉」。与 GET /api/memory
 * 的区别：那个是给设置页用的 active 列表；这个是审查面，默认包含已
 * 遗忘条目（带 forgotten 标记），且只给 provenance 形状，不做任何写。
 *
 * 查询参数：
 *   kind=PREFERENCE|FACT|DECISION|OUTCOME|CORRECTION  按类型过滤（非法值 422）
 *   includeForgotten=0|false                          只看 active（默认包含已遗忘）
 *
 * 门禁：getServerSession（组织 + 用户隔离在查询层），权限登记见
 * tests/authz-matrix.ts。UI 页面是下一小步，本路由不依赖它。
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { MEMORY_KINDS, listMemoryProvenance } from "@/modules/memory";
import { handleApiError } from "@/shared/api-handler";
import { UnprocessableEntityError } from "@/shared/errors";


export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const params = req.nextUrl.searchParams;
    const kindParam = params.get("kind");
    let kind: string | undefined;
    if (kindParam !== null) {
      if (!MEMORY_KINDS.includes(kindParam)) {
        throw new UnprocessableEntityError(`kind must be one of ${MEMORY_KINDS.join(", ")}`);
      }
      kind = kindParam;
    }
    const forgottenParam = params.get("includeForgotten");
    const includeForgotten = forgottenParam !== "0" && forgottenParam !== "false";
    const items = await listMemoryProvenance(session, { kind, includeForgotten });
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error, req);
  }
}
