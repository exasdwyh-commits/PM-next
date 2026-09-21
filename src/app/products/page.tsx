import prisma from "@/shared/db";
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSessionFromContext } from "@/modules/identity/session";
import { listProductBoard } from "@/modules/products/service";
import { getRuntimeStatus, isMockAuthEnabled } from "@/shared/runtime-status";
import { toSessionView } from "@/shared/session-view";
import ProductsClient from "./products-client";

export const dynamic = "force-dynamic";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{
    new?: string;
    stage?: string;
    name?: string;
    coreIdea?: string;
    targetChannels?: string;
  }>;
}) {
  const headerList = await headers();
  const cookieStore = await cookies();

  let session: any = null;
  try {
    session = await getServerSessionFromContext(headerList, cookieStore);
  } catch {
    redirect("/login");
  }

  const sp = await searchParams;
  const board = await listProductBoard(session);

  const allUsers = await prisma.user.findMany({
    where: { organizationId: session.organizationId, isActive: true },
    select: { id: true, name: true, email: true },
    orderBy: { createdAt: "asc" },
  });

  const initialForm = {
    name: sp?.name || "",
    coreIdea: sp?.coreIdea || "",
    targetChannels: sp?.targetChannels || "",
  };

  return (
    <ProductsClient
      products={JSON.parse(JSON.stringify(board))}
      allUsers={JSON.parse(JSON.stringify(allUsers))}
      currentSession={toSessionView(session)}
      runtime={getRuntimeStatus()}
      mockAuth={isMockAuthEnabled()}
      openIngest={sp?.new === "1"}
      initialForm={initialForm}
    />
  );
}
