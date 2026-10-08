/**
 * Cost Scenario API - P0-1 后端持久化
 * POST 保存方案，GET 列表，支持projectId过滤，4类统计
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/shared/db";
import { getServerSession } from "@/modules/identity/session";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");
    const category = searchParams.get("category");
    const status = searchParams.get("status");
    const favorite = searchParams.get("favorite");

    const where: any = {
      organizationId: session.organizationId,
    };
    if (projectId) where.projectId = projectId;
    if (category) where.category = category;
    if (status) where.status = status;
    if (favorite === "true") where.isFavorite = true;

    const scenarios = await prisma.costScenario.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: {
        creator: { select: { id: true, name: true, email: true } },
        project: { select: { id: true, title: true } },
        _count: { select: { comments: true, versions: true } },
      },
    });

    // 统计
    const stats = {
      total: scenarios.length,
      byCategory: scenarios.reduce((acc: any, s: any) => {
        acc[s.category] = (acc[s.category] || 0) + 1;
        return acc;
      }, {}),
      byStatus: scenarios.reduce((acc: any, s: any) => {
        acc[s.status] = (acc[s.status] || 0) + 1;
        return acc;
      }, {}),
      favorites: scenarios.filter((s: any) => s.isFavorite).length,
      avgCost: scenarios.length > 0 ? scenarios.reduce((sum: number, s: any) => sum + s.totalCost, 0) / scenarios.length : 0,
    };

    return NextResponse.json({ scenarios, stats });
  } catch (error) {
    console.error("GET /api/cost/scenarios error:", error);
    return NextResponse.json({ error: "Failed to fetch scenarios" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const {
      name,
      category = "health_food",
      productName,
      projectId,
      moduleValues = {},
      bomItems = [],
      supplierQuotes = [],
      complianceItems = [],
      totalMaterialCost = 0,
      totalManufacturingCost = 0,
      totalPackagingCost = 0,
      totalLogisticsCost = 0,
      totalComplianceCost = 0,
      totalChannelCost = 0,
      totalCost = 0,
      suggestedRetailPrice = 0,
      profitMargin = 0,
      notes,
      tags = [],
      isFavorite = false,
    } = body;

    if (!name || !productName) {
      return NextResponse.json({ error: "name and productName required" }, { status: 400 });
    }

    // 验证4类
    const validCategories = ["regular_food", "health_food", "cross_border_food", "cosmetics", "custom"];
    if (!validCategories.includes(category)) {
      return NextResponse.json({ error: `Invalid category, must be one of ${validCategories.join(", ")}` }, { status: 400 });
    }

    const scenario = await prisma.costScenario.create({
      data: {
        organizationId: session.organizationId,
        projectId: projectId || null,
        name,
        category,
        productName,
        moduleValues,
        bomItems,
        supplierQuotes,
        complianceItems,
        totalMaterialCost,
        totalManufacturingCost,
        totalPackagingCost,
        totalLogisticsCost,
        totalComplianceCost,
        totalChannelCost,
        totalCost,
        suggestedRetailPrice,
        profitMargin,
        notes,
        tags,
        isFavorite,
        createdBy: session.userId,
      },
      include: {
        creator: { select: { id: true, name: true } },
        project: { select: { id: true, title: true } },
      },
    });

    // 创建初始版本
    await prisma.costScenarioVersion.create({
      data: {
        scenarioId: scenario.id,
        version: 1,
        moduleValues,
        bomItems,
        supplierQuotes,
        complianceItems,
        totalCost,
        changeNote: "初始版本",
        createdBy: session.userId,
      },
    });

    return NextResponse.json({ scenario }, { status: 201 });
  } catch (error) {
    console.error("POST /api/cost/scenarios error:", error);
    return NextResponse.json({ error: "Failed to create scenario" }, { status: 500 });
  }
}
