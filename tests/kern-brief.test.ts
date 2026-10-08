import assert from "node:assert/strict";
import test from "node:test";
import { answerText, buildBriefPlan, buildClarifyQuestions, estimateBrief, isUsableMemoryAnswer } from "../src/modules/supervisor/brief";
import { buildNewProductMissionPlan } from "../src/modules/supervisor/plan";
import { chunkForReplay, demoOutput } from "../src/modules/supervisor/demo";
import { competitorResearchIntent, competitorSubject } from "../src/modules/supervisor/competitor-brief";

test("competitor intent comes from the request, not from the concatenated constraints", () => {
  // A constraint that merely says 竞品 must not turn a normal brief into a competitor study.
  assert.equal(competitorResearchIntent("开发宠物饮水机", "主要卖给谁：竞品公司的目标用户"), false);
  assert.equal(competitorResearchIntent("我想开发一个新产品：便携咖啡机", "主要卖给谁：城市年轻白领"), false);

  // An explicit opt-out outranks any keyword hit.
  assert.equal(competitorResearchIntent("开发宠物饮水机", "优先走什么渠道：线下门店，暂不做竞品调研"), false);
  assert.equal(competitorResearchIntent("我想开发便携咖啡机，顺便看看竞品", "优先走什么渠道：线下门店，暂时不需要竞品研究"), false);

  // A real competitor mission stays one, and the brand added while clarifying is
  // still usable as the research subject.
  assert.equal(competitorResearchIntent("调研一下智能水杯的竞品", "调研对象：某品牌"), true);
  assert.equal(competitorSubject("调研一下智能水杯的竞品\n\n已确认的约束：\n- 调研对象：某品牌"), "某品牌");

  // The plan goal still carries the answer, but it no longer defines the intent.
  const qs = buildClarifyQuestions("NEW_PRODUCT", "开发宠物饮水机", []);
  qs[2].answer = { optionId: null, text: "线下门店，暂不做竞品调研" };
  const plan = buildBriefPlan({ goal: "开发宠物饮水机", playbook: "NEW_PRODUCT", questions: qs });
  assert.match(plan.goal, /线下门店，暂不做竞品调研/, "the answer is still a constraint");
  assert.doesNotMatch(plan.goal, /调研默认范围/, "but it does not make it a competitor mission");
});

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

test("mission-conclusion memories are never prefilled as a clarifying answer", () => {
  // A stored conclusion matches the 用户/渠道 hint regexes, but it is a report,
  // not an answer — prefilling it would pollute plan.goal with another mission.
  const conclusion = "「我想开发一个新产品：便携咖啡机」的结论：## 1. 结论与建议:推荐做「随行冷萃杯」。| 竞品 | 价格 | |---|---| | A | ¥299 | 目标用户是通勤白领";
  assert.equal(isUsableMemoryAnswer(conclusion), false);
  assert.equal(isUsableMemoryAnswer(""), false);
  assert.equal(isUsableMemoryAnswer("目标客户是城市白领\n预算 30 万"), false);
  assert.equal(isUsableMemoryAnswer("我们主要走小红书和抖音"), true);

  const qs = buildClarifyQuestions("NEW_PRODUCT", "g", [{ id: "m1", content: conclusion }]);
  assert.deepEqual(qs.map((q) => q.remembered), [null, null, null]);
  assert.deepEqual(qs.map((q) => q.answer), [null, null, null]);
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

test("estimate: demo costs nothing; monthly usage projection", () => {
  const plan = buildNewProductMissionPlan("g");
  const e = estimateBrief(plan, { used: 2, limit: 5 });
  assert.equal(e.steps, 9);
  assert.equal(e.members, 7);
  assert.equal(e.modelCalls.min, 9);
  assert.ok(e.modelCalls.max > 9);
  assert.deepEqual(e.usage, { used: 2, limit: 5, afterLaunch: 3 });
  const d = estimateBrief(plan, { used: 2, limit: 5 }, true);
  assert.deepEqual(d.modelCalls, { min: 0, max: 0 });
  assert.equal(d.usage, null);
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
