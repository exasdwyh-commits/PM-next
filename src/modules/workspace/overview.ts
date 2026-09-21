/**
 * 工作总览聚合（蓝图 §3「工作总览」入口）
 *
 * 硬性要求：
 * 1. 全部为真实聚合，禁止示例数据。没有数据就返回空数组，由 UI 显示空状态。
 * 2. **数量与列表必须一致**：count 一律等于对应 list.length，不做截断计数。
 * 3. 必须携带「统计时间、筛选范围、权限范围」。
 * 4. 负责人未填、日期未定时返回 null，由 UI 显示「未设置」。
 */

import prisma from "@/shared/db";
import { SessionContext } from "../identity/session";
import { labelProductLifecycleStage } from "@/shared/status-labels";

/** 附加简报字段（2026-09-15 分层信息设计）。全部为真实聚合，无数据返回 null/空数组。 */
export interface WorkspaceBriefingExtras {
  /** 全组织最近的业务变化（跨 Product/Project 审计），供「现在的情况」引用 */
  recentChanges: { summary: string; timestamp: string }[];
  /** 阻塞项中最早的截止日（ISO）；全部未设截止日时为 null —— 不推断为「无风险」 */
  earliestBlockerDueAt: string | null;
  /** 聚合是否部分失败；为 true 时 UI 禁止产出「整体正常」式结论 */
  degraded: boolean;
  degradedNote: string | null;
}

export interface OverviewItem {
  id: string;
  title: string;
  meta?: string | null;
  href?: string | null;
  status?: string | null;
  ownerName?: string | null;
  dueAt?: string | null;
  /**
   * 价值分级，直取 `SignalItem.valueTier`（high / normal / low，null = 未评估）。
   * 首页「市场机会」按它显示高/中/低匹配；null 一律显示「未评估」，**不推断**。
   */
  tier?: string | null;
  /** 一句话摘要，直取 `SignalItem.summary`；缺失时为 null，UI 不补写。 */
  summary?: string | null;
  /** 该条目最近一次真实变更时间（ISO）。用于「最近完成」；无此语义时留空。 */
  at?: string | null;
}

export interface WorkspaceOverview {
  meta: {
    generatedAt: string;
    scopeLabel: string;
    permissionLabel: string;
  };
  todos: { count: number; items: OverviewItem[] };
  pendingDecisions: { count: number; items: OverviewItem[] };
  productsInFlight: {
    count: number;
    byStage: { stage: string; label: string; count: number }[];
    items: OverviewItem[];
  };
  blockers: { count: number; items: OverviewItem[] };
  opportunities: { count: number; items: OverviewItem[] };
  /** 最近完成：状态为 ACCEPTED 的工作项，按 updatedAt 倒序。首页「最近完成」用。 */
  recentlyCompleted: { count: number; items: OverviewItem[] };
  portfolio: { projectCount: number; productCount: number };
}

const IN_FLIGHT_STAGES = ["IDEA", "ANALYSIS", "SAMPLING", "LAUNCH_PREP"];

