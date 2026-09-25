import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import "./muse.css";
import MuseClient from "./muse-client";
import { getServerSessionFromContext } from "@/modules/identity/session";
import { buildMuseViewModel } from "@/modules/muse/read-model";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Muse · 你的部门助理",
  description: "对话即操作系统：说目标，Muse 自己推进，需要你点头时才回来找你。",
};

export default async function MusePage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; product?: string; query?: string }>;
}) {
  const headerList = await headers();
  const cookieStore = await cookies();

  let session;
  try {
    session = await getServerSessionFromContext(headerList, cookieStore);
  } catch {
    redirect("/login");
  }

  const sp = await searchParams;
  const model = await buildMuseViewModel(session, {
    conversationId: sp?.c ?? null,
    productId: sp?.product ?? null,
    initialDraft: sp?.query ?? null,
  });

  return <MuseClient model={JSON.parse(JSON.stringify(model))} />;
}
