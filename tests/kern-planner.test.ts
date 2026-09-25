import assert from "node:assert/strict";
import test from "node:test";
import {
  buildKernPlannerMessages,
  parseKernPlannerIntent,
} from "../src/modules/assistant-runtime/planner";

test("Kern planner accepts only whitelisted read/governed intents", () => {
  assert.equal(
    parseKernPlannerIntent('{"intent":"WORKSPACE_STATUS"}'),
    "WORKSPACE_STATUS"
  );
  assert.equal(
    parseKernPlannerIntent('```json\n{"intent":"KNOWLEDGE_SEARCH"}\n```'),
    "KNOWLEDGE_SEARCH"
  );
  assert.equal(parseKernPlannerIntent('{"intent":"DESKTOP_EXECUTION"}'), null);
  assert.equal(parseKernPlannerIntent('{"intent":"PROPOSE_FIELD_CHANGE"}'), null);
  assert.equal(parseKernPlannerIntent('{"intent":"DROP_DATABASE"}'), null);
  assert.equal(parseKernPlannerIntent("not-json"), null);
});

test("Kern planner prompt makes execution and write boundaries explicit", () => {
  const messages = buildKernPlannerMessages({
    text: "帮我看看这件事该怎么推进",
    productBound: true,
    history: [
      { role: "USER", content: "这是 AKK 产品" },
      { role: "ASSISTANT", content: "已绑定产品上下文" },
    ],
  });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /DESKTOP_EXECUTION/);
  assert.match(messages[0].content, /PROPOSE_/);
  assert.match(messages[0].content, /UNSUPPORTED/);
  assert.match(messages[1].content, /AKK 产品/);
  assert.match(messages[1].content, /当前会话是否绑定产品：是/);
});
