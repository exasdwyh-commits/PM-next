import { buildLanes, nodeLabel, toolInputPreview, type MissionEvent, type MissionNodeView, type MissionStatusView } from "./mission-timeline";

export const FLOW_NODE = { width: 232, height: 146, column: 304, row: 180, padding: 32 };
export const FLOW_GOAL = { width: 190, height: 116, offset: 246 };
export type FlowPosition = { key: string; x: number; y: number; rank: number };

/** Titles describe recorded work; the specialist remains a secondary label. */
export function flowNodeTitle(node: MissionNodeView) {
  return flowExcerpt(node.objective ?? "", 64) || nodeLabel(node.key);
}

export function flowNodeSummary(node: MissionNodeView) {
  return (node.summary ?? "").split("\n")
    .filter(line => !(line.trim().startsWith("#") && line.includes(node.key))).join("\n");
}

export function flowExcerpt(text: string, max = 88) {
  const plain = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(^|\n)\s*(?:#{1,6}\s+|[-*]\s+|\d+\.\s+)/g, "$1")
    .replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();
  return plain.length > max ? plain.slice(0, max) + "…" : plain;
}

/** Reveal runnable branches from the snapshot, never from an animation timer. */
export function revealedFlowKeys(status: MissionStatusView, showPlan = false) {
  if (showPlan || status.status === "DRAFT" || status.outcome) return new Set(status.nodes.map(node => node.key));
  const byKey = new Map(status.nodes.map(node => [node.key, node]));
  return new Set(status.nodes.filter(node => node.status !== "PENDING" ||
    (node.dependsOn ?? []).every(key => byKey.get(key)?.status === "SUCCEEDED" || byKey.get(key)?.status === "SKIPPED"))
    .map(node => node.key));
}

/** Only the current attempt supplies activity and evidence; reruns do not inherit old citations. */
export function flowNodeDetails(status: MissionStatusView, events: MissionEvent[]) {
  const lanes = buildLanes(status, events);
  return new Map(status.nodes.map(node => {
    const attempt = node.status === "PENDING" ? undefined : lanes.find(lane => lane.key === node.key)?.attempts.findLast(item => item.attempt === node.attempts);
    const tool = attempt?.toolCalls.at(-1);
    const reset = events.findLastIndex(event => event.nodeKey === node.key && ["node.dispatched", "node.rerun"].includes(event.type));
    const notices = !attempt ? [] : events.slice(Math.max(0, reset)).filter(event => event.nodeKey === node.key && ["node.hypothesis", "node.refuted", "node.retracted"].includes(event.type));
    const uncertainty = notices.some(event => event.type === "node.hypothesis" && Array.isArray(event.payload.unknowns) && event.payload.unknowns.length > 0);
    const retracted = notices.some(event => event.type === "node.retracted" || event.type === "node.refuted");
    return [node.key, {
      sources: attempt?.cites ?? [],
      activity: tool ? `${tool.ok ? tool.label : `${tool.label}失败`}${toolInputPreview(tool.input)}` : attempt?.method[0] ?? "",
      tools: attempt?.toolCalls.length ?? 0,
      uncertainty, retracted,
    }] as const;
  }));
}

export function flowSourceUrl(url: string | null) {
  if (!url) return undefined;
  try { const parsed = new URL(url); return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : undefined; }
  catch { return undefined; }
}

/** Only recorded dependencies become edges. Missing references never become invented steps. */
export function layoutExecutionFlow(nodes: MissionNodeView[]) {
  const keys = new Set(nodes.map(node => node.key));
  const ranks = new Map<string, number>();
  const remaining = new Set(keys);
  for (let pass = 0; pass < nodes.length && remaining.size; pass++) {
    let moved = false;
    for (const node of nodes) {
      if (!remaining.has(node.key)) continue;
      const dependencies = (node.dependsOn ?? []).filter(key => keys.has(key));
      if (dependencies.some(key => !ranks.has(key))) continue;
      ranks.set(node.key, dependencies.length ? Math.max(...dependencies.map(key => ranks.get(key)!)) + 1 : 0);
      remaining.delete(node.key);
      moved = true;
    }
    if (!moved) break;
  }
  // Keep malformed/cyclic plans inspectable, without pretending they can run in order.
  const unresolved = [...remaining];
  const fallback = ranks.size ? Math.max(...ranks.values()) + 1 : 0;
  for (const key of unresolved) ranks.set(key, fallback);
  const columns = new Map<number, MissionNodeView[]>();
  for (const node of nodes) {
    const rank = ranks.get(node.key)!;
    columns.set(rank, [...(columns.get(rank) ?? []), node]);
  }
  const rows = Math.max(1, ...[...columns.values()].map(column => column.length));
  const { width, height, column, row, padding } = FLOW_NODE;
  const positions = nodes.map(node => {
    const rank = ranks.get(node.key)!;
    const peers = columns.get(rank)!;
    return { key: node.key, rank, x: padding + rank * column, y: padding + (rows - peers.length) * row / 2 + peers.indexOf(node) * row };
  });
  const edges = nodes.flatMap(node => [...new Set(node.dependsOn ?? [])]
    .filter(key => keys.has(key))
    .map(from => ({ from, to: node.key })));
  return {
    positions, edges, unresolved,
    width: padding * 2 + width + Math.max(0, columns.size - 1) * column,
    height: padding * 2 + height + (rows - 1) * row,
  };
}

export function flowIsRunning(status: MissionStatusView, connected: boolean) {
  return connected && status.status !== "DRAFT" && !status.paused && !status.outcome;
}

export function flowNodeState(node: MissionNodeView, status: MissionStatusView) {
  if (node.status === "ACTIVE") {
    if (status.outcome?.status === "CANCELLED") return { tone: "idle", label: "已取消" };
    if (status.paused) return { tone: "paused", label: "暂停中 · 当前步骤收尾" };
    if (status.outcome) return { tone: "paused", label: "执行已停止" };
    if (status.pendingAsks?.some(ask => ask.nodeKey === node.key)) return { tone: "blocked", label: "等待你回答" };
    return { tone: "active", label: "正在执行" };
  }
  switch (node.status) {
    case "SUCCEEDED": return { tone: "done", label: "已完成" };
    case "BLOCKED": return { tone: "blocked", label: "受阻" };
    case "FAILED": return { tone: "failed", label: "执行失败" };
    case "SKIPPED": return { tone: "idle", label: "已跳过" };
    default: return { tone: "idle", label: status.outcome?.status === "CANCELLED" ? "未执行 · 已取消" : "尚未开始" };
  }
}
