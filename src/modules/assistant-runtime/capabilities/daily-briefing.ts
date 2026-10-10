/**
 * Daily Briefing Capability - P4 日常助理
 * 只汇总真实项目记录；没有项目时保持空，不用示例项目或行业模板冒充业务事实。
 */
import { defaultCategoryKey } from "@/modules/tenant";

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
  projectId?: string;
  projectTitle?: string;
  /** 本次实际读取的项目数，不代表组织项目总数。 */
  projectCount: number;
  scopeLabel: string;
  suggestions: string[];
  generatedAt: string;
}

interface BriefingMemory {
  kind?: string;
  content?: string;
}

export async function generateDailyBriefing(
  input: DailyBriefingInput & { memories?: BriefingMemory[] },
  prisma: any,
): Promise<DailyBriefingOutput> {
  const category = input.category || defaultCategoryKey();
  let projects: any[] = [];

  if (input.projectId) {
    const project = await prisma.project.findFirst({
      where: { id: input.projectId, organizationId: input.organizationId },
      include: { evidences: true, workItems: true, decisionPackets: true },
    });
    if (project) projects = [project];
  } else {
    projects = await prisma.project.findMany({
      where: { organizationId: input.organizationId },
      include: { evidences: true, workItems: true, decisionPackets: true },
      orderBy: { updatedAt: "desc" },
      take: 5,
    });
  }

  const evidences = projects.flatMap((p) => p.evidences || []);
  const workItems = projects.flatMap((p) => p.workItems || []);
  const decisions = projects.flatMap((p) =>
    (p.decisionPackets || []).filter((d: any) => d.status === "IN_REVIEW"),
  );
  // 聚合和单项目采用同一口径，不把缺口截成四条后再当作总数。
  const gaps = evidences.filter((e) => e.verifyStatus !== "VERIFIED");
  const verifiedCount = evidences.filter((e) => e.verifyStatus === "VERIFIED").length;
  const totalEvidence = evidences.length;
  const evidenceRate = totalEvidence ? Math.round((verifiedCount / totalEvidence) * 100) : 0;
  const doneWork = workItems.filter((w) => w.status === "ACCEPTED").length;
  const totalWork = workItems.length;
  const todos = totalWork - doneWork;
  const workRate = totalWork ? Math.round((doneWork / totalWork) * 100) : 0;

  // 建议来自已读取的记录，不预设产品、预算、材料或专业 Agent 已执行。
  const suggestions: string[] = [];
  if (projects.length > 0) {
    if (decisions.length > 0) suggestions.push(`审查 ${decisions.length} 项待决策事项`);
    if (gaps.length > 0) suggestions.push(`核实 ${gaps.length} 条尚未核实的证据`);
    if (todos > 0) suggestions.push(`梳理 ${todos} 项未完成工作和负责人`);
    if (totalEvidence === 0) suggestions.push("补充第一条可追溯的项目证据");
    if (totalWork === 0) suggestions.push("整理项目目标并建立第一项工作");

    const preference = input.memories?.find((m) =>
      !!m.content && (m.kind === "PREFERENCE" || m.content.includes("偏好")),
    );
    if (preference?.content && suggestions.length > 0) {
      suggestions[0] = `结合已记录的偏好「${preference.content.slice(0, 20)}」，${suggestions[0]}`;
    }
    const correction = input.memories?.find((m) => m.kind === "CORRECTION" && !!m.content);
    if (correction?.content) suggestions.push(`复核已记录的纠正：${correction.content.slice(0, 30)}`);
  }

  // 分母为零表示尚无记录，不等于低可信或项目失败。
  let risks = 0;
  if (totalEvidence > 0 && evidenceRate < 50) risks++;
  if (decisions.length > 3) risks++;
  if (gaps.length > 5) risks++;
  if (totalWork > 0 && workRate < 30) risks++;

  return {
    todos,
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
    projectId: projects.length === 1 ? projects[0].id : undefined,
    projectTitle: projects.length === 1
      ? projects[0].title
      : projects.length > 1 ? `${projects.length} 个项目概览` : undefined,
    projectCount: projects.length,
    scopeLabel: input.projectId ? "当前项目" : "最近 5 个项目（非组织全量）",
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