export async function getWorkspaceOverview(
  session: SessionContext,
  options?: { withBriefing?: boolean }
): Promise<WorkspaceOverview & WorkspaceBriefingExtras> {
  const generatedAt = new Date().toISOString();
  const orgId = session.organizationId;
  const withBriefing = options?.withBriefing !== false; // 默认开启：首页简报需要

  // 简报附加聚合的失败只降级不阻断：degraded=true 时 UI 不写「整体正常」
  let briefing: WorkspaceBriefingExtras = {
    recentChanges: [],
    earliestBlockerDueAt: null,
    degraded: false,
    degradedNote: null,
  };
  let degraded = false;
  let degradedNote: string | null = null;

  // 权限范围：当前用户可见的项目 = 其所属组织中、且我是成员的项目
  const projects = await prisma.project.findMany({
    where: { organizationId: orgId, members: { some: { userId: session.userId } } },
    include: {
      owner: { select: { id: true, name: true } },
      decisionMaker: { select: { id: true, name: true } },
      workItems: {
        select: {
          id: true,
          title: true,
          status: true,
          executorType: true,
          updatedAt: true,
        },
      },
      decisionPackets: {
        select: { id: true, status: true, gate: true, submittedAt: true, createdAt: true },
      },
      evidences: { select: { id: true, verifyStatus: true, nature: true } },
      launchPlans: {
        select: {
          id: true,
          productId: true,
          status: true,
          targetDate: true,
          ownerId: true,
          milestones: { select: { id: true, title: true, status: true, dueDate: true } },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const projectIds = projects.map((p) => p.id);

  // ---- 待办：我可见项目里未完成的工作项 ----
  const todoItems: OverviewItem[] = [];
  for (const p of projects) {
    for (const w of p.workItems) {
      if (w.status === "ACCEPTED") continue;
      todoItems.push({
        id: w.id,
        title: w.title,
        meta: `${p.title} · ${w.status}`,
        href: `/projects/${p.id}`,
        status: w.status,
        ownerName: p.owner?.name ?? null,
      });
    }
  }
  todoItems.sort((a, b) => (a.status === "SUBMITTED" ? -1 : 1) - (b.status === "SUBMITTED" ? -1 : 1));

  // ---- 最近完成：已验收（ACCEPTED）的工作项，按最近更新时间倒序 ----
  // count 是**组织内 ACCEPTED 工作项总数**，items 只是展示窗口（最多 8 条），
  // 与首页文案保持一致口径：数量不受展示窗口影响（同 opportunities 的既有约定）。
  const completedAll: { item: OverviewItem; updatedAt: Date }[] = [];
  for (const p of projects) {
    for (const w of p.workItems) {
      if (w.status !== "ACCEPTED") continue;
      completedAll.push({
        item: {
          id: w.id,
          title: w.title,
          meta: p.title,
          href: `/projects/${p.id}`,
          status: w.status,
          at: w.updatedAt.toISOString(),
        },
        updatedAt: w.updatedAt,
      });
    }
  }
  completedAll.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const recentlyCompleted = {
    count: completedAll.length,
    items: completedAll.slice(0, 8).map((c) => c.item),
  };

  // ---- 待我决策：我是独立决策人、且决策包在评审中的项目 ----
  const pendingDecisionItems: OverviewItem[] = [];
  for (const p of projects) {
    if (p.decisionMakerId !== session.userId) continue;
    for (const dp of p.decisionPackets) {
      if (dp.status !== "IN_REVIEW" && dp.status !== "DRAFT") continue;
      pendingDecisionItems.push({
        id: dp.id,
        title: `${p.title} · ${dp.gate === "PRODUCTION_GATE" ? "生产门" : "研究→打样门"}`,
        meta: p.owner?.name ? `提交人 ${p.owner.name}` : null,
        href: `/projects/${p.id}`,
        status: dp.status,
      });
    }
  }

  // ---- 产品推进 ----
  const products = await prisma.product.findMany({
    where: { organizationId: orgId },
    select: {
      id: true,
      name: true,
      lifecycleStage: true,
      owner: { select: { name: true } },
      targetLaunchDate: true,
      projects: { select: { id: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const inFlight = products.filter((p) => IN_FLIGHT_STAGES.includes(p.lifecycleStage));
  const byStage = IN_FLIGHT_STAGES.map((stage) => ({
    stage,
    label: labelProductLifecycleStage(stage),
    count: inFlight.filter((p) => p.lifecycleStage === stage).length,
  }));

  const productItems: OverviewItem[] = inFlight.map((p) => ({
    id: p.id,
    title: p.name,
    meta: `${labelProductLifecycleStage(p.lifecycleStage)}${p.projects.length ? ` · ${p.projects.length} 个项目` : ""}`,
    href: `/products/${p.id}`,
    status: p.lifecycleStage,
    ownerName: p.owner?.name ?? null,
    dueAt: p.targetLaunchDate ? p.targetLaunchDate.toISOString() : null,
  }));

  // ---- 风险阻塞：真实缺口，不臆造 ----
  const blockerItems: OverviewItem[] = [];
  for (const p of projects) {
    const verifiedReal = p.evidences.filter((e) => e.verifyStatus === "VERIFIED" && e.nature === "REAL");
    if (!p.isDemo && verifiedReal.length === 0) {
      blockerItems.push({
        id: `${p.id}-evidence`,
        title: `${p.title}：缺少已核实的真实市场依据`,
        meta: "证据缺口",
        href: `/projects/${p.id}`,
        status: "OPEN",
      });
    }
    if (!p.decisionMakerId) {
      blockerItems.push({
        id: `${p.id}-dm`,
        title: `${p.title}：未指定独立项目决策人`,
        meta: "治理缺口",
        href: `/projects/${p.id}`,
        status: "OPEN",
      });
    }
    const pendingPacket = p.decisionPackets.find((dp) => dp.status === "CHANGES_REQUESTED");
    if (pendingPacket) {
      blockerItems.push({
        id: `${p.id}-packet`,
        title: `${p.title}：决策包被要求修改，尚未重新提交`,
        meta: "审批阻塞",
        href: `/projects/${p.id}`,
        status: "CHANGES_REQUESTED",
      });
    }
    for (const plan of p.launchPlans) {
      for (const m of plan.milestones) {
        if (m.status === "BLOCKED") {
          blockerItems.push({
            id: m.id,
            title: `${p.title}：上市里程碑「${m.title}」阻塞`,
            meta: "上市阻塞",
            href: `/products/${plan.productId}`,
            status: "BLOCKED",
            dueAt: m.dueDate ? m.dueDate.toISOString() : null,
          });
        }
      }
    }
  }

  // ---- 近期机会：有来源的组织内信号（按价值分级取高优先级） ----
  const signals = await prisma.signalItem.findMany({
    where: { organizationId: orgId, valueTier: "high" },
    orderBy: { collectedAt: "desc" },
    take: 50,
    select: {
      id: true,
      title: true,
      sourceName: true,
      url: true,
      valueReason: true,
      summary: true,
      valueTier: true,
      collectedAt: true,
    },
  });

  const opportunityItems: OverviewItem[] = signals.map((s) => ({
    id: s.id,
    title: s.title,
    meta: s.sourceName,
    href: "/opportunities",
    status: "SIGNAL",
    dueAt: null,
    // 直取真实字段：valueTier 为 null（未评估）时 UI 显示「未评估」，不推断成「中匹配」。
    tier: s.valueTier ?? null,
    // 摘要优先取 summary；没有 summary 时才退回 valueReason（价值判定理由），两者都没有则 null。
    summary: s.summary ?? s.valueReason ?? null,
  }));

  // count 与 items 解耦：items 是「最新 50 条」展示窗口，count 是数据库真实总数 ——
  // 首页文案「已收录 N 条」不能受展示窗口影响（数据完整性审查 2026-09-19）。
  const highValueSignalCount = await prisma.signalItem.count({
    where: { organizationId: orgId, valueTier: "high" },
  });

  // ---- 简报附加聚合（仅首页需要；失败降级，不伪造数据） ----
  if (withBriefing) {
    try {
      const auditRows = await prisma.auditEvent.findMany({
        where: {
          OR: [
            { objectType: "Product", objectId: { in: products.map((p) => p.id) } },
            { objectType: "Project", objectId: { in: projectIds } },
          ],
        },
        orderBy: { timestamp: "desc" },
        take: 5,
        select: { summary: true, timestamp: true },
      });
      briefing.recentChanges = auditRows.map((a) => ({ summary: a.summary, timestamp: a.timestamp.toISOString() }));
    } catch {
      degraded = true;
      degradedNote = "最近变化读取失败";
    }
    briefing.earliestBlockerDueAt =
      blockerItems
        .map((b) => b.dueAt)
        .filter((d): d is string => !!d)
        .sort()[0] ?? null;
    briefing.degraded = degraded;
    briefing.degradedNote = degradedNote;
  }

  return {
    meta: {
      generatedAt,
      scopeLabel:
        projectIds.length > 0
          ? `我参与的项目 ${projectIds.length} 个 · 组织内产品 ${products.length} 个`
          : `我参与的项目 0 个 · 组织内产品 ${products.length} 个`,
      permissionLabel: `组织范围：${session.organizationId} · 仅统计我是成员的项目`,
    },
    todos: { count: todoItems.length, items: todoItems },
    pendingDecisions: { count: pendingDecisionItems.length, items: pendingDecisionItems },
    productsInFlight: { count: productItems.length, byStage, items: productItems },
    blockers: { count: blockerItems.length, items: blockerItems },
    opportunities: { count: highValueSignalCount, items: opportunityItems },
    recentlyCompleted,
    portfolio: { projectCount: projects.length, productCount: products.length },
    ...(withBriefing ? briefing : {}),
  } as WorkspaceOverview & WorkspaceBriefingExtras;
}
