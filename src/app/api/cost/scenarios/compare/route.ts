/**
 * Cost Scenario Compare API - P0-1 + P0-4
 * POST 对比多个方案，返回对比数据+图表数据
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/shared/db";
import { getServerSession } from "@/modules/identity/session";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { ids } = body;

    if (!ids || !Array.isArray(ids) || ids.length < 2) {
      return NextResponse.json({ error: "At least 2 ids required" }, { status: 400 });
    }

    const scenarios = await prisma.costScenario.findMany({
      where: {
        id: { in: ids },
        organizationId: session.organizationId,
      },
      include: {
        creator: { select: { id: true, name: true } },
        project: { select: { id: true, title: true } },
      },
    });

    if (scenarios.length < 2) {
      return NextResponse.json({ error: "Not enough scenarios found" }, { status: 404 });
    }

    // 计算对比
    const metrics = [
      "totalMaterialCost",
      "totalManufacturingCost",
      "totalPackagingCost",
      "totalLogisticsCost",
      "totalComplianceCost",
      "totalChannelCost",
      "totalCost",
      "suggestedRetailPrice",
      "profitMargin",
    ] as const;

    const comparison: Record<string, { min: number; max: number; avg: number; values: number[] }> = {};
    metrics.forEach(m => {
      const vals = scenarios.map(s => (s as any)[m] as number).filter(v => typeof v === "number");
      if (vals.length > 0) {
        comparison[m] = {
          min: Math.min(...vals),
          max: Math.max(...vals),
          avg: vals.reduce((a, b) => a + b, 0) / vals.length,
          values: vals,
        };
      }
    });

    // 图表数据 - 柱状图对比
    const barChartData = {
      labels: scenarios.map(s => s.name),
      datasets: metrics.map(m => ({
        label: m === "totalCost" ? "总成本" : m === "totalMaterialCost" ? "原料" : m === "suggestedRetailPrice" ? "零售价" : m,
        data: scenarios.map(s => (s as any)[m]),
      })),
    };

    // 饼图数据 - 第一个方案的构成
    const firstScenario = scenarios[0];
    const pieChartData = {
      labels: ["原料", "生产", "包装", "物流", "合规", "渠道"],
      values: [
        firstScenario.totalMaterialCost,
        firstScenario.totalManufacturingCost,
        firstScenario.totalPackagingCost,
        firstScenario.totalLogisticsCost,
        firstScenario.totalComplianceCost,
        firstScenario.totalChannelCost,
      ],
      total: firstScenario.totalCost,
    };

    // 瀑布图数据
    const waterfallData = scenarios.map(s => ({
      name: s.name,
      items: [
        { label: "原料", value: s.totalMaterialCost },
        { label: "生产", value: s.totalManufacturingCost },
        { label: "包装", value: s.totalPackagingCost },
        { label: "物流", value: s.totalLogisticsCost },
        { label: "合规", value: s.totalComplianceCost },
        { label: "渠道", value: s.totalChannelCost },
      ],
      total: s.totalCost,
    }));

    // 4类对比
    const byCategory = scenarios.reduce((acc: any, s) => {
      if (!acc[s.category]) acc[s.category] = [];
      acc[s.category].push(s);
      return acc;
    }, {});

    return NextResponse.json({
      scenarios,
      comparison,
      charts: {
        bar: barChartData,
        pie: pieChartData,
        waterfall: waterfallData,
      },
      byCategory,
      count: scenarios.length,
    });
  } catch (error) {
    console.error("POST /api/cost/scenarios/compare error:", error);
    return NextResponse.json({ error: "Failed to compare scenarios" }, { status: 500 });
  }
}
