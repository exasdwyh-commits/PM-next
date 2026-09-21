/**
 * 成本情景 API（TASK-011）
 *
 * GET  /api/products/[id]/cost-scenarios — 列出产品关联的所有成本情景
 * POST /api/products/[id]/cost-scenarios — 保存新成本情景
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/shared/db";
import { requireSession } from "@/shared/auth";
import { UnprocessableEntityError } from "@/shared/errors";
import { saveCostScenario } from "@/modules/cost-engine/scenarios";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  const { id: productId } = await params;

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product || product.organizationId !== session.organizationId) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  const artifacts = await prisma.artifact.findMany({
    where: {
      type: "COST_SCENARIO",
      organizationId: session.organizationId,
      workItem: { projectId: product.projectId ?? undefined },
    },
    orderBy: { contentVersion: "desc" },
    select: {
      id: true,
      content: true,
      schemaVersion: true,
      contentVersion: true,
      title: true,
      createdAt: true,
    },
  });

  const scenarios = artifacts
    .filter((a) => a.schemaVersion === "1.0")
    .map((a) => {
      try {
        const parsed = JSON.parse(a.content);
        return {
          artifactId: a.id,
          scenarioName: parsed.scenarioName ?? a.title,
          engineVersion: parsed.engineVersion,
          sourceStatus: parsed.sourceStatus,
          unit: parsed.unit,
          currency: parsed.currency,
          expenseBase: parsed.expenseBase,
          result: parsed.result,
          netProfit: parsed.netProfit,
          contentVersion: a.contentVersion,
          createdAt: a.createdAt,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return NextResponse.json({ scenarios });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  const { id: productId } = await params;

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product || product.organizationId !== session.organizationId) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  const body = await req.json();
  const { scenarioName, costInput, sourceStatus, unit, currency, expenseBase, workItemId } = body;

  if (!scenarioName || !costInput || !sourceStatus || !unit || !currency || !expenseBase || !workItemId) {
    throw new UnprocessableEntityError(
      "缺少必填字段: scenarioName, costInput, sourceStatus, unit, currency, expenseBase, workItemId"
    );
  }

  const workItem = await prisma.workItem.findUnique({ where: { id: workItemId } });
  if (!workItem || workItem.projectId !== product.projectId) {
    return NextResponse.json({ error: "WorkItem not found or not in same project" }, { status: 404 });
  }

  const result = await prisma.$transaction(async (tx) => {
    return saveCostScenario(tx, {
      workItemId,
      productVersionId: product.currentVersionId,
      scenarioName,
      costInput,
      sourceStatus,
      unit,
      currency,
      expenseBase,
      recordedBy: session.userId,
      organizationId: session.organizationId,
    });
  });

  return NextResponse.json(result, { status: 201 });
}
