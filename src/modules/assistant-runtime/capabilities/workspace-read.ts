import type { SessionContext } from "@/modules/identity/session";
import { getWorkspaceOverview } from "@/modules/workspace/overview";
import { listProductBoard } from "@/modules/products/service";
import { fmtDateTime } from "@/shared/datetime";
import type {
  KernCapabilityContext,
  KernCapabilityHandler,
  KernCapabilityIntent,
  KernCapabilityResult,
} from "./contracts";

export const handleWorkspaceReadCapability: KernCapabilityHandler = async (
  session: SessionContext,
  intent: KernCapabilityIntent,
  ctx: KernCapabilityContext
): Promise<KernCapabilityResult | null> => {
  switch (intent) {
    case "PENDING_DECISIONS": {
      const ov = await getWorkspaceOverview(session);
      const items = ov.pendingDecisions.items;
      if (items.length === 0) {
        return {
          toolKey: "workspace.pendingDecisions",
          text: `当前没有需要你拍板的决策包（统计时间 ${fmtDateTime(ov.meta.generatedAt)}）。`,
          citations: [],
        };
      }
      return {
        toolKey: "workspace.pendingDecisions",
        text: `需要你拍板的决策包共 ${items.length} 项：\n${items
          .map((i, n) => `${n + 1}. ${i.title}${i.meta ? `（${i.meta}）` : ""}`)
          .join("\n")}`,
        citations: items.map((i) => ({ kind: "decision", ref: i.id, title: i.title })),
      };
    }
    case "PRODUCT_STATUS": {
      const board = await listProductBoard(session);
      if (board.length === 0) {
        return {
          toolKey: "products.board",
          text: "当前组织内还没有产品。可以到「产品开发」新建一个产品入库。",
          citations: [],
        };
      }
      const byStage = new Map<string, number>();
      for (const p of board) byStage.set(p.lifecycleStage, (byStage.get(p.lifecycleStage) ?? 0) + 1);
      return {
        toolKey: "products.board",
        text: `组织内共 ${board.length} 个产品。生命周期分布：${[...byStage.entries()]
          .map(([k, v]) => `${k} ${v}`)
          .join("、")}。`,
        citations: board.slice(0, 10).map((p) => ({ kind: "product", ref: p.id, title: p.name })),
      };
    }
    case "WORKSPACE_STATUS": {
      const ov = await getWorkspaceOverview(session);
      return {
        toolKey: "workspace.overview",
        text: [
          `统计时间：${fmtDateTime(ov.meta.generatedAt)}`,
          `范围：${ov.meta.scopeLabel}`,
          `待办 ${ov.todos.count} 项；待我决策 ${ov.pendingDecisions.count} 项；在推进产品 ${ov.productsInFlight.count} 个；风险阻塞 ${ov.blockers.count} 项。`,
          ov.blockers.count > 0
            ? `阻塞示例：${ov.blockers.items.slice(0, 3).map((b) => b.title).join("；")}`
            : "当前未发现阻塞项。",
        ].join("\n"),
        citations: ov.pendingDecisions.items.map((i) => ({ kind: "decision", ref: i.id, title: i.title })),
      };
    }

    default:
      return null;
  }
};
