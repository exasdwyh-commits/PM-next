import assert from "node:assert/strict";
import test from "node:test";
import { shouldAutoApplyChatProposal } from "../src/modules/assistant-runtime/autonomy";

test("explicit low-risk chat writes do not ask for duplicate approval", () => {
  assert.equal(
    shouldAutoApplyChatProposal({
      intent: "PROPOSE_FIELD_CHANGE",
      actionType: "UPDATE_FIELD",
    }),
    true
  );
  assert.equal(
    shouldAutoApplyChatProposal({
      intent: "PROPOSE_CREATE_WORK_ITEM",
      actionType: "CREATE_WORK_ITEM",
    }),
    true
  );
  assert.equal(
    shouldAutoApplyChatProposal({
      intent: "NEW_PRODUCT_INTAKE",
      actionType: "CREATE_PRODUCT",
    }),
    true
  );
});

test("unrelated or protected proposal paths remain gated", () => {
  assert.equal(
    shouldAutoApplyChatProposal({
      intent: "CHALLENGE_THESIS",
      actionType: "UPDATE_FIELD",
    }),
    false
  );
  assert.equal(
    shouldAutoApplyChatProposal({
      intent: "PROPOSE_FIELD_CHANGE",
      actionType: "CREATE_REVISION",
    }),
    false
  );
});
