import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import prisma from "@/shared/db";
import { getServerSessionFromContext } from "@/modules/identity/session";
import { getRuntimeStatus } from "@/shared/runtime-status";
import { toSessionView } from "@/shared/session-view";
import ProjectsClient from "./projects-client";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const headerList = await headers();
  const cookieStore = await cookies();

  let session: any = null;
  try {
    session = await getServerSessionFromContext(headerList, cookieStore);
  } catch {
    redirect("/login");
  }

  const projects = await prisma.project.findMany({
    // 项目列表与详情/API 使用同一权限契约：组织成员不等于项目成员。
    // 只下发当前用户实际加入的项目，避免同组织用户枚举他人的项目元数据。
    where: {
      organizationId: session.organizationId,
      members: { some: { userId: session.userId } },
    },
    include: {
      owner: { select: { id: true, name: true } },
      decisionMaker: { select: { id: true, name: true } },
      product: { select: { id: true, name: true, identityCode: true } },
      _count: { select: { workItems: true, evidences: true, decisionPackets: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <ProjectsClient
      projects={JSON.parse(JSON.stringify(projects))}
      currentSession={toSessionView(session)}
      runtime={getRuntimeStatus()}
    />
  );
}
