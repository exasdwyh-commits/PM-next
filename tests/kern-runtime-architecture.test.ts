import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("Kern owns the primary conversation lifecycle", () => {
  const service = read("src/modules/assistant-runtime/service.ts");
  const engine = read("src/modules/assistant-runtime/conversation-engine.ts");
  const messagesRoute = read("src/app/api/conversations/[id]/messages/route.ts");
  const conversationsRoute = read("src/app/api/conversations/route.ts");

  assert.equal(
    service.includes("sendLegacyAdvisorMessage"),
    false,
    "primary Kern service must not delegate the whole turn to legacy Advisor"
  );
  assert.ok(
    service.includes("executeKernConversationTurn"),
    "Kern service must invoke its own conversation engine"
  );
  assert.ok(
    engine.includes('runtimeOwner: "KERN_ASSISTANT"'),
    "AgentRun context must record Kern as the runtime owner"
  );
  assert.ok(
    engine.includes('capabilityProvider: "LEGACY_ADVISOR_COMPAT"'),
    "remaining Advisor dependency must be explicitly marked as compatibility provider"
  );
  assert.equal(
    messagesRoute.includes("@/modules/advisor/service"),
    false,
    "conversation message API must not import legacy Advisor directly"
  );
  assert.equal(
    conversationsRoute.includes("@/modules/advisor/service"),
    false,
    "conversation CRUD API must not import legacy Advisor directly"
  );
});

test("Kern Chat view model is conversation-first, not mission/today dashboard-first", () => {
  const types = read("src/app/muse/types.ts");
  const readModel = read("src/modules/muse/read-model.ts");
  const client = read("src/app/muse/muse-client.tsx");

  for (const stale of [
    "interface Mission",
    "activeMissionId",
    "TodayBrief",
    "missionId:",
    "brief.missions",
  ]) {
    assert.equal(
      types.includes(stale) || readModel.includes(stale) || client.includes(stale),
      false,
      `stale dashboard semantic returned: ${stale}`
    );
  }

  assert.ok(types.includes("interface ConversationSummary"));
  assert.ok(types.includes("activeConversationId"));
  assert.ok(readModel.includes("conversationSummaries"));
  assert.equal(
    readModel.includes("getWorkspaceOverview(session)"),
    false,
    "Kern chat read model must not preload the management dashboard"
  );
});

test("autonomy is risk-based and Project Map is a first-class visual capability", () => {
  const autonomy = read("src/modules/assistant-runtime/autonomy.ts");
  const projectMap = read("src/modules/visual-intelligence/project-map-builder.ts");

  for (const dimension of [
    "reversibility",
    "externalSideEffect",
    "financialImpact",
    "permissionSensitive",
    "productionRelease",
    "formalBusinessGate",
    "destructive",
  ]) {
    assert.ok(autonomy.includes(dimension), `missing autonomy risk dimension: ${dimension}`);
  }

  assert.ok(projectMap.includes("buildProjectArchitectureGraph"));
  assert.ok(projectMap.includes("toArchifyArchitectureSpec"));
  assert.ok(projectMap.includes('"VERIFIED"'));
});
