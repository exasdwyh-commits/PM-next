import prisma from "@/shared/db";
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSessionFromContext } from "@/modules/identity/session";
import DashboardClient from "./dashboard-client";
import { getContentModeConfig } from "@/shared/content-mode";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const headerList = await headers();
  const cookieStore = await cookies();
  let session: any = null;
  try {
    session = await getServerSessionFromContext(headerList, cookieStore);
  } catch (e) {
    redirect("/login");
  }

  const orgId = session.organizationId;
  // project 有 organizationId；evidence/workItem/dataGap/feedback 均通过 project relation 归属组织
  const projOrg = { organizationId: orgId };
  const viaProjOrg = { project: { organizationId: orgId } };

  // 真实计数统计，全部来自库内数据，不做任何估算
  const [projects, stageGroups, evidenceGroups, evidenceNatureGroups, validationGroups, workItemGroups, packetGroups, gapCount, feedbackGroups, memberCount] =
    await Promise.all([
      prisma.project.findMany({
        where: { ...projOrg, members: { some: { userId: session.userId } } },
        include: { owner: { select: { id: true, name: true } }, decisionMaker: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.project.groupBy({ by: ["stage"], where: projOrg, _count: { _all: true } }),
      prisma.evidence.groupBy({ by: ["verifyStatus"], where: viaProjOrg, _count: { _all: true } }),
      prisma.evidence.groupBy({ by: ["nature"], where: viaProjOrg, _count: { _all: true } }),
      prisma.evidence.groupBy({ by: ["validationStatus"], where: viaProjOrg, _count: { _all: true } }),
      prisma.workItem.groupBy({ by: ["status"], where: viaProjOrg, _count: { _all: true } }),
      prisma.decisionPacket.groupBy({ by: ["status"], where: viaProjOrg, _count: { _all: true } }),
      prisma.dataGap.count({ where: { ...viaProjOrg, status: "OPEN" } }),
      prisma.feedback.groupBy({ by: ["status"], where: viaProjOrg, _count: { _all: true } }),
      prisma.user.count({ where: { organizationId: orgId, isActive: true } }),
    ]);

  /**
   * Prisma groupBy 结果 → { 枚举值: 计数 }。
   *
   * ⚠️ 必须取**值**（`r[field]`），不能取字段名（`field`）。
   * 取字段名会让每张分组表都塌成 `{ stage: 1 }` / `{ status: 1 }` 这样的单键表：
   *   · 证据资产等用 `count(map, "VERIFIED")` 查表的地方**全部恒为 0**（真数据被显示成 0）；
   *   · 阶段 / 状态面板把内部字段名当标签渲染（页面上出现「stage 1」「status 1」）。
   */
  const toMap = (rows: any[]): Record<string, number> =>
    Object.fromEntries(
      rows.map((r) => {
        const field = Object.keys(r).find((k) => k !== "_count") as string;
        return [String(r[field]), r._count._all];
      }),
    );

  // 科学证据统计（从知识库原料卡）
  const ingredientDocs = await prisma.knowledgeDocument.findMany({
    where: {
      organizationId: orgId,
      relativePath: { startsWith: "30-science/ingredients/" },
      deletedAt: null,
    },
    select: { frontmatter: true },
  });
  const evidenceLevels = ingredientDocs.reduce((acc: Record<string, number>, d) => {
    const fm = d.frontmatter as any;
    const level = fm?.evidence_level || "UNKNOWN";
    acc[level] = (acc[level] || 0) + 1;
    return acc;
  }, {});
  const lowConfidenceCount = ingredientDocs.filter((d) => {
    const fm = d.frontmatter as any;
    return (parseInt(fm?.confidence || "100", 10) < 70);
  }).length;

  // 挑战报告统计（从 Message citations）
  const challengeMessages = await prisma.message.findMany({
    where: {
      // Advisor conversation 是 owner-only；同组织不能读取他人的挑战报告。
      conversation: { organizationId: orgId, ownerId: session.userId },
      citations: { path: ["0", "kind"], equals: "challenge-report" },
    },
    select: { citations: true, createdAt: true, conversationId: true },
    orderBy: { createdAt: "desc" },
    // 「最近挑战报告」默认展示 5 条，其余由客户端「查看全部」展开；
    // 服务端多取一些以支撑展开视图（Dashboard 层不承诺全量分页）。
    take: 50,
  });
  const recentChallenges = challengeMessages.map((m) => {
    const c = (m.citations as any)?.[0];
    return {
      productName: c?.report?.productName || "未知产品",
      overallRisk: c?.report?.overallRisk || "UNKNOWN",
      recommendation: c?.report?.recommendation || "UNKNOWN",
      createdAt: m.createdAt,
      conversationId: m.conversationId,
      // challenge-report citation 的 ref 必须是实际产品 ID，不能使用 inline 占位符。
      productId: typeof c?.ref === "string" && c.ref !== "inline" ? c.ref : null,
    };
  });

  const stats = {
    projects,
    projectCount: projects.length,
    stageGroups: toMap(stageGroups),
    verifyStatusGroups: toMap(evidenceGroups),
    natureGroups: toMap(evidenceNatureGroups),
    validationGroups: toMap(validationGroups),
    workItemGroups: toMap(workItemGroups),
    packetGroups: toMap(packetGroups),
    feedbackGroups: toMap(feedbackGroups),
    openGapCount: gapCount,
    memberCount,
    // 科学证据
    evidenceLevels,
    ingredientCount: ingredientDocs.length,
    lowConfidenceCount,
    recentChallenges,
  };

  return (
    <DashboardClient
      initialStats={JSON.parse(JSON.stringify(stats))}
      user={{ name: session?.userName, meta: session?.userEmail }}
      runtime={{ tone: "neutral", label: "模型未配置", detail: "仅结构化能力可用" }}
      knowledgeSampleMode={getContentModeConfig().knowledgeSampleMode}
    />
  );
}
