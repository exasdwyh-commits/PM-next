import type { ModelGatewayMessage } from "@/modules/model-gateway";

export const KERN_PLANNER_INTENTS = [
  "WORKSPACE_STATUS",
  "PENDING_DECISIONS",
  "PRODUCT_STATUS",
  "PENDING_PROPOSALS",
  "NEW_PRODUCT_INTAKE",
  "KNOWLEDGE_SEARCH",
  "CHALLENGE_THESIS",
  "UNSUPPORTED",
] as const;

export type KernPlannerIntent = (typeof KERN_PLANNER_INTENTS)[number];

const INTENT_SET = new Set<string>(KERN_PLANNER_INTENTS);

/**
 * Kern 的规划模型只做“选哪个只读/受治理能力”，不执行动作。
 *
 * 明确禁止把 DESKTOP_EXECUTION / PROPOSE_* 放进模型可选集合：
 * - 本机执行必须由确定性显式指令识别；
 * - 写入类动作继续由现有解析器生成 Proposal，再由人确认。
 */
export function buildKernPlannerMessages(input: {
  text: string;
  productBound: boolean;
  history?: { role: string; content: string }[];
}): ModelGatewayMessage[] {
  const history = (input.history ?? [])
    .filter((item) => item.role === "USER" || item.role === "ASSISTANT")
    .slice(-6)
    .map((item) => `${item.role === "USER" ? "用户" : "Kern"}：${item.content.slice(0, 800)}`)
    .join("\n");

  const system = [
    "你是 Kern 的受治理意图规划器。你只选择下一步应该读取/分析哪类真实系统信息，不执行任何动作。",
    "只能返回一个 JSON 对象，格式严格为：{\"intent\":\"INTENT\"}。不要 markdown，不要解释。",
    "允许值及语义：",
    "- WORKSPACE_STATUS：用户在问今天/本周/项目/任务/进度/阻塞等工作状态。",
    "- PENDING_DECISIONS：用户在问需要自己拍板、审批、决定什么。",
    "- PRODUCT_STATUS：用户在问产品组合、产品状态、生命周期、版本、上市进展。",
    "- PENDING_PROPOSALS：用户在问有哪些待确认提议/草案。",
    "- NEW_PRODUCT_INTAKE：用户明确在提出一个新的产品想法或要开始新品立项。",
    "- KNOWLEDGE_SEARCH：用户要查公司知识、制度、资料、规则、背景或需要已有知识回答。",
    "- CHALLENGE_THESIS：用户明确要求反方、证伪、挑战判断或复核某个假设。",
    "- UNSUPPORTED：普通聊天、需要新能力、需要执行电脑动作、需要写业务数据、或无法可靠归类。",
    "安全边界：",
    "1. DESKTOP_EXECUTION（电脑/终端/Git/文件/App 操作）一律返回 UNSUPPORTED，由确定性 Desktop 识别器处理。",
    "2. PROPOSE_*（修改字段、创建任务、审批、发布等写操作）一律返回 UNSUPPORTED，由现有 Proposal/Governance 路径处理。",
    "3. 不从用户没有说过的内容推断产品字段或业务事实。",
  ].join("\n");

  return [
    { role: "system", content: system },
    {
      role: "user",
      content: [
        `当前会话是否绑定产品：${input.productBound ? "是" : "否"}`,
        history ? `最近对话：\n${history}` : "最近对话：无",
        `本轮用户消息：${input.text}`,
      ].join("\n\n"),
    },
  ];
}

export function parseKernPlannerIntent(raw: string): KernPlannerIntent | null {
  const text = raw.trim().replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/i, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { intent?: unknown };
    return typeof parsed.intent === "string" && INTENT_SET.has(parsed.intent)
      ? (parsed.intent as KernPlannerIntent)
      : null;
  } catch {
    return null;
  }
}
