import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSessionFromContext } from "@/modules/identity/session";
import { getProductOverview } from "@/modules/products/service";
import { getRuntimeStatus } from "@/shared/runtime-status";
import { toSessionView } from "@/shared/session-view";
import ProductOverviewClient from "./product-overview-client";

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

  return (
    <ProductOverviewClient
      overview={JSON.parse(JSON.stringify(overview))}
      currentSession={toSessionView(session)}
      runtime={getRuntimeStatus()}
    />
  );
}
