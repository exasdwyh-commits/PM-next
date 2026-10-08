import { NextRequest, NextResponse } from "next/server";
import prisma from "@/shared/db";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await getServerSession(req);
    const scenarioId = id;

    // CostScenarioVersion 没有 organizationId（租户由父方案继承），
    // 因此必须先确认父方案属于本组织；否则只要拿到 scenarioId 就能跨租户读到版本历史。
    // 同文件 POST 一直有这个校验，GET 此前漏了 —— 读写口径不一致即跨租户读口子。
    const scenario = await prisma.costScenario.findFirst({
      where: { id: scenarioId, organizationId: session.organizationId },
      select: { id: true },
    });
    if (!scenario) return NextResponse.json({ error: "Scenario not found" }, { status: 404 });

    const versions = await prisma.costScenarioVersion.findMany({
      where: { scenarioId },
      include: { creator: { select: { id: true, name: true } } },
      orderBy: { version: "desc" },
    });
    return NextResponse.json({ versions });
  } catch (e) {
    return handleApiError(e, req);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await getServerSession(req);
    const scenarioId = id;
    const body = await req.json();
    const { changeNote, moduleValues, bomItems, supplierQuotes, complianceItems, totalCost } = body;

    const scenario = await prisma.costScenario.findFirst({
      where: { id: scenarioId, organizationId: session.organizationId },
    });
    if (!scenario) return NextResponse.json({ error: "Scenario not found" }, { status: 404 });

    const lastVersion = await prisma.costScenarioVersion.findFirst({
      where: { scenarioId },
      orderBy: { version: "desc" },
    });
    const nextVersion = (lastVersion?.version || 0) + 1;

    const version = await prisma.costScenarioVersion.create({
      data: {
        scenarioId,
        version: nextVersion,
        moduleValues: moduleValues ?? scenario.moduleValues,
        bomItems: bomItems ?? scenario.bomItems,
        supplierQuotes: supplierQuotes ?? scenario.supplierQuotes,
        complianceItems: complianceItems ?? scenario.complianceItems,
        totalCost: totalCost ?? scenario.totalCost,
        changeNote: changeNote || `v${nextVersion}`,
        createdBy: session.userId,
      },
      include: { creator: { select: { id: true, name: true } } },
    });

    return NextResponse.json({ version });
  } catch (e) {
    return handleApiError(e, req);
  }
}
