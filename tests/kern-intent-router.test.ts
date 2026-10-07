import assert from "node:assert/strict";
import test from "node:test";
import { isPastedContent, routeIntent } from "../src/modules/assistant-runtime/router";
import { decideMissionLaunch } from "../src/modules/supervisor/plan";

const MINUTES = [
  "帮我把这份会议纪要整理成行动项",
  "1. 本周决定：Q4 预算冻结，新项目一律暂停审批",
  "2. 产品线：饮水机版本 2.1 上市时间待定，今天没有结论",
  "3. 待办：张三下周给出供应商报价；李四跟进合规备案",
].join("\n");

test("R-03 pasted content is recognised by length / lines / bullets", () => {
  assert.equal(isPastedContent("本周有什么待办"), false);
  assert.equal(isPastedContent(MINUTES), true);
  assert.equal(isPastedContent("- 一条\n- 两条"), true);
  assert.equal(isPastedContent("一".repeat(160)), true);
});

test("R-03 long pasted text is not hijacked by status keywords; short queries still are", () => {
  assert.equal(routeIntent("本周有什么待办", false), "WORKSPACE_STATUS");
  assert.equal(routeIntent("有什么待我决定的", false), "PENDING_DECISIONS");
  // 纪要里满是「决定 / 产品 / 本周 / 待办」，但它是内容，不是查询
  assert.equal(routeIntent(MINUTES, false), "UNSUPPORTED");
  assert.equal(routeIntent(MINUTES, true), "UNSUPPORTED");
  // 明确指令写在开头仍然生效
  assert.equal(routeIntent("挑战我的判断：下面这个方案哪里最脆弱？\n" + MINUTES, true), "CHALLENGE_THESIS");
  assert.equal(routeIntent("我想开发一款便携冷萃机\n" + MINUTES, false), "NEW_PRODUCT_INTAKE");
  // 关键词埋在正文里、不在开头一句 → 不算指令
  assert.equal(routeIntent("下面是周报。\n" + MINUTES + "\n另外请复核一下数字。", false), "UNSUPPORTED");
});

test("R-03 challenge without a bound product goes to the red-team mission instead of a refusal", () => {
  const collab = { mode: "RED_TEAM" } as unknown as Parameters<typeof decideMissionLaunch>[0]["collaboration"];
  const text = "挑战我的判断：便携冷萃机进办公室市场哪里最脆弱？";
  assert.equal(decideMissionLaunch({ text, intent: "CHALLENGE_THESIS", collaboration: collab, productBound: true }).reason, "DEDICATED_TOOL_ANSWERED");
  assert.equal(decideMissionLaunch({ text, intent: "CHALLENGE_THESIS", collaboration: collab }).reason, "DEDICATED_TOOL_ANSWERED");
  const unbound = decideMissionLaunch({ text, intent: "CHALLENGE_THESIS", collaboration: collab, productBound: false });
  assert.equal(unbound.launch, true);
  assert.equal(unbound.playbook, "GENERIC");
});

// Browser regression: mentioning a forbidden task creation is not consent to write.
test("negative task creation does not hijack a read-only knowledge request", () => {
  assert.equal(routeIntent("查一下公司知识库的渠道政策，不要创建任务或执行写操作。", false), "KNOWLEDGE_SEARCH");
  assert.equal(routeIntent("查一下公司知识库，别自动创建任务 核对渠道", false), "KNOWLEDGE_SEARCH");
  assert.equal(routeIntent("创建任务 核对渠道政策", false), "PROPOSE_CREATE_WORK_ITEM");
});
