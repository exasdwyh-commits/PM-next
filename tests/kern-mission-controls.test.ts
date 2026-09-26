import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPlanEdit,
  buildNewProductMissionPlan,
  initialMissionState,
  prepareNodeRerun,
  MAX_MISSION_RERUNS,
  type MissionState,
} from "../src/modules/supervisor/plan";
import { classifyAttention } from "../src/modules/supervisor/attention";
import { formatSseEvent } from "../src/modules/supervisor/events";
import { parseMissionControl } from "../src/modules/supervisor/controls";

function doneState(keys: string[]): MissionState {
  const plan = buildNewProductMissionPlan("g");
  const s = initialMissionState(plan);
  for (const k of keys) s.nodes[k].status = "SUCCEEDED";
  return s;
}

test("applyPlanEdit adds a step wired into QA and synthesis, with budget", () => {
  const plan = buildNewProductMissionPlan("g");
  const r = applyPlanEdit(plan, doneState(["market"]), [
    { op: "add", node: { key: "pricing", agentCode: "cost_bom_agent", objective: "定价", dependsOn: ["market"] } },
  ]);
  assert.ok(!("error" in r));
  assert.ok(r.plan.nodes.find((n) => n.key === "qa")!.dependsOn.includes("pricing"));
  assert.ok(r.plan.nodes.find((n) => n.key === "synthesis")!.dependsOn.includes("pricing"));
  assert.equal(r.plan.budget.maxTasks, plan.budget.maxTasks + 1);
  assert.equal(r.state.nodes.pricing.status, "PENDING");
});

test("applyPlanEdit guards: finished, structural, cycles, bad keys", () => {
  const plan = buildNewProductMissionPlan("g");
  const st = doneState(["market"]);
  assert.match((applyPlanEdit(plan, st, [{ op: "remove", key: "market" }]) as { error: string }).error, /NOT_PENDING/);
  assert.match((applyPlanEdit(plan, st, [{ op: "reassign", key: "synthesis", agentCode: "x" }]) as { error: string }).error, /STRUCTURAL/);
  assert.match((applyPlanEdit(plan, st, [{ op: "add", node: { key: "Bad Key", agentCode: "x", objective: "o" } }]) as { error: string }).error, /INVALID_KEY/);
  assert.match((applyPlanEdit(plan, st, [{ op: "add", node: { key: "x", agentCode: "a", objective: "o", dependsOn: ["nope"] } }]) as { error: string }).error, /INVALID_PLAN/);
  const removed = applyPlanEdit(plan, st, [{ op: "remove", key: "gtm" }]);
  assert.ok(!("error" in removed));
  assert.ok(!removed.plan.nodes.some((n) => n.dependsOn.includes("gtm")));
  assert.equal(removed.state.nodes.gtm, undefined);
});

test("prepareNodeRerun resets the node + downstream and tops up budget", () => {
  const plan = buildNewProductMissionPlan("g");
  const all = plan.nodes.map((n) => n.key);
  const r = prepareNodeRerun(plan, doneState(all), "opportunity", "fb");
  assert.ok(!("error" in r));
  assert.deepEqual(r.resetKeys.sort(), ["gtm", "opportunity", "qa", "red-team", "synthesis", "validation"]);
  assert.equal(r.state.nodes.market.status, "SUCCEEDED");
  assert.equal(r.state.nodes.opportunity.revisionFeedback, "fb");
  assert.equal(r.state.nodes.gtm.revisionFeedback, null);
  assert.equal(r.plan.budget.maxTasks, plan.budget.maxTasks + 6);
  assert.equal(r.state.reruns, 1);
});

test("prepareNodeRerun refuses unfinished, active downstream and over-limit", () => {
  const plan = buildNewProductMissionPlan("g");
  const st = doneState(["market"]);
  assert.deepEqual(prepareNodeRerun(plan, st, "opportunity"), { error: "NODE_NOT_FINISHED" });
  st.nodes.opportunity.status = "ACTIVE";
  assert.deepEqual(prepareNodeRerun(plan, st, "market"), { error: "DOWNSTREAM_ACTIVE" });
  const all = doneState(plan.nodes.map((n) => n.key));
  all.reruns = MAX_MISSION_RERUNS;
  assert.deepEqual(prepareNodeRerun(plan, all, "gtm"), { error: "RERUN_LIMIT" });
});

test("attention: cancelled is quiet, paused asks the user to continue", () => {
  const base = { kind: "MISSION" as const, id: "m", goal: "g", progress: { done: 3, total: 9 }, reasons: [], finishedAt: null, conversationId: "c", seenByUser: false };
  assert.equal(classifyAttention({ ...base, status: "CANCELLED" }).level, "AUTO_HANDLE");
  const p = classifyAttention({ ...base, status: "RUNNING", paused: true });
  assert.equal(p.level, "SURFACE");
  assert.match(p.why, /已暂停/);
});

test("SSE frame carries seq as id for Last-Event-ID resume", () => {
  const frame = formatSseEvent({ id: "x", seq: 7, type: "node.started", nodeKey: "market", actorUserId: null, payload: {}, demo: false, createdAt: "t" });
  assert.match(frame, /^id: 7\nevent: node.started\ndata: \{.*\}\n\n$/);
});

test("parseMissionControl validates input", () => {
  assert.deepEqual(parseMissionControl({ action: "pause" }), { action: "pause" });
  assert.deepEqual(parseMissionControl({ action: "add-input", text: "  hi " }), { action: "add-input", text: "hi" });
  assert.throws(() => parseMissionControl({ action: "add-input", text: "  " }));
  assert.throws(() => parseMissionControl({ action: "skip" }));
  assert.throws(() => parseMissionControl({ action: "drop-table" }));
  assert.throws(() => parseMissionControl(null));
});
