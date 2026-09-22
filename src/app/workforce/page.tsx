import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSessionFromContext } from "@/modules/identity/session";
import { isOrgAdmin } from "@/modules/identity/admin";
import { getWorkforceOverview } from "@/modules/workforce/service";
import { getRuntimeStatus } from "@/shared/runtime-status";
import { toSessionView } from "@/shared/session-view";
import WorkforceClient from "./workforce-client";

export const dynamic = "force-dynamic";

export default async function WorkforcePage() {
  const headerList = await headers();
  const cookieStore = await cookies();

  let session;
  try {
    session = await getServerSessionFromContext(headerList, cookieStore);
  } catch {
    redirect("/login");
  }

  const [overview, canBootstrap] = await Promise.all([
    getWorkforceOverview(session),
    isOrgAdmin(session),
  ]);

  return (
    <WorkforceClient
      overview={JSON.parse(JSON.stringify(overview))}
      session={toSessionView(session)}
      runtime={getRuntimeStatus()}
      canBootstrap={canBootstrap}
    />
  );
}
