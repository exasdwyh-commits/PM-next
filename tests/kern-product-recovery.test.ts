import assert from "node:assert/strict";
import test from "node:test";
import { conversationProductGoal } from "../src/modules/assistant-runtime/product-goal";
import { missionDependencyKeys, missionOutputText, renderMissionUpstream } from "../src/modules/supervisor/handoff";
import { buildNewProductMissionPlan } from "../src/modules/supervisor/plan";

test("conversation carries development goal and follow-up constraints", () => {
  const history = [{ role: "USER", content: "我想做一款人参饮料" }, { role: "ASSISTANT", content: "目标人群和预算是多少？" }];
  assert.equal(conversationProductGoal(history[0].content), history[0].content);
  assert.match(conversationProductGoal("预算十万元，面向年轻人", history)!, /人参饮料[\s\S]*十万元/);
  for (const text of ["只是聊聊，不要启动研发", "换个话题", "这个产品是什么", "引用：我想开发一个产品"]) assert.equal(conversationProductGoal(text, history), null);
  assert.equal(conversationProductGoal("开始吧", [{ role: "ASSISTANT", content: "我想开发一个产品" }]), null);
  assert.equal(conversationProductGoal("预算十万元", [...history, { role: "USER", content: "先不做了" }]), null);
});

test("synthesis sees complete transitive specialist handoff including GTM tail", () => {
  const plan = buildNewProductMissionPlan("开发人参饮料");
  const keys = missionDependencyKeys(plan.nodes, "synthesis");
  assert.ok(keys.includes("market"));
  assert.ok(keys.includes("gtm"));
  assert.ok(!keys.includes("synthesis"));
  const output = "渠道建议\n" + "正文".repeat(2600) + "\n验证动作：测试复购率";
  assert.equal(missionOutputText({ kind: "MISSION_NODE_OUTPUT", output }, "short summary"), output);
  assert.match(renderMissionUpstream([{ key: "gtm", agentCode: "marketing_agent", status: "SUCCEEDED", summary: output }]), /验证动作：测试复购率$/);
  assert.equal(missionOutputText({ kind: "MISSION_QA" }, "QA PASS"), "QA PASS");
});
