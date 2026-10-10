/**
 * 删除一条真实报价 / 规格行（P0-1 数据供给侧）
 *
 * DELETE /api/supplier-quotes/[id]
 *
 * 破坏性端点，权限收紧到**创建者本人或项目 OWNER** —— 只校验「是不是本项目成员」
 * 是不够的：那样任何项目成员都能删掉别人录入的报价，而报价是深度报告 ①② 块
 * 唯一的真实数据来源，误删等于把已点亮的块重新打回 UNKNOWN。
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/shared/db";
import { Role } from "@prisma/client";
import { getServerSession, requireProjectRole } from "@/modules/identity/session";
import { NotFoundError } from "@/shared/errors";
import { handleApiError } from "@/shared/api-handler";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;

    const quote = await prisma.supplierQuote.findUnique({
      where: { id },
      select: { id: true, organizationId: true, projectId: true, createdById: true },
    });

    // 跨组织一律 404（不泄露存在性）；同组织但无项目角色 → requireProjectRole 403。
    if (!quote || quote.organizationId !== session.organizationId) {
      throw new NotFoundError("Supplier quote not found");
    }

    if (quote.createdById !== session.userId) {
      await requireProjectRole(session, quote.projectId, [Role.OWNER]);
    }

    await prisma.supplierQuote.delete({ where: { id } });

    return NextResponse.json({ deleted: true, id });
  } catch (error) {
    return handleApiError(error, req);
  }
}
