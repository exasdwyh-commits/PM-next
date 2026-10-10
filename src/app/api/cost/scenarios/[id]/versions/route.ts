import { NextRequest, NextResponse } from "next/server";
import prisma from "@/shared/db";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const scenarioId = id;
    // 修前此处 `where: { scenarioId }` 完全没有组织限定 —— 任一登录用户拿他组织情景 id
    // 都能把版本明细整段读走。改为先双限定确认父情景属于本组织，再按父情景查版本。
    const scenario = await prisma.costScenario.findFirst({
      where: { id: scenarioId, organizationId: session.organizationId },
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
    const session = await getServerSession(req);
    const { id } = await params;
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
