import assert from "node:assert/strict";
import test from "node:test";
import { answerText, buildBriefPlan, buildClarifyQuestions, estimateBrief } from "../src/modules/supervisor/brief";
import { buildNewProductMissionPlan } from "../src/modules/supervisor/plan";
import { chunkForReplay, demoOutput } from "../src/modules/supervisor/demo";

test("clarify questions only for NEW_PRODUCT, memory maps to the right question", () => {
  assert.deepEqual(buildClarifyQuestions("GENERIC", "g", []), []);
  const qs = buildClarifyQuestions("NEW_PRODUCT", "g", [
    { id: "m1", content: "我们主要走小红书和抖音" },
    { id: "m2", content: "我喜欢简洁的报告" },
  ]);
  assert.equal(qs.length, 3);
  assert.equal(qs.find((q) => q.id === "channel")!.remembered?.memoryId, "m1");
  assert.equal(qs.find((q) => q.id === "audience")!.remembered, null);
  assert.equal(qs.find((q) => q.id === "budget")!.answer, null);
});

test("answers → constraints; 'open' is not a constraint", () => {
  const qs = buildClarifyQuestions("NEW_PRODUCT", "g", []);
  qs[0].answer = { optionId: "smb", text: "" };
  qs[1].answer = { optionId: "open", text: "" };
  qs[2].answer = { optionId: null, text: "  门店  " };
  assert.equal(answerText(qs[1]), null);
  const plan = buildBriefPlan({ goal: "做个新产品", playbook: "NEW_PRODUCT", questions: qs });
  assert.match(plan.goal, /主要卖给谁：中小企业/);
  assert.match(plan.goal, /优先走什么渠道：门店/);
  assert.doesNotMatch(plan.goal, /预算/);
});

test("estimate: demo costs nothing; quota projection", () => {
  const plan = buildNewProductMissionPlan("g");
  const e = estimateBrief(plan, { used: 2, limit: 5 });
  assert.equal(e.steps, 9);
  assert.equal(e.members, 7);
  assert.equal(e.modelCalls.min, 9);
  assert.ok(e.modelCalls.max > 9);
  assert.deepEqual(e.quota, { used: 2, limit: 5, afterLaunch: 3 });
  const d = estimateBrief(plan, { used: 2, limit: 5 }, true);
  assert.deepEqual(d.modelCalls, { min: 0, max: 0 });
  assert.equal(d.quota, null);
});

test("demo output is labelled; QA revises once then passes; replay chunks rejoin", () => {
  assert.match(demoOutput("market", "SPECIALIST", 1), /示例/);
  assert.equal(JSON.parse(demoOutput("qa", "QA", 1)).verdict, "REVISE");
  assert.equal(JSON.parse(demoOutput("qa", "QA", 2)).verdict, "PASS");
  const t = demoOutput("gtm", "SPECIALIST", 1);
  const chunks = chunkForReplay(t);
  assert.ok(chunks.length > 2);
  assert.equal(chunks.join(""), t);
});
