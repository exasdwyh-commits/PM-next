import prisma from "@/shared/db";
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSessionFromContext } from "@/modules/identity/session";
import WarRoomClient from "./war-room-client";
import { isMockAuthEnabled } from "@/shared/runtime-status";
import { toSessionView } from "@/shared/session-view";
import { EVIDENCE_PUBLIC_SELECT } from "@/modules/evidence/evidence-view";

export const dynamic = "force-dynamic";

export default async function WarRoomPage() {
  const headerList = await headers();
  const cookieStore = await cookies();
  let session: any = null;
  try {
    session = await getServerSessionFromContext(headerList, cookieStore);
  } catch (e) {
    redirect("/login");
  }

  const orgId = session.organizationId;

  // R02: scope-limited — 仅当前用户所属组织 + 其成员的项目
  const projects = await prisma.project.findMany({
    where: { organizationId: orgId, members: { some: { userId: session.userId } } },
    include: {
      owner: { select: { id: true, name: true } },
      decisionMaker: { select: { id: true, name: true } },
      workItems: {
        include: { submissions: { include: { reviewedBy: { select: { name: true } } } }, artifacts: true },
        orderBy: { updatedAt: "desc" },
      },
      // B6：Evidence 显式白名单 —— 此前 include 会把服务端存储键 fileKey
      // 随 RSC 负载送到浏览器（可直接从 HTML 里读出）。
      evidences: { select: { ...EVIDENCE_PUBLIC_SELECT, claims: true } },
      decisionPackets: { include: { decisions: { include: { actor: { select: { name: true } } } } } },
      feedbackItems: { include: { author: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  const allUsers = await prisma.user.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, name: true, email: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <WarRoomClient
      initialProjects={JSON.parse(JSON.stringify(projects))}
      allUsers={JSON.parse(JSON.stringify(allUsers))}
      currentSession={toSessionView(session)}
      mockAuth={isMockAuthEnabled()}
    />
  );
}