import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRevision,
  buildMissionPlanFromGoalPlan,
  buildNewProductMissionPlan,
  decideMissionLaunch,
  decideMissionStep,
  initialMissionState,
  parseQaVerdict,
  validateMissionPlan,
  type MissionState,
} from "../src/modules/supervisor/plan";
import { buildKernGoalPlanShadow } from "../src/modules/assistant-runtime/goal-plan";

const collab = (mode: string, experts: string[] = []) => ({
  version: "kern-collaboration-shadow/v1" as const,
  mode: mode as "SOLO",
  experts,
  synthesisTier: "FRONTIER" as const,
  researchRequired: true,
  independentFirstPass: experts.length > 1,
  qaRequired: mode === "COUNCIL",
  redTeamRequired: false,
  autoDispatchCandidate: false,
  autoDispatchEligible: false,
  authority: "ADVISORY_ONLY" as const,
  source: "DETERMINISTIC" as const,
  reasons: [],
});

function complete(state: MissionState, key: string, extra: Partial<MissionState["nodes"][string]> = {}) {
  state.nodes[key] = { ...state.nodes[key], status: "SUCCEEDED", summary: `${key} done`, ...extra };
}

test("launch policy: goals and multi-agent work become missions; governed paths do not", () => {
  assert.equal(decideMissionLaunch({ text: "我想开发一个新的产品", intent: "NEW_PRODUCT_INTAKE", collaboration: collab("SOLO") }).playbook, "NEW_PRODUCT");
  assert.equal(decideMissionLaunch({ text: "比较这两个渠道", intent: "UNSUPPORTED", collaboration: collab("PAIR", ["a", "b"]) }).launch, true);
  assert.equal(decideMissionLaunch({ text: "今天有什么任务", intent: "WORKSPACE_STATUS", collaboration: collab("SOLO") }).launch, false);
  assert.equal(decideMissionLaunch({ text: "我想开发一个新产品", intent: "DESKTOP_EXECUTION", collaboration: collab("SOLO") }).launch, false);
  assert.equal(decideMissionLaunch({ text: "开始完整研发评估", intent: "START_PRODUCT_RND", collaboration: collab("FULL_RND") }).launch, false);
});

test("new product playbook is a valid DAG with parallel first pass, red team, QA and synthesis", () => {
  const plan = buildNewProductMissionPlan("我想开发一个新的产品");
  assert.deepEqual(validateMissionPlan(plan), []);
  const first = decideMissionStep(plan, initialMissionState(plan));
  assert.deepEqual(
    first.map((a) => a.type === "DISPATCH" && a.nodeKey),
    ["market", "compliance", "economics"]
  );
  assert.ok(plan.nodes.some((n) => n.kind === "RED_TEAM"));
  assert.equal(plan.nodes.at(-1)!.kind, "SYNTHESIS");
});

test("upstream failure degrades instead of stalling; critical failure needs the user", () => {
  const plan = buildNewProductMissionPlan("x 新产品");
  const s = initialMissionState(plan);
  s.nodes.market.status = "BLOCKED";
  complete(s, "compliance");
  complete(s, "economics");
  const next = decideMissionStep(plan, s);
  assert.ok(next.some((a) => a.type === "DISPATCH" && a.nodeKey === "opportunity"));
  for (const key of ["opportunity", "validation", "gtm", "red-team", "qa", "synthesis"]) complete(s, key);
  const fin = decideMissionStep(plan, s);
  assert.equal(fin[0].type, "FINISH");
  assert.equal(fin[0].type === "FINISH" && fin[0].outcome, "NEEDS_USER");
});

test("QA REVISE re-delegates named nodes plus their downstream once, then completes", () => {
  const plan = buildNewProductMissionPlan("新产品");
  let s = initialMissionState(plan);
  for (const n of plan.nodes) if (n.kind !== "SYNTHESIS") complete(s, n.key);
  s.tasksCreated = 8;
  s.nodes.qa.qa = { verdict: "REVISE", issues: [{ target: "opportunity", problem: "差异化缺证据" }] };
  const actions = decideMissionStep(plan, s);
  assert.equal(actions[0].type, "REVISE");
  s = applyRevision(plan, s, actions[0] as Extract<(typeof actions)[0], { type: "REVISE" }>);
  assert.equal(s.revisionRounds, 1);
  // opportunity + everything depending on it + QA reset; market untouched
  for (const key of ["opportunity", "validation", "gtm", "red-team", "qa"]) assert.equal(s.nodes[key].status, "PENDING", key);
  assert.equal(s.nodes.market.status, "SUCCEEDED");
  assert.match(s.nodes.opportunity.revisionFeedback ?? "", /差异化/);
  // Second REVISE is out of budget → proceeds to synthesis
  for (const key of ["opportunity", "validation", "gtm", "red-team", "qa"]) complete(s, key);
  s.nodes.qa.qa = { verdict: "REVISE", issues: [] };
  const after = decideMissionStep(plan, s);
  assert.deepEqual(after, [{ type: "DISPATCH", nodeKey: "synthesis" }]);
});

test("task budget is hard", () => {
  const plan = buildNewProductMissionPlan("新产品");
  const s = initialMissionState(plan);
  s.tasksCreated = plan.budget.maxTasks - 1;
  const actions = decideMissionStep(plan, s);
  assert.equal(actions.filter((a) => a.type === "DISPATCH").length, 1);
  assert.equal(actions.filter((a) => a.type === "SKIP").length, 2);
});

test("shadow goal plan converts into an executable mission plan", () => {
  const goalPlan = buildKernGoalPlanShadow({
    goal: "验证渠道和合规",
    collaboration: collab("COUNCIL", ["research_agent", "compliance_agent", "product_agent"]),
  });
  const plan = buildMissionPlanFromGoalPlan(goalPlan);
  assert.deepEqual(validateMissionPlan(plan), []);
  assert.deepEqual(plan.nodes.find((n) => n.kind === "SYNTHESIS")!.dependsOn, ["qa"]);
});

test("QA verdict parser is strict", () => {
  assert.deepEqual(parseQaVerdict('```json\n{"verdict":"revise","issues":[{"target":"gtm","problem":"缺渠道数据"}]}\n```'), {
    verdict: "REVISE",
    issues: [{ target: "gtm", problem: "缺渠道数据" }],
  });
  assert.equal(parseQaVerdict("looks fine"), null);
  assert.equal(parseQaVerdict('{"verdict":"MAYBE"}'), null);
});
