import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSessionFromContext } from "@/modules/identity/session";
import { getRuntimeStatus, isMockAuthEnabled } from "@/shared/runtime-status";
import { toSessionView } from "@/shared/session-view";
import ProductRndClient from "./product-rnd-client";

export const dynamic = "force-dynamic";

export default async function ProductRndPage() {
  const headerList = await headers();
  const cookieStore = await cookies();

  let session: any = null;
  try {
    session = await getServerSessionFromContext(headerList, cookieStore);
  } catch {
    redirect("/login");
  }

  return (
    <ProductRndClient
      currentSession={toSessionView(session)}
      runtime={getRuntimeStatus()}
      mockAuth={isMockAuthEnabled()}
    />
  );
}
