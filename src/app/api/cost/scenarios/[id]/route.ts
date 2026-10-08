/**
 * Cost Scenario Detail API - P0-1
 * GET 详情，PUT 更新，DELETE 删除
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/shared/db";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(req);
    const scenario = await prisma.costScenario.findFirst({
      where: {
        id: params.id,
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
    console.error(`GET /api/cost/scenarios/${params.id} error:`, error);
    return NextResponse.json({ error: "Failed to fetch scenario" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(req);
    const body = await req.json();
    const existing = await prisma.costScenario.findFirst({
      where: { id: params.id, organizationId: session.organizationId },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // 创建新版本
    const latestVersion = await prisma.costScenarioVersion.findFirst({
      where: { scenarioId: params.id },
      orderBy: { version: "desc" },
    });
    const nextVersion = (latestVersion?.version || 0) + 1;

    const updated = await prisma.costScenario.update({
      where: { id: params.id },
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
        scenarioId: params.id,
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
    console.error(`PUT /api/cost/scenarios/${params.id} error:`, error);
    return NextResponse.json({ error: "Failed to update scenario" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(req);
    const existing = await prisma.costScenario.findFirst({
      where: { id: params.id, organizationId: session.organizationId },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.costScenario.delete({ where: { id: params.id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`DELETE /api/cost/scenarios/${params.id} error:`, error);
    return NextResponse.json({ error: "Failed to delete scenario" }, { status: 500 });
  }
}
