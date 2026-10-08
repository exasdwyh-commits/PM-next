import { NextRequest, NextResponse } from "next/server";
import prisma from "@/shared/db";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const scenarioId = id;
    const versions = await prisma.costScenarioVersion.findMany({
      where: { scenarioId },
      include: { creator: { select: { id: true, name: true } } },
      orderBy: { version: "desc" },
    });
    return NextResponse.json({ versions });
  } catch (e) {
    console.error("GET versions error", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
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
    console.error("POST versions error", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
