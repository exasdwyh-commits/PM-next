/**
 * Cost Scenario Approval API - P2-2
 * POST 提交审批，PUT 审批操作
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/shared/db";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await getServerSession(req);
    const scenario = await prisma.costScenario.findFirst({
      where: { id, organizationId: session.organizationId },
    });
    if (!scenario) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await readJsonObjectBody(req);
    const approverId = body.approverId;

    const approval = await prisma.costScenarioApproval.create({
      data: {
        scenarioId: id,
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
      where: { id: id },
      data: { status: "PENDING_APPROVAL" },
    });

    return NextResponse.json({ approval }, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
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
      where: { id: approvalId, scenarioId: id, organizationId: session.organizationId },
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
      where: { id: id },
      data: { status: status as any },
    });

    return NextResponse.json({ approval: updatedApproval });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await getServerSession(req);
    const approvals = await prisma.costScenarioApproval.findMany({
      where: { scenarioId: id, organizationId: session.organizationId },
      include: {
        requester: { select: { id: true, name: true } },
        approver: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ approvals });
  } catch (error) {
    return handleApiError(error, req);
  }
}
