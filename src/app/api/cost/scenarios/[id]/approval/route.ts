/**
 * Cost Scenario Approval API - P2-2
 * POST 提交审批，PUT 审批操作
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/shared/db";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(req);
    const scenario = await prisma.costScenario.findFirst({
      where: { id: params.id, organizationId: session.organizationId },
    });
    if (!scenario) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const approverId = body.approverId;

    const approval = await prisma.costScenarioApproval.create({
      data: {
        scenarioId: params.id,
        organizationId: session.organizationId,
        requestedBy: session.userId,
        approverId: approverId || null,
        status: "PENDING_APPROVAL",
        comment: body.comment || `提交审批：${scenario.name}`,
      },
      include: {
        requester: { select: { id: true, name: true } },
        approver: { select: { id: true, name: true } },
      },
    });

    await prisma.costScenario.update({
      where: { id: params.id },
      data: { status: "PENDING_APPROVAL" },
    });

    return NextResponse.json({ approval }, { status: 201 });
  } catch (error) {
    console.error(`POST /api/cost/scenarios/${params.id}/approval error:`, error);
    return NextResponse.json({ error: "Failed to submit approval" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(req);
    const body = await req.json();
    const { approvalId, status, comment } = body;

    if (!approvalId || !status) {
      return NextResponse.json({ error: "approvalId and status required" }, { status: 400 });
    }

    const validStatus = ["APPROVED", "REJECTED"];
    if (!validStatus.includes(status)) {
      return NextResponse.json({ error: `Invalid status, must be ${validStatus.join(", ")}` }, { status: 400 });
    }

    const approval = await prisma.costScenarioApproval.findFirst({
      where: { id: approvalId, scenarioId: params.id, organizationId: session.organizationId },
    });
    if (!approval) return NextResponse.json({ error: "Approval not found" }, { status: 404 });

    const updatedApproval = await prisma.costScenarioApproval.update({
      where: { id: approvalId },
      data: {
        status,
        approverId: session.userId,
        comment: comment || approval.comment,
      },
      include: {
        requester: { select: { id: true, name: true } },
        approver: { select: { id: true, name: true } },
      },
    });

    await prisma.costScenario.update({
      where: { id: params.id },
      data: { status: status as any },
    });

    return NextResponse.json({ approval: updatedApproval });
  } catch (error) {
    console.error(`PUT /api/cost/scenarios/${params.id}/approval error:`, error);
    return NextResponse.json({ error: "Failed to update approval" }, { status: 500 });
  }
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(req);
    const approvals = await prisma.costScenarioApproval.findMany({
      where: { scenarioId: params.id, organizationId: session.organizationId },
      include: {
        requester: { select: { id: true, name: true } },
        approver: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ approvals });
  } catch (error) {
    console.error(`GET /api/cost/scenarios/${params.id}/approval error:`, error);
    return NextResponse.json({ error: "Failed to fetch approvals" }, { status: 500 });
  }
}
