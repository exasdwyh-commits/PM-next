import assert from "node:assert/strict";
import test from "node:test";
import {
  assessChatProposalAutonomy,
  assessKernCapabilityRisk,
  shouldAutoApplyChatProposal,
} from "../src/modules/assistant-runtime/autonomy";

test("explicit low-risk internal chat writes auto-execute", () => {
  for (const [intent, actionType] of [
    ["PROPOSE_FIELD_CHANGE", "UPDATE_FIELD"],
    ["PROPOSE_CREATE_WORK_ITEM", "CREATE_WORK_ITEM"],
    ["NEW_PRODUCT_INTAKE", "CREATE_PRODUCT"],
  ] as const) {
    const assessment = assessChatProposalAutonomy({ intent, actionType });
    assert.equal(assessment.decision, "AUTO");
    assert.equal(shouldAutoApplyChatProposal({ intent, actionType }), true);
  }
});

test("ambiguous targets ask instead of guessing", () => {
  const assessment = assessChatProposalAutonomy({
    intent: "PROPOSE_CREATE_WORK_ITEM",
    actionType: "CREATE_WORK_ITEM",
    targetResolved: false,
  });
  assert.equal(assessment.decision, "ASK");
  assert.ok(assessment.reasons.includes("AMBIGUOUS_TARGET"));
});

test("protected capability dimensions require a human gate", () => {
  for (const partial of [
    { financialImpact: true },
    { externalSideEffect: true },
    { permissionSensitive: true },
    { productionRelease: true },
    { formalBusinessGate: true },
    { destructive: true },
  ]) {
    const assessment = assessKernCapabilityRisk({
      capability: "test.protected",
      explicitUserInstruction: true,
      targetResolved: true,
      reversibility: "REVERSIBLE",
      externalSideEffect: false,
      financialImpact: false,
      permissionSensitive: false,
      productionRelease: false,
      formalBusinessGate: false,
      destructive: false,
      ...partial,
    });
    assert.equal(assessment.decision, "ASK");
  }
});

test("unknown proposal actions remain gated by default", () => {
  assert.equal(
    shouldAutoApplyChatProposal({
      intent: "PROPOSE_FIELD_CHANGE",
      actionType: "CREATE_REVISION",
    }),
    false
  );
});
