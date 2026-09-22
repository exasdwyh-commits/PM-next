import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSessionFromContext } from "@/modules/identity/session";
import { getProductOverview } from "@/modules/products/service";
import { getRuntimeStatus } from "@/shared/runtime-status";
import { toSessionView } from "@/shared/session-view";
import ProductOverviewClient from "./product-overview-client";
import { listAutomationTraces } from "@/modules/automation-trace";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const headerList = await headers();
  const cookieStore = await cookies();

  let session: any = null;
  try {
    session = await getServerSessionFromContext(headerList, cookieStore);
  } catch {
    redirect("/login");
  }

  const { id } = await params;

  let overview: any = null;
  try {
    overview = await getProductOverview(session, id);
  } catch {
    redirect("/products");
  }

  const versionIds = (overview.product?.versions ?? []).map((version: any) => version.id);
  const evidenceIds = (overview.product?.projects ?? []).flatMap((project: any) =>
    (project.evidences ?? []).map((evidence: any) => evidence.id)
  );
  const [versionTraces, evidenceTraces] = await Promise.all([
    listAutomationTraces(session, {
      aggregateType: "ProductVersion",
      aggregateIds: versionIds,
      limit: 30,
    }),
    listAutomationTraces(session, {
      aggregateType: "Evidence",
      aggregateIds: evidenceIds,
      limit: 30,
    }),
  ]);
  const automationTraces = [...versionTraces, ...evidenceTraces]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 30);

  return (
    <ProductOverviewClient
      overview={JSON.parse(JSON.stringify(overview))}
      automationTraces={JSON.parse(JSON.stringify(automationTraces))}
      currentSession={toSessionView(session)}
      runtime={getRuntimeStatus()}
    />
  );
}
