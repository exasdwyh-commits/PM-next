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
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/shared/db";
import { Role } from "@prisma/client";
import { getServerSession } from "@/modules/identity/session";
import { requireProjectMembership } from "@/modules/identity/service";
import { requireProjectRole } from "@/modules/identity/session";
import { NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";
import {
  isSupplierQuoteKind,
  normalizeQuoteRows,
  type SupplierQuoteKindValue,
} from "@/modules/product-rnd/supplier-quotes";

/** 与附件上传口对齐：能往项目里写资料的角色即可录入报价。 */
const QUOTE_WRITE_ROLES: Role[] = [Role.OWNER, Role.DECISION_MAKER, Role.FEEDBACK_PROVIDER];

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

    const quotes = await prisma.supplierQuote.findMany({
      where: {
        projectId,
        organizationId: session.organizationId,
        ...(kindParam ? { kind: kindParam as SupplierQuoteKindValue } : {}),
      },
      include: {
        evidence: {
          select: {
            id: true,
            source: true,
            nature: true,
            verifyStatus: true,
            originalFilename: true,
          },
        },
      },
      orderBy: [{ quotedAt: "desc" }, { createdAt: "desc" }],
      take: 500,
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
    const { evidenceId, kind, rows } = body;

    if (typeof evidenceId !== "string" || !evidenceId.trim()) {
      throw new UnprocessableEntityError(
        "缺少 evidenceId：报价行必须锚定一条已上传的真实资料（先调 POST /api/projects/{id}/attachments）"
      );
    }
    if (!isSupplierQuoteKind(kind)) {
      throw new UnprocessableEntityError("kind 非法，允许值：SPEC / PRICE");
    }
    // 行校验在资料归属校验之前：入参形态错误与资源是否存在是两回事，
    // 先把调用方能改的错一次性说清（消息里带行号）。
    const normalized = normalizeQuoteRows(rows);

    // 跨项目 / 跨组织借用他人资料一律按不存在处理（404 而非 403），不泄露存在性。
    const evidence = await prisma.evidence.findFirst({
      where: {
        id: evidenceId.trim(),
        projectId,
        project: { organizationId: session.organizationId },
      },
      select: { id: true },
    });
    if (!evidence) {
      throw new NotFoundError("Evidence not found in this project");
    }

    const created = await prisma.$transaction(async (tx) => {
      const out = [];
      for (const row of normalized) {
        out.push(
          await tx.supplierQuote.create({
            data: {
              organizationId: session.organizationId,
              projectId,
              evidenceId: evidence.id,
              kind: kind as SupplierQuoteKindValue,
              supplier: row.supplier ?? null,
              item: row.item,
              spec: row.spec ?? null,
              uom: row.uom ?? null,
              moq: row.moq ?? null,
              unitPrice: row.unitPrice ?? null,
              currency: row.currency ?? "CNY",
              quotedAt: row.quotedAt ?? null,
              note: row.note ?? null,
              createdById: session.userId,
            },
          })
        );
      }
      return out;
    });

    await prisma.auditEvent.create({
      data: {
        actorId: session.userId,
        action: "SUPPLIER_QUOTE_INGESTED",
        objectType: "SupplierQuote",
        objectId: evidence.id,
        summary: `从资料 ${evidence.id} 结构化录入 ${created.length} 条${kind === "SPEC" ? "规格" : "报价"}行`,
      },
    });

    return NextResponse.json({ created: created.length, quotes: created }, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
