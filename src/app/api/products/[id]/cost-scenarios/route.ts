/**
 * 成本情景 API（TASK-011）
 *
 * GET  /api/products/[id]/cost-scenarios — 列出产品关联的所有成本情景
 * POST /api/products/[id]/cost-scenarios — 保存新成本情景
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/shared/db";
import { getServerSession } from "@/modules/identity/session";
import {
  PRODUCT_WRITE_ROLES,
  requireProductRead,
  requireProductRole,
} from "@/modules/identity/product-access";
import { NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import { saveCostScenario } from "@/modules/cost-engine/scenarios";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

const COST_SCENARIO_STATUSES = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;
type CostScenarioStatus = (typeof COST_SCENARIO_STATUSES)[number];

function isCostScenarioStatus(value: unknown): value is CostScenarioStatus {
  return typeof value === "string" &&
    COST_SCENARIO_STATUSES.includes(value as CostScenarioStatus);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id: productId } = await params;
    await requireProductRead(session, productId);

    const artifacts = await prisma.artifact.findMany({
      where: {
        type: "COST_SCENARIO",
        organizationId: session.organizationId,
        workItem: {
          project: {
            productId,
            organizationId: session.organizationId,
          },
        },
      },
      orderBy: { contentVersion: "desc" },
      select: {
        id: true,
        content: true,
        schemaVersion: true,
        contentVersion: true,
        title: true,
        createdAt: true,
        productVersionId: true,
      },
    });

    const scenarios = artifacts.flatMap((artifact) => {
      if (artifact.schemaVersion !== "1.0") return [];
      try {
        const parsed = JSON.parse(artifact.content) as Record<string, unknown>;
        return [{
          artifactId: artifact.id,
          productVersionId: artifact.productVersionId,
          scenarioName: parsed.scenarioName ?? artifact.title,
          engineVersion: parsed.engineVersion,
          sourceStatus: parsed.sourceStatus,
          unit: parsed.unit,
          currency: parsed.currency,
          expenseBase: parsed.expenseBase,
          result: parsed.result,
          netProfit: parsed.netProfit,
          contentVersion: artifact.contentVersion,
          createdAt: artifact.createdAt,
        }];
      } catch {
        return [];
      }
    });

    return NextResponse.json({ scenarios });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id: productId } = await params;
    await requireProductRole(session, productId, PRODUCT_WRITE_ROLES);

    const body = await readJsonObjectBody(req);
    const {
      scenarioName,
      costInput,
      sourceStatus,
      unit,
      currency,
      expenseBase,
      workItemId,
    } = body;

    if (!scenarioName || !costInput || !sourceStatus || !unit || !currency || !expenseBase || !workItemId) {
      throw new UnprocessableEntityError(
        "缺少必填字段: scenarioName, costInput, sourceStatus, unit, currency, expenseBase, workItemId"
      );
    }
    if (!isCostScenarioStatus(sourceStatus)) {
      throw new UnprocessableEntityError(
        `sourceStatus 非法，允许值：${COST_SCENARIO_STATUSES.join(" / ")}`
      );
    }

    const workItem = await prisma.workItem.findUnique({
      where: { id: String(workItemId) },
      include: {
        project: {
          select: {
            id: true,
            organizationId: true,
            productId: true,
            productVersionId: true,
          },
        },
      },
    });

    if (!workItem ||
        workItem.project.organizationId !== session.organizationId ||
        workItem.project.productId !== productId) {
      throw new NotFoundError("WorkItem not found or not linked to this product");
    }

    const latestVersion = await prisma.productVersion.findFirst({
      where: { productId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    const productVersionId =
      workItem.project.productVersionId ?? latestVersion?.id ?? null;

    const result = await prisma.$transaction((tx) =>
      saveCostScenario(tx, {
        workItemId: workItem.id,
        productVersionId,
        scenarioName: String(scenarioName),
        costInput,
        sourceStatus,
        unit: String(unit),
        currency: String(currency),
        expenseBase: String(expenseBase),
        recordedBy: session.userId,
        organizationId: session.organizationId,
      })
    );

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
