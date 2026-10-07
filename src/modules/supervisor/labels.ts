/**
 * 任务节点 / 专员的中文标签（KX-71 从 app/muse/mission-timeline.ts 下沉到 supervisor）。
 * 页面层与 takeaway 都从这里取；界面文件只 re-export，不再让模块层反向依赖页面。
 */

export const NODE_LABEL: Record<string, string> = {
  market: "市场与竞品研究",
  compliance: "合规边界",
  economics: "单位经济性",
  opportunity: "机会判断与方向",
  validation: "验证计划",
  gtm: "上市与营销策略",
  "red-team": "红队挑战",
  qa: "独立 QA 复核",
  synthesis: "Kern 综合结论",
};

export const AGENT_LABEL: Record<string, string> = {
  research_agent: "市场研究",
  compliance_agent: "合规",
  cost_bom_agent: "成本",
  product_agent: "产品",
  marketing_agent: "营销",
  red_team: "红队",
  qa_verifier: "QA",
  hermes_pm: "Kern",
  scientific_evidence_agent: "科学证据",
  formulation_agent: "配方",
  ops_agent: "供应与运营",
  tech_architect_agent: "技术架构",
};

export function nodeLabel(key: string): string {
  const code = key.replace(/^specialist-\d+-/, "");
  return NODE_LABEL[key] ?? AGENT_LABEL[code] ?? code;
}
export function agentLabel(code: string): string {
  return AGENT_LABEL[code] ?? code;
}
