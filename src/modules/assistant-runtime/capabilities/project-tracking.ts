/**
 * Project Tracking Capability - P5 项目追踪（本地补齐）
 * -----------------------------------------------------
 * Arena 工作区未交付本文件（api/assistant/project-tracking/route.ts 引用它）。
 * 结构按 MASTER_PLAN_4CAT.md「项目追踪」要求还原：
 *   进度、里程碑、工作项与依赖、风险/坏死项、按类别的追踪重点。
 *
 * 只做读取与聚合，不写库；所有数字来自 project.evidences / workItems / decisionPackets。
 */

import prisma from "@/shared/db";

export interface ProjectTrackingInput {
  organizationId: string;
  projectId: string;
  category?: string;
}

export interface TrackingMilestone {
  id: string;
  title: string;
  status: string;
  dueAt?: string | null;
}

export interface TrackingRisk {
  level: "high" | "medium" | "low";
  title: string;
  detail: string;
}

export interface TrackingWorkItem {
  id: string;
  title: string;
  status: string;
  dependencyCount: number;
  deliverable?: string | null;
}

export interface ProjectTrackingOutput {
  projectId: string;
  projectTitle: string;
  category: string;
  owner: { id: string; name: string } | null;
  progress: { evidenceRate: number; workRate: number; verifiedCount: number; totalEvidence: number; doneWork: number; totalWork: number };
  milestones: TrackingMilestone[];
  workItems: TrackingWorkItem[];
  pendingDecisions: number;
  risks: TrackingRisk[];
  categoryFocus: string[];
  generatedAt: string;
}

const CATEGORY_FOCUS: Record<string, string[]> = {
  regular_food: ["SC 资质与标签", "包材成本优化", "渠道铺货节奏"],
  health_food: ["蓝帽子材料完整性", "功效证据强度", "固定成本摊销与盈亏平衡"],
  cross_border_food: ["进口备案与境外注册", "国际物流与关税", "保税仓发货流程"],
  cosmetics: ["备案与功效检测", "包材成本占比", "渠道费率对净利的影响"],
};

export async function generateProjectTracking(
  input: ProjectTrackingInput
): Promise<ProjectTrackingOutput> {
  const category = input.category || "health_food";

  const project = await prisma.project.findFirst({
    where: { id: input.projectId, organizationId: input.organizationId },
    include: {
      evidences: true,
      workItems: true,
      decisionPackets: true,
      owner: { select: { id: true, name: true } },
      // 里程碑不在 Project 上：关系是 Project → LaunchPlan → LaunchMilestone。
      launchPlans: { include: { milestones: { orderBy: { seq: "asc" } } } },
    },
  });

  if (!project) throw new Error("Project not found");

  const evidences = (project as any).evidences || [];
  const workItems = (project as any).workItems || [];
  const decisions = (project as any).decisionPackets || [];

  // 里程碑取自该项目的上市计划；LaunchMilestone 的时间列叫 dueDate。
  const milestones: TrackingMilestone[] = ((project as any).launchPlans || [])
    .flatMap((plan: any) => plan.milestones || [])
    .map((m: any) => ({
      id: m.id,
      title: m.title,
      status: m.status,
      dueAt: m.dueDate ? new Date(m.dueDate).toISOString() : null,
    }));

  const verifiedCount = evidences.filter((e: any) => e.verifyStatus === "VERIFIED").length;
  const doneWork = workItems.filter((w: any) => w.status === "ACCEPTED").length;
  const pendingDecisions = decisions.filter((d: any) => d.status === "IN_REVIEW").length;

  const evidenceRate = evidences.length ? Math.round((verifiedCount / evidences.length) * 100) : 0;
  const workRate = workItems.length ? Math.round((doneWork / workItems.length) * 100) : 0;

  const risks: TrackingRisk[] = [];
  const unverified = evidences.length - verifiedCount;
  if (unverified > 0) {
    risks.push({
      level: unverified > 3 ? "high" : "medium",
      title: `${unverified} 条证据未核实`,
      detail: "未核实证据不得用于对外结论，会阻断决策门",
    });
  }
  if (pendingDecisions > 0) {
    risks.push({ level: "medium", title: `${pendingDecisions} 个决策待拍板`, detail: "决策未闭环会拖住后续工作项" });
  }
  const blocked = workItems.filter((w: any) => (w.dependencies?.length || 0) > 0 && w.status !== "ACCEPTED");
  if (blocked.length > 0) {
    risks.push({ level: "low", title: `${blocked.length} 个工作项有前置依赖`, detail: "注意依赖顺序，避免并行返工" });
  }

  return {
    projectId: project.id,
    projectTitle: project.title,
    category,
    owner: (project as any).owner ? { id: (project as any).owner.id, name: (project as any).owner.name } : null,
    progress: {
      evidenceRate,
      workRate,
      verifiedCount,
      totalEvidence: evidences.length,
      doneWork,
      totalWork: workItems.length,
    },
    milestones,
    workItems: workItems.slice(0, 20).map((w: any) => ({
      id: w.id,
      title: w.title,
      status: w.status,
      dependencyCount: w.dependencies?.length || 0,
      deliverable: w.deliverableReq || null,
    })),
    pendingDecisions,
    risks,
    categoryFocus: CATEGORY_FOCUS[category] || [],
    generatedAt: new Date().toISOString(),
  };
}
