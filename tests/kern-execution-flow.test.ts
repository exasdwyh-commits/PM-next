import test from "node:test";
import assert from "node:assert/strict";
import { FLOW_NODE, flowExcerpt, flowIsRunning, flowNodeDetails, flowNodeState, flowNodeTitle, flowSourceUrl, layoutExecutionFlow, revealedFlowKeys } from "../src/app/muse/execution-flow";
import type { MissionEvent, MissionNodeView, MissionStatusView } from "../src/app/muse/mission-timeline";
import { dedupeMissionCards } from "../src/app/muse/conversation-view";
import type { Message } from "../src/app/muse/types";

function node(key: string, dependsOn?: string[], status = "PENDING"): MissionNodeView {
  return { key, dependsOn, status, kind: "SPECIALIST", agentCode: "research_agent", attempts: 1, taskId: null };
}
function mission(nodes: MissionNodeView[]): MissionStatusView {
  return { nodes, missionTaskId: "flow-test", status: "RUNNING", goal: "test", playbook: "test", progress: { done: 0, total: nodes.length }, revisionRounds: 0, tasksCreated: 0, outcome: null, paused: null, userInputs: [] };
}

test("parallel work occupies one column; downstream steps wait in later columns even when input order differs", () => {
  const layout = layoutExecutionFlow([node("report", ["qa"]), node("market"), node("cost"), node("qa", ["market", "cost"])]);
  const position = (key: string) => layout.positions.find(p => p.key === key)!;
  assert.equal(position("market").x, position("cost").x);
  assert.notEqual(position("market").y, position("cost").y);
  assert.ok(position("qa").x > position("market").x + FLOW_NODE.width);
  assert.ok(position("report").x > position("qa").x);
  assert.equal(layout.edges.length, 3);
  assert.deepEqual(layout.unresolved, []);
  for (const p of layout.positions) {
    assert.ok(p.x + FLOW_NODE.width <= layout.width);
    assert.ok(p.y + FLOW_NODE.height <= layout.height);
  }
});

test("missing dependencies do not invent connections; duplicate dependencies produce one edge", () => {
  const layout = layoutExecutionFlow([node("a"), node("b", ["a", "a", "unrecorded"]), node("legacy")]);
  assert.deepEqual(layout.edges, [{ from: "a", to: "b" }]);
  assert.equal(layout.positions.find(p => p.key === "legacy")!.rank, 0);
});

test("a cyclic or empty plan stays inspectable without claiming a valid execution order", () => {
  const cyclic = layoutExecutionFlow([node("a", ["b"]), node("b", ["a"]), node("c", ["b"])]);
  assert.deepEqual(cyclic.unresolved, ["a", "b", "c"]);
  assert.ok(Number.isFinite(cyclic.height));
  assert.deepEqual(layoutExecutionFlow([]).edges, []);
});

test("paused, disconnected, cancelled, finished and draft workflows do not animate execution", () => {
  const status = mission([node("a", [], "ACTIVE")]);
  assert.equal(flowIsRunning(status, true), true);
  assert.equal(flowIsRunning(status, false), false);
  status.paused = { at: "2026-10-07T00:00:00Z", byUserId: "test" };
  assert.equal(flowIsRunning(status, true), false);
  assert.match(flowNodeState(status.nodes[0], status).label, /暂停/);
  status.paused = null;
  status.outcome = { status: "CANCELLED", reasons: [] };
  assert.equal(flowIsRunning(status, true), false);
  assert.equal(flowNodeState(status.nodes[0], status).label, "已取消");
  status.outcome = { status: "COMPLETED", reasons: [] };
  assert.equal(flowIsRunning(status, true), false);
  status.outcome = null;
  status.status = "DRAFT";
  assert.equal(flowIsRunning(status, true), false);
});

test("waiting for a user answer stays distinct from actively executing and from a failed node", () => {
  const status = mission([node("a", [], "ACTIVE")]);
  status.pendingAsks = [{ askId: "ask", nodeKey: "a", question: "test", defaultAssumption: "", askedAt: "now", timeoutSec: null }];
  assert.equal(flowNodeState(status.nodes[0], status).tone, "blocked");
  assert.equal(flowNodeState(node("b", [], "FAILED"), status).tone, "failed");
  assert.equal(flowNodeState(node("b", [], "SUCCEEDED"), status).tone, "done");
});

