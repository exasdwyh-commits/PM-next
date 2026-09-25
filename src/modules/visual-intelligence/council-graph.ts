import type {
  KernCollaborationPlanShadow,
  KernCouncilMode,
} from "@/modules/assistant-runtime/collaboration-planner";
import type { KernGraphNode, KernGraphV1 } from "./contracts";
import { assertValidKernGraph } from "./contracts";

const EXPERT_LABELS: Record<string, string> = {
  product_agent: "产品顾问",
  research_agent: "市场研究顾问",
  scientific_evidence_agent: "科学证据顾问",
  formulation_agent: "配方顾问",
  compliance_agent: "法规合规顾问",
  cost_bom_agent: "成本与 BOM 顾问",
  ops_agent: "供应链顾问",
  qa_verifier: "独立 QA",
  red_team: "Red Team",
  hermes_pm: "技术 / 项目顾问",
  tech_architect_agent: "技术架构顾问",
};

const VISUAL_REQUEST =
  /(画(?:一下|出来)?|可视化|关系图|结构图|依赖图|决策图|拆解(?:一下)?|图解)/;

function needsSynthesis(mode: KernCouncilMode, expertCount: number): boolean {
  return (
    expertCount > 1 ||
    mode === "COUNCIL" ||
    mode === "RED_TEAM" ||
    mode === "FULL_RND"
  );
}

export function shouldAttachKernCouncilGraph(
  text: string,
  plan: KernCollaborationPlanShadow
): boolean {
  if (VISUAL_REQUEST.test(text)) return true;
  return (
    plan.mode === "PAIR" ||
    plan.mode === "COUNCIL" ||
    plan.mode === "RED_TEAM" ||
    plan.mode === "FULL_RND"
  );
}

export function buildKernCouncilGraph(input: {
  graphId: string;
  goal: string;
  plan: KernCollaborationPlanShadow;
}): KernGraphV1 {
  const { plan } = input;
  const nodes: KernGraphNode[] = [
    {
      id: "goal",
      type: "USER_GOAL",
      label: "用户目标",
      detail: input.goal,
      layer: 0,
      truth: "VERIFIED",
      metadata: {
        source: "conversation",
      },
    },
    {
      id: "kern-router",
      type: "KERN_ROUTER",
      label: "Kern 路由器",
      detail: `${plan.mode} · ${plan.synthesisTier}`,
      layer: 1,
      truth: "INFERRED",
      metadata: {
        mode: plan.mode,
        synthesisTier: plan.synthesisTier,
        source: plan.source,
        researchRequired: plan.researchRequired,
      },
    },
  ];
  const edges: KernGraphV1["edges"] = [
    {
      id: "goal-to-router",
      from: "goal",
      to: "kern-router",
      relation: "REQUEST",
      label: "输入目标",
      truth: "VERIFIED",
    },
  ];

  for (const [index, expert] of plan.experts.entries()) {
    const id = `expert-${index + 1}`;
    nodes.push({
      id,
      type: expert === "red_team" ? "RED_TEAM" : "ADVISOR",
      label: EXPERT_LABELS[expert] || expert,
      detail: `Kern 建议参与本轮 ${plan.mode} 协作`,
      layer: 2,
      truth: "INFERRED",
      metadata: { agentCode: expert },
    });
    edges.push({
      id: `router-to-${id}`,
      from: "kern-router",
      to: id,
      relation: "RECOMMENDS",
      label: "建议委派",
      truth: "INFERRED",
    });
  }

  const stage3: string[] = [];
  if (plan.researchRequired) {
    nodes.push({
      id: "research-check",
      type: "RESEARCH",
      label: "证据 / 研究检查",
      detail: "需要外部或内部证据补强后再综合。",
      layer: 3,
      truth: "INFERRED",
    });
    stage3.push("research-check");
  }
  if (plan.qaRequired) {
    nodes.push({
      id: "qa-check",
      type: "QA",
      label: "独立 QA",
      detail: "检查证据覆盖、冲突、UNKNOWN 与输出边界。",
      layer: 3,
      truth: "INFERRED",
    });
    stage3.push("qa-check");
  }
  if (plan.redTeamRequired && !plan.experts.includes("red_team")) {
    nodes.push({
      id: "red-team-check",
      type: "RED_TEAM",
      label: "Red Team",
      detail: "独立攻击关键假设与失败路径。",
      layer: 3,
      truth: "INFERRED",
    });
    stage3.push("red-team-check");
  }

  const expertIds = nodes
    .filter((node) => node.layer === 2)
    .map((node) => node.id);

  for (const expertId of expertIds) {
    for (const stageId of stage3) {
      edges.push({
        id: `${expertId}-to-${stageId}`,
        from: expertId,
        to: stageId,
        relation: "FEEDS",
        label: "候选结论",
        truth: "INFERRED",
      });
    }
  }

  if (needsSynthesis(plan.mode, expertIds.length)) {
    nodes.push({
      id: "kern-synthesis",
      type: "SYNTHESIS",
      label: "Kern 综合",
      detail: `${plan.synthesisTier} synthesis · 合并分歧但不把共识当证据`,
      layer: stage3.length > 0 ? 4 : 3,
      truth: "INFERRED",
      metadata: {
        independentFirstPass: plan.independentFirstPass,
        synthesisTier: plan.synthesisTier,
      },
    });

    const sources = stage3.length > 0 ? stage3 : expertIds.length > 0 ? expertIds : ["kern-router"];
    for (const source of sources) {
      edges.push({
        id: `${source}-to-synthesis`,
        from: source,
        to: "kern-synthesis",
        relation: "SYNTHESIZES",
        label: "进入综合",
        truth: "INFERRED",
      });
    }
  }

  const graph: KernGraphV1 = {
    version: "kern-graph/v1",
    id: input.graphId,
    title: `Kern 顾问协作图 · ${plan.mode}`,
    summary:
      plan.mode === "SOLO"
        ? "本轮建议由 Kern 自己完成。"
        : `本轮建议采用 ${plan.mode}，由 ${plan.experts.length} 个专业角色参与，并以 ${plan.synthesisTier} 层级综合。`,
    view: "DECISION",
    subject: {
      kind: "conversation-turn",
      label: input.goal.slice(0, 80) || "当前请求",
    },
    generator: "DETERMINISTIC",
    nodes,
    edges,
    notices: [
      "Shadow：这是协作路由建议，不代表这些 Agent 已经实际执行。",
      "图中的 INFERRED 表示规划或推断；只有真实运行与证据回执才能升级为 VERIFIED。",
    ],
  };

  assertValidKernGraph(graph);
  return graph;
}
