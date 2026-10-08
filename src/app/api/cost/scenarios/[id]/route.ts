/**
 * Cost Scenario Detail API - P0-1
 * GET 详情，PUT 更新，DELETE 删除
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/shared/db";
import { getServerSession } from "@/modules/identity/session";
import { isOrgAdmin } from "@/modules/identity/admin";
import { handleApiError } from "@/shared/api-handler";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await getServerSession(req);
    const scenario = await prisma.costScenario.findFirst({
      where: {
        id,
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
    const { id } = await params;
    const session = await getServerSession(req);
    const body = await req.json();
    const existing = await prisma.costScenario.findFirst({
      where: { id, organizationId: session.organizationId },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

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
    const { id } = await params;
    const session = await getServerSession(req);
    const existing = await prisma.costScenario.findFirst({
      where: { id, organizationId: session.organizationId },
    });
    // 跨组织一律 404：不泄露「该方案在别的组织存在」。
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // 删除是**破坏性**操作，需要归口：
    // 本仓其余破坏性端点（vault / connectors / schedules / playbooks / memory）
    // 一律限定「创建者本人」，此处此前只校验 organizationId，
    // 等于组织内任何登录用户都能删除他人建的方案 —— 与同族端点口径不一致。
    // 同组织成员可 GET/PUT（协作需要），但删只给创建者与组织管理员；
    // 存在性对同组织不保密，故返回 403 而非 404（跨组织才是 404）。
    const allowed = existing.createdBy === session.userId || (await isOrgAdmin(session));
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    await prisma.costScenario.delete({ where: { id: id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, req);
  }
}
