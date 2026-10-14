import assert from "node:assert/strict";
import test from "node:test";
import {
  assessChatProposalAutonomy,
  assessKernCapabilityRisk,
  requiresChatUserConfirmation,
  shouldAutoApplyChatProposal,
} from "../src/modules/assistant-runtime/autonomy";
import { applyExplicitChatProposal } from "../src/modules/assistant-runtime/proposal-executor";
import { intakeProposalFeedback } from "../src/modules/assistant-runtime/capabilities/product-write";
import { ActionProposalStatus } from "@prisma/client";

const LOW_RISK_CHAT_WRITES = [
  ["PROPOSE_FIELD_CHANGE", "UPDATE_FIELD"],
  ["PROPOSE_CREATE_WORK_ITEM", "CREATE_WORK_ITEM"],
  ["NEW_PRODUCT_INTAKE", "CREATE_PRODUCT"],
] as const;

test("explicit low-risk internal chat writes keep their AUTO risk level", () => {
  for (const [intent, actionType] of LOW_RISK_CHAT_WRITES) {
    assert.equal(assessChatProposalAutonomy({ intent, actionType }).decision, "AUTO");
  }
});

test("product creation is not a risk escalation: AUTO risk, gated by user confirmation", () => {
  const assessment = assessChatProposalAutonomy({
    intent: "NEW_PRODUCT_INTAKE",
    actionType: "CREATE_PRODUCT",
  });
  assert.equal(assessment.decision, "AUTO");
  assert.deepEqual(assessment.reasons, ["INTERNAL_COMPENSATABLE"]);
  assert.equal(requiresChatUserConfirmation("CREATE_PRODUCT"), true);
  assert.equal(
    shouldAutoApplyChatProposal({
      intent: "NEW_PRODUCT_INTAKE",
      actionType: "CREATE_PRODUCT",
    }),
    false
  );
});

test("confirmation requirement does not spread to the other chat writes", () => {
  assert.equal(requiresChatUserConfirmation("UPDATE_FIELD"), false);
  assert.equal(requiresChatUserConfirmation("CREATE_WORK_ITEM"), false);
  assert.equal(
    shouldAutoApplyChatProposal({ intent: "PROPOSE_FIELD_CHANGE", actionType: "UPDATE_FIELD" }),
    true
  );
  assert.equal(
    shouldAutoApplyChatProposal({ intent: "PROPOSE_CREATE_WORK_ITEM", actionType: "CREATE_WORK_ITEM" }),
    true
  );
});

test("chat auto-execution leaves CREATE_PRODUCT pending instead of writing", async () => {
  // 不会触达数据库：确认门禁在 applyProposal 之前返回。
  const session = {} as never;
  const result = {
    text: "现在还没有创建产品：这条动作停在「待确认」。",
    citations: [{ kind: "proposal", ref: "proposal-1", title: "新建产品: 测试" }],
    proposal: { proposalId: "proposal-1", created: true, actionType: "CREATE_PRODUCT" },
  };

  const out = await applyExplicitChatProposal(session, {
    intent: "NEW_PRODUCT_INTAKE",
    runId: "run-1",
    result,
  });

  assert.equal(out.proposal?.actionType, "CREATE_PRODUCT", "提议必须保持待确认，不能被消费掉");
  assert.equal(out.text, result.text);
  assert.ok(
    !out.citations.some((citation) => citation.kind === "action-receipt"),
    "未确认前不得产生执行回执"
  );
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

test("PENDING_CONFIRMATION intake feedback says not created yet", () => {
  const fb = intakeProposalFeedback("PENDING_CONFIRMATION");
  assert.match(fb.headline, /尚未创建/);
  assert.match(fb.headline, /等待你批准写入/);
});

test("APPLIED intake feedback says already executed, never says not-created", () => {
  const fb = intakeProposalFeedback("APPLIED");
  assert.match(fb.headline, /已执行/);
  assert.match(fb.headline, /本次未重复创建/);
  assert.match(fb.detail, /没有重新核验/);
  assert.doesNotMatch(`${fb.headline}${fb.detail}`, /尚未创建|等待批准|待确认/);
});

test("other real statuses say 本次未创建产品 without assuming pending or created", () => {
  for (const status of ["DRAFT", "REJECTED", "SUPERSEDED", "EXPIRED"] as const) {
    const fb = intakeProposalFeedback(status);
    assert.match(fb.headline, /本次未创建产品/, status);
    assert.doesNotMatch(fb.headline, /尚未创建|等待批准/);
    assert.doesNotMatch(fb.detail, /已创建/);
  }
});

test("unknown or missing status is not assumed to be pending or created", () => {
  for (const status of ["SOMETHING_NEW", null, undefined]) {
    const fb = intakeProposalFeedback(status);
    assert.match(fb.headline, /本次未创建产品/);
    assert.doesNotMatch(fb.headline, /尚未创建|已创建/);
  }
});

test("intake feedback covers every ActionProposalStatus value", () => {
  for (const status of Object.values(ActionProposalStatus)) {
    const fb = intakeProposalFeedback(status);
    assert.ok(fb.headline.trim().length > 0, status);
    assert.ok(fb.detail.trim().length > 0, status);
  }
});
