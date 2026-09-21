import prisma from "@/shared/db";
import { notFound, redirect } from "next/navigation";
import { headers, cookies } from "next/headers";
import { getServerSessionFromContext } from "@/modules/identity/session";
import { buildEvidenceInsight } from "@/modules/research/evidence-claims";
import { parseProjectRequirements } from "@/modules/research/requirement-parser";
import { synthesizeOpportunityAnalysis } from "@/modules/research/opportunity-analysis";
import { BUSINESS_BASELINE, BASELINE_FIELD } from "@/config/business-baseline";
import { isMockAuthEnabled } from "@/shared/runtime-status";
import { toSessionView } from "@/shared/session-view";
import { PROJECT_DETAIL_SELECT } from "@/modules/projects/project-view";
import ProjectDetailClient from "./project-detail-client";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const headerList = await headers();
  const cookieStore = await cookies();

  let session: any = null;
  try {
    session = await getServerSessionFromContext(headerList, cookieStore);
  } catch (e) {
    // B01-01: 未登录跳转登录页；匿名不能读取项目数据
    redirect("/login");
  }

  const project = await prisma.project.findUnique({
    where: { id },
    // B6 收尾：与 GET /api/projects/[id] 共用同一份对外白名单（project-view），
    // 消除 SSR 与客户端刷新两套形状的漂移，同时不再下发内部关联 id 与 Json
    select: PROJECT_DETAIL_SELECT,
  });

  // R02: Cross-company or non-member cannot view project
  if (!project || project.organizationId !== session.organizationId) {
    notFound();
  }

  const isMember = project.members.some((m) => m.userId === session.userId);
  if (!isMember) {
    notFound();
  }

  // B6：开发态身份切换才需要组织成员名单；生产态不下发，避免把同组织用户 id/name/email
  // 序列化进 RSC 载荷（页面在 mockAuth=false 时本就不渲染该下拉）
  const mockAuth = isMockAuthEnabled();
  const allUsers = mockAuth
    ? await prisma.user.findMany({
        where: { organizationId: session.organizationId, isActive: true },
        select: { id: true, name: true, email: true },
      })
    : [];

  // Calculate gate gaps
  const marketEvidences = project.evidences.filter(
    (e) => e.nature === "REAL" && e.verifyStatus === "VERIFIED"
  );
  const latestPacket = project.decisionPackets[0];

  const gaps: string[] = [];
  if (marketEvidences.length === 0) {
    gaps.push("缺少核实有效的真实市场依据 (REAL Evidence)");
  }
  if (!latestPacket || !latestPacket.budgetAmount || !latestPacket.budgetScope) {
    gaps.push("拟投入预算金额或明确授权动作范围未确定");
  }
  if (!project.decisionMakerId) {
    gaps.push("未指定独立决策人");
  }

  // P1-01: 服务端计算证据覆盖/缺口（仅已核实 FACT；缺口保持 UNKNOWN），跨认证模式可用
  const evidenceInsight = buildEvidenceInsight(project.evidences);

  // P1-02: 服务端合成机会分析与市场验证（同 evidenceInsight，跨认证模式可用）
  const { resolved, gaps: evidenceGaps } = evidenceInsight;
  const constraints = parseProjectRequirements(
    `${project.target} ${project.constraints ?? ""}`
  ).constraints;
  const opportunity = synthesizeOpportunityAnalysis({ resolved, gaps: evidenceGaps }, constraints);
  const blockingKeyGaps: string[] = [];
  if (BUSINESS_BASELINE.priceRequired && evidenceGaps.some((g) => g.fieldKey === BASELINE_FIELD.price)) {
    blockingKeyGaps.push(BASELINE_FIELD.price);
  }
  if (
    BUSINESS_BASELINE.followHitRequiresSalesVolume &&
    opportunity.type === "FOLLOW_HIT_PRODUCT" &&
    evidenceGaps.some((g) => g.fieldKey === BASELINE_FIELD.salesVolume)
  ) {
    blockingKeyGaps.push(BASELINE_FIELD.salesVolume);
  }
  const validations = project.evidences
    .filter(
      (e) =>
        e.verifyStatus === "VERIFIED" &&
        (e.validationSampleSize ||
          e.validationTimeRange ||
          e.validationLimitations ||
          e.validationStatus !== "UNAPPLIED" ||
          e.claims?.some((c) => c.fieldKey?.startsWith("validation.")))
    )
    .map((e) => ({
      evidenceId: e.id,
      sampleSize: e.validationSampleSize,
      timeRange: e.validationTimeRange,
      limitations: e.validationLimitations,
      status: e.validationStatus,
      claims:
        e.claims
          ?.filter((c) => c.fieldKey?.startsWith("validation."))
          .map((c) => ({ key: c.fieldKey, value: c.value, kind: c.kind, source: e.source })) ?? [],
    }));
  const initialOpportunity = {
    type: opportunity.type,
    basis: opportunity.basis,
    elements: opportunity.elements,
    blockingKeyGaps,
    validations,
  };

  return (
    <ProjectDetailClient
      initialProject={JSON.parse(JSON.stringify(project))}
      allUsers={JSON.parse(JSON.stringify(allUsers))}
      currentSession={toSessionView(session)}
      gaps={gaps}
      mockAuth={mockAuth}
      initialEvidenceInsight={JSON.parse(JSON.stringify(evidenceInsight))}
      initialOpportunity={JSON.parse(JSON.stringify(initialOpportunity))}
    />
  );
}
