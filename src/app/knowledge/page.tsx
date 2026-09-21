import prisma from "@/shared/db";
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSessionFromContext } from "@/modules/identity/session";
import { isOrgAdmin } from "@/modules/identity/admin";
import { projectCompanyFacts } from "@/modules/knowledge/fact-visibility";
import { getKnowledgeOverview } from "@/modules/knowledge/service";
import { getContentModeConfig, KNOWLEDGE_SAMPLE_MODE_BANNER } from "@/shared/content-mode";
import AppShell from "@/components/app-shell";
import KnowledgeClient from "./knowledge-client";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const headerList = await headers();
  const cookieStore = await cookies();
  let session: any = null;
  try {
    session = await getServerSessionFromContext(headerList, cookieStore);
  } catch (e) {
    redirect("/login");
  }

  // 1. 公司知识库概况（知识源、文档切片、公司事实）
  const overview = await getKnowledgeOverview(session);

  // 权限：知识库管理员（用于收口配置类入口与事实技术字段）
  const isAdmin = await isOrgAdmin(session);

  // 非管理员不下发「知识源明细」，也不下发事实的内部字段。
  // 只隐藏按钮不算收口：这些字段仍在传给客户端 props 的对象里，
  // 会随 RSC 负载一起到达浏览器，可直接从 HTML 里读出来。
  //   - sources 里带 rootPath（服务器绝对路径）与最近一次 syncRuns（同步日志）
  //   - facts 里带 key（机器标识）、category 与 sourcePath（来源文件路径）
  // 计数类信息（documentCount / chunkCount / sourceCount / facts 统计）保留 ——
  // 它们只说明规模，不含路径、日志与技术标识。
  //
  // 口径收敛到 `projectCompanyFacts()`（白名单拷贝），与 `GET /api/knowledge/facts` 共用，
  // 避免「同一事实在两个地方有两种说法」。旧写法是黑名单（只 delete key / category），
  // 因此 `sourcePath` 从未被剔除过 —— 黑名单会随 schema 增长持续失守。
  const overviewForClient = {
    ...overview,
    sources: isAdmin ? overview.sources : [],
    facts: projectCompanyFacts(overview.facts, isAdmin),
  };

  // 2. 知识库 = 已验收(ACCEPTED)工作项成果归档
  const workItems = await prisma.workItem.findMany({
    where: { project: { organizationId: session.organizationId }, status: "ACCEPTED" },
    include: {
      project: { select: { id: true, title: true } },
      artifacts: true,
      applicabilities: { include: { confirmedBy: { select: { name: true } } }, where: { status: "CONFIRMED" } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <AppShell
      active="knowledge"
      user={{ name: session?.userName, meta: session?.userEmail }}
      runtime={{ tone: "neutral", label: "知识库正常", detail: `${overview.stats.documentCount} 篇文档已索引` }}
    >
      <KnowledgeClient
        overview={overviewForClient}
        workItems={workItems}
        isAdmin={isAdmin}
        contentMode={getContentModeConfig()}
        sampleModeBanner={KNOWLEDGE_SAMPLE_MODE_BANNER}
      />
    </AppShell>
  );
}
