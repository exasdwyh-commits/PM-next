import prisma from "@/shared/db";
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSessionFromContext } from "@/modules/identity/session";
import AppShell from "@/components/app-shell";
import ConsultationClient from "./consultation-client";
import { isMockAuthEnabled } from "@/shared/runtime-status";
import { toSessionView } from "@/shared/session-view";

export const dynamic = "force-dynamic";

export default async function ConsultationPage() {
  const headerList = await headers();
  const cookieStore = await cookies();
  let session: any = null;
  try {
    session = await getServerSessionFromContext(headerList, cookieStore);
  } catch (e) {
    redirect("/login");
  }

  const orgId = session.organizationId;

  const feedbacks = await prisma.feedback.findMany({
    where: { project: { organizationId: orgId } },
    include: {
      author: { select: { name: true } },
      project: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const projects = await prisma.project.findMany({
    where: { organizationId: orgId },
    select: { id: true, title: true, ownerId: true },
    orderBy: { createdAt: "asc" },
  });

  const allUsers = await prisma.user.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, name: true, email: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <AppShell
      active="consultation"
      user={{ name: session?.userName, meta: session?.userEmail }}
      runtime={{ tone: "neutral", label: "模型未配置", detail: "仅结构化能力可用" }}
    >
      <ConsultationClient
        initialFeedbacks={JSON.parse(JSON.stringify(feedbacks))}
        projects={JSON.parse(JSON.stringify(projects))}
        allUsers={JSON.parse(JSON.stringify(allUsers))}
        currentSession={toSessionView(session)}
        mockAuth={isMockAuthEnabled()}
      />
    </AppShell>
  );
}
