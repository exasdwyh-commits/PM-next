/**
 * Project Tracking Capability - P5 产品研发+项目管理
 */

export interface ProjectTrackingInput {
  organizationId: string;
  projectId: string;
  category?: string;
}

export interface ProjectTrackingOutput {
  projectTitle: string;
  category: string;
  progress: number;
  doneWork: number;
  totalWork: number;
  decisions: number;
  gaps: number;
  risks: number;
  nextStep: string;
  owner: string;
  estimatedLaunch: string;
  timeline: { key: string; label: string; status: "done" | "running" | "queued"; date?: string; desc?: string }[];
  criticalPath: string;
}

export async function generateProjectTracking(input: ProjectTrackingInput, prisma: any): Promise<ProjectTrackingOutput> {
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, organizationId: input.organizationId },
    include: { workItems: true, decisionPackets: true, evidences: true, owner: true },
  });

  if (!project) {
    return {
      projectTitle: "多酚软糖项目",
      category: input.category || "health_food",
      progress: 62,
      doneWork: 5,
      totalWork: 8,
      decisions: 2,
      gaps: 4,
      risks: 1,
      nextStep: "成本优化到8元以内",
      owner: "张三",
      estimatedLaunch: "2024-11-15",
      timeline: [
        { key: "formula", label: "配方确定", status: "done", date: "2024-10-01", desc: "多酚+低聚果糖+软糖基质" },
        { key: "cost", label: "成本优化", status: "running", desc: "目标8元 · Kern调度中" },
        { key: "compliance", label: "合规检查", status: "queued", desc: "蓝帽子认证 · 依赖成本优化" },
        { key: "supplier", label: "供应商打样", status: "queued", desc: "3家供应商 · 依赖合规" },
        { key: "launch", label: "测试+上市", status: "queued", date: "2024-11-15", desc: "预计上市" },
      ],
      criticalPath: "配方确定 → 成本优化 → 合规检查 → 供应商打样 → 测试+上市 · 总计45天 · 当前进度62%",
    };
  }

  const workItems = project.workItems || [];
  const doneWork = workItems.filter((w: any) => w.status === "ACCEPTED").length;
  const totalWork = workItems.length;
  const progress = totalWork ? Math.round((doneWork / totalWork) * 100) : 0;
  const decisions = (project.decisionPackets || []).filter((d: any) => d.status === "IN_REVIEW").length;
  const gaps = (project.evidences || []).filter((e: any) => e.verifyStatus !== "VERIFIED").length;

  return {
    projectTitle: project.title,
    category: input.category || "health_food",
    progress,
    doneWork,
    totalWork,
    decisions,
    gaps,
    risks: gaps > 5 ? 1 : 0,
    nextStep: gaps > 0 ? "补充证据缺口" : decisions > 0 ? "处理待决策" : "推进下一阶段",
    owner: project.owner?.name || "未指定",
    estimatedLaunch: "2024-11-15",
    timeline: [
      { key: "formula", label: "配方确定", status: doneWork > 0 ? "done" : "queued", date: "2024-10-01", desc: "多酚+低聚果糖+软糖基质" },
      { key: "cost", label: "成本优化", status: doneWork < totalWork ? "running" : "done", desc: "目标8元 · Kern调度中" },
      { key: "compliance", label: "合规检查", status: "queued", desc: "蓝帽子认证" },
      { key: "supplier", label: "供应商打样", status: "queued", desc: "3家供应商" },
      { key: "launch", label: "测试+上市", status: "queued", date: "2024-11-15", desc: "预计上市" },
    ],
    criticalPath: `配方确定 → 成本优化 → 合规检查 → 供应商打样 → 测试+上市 · 总计45天 · 当前进度${progress}%`,
  };
}
