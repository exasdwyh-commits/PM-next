import { NextRequest, NextResponse } from "next/server";
import { getServerSession, requireProjectRole } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import prisma from "@/shared/db";
import { Role } from "@prisma/client";
import { buildEvidenceInsight } from "@/modules/research/evidence-claims";

/**
 * P1-01: 证据缺口与已核实结论查看
 *
 * - 仅基于已核实 VERIFIED 的 FACT 断言计算结论与缺口；
 * - 缺失关键业务字段保持 OPEN 缺口，不自动补成事实，也不凭空生成市场数字；
 * - 冲突断言并列展示（conflicts）与选用理由（selectionReason），不静默覆盖。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id: projectId } = await params;

    await requireProjectRole(session, projectId, [
      Role.OWNER,
      Role.DECISION_MAKER,
      Role.VIEWER,
      Role.FEEDBACK_PROVIDER,
    ]);

    const evidences = await prisma.evidence.findMany({
      where: { projectId },
      include: { claims: true },
      orderBy: { createdAt: "desc" },
    });

    const { resolved: selected, conflicts, gaps } = buildEvidenceInsight(evidences);

    // 持久化到 DataGap：已覆盖字段 OPEN→可标记 FILLED；新缺口保持 OPEN（不重复堆叠）
    for (const g of gaps) {
      await prisma.dataGap.upsert({
        where: { projectId_fieldKey: { projectId, fieldKey: g.fieldKey } },
        create: { projectId, fieldKey: g.fieldKey, fieldName: g.fieldName, description: g.description, status: "OPEN" },
        update: {},
      });
    }

    return NextResponse.json({
      resolved: selected,
      conflicts,
      gaps,
    });
  } catch (error) {
    return handleApiError(error, req);
  }
}