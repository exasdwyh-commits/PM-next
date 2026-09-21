import prisma from "@/shared/db";
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSessionFromContext } from "@/modules/identity/session";
import TraceClient from "./trace-client";

export const dynamic = "force-dynamic";

export default async function TracePage() {
  const headerList = await headers();
  const cookieStore = await cookies();
  let session: any = null;
  try {
    session = await getServerSessionFromContext(headerList, cookieStore);
  } catch (e) {
    redirect("/login");
  }

  const orgId = session.organizationId;

  const [packets, feeds, audits] = await Promise.all([
    prisma.decisionPacket.findMany({
      where: { project: { organizationId: orgId } },
      include: {
        project: { select: { id: true, title: true } },
        decisions: {
          include: { actor: { select: { name: true } } },
          orderBy: { decidedAt: "desc" },
        },
        productVersion: { select: { versionTag: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.feedback.findMany({
      where: { project: { organizationId: orgId }, status: { in: ["ACCEPTED", "REJECTED"] } },
      include: {
        author: { select: { name: true } },
        project: { select: { id: true, title: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.auditEvent.findMany({
      where: { actor: { organizationId: orgId } },
      include: { actor: { select: { name: true } } },
      orderBy: { timestamp: "desc" },
      // 审计时间线是追溯页的主体内容；服务端多取以支撑「查看全部」展开
      // （200 条为展示上限，超出部分仍需数据库查询工具，UI 不承诺全量）。
      take: 200,
    }),
  ]);

  return (
    <TraceClient
      initialPackets={JSON.parse(JSON.stringify(packets))}
      initialFeeds={JSON.parse(JSON.stringify(feeds))}
      initialAudits={JSON.parse(JSON.stringify(audits))}
      user={{ name: session?.userName, meta: session?.userEmail }}
      runtime={{ tone: "neutral", label: "模型未配置", detail: "仅结构化能力可用" }}
    />
  );
}