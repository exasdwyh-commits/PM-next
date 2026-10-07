import assert from "node:assert/strict";
import test from "node:test";
import { sendDepartmentAssistantMessage } from "../src/modules/assistant-runtime/service";
import { executeKernConversationTurn } from "../src/modules/assistant-runtime/conversation-engine";
import { UnprocessableEntityError } from "../src/shared/errors";

const session = { organizationId: "invalid-input-no-db", userId: "no-user", userName: "QA", userEmail: "qa@invalid.test" };

for (const [label, input] of [
  ["number", 123], ["object", {}], ["array", []], ["null", null],
  ["missing", undefined], ["empty", ""], ["whitespace", " \n\t "],
] as const) {
  test(`public message entry rejects ${label} before context, model or database work`, async () => {
    await assert.rejects(sendDepartmentAssistantMessage(session, "no-conversation", input as unknown as string), UnprocessableEntityError);
  });
  test(`low-level conversation entry rejects ${label} as invalid input`, async () => {
    await assert.rejects(executeKernConversationTurn(session, "no-conversation", input as unknown as string), UnprocessableEntityError);
  });
}
