import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import prisma from "@/shared/db";
import { getServerSessionFromContext } from "@/modules/identity/session";
import { listConversations, getConversation } from "@/modules/advisor/service";
import { listProposals, supersedeStaleProposals } from "@/modules/advisor/proposals";
import { getRuntimeStatus } from "@/shared/runtime-status";
import { toSessionView } from "@/shared/session-view";
import AdvisorClient from "./advisor-client";

export const dynamic = "force-dynamic";

export default async function AdvisorPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; c?: string; query?: string }>;
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
  const targetProductId = sp?.product || null;
  const initialQuery = sp?.query || "";

  // 1. 如果指定了产品，必须拉取该产品的上下文信息，以保证名称与版本准确
  let boundProduct: any = null;
  if (targetProductId) {
    boundProduct = await prisma.product.findUnique({
      where: { id: targetProductId },
      select: {
        id: true,
        name: true,
        identityCode: true,
        lifecycleStage: true,
        versions: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, versionTag: true } },
      },
    });
  }

  // 2. 会话列表：若指定产品，优先列出属于该产品的会话，否则列出全局会话
  const conversations = await listConversations(
    session,
    targetProductId ? { productId: targetProductId } : undefined
  );

  // 3. 激活会话选择：
  // 如果 URL 显式指定了 c，则尝试读取并严格校验产品归属；
  // 如果 URL 未指定 c，但指定了产品，且该产品已有会话，则激活属于该产品的第一个会话；
  // 如果该产品暂无会话，则 activeId 保持为 null（新对话模式），绝不把其它产品的会话套上当前产品的标签！
  let activeId = sp?.c || null;
  if (!activeId && targetProductId && conversations.length > 0) {
    activeId = conversations[0].id;
  } else if (!activeId && !targetProductId && conversations.length > 0) {
    activeId = conversations[0].id;
  }

  let active: any = null;
  if (activeId) {
    try {
      active = await getConversation(session, activeId);
      // 校验产品一致性：如果当前页面绑定了产品A，但该会话属于产品B或全局，则重置为新对话模式，避免串上下文
      if (targetProductId && active.productId !== targetProductId) {
        active = null;
        activeId = null;
      }
    } catch {
      active = null;
    }
  }

  // 待确认提议：只展示本会话的。产品绑定时先作废"依据版本已失效"的旧提议
  let proposals: any[] = [];
  if (activeId) {
    if (targetProductId) {
      try {
        await supersedeStaleProposals(session, targetProductId);
      } catch {
        // 产品不存在或不属于本组织时不阻断顾问页渲染
      }
    }
    proposals = await listProposals(session, { conversationId: activeId, take: 20 });
  }

  return (
    <AdvisorClient
      conversations={JSON.parse(JSON.stringify(conversations))}
      activeConversation={JSON.parse(JSON.stringify(active))}
      proposals={JSON.parse(JSON.stringify(proposals))}
      currentSession={toSessionView(session)}
      runtime={getRuntimeStatus()}
      productId={targetProductId}
      boundProduct={JSON.parse(JSON.stringify(boundProduct))}
      initialQuery={initialQuery}
    />
  );
}
