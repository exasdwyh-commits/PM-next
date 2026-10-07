import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildNewProductMissionPlan,
  decideMissionStep,
  effectiveDeps,
  extractNodeSignals,
  initialMissionState,
  prepareNodeRerun,
  validateMissionPlan,
  type MissionState,
} from "../src/modules/supervisor/plan";
import { reasonLabel } from "../src/app/muse/mission-timeline";

const plan = buildNewProductMissionPlan("我想开发一个新产品");
const done = (s: MissionState, keys: string[]) => {
  for (const k of keys) s.nodes[k] = { ...s.nodes[k], status: "SUCCEEDED" };
  return s;
};

test("CD1：判定行解析，以最后一条为准", () => {
  assert.deepEqual(extractNodeSignals("……\n合规判定：禁止"), ["PROHIBITED"]);
  assert.deepEqual(extractNodeSignals("合规判定: **有条件可做**（需取得资质）"), ["CONDITIONAL"]);
  assert.deepEqual(extractNodeSignals("初判判定：禁止\n复核后 合规判定：可做"), ["CLEAR"]);
  assert.deepEqual(extractNodeSignals("没有判定行"), []);
  assert.deepEqual(extractNodeSignals("判定：待定"), []);
});

test("CD2：营销等合规结束才派发；合规=禁止时跳过并写明原因", () => {
  const gtm = plan.nodes.find((n) => n.key === "gtm")!;
  assert.deepEqual(effectiveDeps(gtm, plan), ["opportunity", "compliance"]);
  assert.deepEqual(validateMissionPlan(plan), []);
  const s = done(initialMissionState(plan), ["market", "opportunity"]);
  s.tasksCreated = 2;
  s.nodes.compliance = { ...s.nodes.compliance, status: "ACTIVE" };
  assert.ok(!decideMissionStep(plan, s).some((a) => "nodeKey" in a && a.nodeKey === "gtm"), "合规未结束不派发营销");
  s.nodes.compliance = { ...s.nodes.compliance, status: "SUCCEEDED", signals: ["PROHIBITED"] };
  assert.deepEqual(decideMissionStep(plan, s).find((a) => "nodeKey" in a && a.nodeKey === "gtm"), {
    type: "SKIP",
    nodeKey: "gtm",
    reason: "CONDITION_compliance_PROHIBITED",
  });
  s.nodes.compliance = { ...s.nodes.compliance, signals: ["CONDITIONAL"] };
  assert.deepEqual(decideMissionStep(plan, s).find((a) => "nodeKey" in a && a.nodeKey === "gtm"), { type: "DISPATCH", nodeKey: "gtm" });
});

test("CD3：合规重跑会连带重置被跳过的营销", () => {
  const s = done(initialMissionState(plan), plan.nodes.map((n) => n.key));
  s.nodes.gtm = { ...s.nodes.gtm, status: "SKIPPED", reason: "CONDITION_compliance_PROHIBITED" };
  const r = prepareNodeRerun(plan, s, "compliance", "复核");
  assert.ok(!("error" in r));
  assert.ok(r.resetKeys.includes("gtm"));
});

test("CD4：非法条件被校验拦下（缺失 / 自指 / 成环）", () => {
  const bad = (patch: (p: typeof plan) => void) => {
    const p = JSON.parse(JSON.stringify(plan)) as typeof plan;
    patch(p);
    return validateMissionPlan(p);
  };
  assert.ok(bad((p) => (p.nodes.find((n) => n.key === "gtm")!.skipWhen = { nodeKey: "nope", signal: "PROHIBITED" })).length);
  assert.ok(bad((p) => (p.nodes.find((n) => n.key === "gtm")!.skipWhen = { nodeKey: "gtm", signal: "PROHIBITED" })).length);
  assert.ok(bad((p) => (p.nodes.find((n) => n.key === "market")!.skipWhen = { nodeKey: "synthesis", signal: "PROHIBITED" })).some((e) => /cycle/.test(e)));
});

test("CD5：跳过原因的中文说明", () => {
  assert.match(reasonLabel("CONDITION_compliance_PROHIBITED")!, /判定为禁止，按计划跳过/);
});
