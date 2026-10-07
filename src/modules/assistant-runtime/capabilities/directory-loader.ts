/**
 * 统一能力目录的真实数据装配（KX-71）。读各模块，再交给纯函数 buildCapabilityDirectory。
 * 单独一个文件，是为了让 directory.ts 保持可以离线单测。
 */
import type { SessionContext } from "@/modules/identity/session";
import type { CapabilityDirectory } from "@/modules/kern-contracts";
import { listConnectors } from "@/modules/connectors";
import { readDesktopPresence } from "@/modules/desktop-runtime/presence";
import { getKnowledgeOverview } from "@/modules/knowledge/service";
import { listPlaybooks } from "@/modules/playbooks/service";
import { BUILTIN_TOOLS, makeAskUserTool, toolsFor } from "@/modules/supervisor/tools";
import { getWebSearch } from "@/modules/supervisor/web-search";
import { buildCapabilityDirectory } from "./directory";

export async function loadCapabilityDirectory(session: SessionContext): Promise<CapabilityDirectory> {
  const webSearchConfigured = getWebSearch() !== null;
  const [connectors, playbooks, knowledge] = await Promise.all([
    listConnectors(session),
    listPlaybooks(session),
    getKnowledgeOverview(session),
  ]);
  // 工具表：内置 + 网页（无论是否配置都登记，配置与否体现在 available）+ ask_user。
  const tools = [
    ...toolsFor({
      organizationId: session.organizationId,
      webSearch: async () => [],
      webFetch: async () => ({ url: "", title: null, text: "", truncated: false }),
    }),
    ...BUILTIN_TOOLS,
    makeAskUserTool(),
  ].map((t) => ({ name: t.name, label: t.label, description: t.description, inputHint: t.inputHint, risk: t.risk }));
  const presence = readDesktopPresence({ organizationId: session.organizationId, userId: session.userId });
  return buildCapabilityDirectory({
    tools,
    webSearchConfigured,
    desktopOnline: presence.status === "ONLINE",
    connectors: connectors.map((c) => ({ id: c.id, name: c.name, host: c.host, lastError: c.lastError, tools: c.tools })),
    playbooks,
    knowledge: {
      sources: knowledge.sources.map((s) => ({
        id: s.id,
        name: s.name,
        kind: String(s.kind),
        enabled: s.enabled,
        documentCount: s._count.documents,
      })),
      confirmedFactsCount: knowledge.stats.confirmedFactsCount,
    },
  });
}
