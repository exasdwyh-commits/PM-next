import assert from "node:assert/strict";
import test from "node:test";

import {
  ApprovalService,
  ToolBroker,
  ToolBrokerDeniedError,
  computeActionHash,
  type ApprovalGrantRecord,
  type ApprovalGrantStore,
} from "../src/modules/governance";
import {
  IndependentEvidenceVerifier,
  fetchTrustedSource,
} from "../src/modules/evidence";
import {
  LayaDecisionEngine,
  createDefaultDecisionSpecs,
} from "../src/modules/decision-intelligence";
import {
  MODEL_POLICY_PRESETS,
  MODEL_PROFILE_PRESETS,
} from "../src/modules/model-control/presets";

class MemoryApprovalStore implements ApprovalGrantStore {
  rows = new Map<string, ApprovalGrantRecord>();

  async create(
    input: Omit<ApprovalGrantRecord, "usedAt" | "usedByRunId">
  ): Promise<ApprovalGrantRecord> {
    const row: ApprovalGrantRecord = {
      ...input,
      usedAt: null,
      usedByRunId: null,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async find(id: string) {
    return this.rows.get(id) ?? null;
  }

  async consume(id: string, usedByRunId: string, now: Date) {
    const row = this.rows.get(id);
    if (!row || row.usedAt || row.validUntil <= now) return false;
    this.rows.set(id, { ...row, usedAt: now, usedByRunId });
    return true;
  }
}

import crypto from "node:crypto";

const session = {
  userId: "user-1",
  organizationId: "org-1",
  userEmail: "owner@example.com",
  userName: "Owner",
};

test("fusion: protected ToolBroker action requires a signed single-use grant", async () => {
  const store = new MemoryApprovalStore();
  const approvals = new ApprovalService(
    store,
    "fusion-test-secret-abcdefghijklmnopqrstuvwxyz"
  );
  const actionHash = computeActionHash({ branch: "feature/demo", sha: "abc" });
  const grant = await approvals.issue(session, {
    taskRef: "agent-task:1",
    capability: "git.merge",
    resource: "refs/heads/feature/demo",
    actionHash,
    validUntil: new Date(Date.now() + 60_000),
  });

  let calls = 0;
  const broker = new ToolBroker({
    identity: {
      actorId: session.userId,
      organizationId: session.organizationId,
      agentCode: "software_engineer",
      runId: "run-1",
    },
    approvalService: approvals,
    authorizer: () => true,
    tools: {
      merge: async () => {
        calls += 1;
        return "merged";
      },
    },
  });

  const first = await broker.call({
    tool: "merge",
    capability: "git.merge",
    resource: "refs/heads/feature/demo",
    taskRef: "agent-task:1",
    runId: "run-1",
    input: {},
    actionHash,
    approvalGrantId: grant.id,
  });
  assert.equal(first, "merged");

  await assert.rejects(
    () =>
      broker.call({
        tool: "merge",
        capability: "git.merge",
        resource: "refs/heads/feature/demo",
        taskRef: "agent-task:1",
        runId: "run-2",
        input: {},
        actionHash,
        approvalGrantId: grant.id,
      }),
    (error: unknown) =>
      error instanceof ToolBrokerDeniedError &&
      error.reason === "approval-grant-invalid"
  );
  assert.equal(calls, 1);
  assert.equal(typeof (broker as unknown as { register?: unknown }).register, "undefined");
});

test("fusion: forged or mismatched approval cannot authorize another resource", async () => {
  const store = new MemoryApprovalStore();
  const approvals = new ApprovalService(
    store,
    "fusion-test-secret-abcdefghijklmnopqrstuvwxyz"
  );
  const actionHash = computeActionHash({ target: "A" });
  const grant = await approvals.issue(session, {
    taskRef: "agent-task:2",
    capability: "external.send",
    resource: "external:customer-A",
    actionHash,
    validUntil: new Date(Date.now() + 60_000),
  });

  const broker = new ToolBroker({
    identity: {
      actorId: session.userId,
      organizationId: session.organizationId,
      agentCode: "department_assistant",
      runId: "run-x",
    },
    approvalService: approvals,
    authorizer: () => true,
    tools: { send: async () => "sent" },
  });

  await assert.rejects(
    () =>
      broker.call({
        tool: "send",
        capability: "external.send",
        resource: "external:customer-B",
        taskRef: "agent-task:2",
        runId: "run-x",
        input: {},
        actionHash,
        approvalGrantId: grant.id,
      }),
    ToolBrokerDeniedError
  );
});

test("fusion: source fetch rejects private DNS resolution before request", async () => {
  let requests = 0;
  await assert.rejects(
    () =>
      fetchTrustedSource({
        url: "https://www.fda.gov/example",
        resolver: async () => [{ address: "127.0.0.1", family: 4 }],
        request: async () => {
          requests += 1;
          throw new Error("must-not-run");
        },
      }),
    /source-address-not-public/
  );
  assert.equal(requests, 0);
});

test("fusion: official source without claim support remains UNKNOWN", () => {
  const verifier = new IndependentEvidenceVerifier("test-verifier");
  const result = verifier.verifyClaim(
    { claim: "FDA approved product X on September 24 2026.", claimKind: "FACT" },
    [{
      evidenceId: "e1",
      sourceUri: "https://www.fda.gov/",
      httpStatus: 200,
      rawContentPreview: "Welcome to the FDA website.",
    }]
  );
  assert.equal(result.evidenceLevel, "UNKNOWN");
  assert.equal(result.assessments[0]?.supportStatus, "NOT_FOUND");
});

test("fusion: two URLs from the same source organization never become STRONG", () => {
  const verifier = new IndependentEvidenceVerifier();
  const body = "FDA approved product X on September 24 2026.";
  const result = verifier.verifyClaim(
    { claim: body },
    [
      {
        evidenceId: "a",
        sourceUri: "https://fda.gov/a",
        httpStatus: 200,
        rawContentPreview: body,
      },
      {
        evidenceId: "b",
        sourceUri: "https://www.fda.gov/b",
        httpStatus: 200,
        rawContentPreview: body,
      },
    ]
  );
  assert.equal(result.evidenceLevel, "SUPPORTED");
});

test("fusion: Laya adapter is typed, bounded and shadow-only by default", async () => {
  const specs = createDefaultDecisionSpecs();
  const spec = specs.get("assistant.intent");
  assert.equal(spec.automation.autoPolicy, "DISABLED");

  const engine = new LayaDecisionEngine({
    async decide() {
      return {
        value: "RESEARCH",
        confidence: 0.93,
        reasonCodes: ["FRESH_INFO_REQUIRED"],
        latencyMs: 8,
      };
    },
  });
  assert.equal(engine.canHandle(spec), true);
  const result = await engine.decide(spec, {
    decisionKey: "assistant.intent",
    state: { text: "查一下最新法规" },
    contextRefs: [],
    language: "zh-CN",
  });
  assert.equal(result.value, "RESEARCH");
  assert.equal(result.engineVersion.startsWith("laya-system1/"), true);
});

test("fusion: Muse is a disabled local resident resource, not a hard-coded dependency", () => {
  const muse = MODEL_PROFILE_PRESETS.find(
    (profile) => profile.key === "muse-glimmer-resident-slot"
  );
  assert.ok(muse);
  assert.equal(muse.enabled, false);
  assert.equal(muse.locality, "LOCAL");
  assert.equal(muse.provider, "muse-local");
  assert.equal(muse.modelId, "muse-glimmer");

  const assistantPolicies = MODEL_POLICY_PRESETS.filter((policy) =>
    policy.taskClass.startsWith("ASSISTANT_")
  );
  assert.equal(assistantPolicies.length, 3);
  assert.ok(assistantPolicies.every((policy) => policy.cloudAllowed === false));
});
