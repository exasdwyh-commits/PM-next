/**
 * 真实报价 / 规格资料入库通道（P0-1 数据供给侧）
 *
 * GET  /api/projects/[id]/supplier-quotes — 列出项目下已入库的真实报价 / 规格行
 * POST /api/projects/[id]/supplier-quotes — 从一条已上传资料结构化录入若干行
 *
 * 设计要点：
 * - **先上传、再结构化**：文件走既有 `POST /api/projects/{id}/attachments` 落成 Evidence，
 *   这里只负责把资料里的行落库，并强制 `evidenceId` 锚定到那条资料。
 *   没有来源的行进不来 —— 深度报告 ①② 块显示的每个数字都要能回溯到具体文件。
 * - **鉴权先于业务**：不符合项目角色的调用方先拿到 403，够不到「该资料存不存在」的判断，
 *   避免用 404/422 泄露资源存在性。
 * - **数据访问走模块层**（架构守卫 AL3）：本文件只管鉴权与响应封装，
 *   查库 / 落库 / 审计都在 `modules/product-rnd/supplier-quotes`。
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { requireProjectMembership } from "@/modules/identity/service";
import { requireProjectRole } from "@/modules/identity/session";
import { UnprocessableEntityError } from "@/shared/errors";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";
import {
  ingestQuoteRows,
  isSupplierQuoteKind,
  listProjectQuotes,
  QUOTE_WRITE_ROLES,
} from "@/modules/product-rnd/supplier-quotes";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id: projectId } = await params;
    await requireProjectMembership(session, projectId);

    const kindParam = req.nextUrl.searchParams.get("kind");
    if (kindParam !== null && !isSupplierQuoteKind(kindParam)) {
      throw new UnprocessableEntityError("kind 非法，允许值：SPEC / PRICE");
    }

    const quotes = await listProjectQuotes({
      projectId,
      organizationId: session.organizationId,
      kind: kindParam ?? undefined,
    });

    return NextResponse.json({ quotes });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id: projectId } = await params;
    await requireProjectRole(session, projectId, QUOTE_WRITE_ROLES);

    const body = await readJsonObjectBody(req);
    const created = await ingestQuoteRows({
      organizationId: session.organizationId,
      projectId,
      userId: session.userId,
      evidenceId: body.evidenceId,
      kind: body.kind,
      rows: body.rows,
    });

    return NextResponse.json({ created: created.length, quotes: created }, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
