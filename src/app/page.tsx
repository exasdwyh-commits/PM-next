import prisma from "@/shared/db";
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSessionFromContext } from "@/modules/identity/session";
import { getWorkspaceOverview } from "@/modules/workspace/overview";
import { getRuntimeStatus, isMockAuthEnabled } from "@/shared/runtime-status";
import { toSessionView } from "@/shared/session-view";
import WorkbenchClient from "./workbench-client";
import { getWorkforceActivityBrief } from "@/modules/workforce/activity-brief";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const headerList = await headers();
  const cookieStore = await cookies();

  let session: any = null;
  try {
    session = await getServerSessionFromContext(headerList, cookieStore);
  } catch {
    // B01-01: 未登录一律跳转正式登录页
    redirect("/login");
  }

  const [overview, workforceActivity, allUsers] = await Promise.all([
    getWorkspaceOverview(session),
    getWorkforceActivityBrief(session, { windowHours: 24 }),
    // 身份切换（仅开发态 mock 认证使用；生产环境 DEV_MOCK_AUTH 为 false 时该下拉无实际作用）
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
