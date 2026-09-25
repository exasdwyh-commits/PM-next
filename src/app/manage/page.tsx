import prisma from "@/shared/db";
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSessionFromContext } from "@/modules/identity/session";
import { getWorkspaceOverview } from "@/modules/workspace/overview";
import { getRuntimeStatus, isMockAuthEnabled } from "@/shared/runtime-status";
import { toSessionView } from "@/shared/session-view";
import WorkbenchClient from "../workbench-client";
import { getWorkforceActivityBrief } from "@/modules/workforce/activity-brief";

export const dynamic = "force-dynamic";

/**
 * 专业管理后台。
 *
 * Muse 是默认操作入口；这里保留传统、完整、可深入的产品/项目/评估/证据/自动化管理能力，
 * 面向产品经理、项目负责人和管理员，不要求领导层或普通成员日常进入。
 */
export default async function ManagementPage() {
  const headerList = await headers();
  const cookieStore = await cookies();

  let session: any = null;
  try {
    session = await getServerSessionFromContext(headerList, cookieStore);
  } catch {
    redirect("/login");
  }

  const [overview, workforceActivity, allUsers] = await Promise.all([
    getWorkspaceOverview(session),
    getWorkforceActivityBrief(session, { windowHours: 24 }),
    prisma.user.findMany({
      where: { organizationId: session.organizationId, isActive: true },
      select: { id: true, name: true, email: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return (
    <WorkbenchClient
      overview={JSON.parse(JSON.stringify(overview))}
      workforceActivity={JSON.parse(JSON.stringify(workforceActivity))}
      allUsers={JSON.parse(JSON.stringify(allUsers))}
      currentSession={toSessionView(session)}
      runtime={getRuntimeStatus()}
      mockAuth={isMockAuthEnabled()}
    />
  );
}