test("plan, launch receipt and final report share one canvas while all report content is preserved", () => {
  const messages = [
    { id: "plan", blocks: [{ kind: "brief", ref: "brief-1" }, { kind: "mission", ref: "mission-1" }] },
    { id: "report", blocks: [{ kind: "conclusion", ref: "mission-1", text: "result" }, { kind: "mission", ref: "mission-1" }] },
    { id: "other", blocks: [{ kind: "mission", ref: "mission-2" }] },
  ] as Message[];
  const result = dedupeMissionCards(messages);
  assert.equal(result.flatMap(message => message.blocks).filter(block => block.kind === "mission").length, 2);
  assert.equal(result[1].blocks[0].kind, "conclusion");
  assert.equal(messages[1].blocks.length, 2, "source message must not be mutated");
});

test("branches reveal from readiness and actual state; unresolved dependencies stay planned", () => {
  const status = mission([node("research", [], "ACTIVE"), node("cost"), node("report", ["research", "cost"]), node("missing", ["unknown"])]);
  assert.deepEqual([...revealedFlowKeys(status)], ["research", "cost"]);
  assert.equal(revealedFlowKeys(status, true).size, 4);
  status.nodes[0].status = "SUCCEEDED";
  assert.equal(revealedFlowKeys(status).has("report"), false);
  status.nodes[1].status = "SKIPPED";
  assert.equal(revealedFlowKeys(status).has("report"), true);
  status.outcome = { status: "NEEDS_USER", reasons: [] };
  assert.equal(revealedFlowKeys(status).size, 4, "stopped workflows preserve the complete plan for inspection");
});

test("concrete recorded objectives become titles; markdown previews stay plain", () => {
  assert.equal(flowNodeTitle({ ...node("market"), objective: "比较三种产品剂型的开发条件" }), "比较三种产品剂型的开发条件");
  assert.equal(flowNodeTitle(node("market")), "市场与竞品研究");
  assert.equal(flowExcerpt("## 结论\n**信息缺口** [引用](https://example.com)"), "结论 信息缺口 引用");
});

test("reruns discard earlier activity and citations while keeping current recorded evidence", () => {
  const status = mission([node("research", [], "ACTIVE")]);
  const event = (seq: number, type: string, payload: Record<string, unknown>): MissionEvent => ({ id: `${seq}`, seq, type, payload, nodeKey: "research", actorUserId: null, demo: true, createdAt: "2026-10-07T00:00:00Z" });
  const events = [event(1, "node.dispatched", { attempt: 1 }), event(2, "node.cite", { title: "old", url: "https://example.com/old" }), event(3, "node.tool", { tool: "knowledge_search", input: '{"query":"old query"}' })];
  assert.equal(flowNodeDetails(status, events).get("research")!.sources.length, 1);
  status.nodes[0].attempts = 2;
  assert.equal(flowNodeDetails(status, events).get("research")!.sources.length, 0, "snapshot may arrive before second dispatch event");
  events.push(event(4, "node.dispatched", { attempt: 2 }), event(5, "node.tool", { tool: "knowledge_search", input: '{"query":"new query"}' }), event(6, "node.cite", { title: "new", url: "https://example.com/new" }), event(7, "node.hypothesis", { unknowns: ["尚未验证"] }));
  const current = flowNodeDetails(status, events).get("research")!;
  assert.deepEqual(current.sources.map(source => source.title), ["new"]);
  assert.match(current.activity, /new query/);
  assert.equal(current.uncertainty, true);
  status.nodes[0].status = "PENDING";
  assert.equal(flowNodeDetails(status, events).get("research")!.sources.length, 0);
});

test("source links accept web URLs and reject executable or local destinations", () => {
  assert.equal(flowSourceUrl("https://example.com/paper"), "https://example.com/paper");
  for (const url of ["javascript:alert(1)", "data:text/html,test", "file:///tmp/test", "invalid", null]) assert.equal(flowSourceUrl(url), undefined);
});
