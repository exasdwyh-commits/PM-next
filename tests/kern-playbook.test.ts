/** KX-36 做法：目标相似度 / 挑选 / 模板化与实例化（纯函数）。 */
import assert from "node:assert/strict";
import test from "node:test";
import { GOAL_TOKEN, goalCore, goalSimilarity, instantiatePlan, pickPlaybook, templatizePlan } from "../src/modules/playbooks/match";
import { buildNewProductMissionPlan } from "../src/modules/supervisor";
import { buildBriefPlan } from "../src/modules/supervisor/brief";

test("相似目标得分高，无关目标得分低", () => {
  const a = "我想开发一个宠物智能喂食器";
  assert.ok(goalSimilarity(a, "我想开发一个宠物智能饮水机") >= 0.3);
  assert.ok(goalSimilarity(a, "帮我整理本周的会议纪要") < 0.3);
  assert.equal(goalSimilarity("", a), 0);
});

test("pickPlaybook 过阈值才选，同分看成功率", () => {
  const base = { matchText: "开发一个宠物智能喂食器", useCount: 0, failureCount: 0 };
  const cands = [
    { ...base, id: "a", name: "A", successCount: 0, failureCount: 3 },
    { ...base, id: "b", name: "B", successCount: 3 },
  ];
  assert.equal(pickPlaybook("开发一个宠物智能喂食器", cands)?.playbook.id, "b");
  assert.equal(pickPlaybook("写一首关于秋天的诗", cands), null);
});

test("模板化 → 实例化：原目标全部替换，约束保留在 goal 上", () => {
  const plan = buildNewProductMissionPlan("宠物智能喂食器");
  const tpl = templatizePlan(plan);
  assert.equal(tpl.goal, GOAL_TOKEN);
  assert.ok(!JSON.stringify(tpl).includes("宠物智能喂食器"));
  const goal = "宠物饮水机\n\n已确认的约束：\n- 预算 5 万";
  assert.equal(goalCore(goal), "宠物饮水机");
  const inst = instantiatePlan(tpl, goal);
  assert.equal(inst.goal, goal);
  assert.equal(inst.nodes.length, plan.nodes.length);
  assert.ok(!JSON.stringify(inst.nodes).includes(GOAL_TOKEN));
});

test("简报：有做法用做法，去掉做法回到默认计划", () => {
  const tpl = templatizePlan(buildNewProductMissionPlan("宠物智能喂食器"));
  tpl.nodes = tpl.nodes.slice(0, 2);
  const brief = { goal: "宠物饮水机", playbook: "NEW_PRODUCT" as const, questions: [], playbookRef: { id: "p", name: "做法", score: 1, useCount: 0, successCount: 0, template: tpl, defaultPlan: null } };
  assert.equal(buildBriefPlan(brief).nodes.length, 2);
  assert.equal(buildBriefPlan({ ...brief, playbookRef: null }).nodes.length, buildNewProductMissionPlan("x").nodes.length);
});
