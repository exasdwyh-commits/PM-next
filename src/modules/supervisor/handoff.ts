import type { MissionNode } from "@/modules/kern-contracts/mission-plan";

/** QA reviews dependencies; synthesis also needs the deliverables behind that review. */
export function missionDependencyKeys(nodes: MissionNode[], key: string): string[] {
  const node = nodes.find(item => item.key === key);
  if (!node) return [];
  if (node.kind !== "SYNTHESIS") return node.dependsOn;
  const seen = new Set<string>([key]);
  const visit = (dependency: string) => {
    if (seen.has(dependency)) return;
    seen.add(dependency);
    nodes.find(item => item.key === dependency)?.dependsOn.forEach(visit);
  };
  node.dependsOn.forEach(visit);
  return nodes.filter(item => item.key !== key && seen.has(item.key)).map(item => item.key);
}

export function missionOutputText(result: unknown, summary: string | null): string | null {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const value = result as Record<string, unknown>;
    if (value.kind === "MISSION_NODE_OUTPUT" && typeof value.output === "string" && value.output.trim()) return value.output;
  }
  return summary;
}

/** 上游输出进提示词时的截断：保留头部与尾部（尾部往往是渠道建议与验证动作），截断处显式标记，不得假装完整。 */
export function truncateUpstreamForPrompt(text: string, limit = 12000): string {
  if (text.length <= limit) return text;
  const head = Math.ceil(limit * 0.7);
  const tail = limit - head;
  return text.slice(0, head) + `\n\n…（上游输出共 ${text.length} 字，为控制上下文已保留头部与尾部、中间略去；缺失部分按 UNKNOWN 处理，不得编造）…\n\n` + text.slice(-tail);
}

export function renderMissionUpstream(upstream: { key: string; agentCode: string; status: string; summary: string | null }[], limit = 12000): string {
  return upstream.map(item => {
    const body = item.summary != null ? truncateUpstreamForPrompt(item.summary, limit) : (item.status === "SUCCEEDED" ? "(无产出)" : "该部分未能完成 → 视为 UNKNOWN");
    return `### ${item.key}（${item.agentCode}，${item.status}）\n${body}`;
  }).join("\n\n") || "（无上游产出）";
}
