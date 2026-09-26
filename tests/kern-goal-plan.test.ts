import assert from "node:assert/strict";
import test from "node:test";
import { buildKernGoalPlanShadow } from "../src/modules/assistant-runtime/goal-plan";

const base = {
  version: "kern-collaboration-shadow/v1" as const,
  mode: "COUNCIL" as const,
  experts: ["research_agent", "compliance_agent", "product_agent"],
  synthesisTier: "FRONTIER" as const,
  researchRequired: true,
  independentFirstPass: true,
  qaRequired: true,
  redTeamRequired: false,
  source: "DETERMINISTIC" as const,
  reasons: ["MARKET_SIGNAL", "HIGH_RISK_DOMAIN"],
};

test("goal plan turns collaboration into a stable task DAG without executing it", () => {
  const plan = buildKernGoalPlanShadow({
    goal: "验证一个新品机会并给出是否继续推进需要补什么证据",
    collaboration: base,
  });

  assert.equal(plan.version, "kern-goal-plan-shadow/v1");
  assert.equal(plan.status, "SHADOW");
  assert.equal(plan.executionPolicy.autoCreateAgentTasks, false);
  assert.equal(plan.collaborationMode, "COUNCIL");

  const specialists = plan.tasks.filter((task) => task.kind === "SPECIALIST");
  assert.equal(specialists.length, 3);
  assert.deepEqual(
    specialists.map((task) => task.preferredAgentCode),
    ["research_agent", "compliance_agent", "product_agent"]
  );

  const qa = plan.tasks.find((task) => task.taskKey === "qa-review");
  assert.ok(qa);
  assert.deepEqual(
    qa!.dependencies,
    specialists.map((task) => task.taskKey)
  );

  const synthesis = plan.tasks.find((task) => task.taskKey === "kern-synthesis");
  assert.ok(synthesis);
  assert.deepEqual(synthesis!.dependencies, ["qa-review"]);
  assert.ok(plan.successCriteria.some((item) => item.includes("可追溯来源")));
});

test("solo work still becomes an explicit Kern-owned plan", () => {
  const plan = buildKernGoalPlanShadow({
    goal: "整理一下当前产品状态",
    collaboration: {
      ...base,
      mode: "SOLO",
      experts: [],
      synthesisTier: "FAST",
      researchRequired: false,
      qaRequired: false,
      reasons: ["COMPLEXITY_SIMPLE"],
    },
  });

  assert.equal(plan.tasks[0].taskKey, "kern-primary");
  assert.equal(plan.tasks[0].preferredAgentCode, "hermes_pm");
  assert.equal(plan.tasks.at(-1)?.taskKey, "kern-synthesis");
  assert.deepEqual(plan.tasks.at(-1)?.dependencies, ["kern-primary"]);
});

test("required red team is materialized once", () => {
  const plan = buildKernGoalPlanShadow({
    goal: "完整研发并挑战失败路径",
    collaboration: {
      ...base,
      mode: "FULL_RND",
      experts: ["research_agent", "red_team"],
      redTeamRequired: true,
    },
  });

  assert.equal(
    plan.tasks.filter((task) => task.preferredAgentCode === "red_team").length,
    1
  );
});
