/**
 * Daily Briefing Capability - P4 日常助理
 * 生成每日简报：待办+待决策+缺口+风险+Kern建议，4类专用，角色自适应
 */

export interface DailyBriefingInput {
  organizationId: string;
  userId: string;
  projectId?: string;
  category?: string;
  role?: string;
}

export interface DailyBriefingOutput {
  todos: number;
  decisions: number;
  gaps: number;
  risks: number;
  evidenceRate: number;
  workRate: number;
  verifiedCount: number;
  totalEvidence: number;
  doneWork: number;
  totalWork: number;
  category: string;
  projectTitle?: string;
  suggestions: string[];
  generatedAt: string;
}

const CATEGORY_SUGGESTIONS: Record<string, string[]> = {
  regular_food: ["补充SC资质证据", "优化包材成本到1.0元", "准备性价比卖点PPT", "核实日常刚需市场数据"],
  health_food: ["补充80℃烘焙温度证据", "优化成本到8元以内", "准备蓝帽子认证材料", "生成多酚功效销售话术"],
  cross_border_food: ["补充进口资质", "优化国际物流成本", "准备跨境背书材料", "核实保税仓发货流程"],
  cosmetics: ["补充化妆品备案", "优化玻璃瓶包材成本", "准备透明质酸卖点PPT", "核实烟酰胺美白证据"],
};

export async function generateDailyBriefing(input: DailyBriefingInput & { memories?: any[] }, prisma: any): Promise<DailyBriefingOutput> {
  const category = input.category || "health_food";
  
  // 查询项目数据
  let project = null;
  let evidences: any[] = [];
  let workItems: any[] = [];
  let decisions: any[] = [];
  let gaps: any[] = [];

  if (input.projectId) {
    project = await prisma.project.findFirst({
      where: { id: input.projectId, organizationId: input.organizationId },
      include: {
        evidences: true,
        workItems: true,
        decisionPackets: true,
      },
    });
    if (project) {
      evidences = project.evidences || [];
      workItems = project.workItems || [];
      decisions = (project.decisionPackets || []).filter((d: any) => d.status === "IN_REVIEW");
      // gaps from evidence insight
      gaps = evidences.filter((e: any) => e.verifyStatus !== "VERIFIED").slice(0, 4);
    }
  } else {
    // 查询组织下所有项目聚合
    const projects = await prisma.project.findMany({
      where: { organizationId: input.organizationId },
      include: { evidences: true, workItems: true, decisionPackets: true },
      take: 5,
    });
    evidences = projects.flatMap((p: any) => p.evidences || []);
    workItems = projects.flatMap((p: any) => p.workItems || []);
    decisions = projects.flatMap((p: any) => (p.decisionPackets || []).filter((d: any) => d.status === "IN_REVIEW"));
    project = projects[0];
  }

  const verifiedCount = evidences.filter((e: any) => e.verifyStatus === "VERIFIED").length;
  const totalEvidence = evidences.length;
  const evidenceRate = totalEvidence ? Math.round((verifiedCount / totalEvidence) * 100) : 0;

  const doneWork = workItems.filter((w: any) => w.status === "ACCEPTED").length;
  const totalWork = workItems.length;
  const workRate = totalWork ? Math.round((doneWork / totalWork) * 100) : 0;

  let suggestions = CATEGORY_SUGGESTIONS[category] || CATEGORY_SUGGESTIONS.health_food;

  // 上下文记忆个性化
  if (input.memories && input.memories.length > 0) {
    const prefs = input.memories.filter((m: any) => m.kind === "PREFERENCE" || m.content?.includes("偏好")).slice(0, 2);
    if (prefs.length > 0) {
      suggestions = [`基于记忆偏好 ${prefs[0].content.slice(0, 20)}，${suggestions[0]}`, ...suggestions.slice(1)];
    }
    // 纠正记忆影响风险
    const corrections = input.memories.filter((m: any) => m.kind === "CORRECTION").slice(0, 1);
    if (corrections.length > 0) {
      suggestions.push(`注意纠正：${corrections[0].content.slice(0, 30)}`);
    }
  }

  // 风险预警逻辑
  let risks = 0;
  if (evidenceRate < 50) risks++;
  if (decisions.length > 3) risks++;
  if (gaps.length > 5) risks++;
  if (workRate < 30 && totalWork > 0) risks++;

  return {
    todos: workItems.filter((w: any) => w.status !== "ACCEPTED").length,
    decisions: decisions.length,
    gaps: gaps.length,
    risks,
    evidenceRate,
    workRate,
    verifiedCount,
    totalEvidence,
    doneWork,
    totalWork,
    category,
    projectTitle: project?.title || "多酚软糖项目",
    suggestions,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * @deprecated LEGACY — 无调用方，不参与任何模型调用。正式输出规范见 src/modules/artifacts/protocol.ts（kern-rich/v1）。
 */
export function buildDailyBriefingPrompt(output: DailyBriefingOutput, role: string = "product"): string {
  const roleDesc = role === "leadership" ? "领导视角极简，专注结论和决策" : role === "sales" ? "销售视角卖点突出工具化" : "研发视角专业严谨";
  return `
你是 Kern 日常助理，生成每日简报，${roleDesc}，4类专用。

数据:
- 项目: ${output.projectTitle} · 类别: ${output.category}
- 已核实证据: ${output.verifiedCount}/${output.totalEvidence} ${output.evidenceRate}%
- 工作进度: ${output.doneWork}/${output.totalWork} ${output.workRate}%
- 待决策: ${output.decisions}项
- 缺口: ${output.gaps}个
- 风险: ${output.risks}个
- 建议: ${output.suggestions.join("、")}

要求:
- 输出富可视化HTML Artifact，15组件+8动效，4类专用，角色自适应，通过harness R1-R17
- 领导: KPI 4列+一句话结论+极简工具3个
- 研发: 证据表8行+工作流6卡+charts bar+donut+建议
- 销售: selling-points 2列+sales-tools+话术
- 4类差异化卖点，${output.category}专用
- 包含快捷操作按钮，去补证据/去做决策/查看AI研发
- 动效 fadeInUp/growWidth/drawDonut
`;
}
