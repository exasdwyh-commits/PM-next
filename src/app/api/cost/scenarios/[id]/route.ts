/**
 * Cost Scenario Detail API - P0-1
 * GET 详情，PUT 更新，DELETE 删除
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/shared/db";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { ForbiddenError } from "@/shared/errors";

/**
 * 成本情景是**组织级共享资产**（列表按 organizationId 对同组织成员开放），
 * 但改/删是破坏性操作，只认创建者本人：
 * - 跨组织：组织过滤查不到 → 404（不泄露资源存在性）
 * - 同组织非创建者 → 403（明确告知无权，而不是让它变成"找不到"）
 * 修前这里只按 organizationId 过滤，同组织任何成员都能改删他人情景。
 */
function assertOwner(scenario: { createdBy: string }, session: { userId: string }) {
  if (scenario.createdBy !== session.userId) {
    throw new ForbiddenError("只有成本情景的创建者可以修改或删除它");
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const scenario = await prisma.costScenario.findFirst({
      where: {
        id: id,
        organizationId: session.organizationId,
      },
      include: {
        creator: { select: { id: true, name: true, email: true } },
        project: { select: { id: true, title: true } },
        comments: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { createdAt: "desc" },
        },
        versions: {
          orderBy: { version: "desc" },
          take: 10,
        },
        approvals: {
          include: {
            requester: { select: { id: true, name: true } },
            approver: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!scenario) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ scenario });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const body = await req.json();
    const existing = await prisma.costScenario.findFirst({
      where: { id: id, organizationId: session.organizationId },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    assertOwner(existing, session);

    // 创建新版本
    const latestVersion = await prisma.costScenarioVersion.findFirst({
      where: { scenarioId: id },
      orderBy: { version: "desc" },
    });
    const nextVersion = (latestVersion?.version || 0) + 1;

    const updated = await prisma.costScenario.update({
      where: { id: id },
      data: {
        name: body.name ?? existing.name,
        category: body.category ?? existing.category,
        productName: body.productName ?? existing.productName,
        moduleValues: body.moduleValues ?? existing.moduleValues,
        bomItems: body.bomItems ?? existing.bomItems,
        supplierQuotes: body.supplierQuotes ?? existing.supplierQuotes,
        complianceItems: body.complianceItems ?? existing.complianceItems,
        totalMaterialCost: body.totalMaterialCost ?? existing.totalMaterialCost,
        totalManufacturingCost: body.totalManufacturingCost ?? existing.totalManufacturingCost,
        totalPackagingCost: body.totalPackagingCost ?? existing.totalPackagingCost,
        totalLogisticsCost: body.totalLogisticsCost ?? existing.totalLogisticsCost,
        totalComplianceCost: body.totalComplianceCost ?? existing.totalComplianceCost,
        totalChannelCost: body.totalChannelCost ?? existing.totalChannelCost,
        totalCost: body.totalCost ?? existing.totalCost,
        suggestedRetailPrice: body.suggestedRetailPrice ?? existing.suggestedRetailPrice,
        profitMargin: body.profitMargin ?? existing.profitMargin,
        notes: body.notes ?? existing.notes,
        tags: body.tags ?? existing.tags,
        isFavorite: body.isFavorite ?? existing.isFavorite,
        status: body.status ?? existing.status,
      },
    });

    await prisma.costScenarioVersion.create({
      data: {
        scenarioId: id,
        version: nextVersion,
        moduleValues: updated.moduleValues as any,
        bomItems: updated.bomItems as any,
        supplierQuotes: updated.supplierQuotes as any,
        complianceItems: updated.complianceItems as any,
        totalCost: updated.totalCost,
        changeNote: body.changeNote || `更新版本 ${nextVersion}`,
        createdBy: session.userId,
      },
    });

    return NextResponse.json({ scenario: updated });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const existing = await prisma.costScenario.findFirst({
      where: { id: id, organizationId: session.organizationId },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    assertOwner(existing, session);

    await prisma.costScenario.delete({ where: { id: id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, req);
  }
}
