import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { executeLegacyAdvisorModel, executePersistedModelGateway, ModelExecutionBudgetError, type ModelPolicy, type ModelProfile } from "../src/modules/model-gateway";
import { getUsage, UsageLimitError } from "../src/modules/usage";
import { costFromModelRuns } from "../src/modules/supervisor/metrics";
import { refreshMissionMetrics, toJson } from "../src/modules/supervisor/service";
import { buildNewProductMissionPlan, initialMissionState } from "../src/modules/supervisor/plan";
import { generateProfessionalAnalysisDraft } from "../src/modules/product-development/professional-analysis";
import { ExecutionStoppedError } from "../src/modules/worker/claim";

async function main() {
  await assertTestDatabaseSafety(prisma);
  const org = await prisma.organization.create({ data: { name: "Model facts regression", code: `MF_${randomUUID()}` } });
  const user = await prisma.user.create({ data: { organizationId: org.id, name: "Model facts", email: `${randomUUID()}@hermes.test` } });
  const agent = await prisma.agent.create({ data: { organizationId: org.id, name: "Facts", code: "facts", roleKey: "facts" } });
  const keys = ["ADVISOR_LLM_ENABLED", "ADVISOR_MODEL_PROVIDER", "ADVISOR_MODEL_ID", "ADVISOR_LLM_BASE_URL", "ADVISOR_LLM_API_KEY", "ADVISOR_LLM_TIMEOUT_MS", "KERN_LIMIT_MODEL_CALLS_PER_MONTH", "KERN_MODEL_BUDGET_ATTEMPTS", "KERN_MODEL_BUDGET_MS", "MODEL_PROVIDER_FACTS_BASE_URL"];
  const old = new Map(keys.map(key => [key, process.env[key]]));
  let requests = 0;
  let mode = "ok";
  let disconnected!: () => void;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", data => { body += data; });
    req.on("end", () => {
      requests++;
      if (mode === "hang") { res.once("close", () => disconnected()); return; }
      if (mode === "fail") { res.writeHead(503); res.end('{"error":"fixture unavailable"}'); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model: JSON.parse(body).model, choices: [{ message: { content: "fixture result" } }],
        ...(mode === "missing" ? {} : { usage: mode === "invalid" ? { prompt_tokens: -1, completion_tokens: 1.5, total_tokens: "12" } : { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } }),
      }));
    });
  });
  const ledger = () => prisma.modelRun.findMany({ where: { organizationId: org.id }, orderBy: { createdAt: "asc" } });
  const clear = () => prisma.modelRun.deleteMany({ where: { organizationId: org.id } });
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    process.env.ADVISOR_LLM_ENABLED = "true";
    delete process.env.ADVISOR_MODEL_PROVIDER; // compatibility default must remain usable
    process.env.ADVISOR_MODEL_ID = "legacy-fixture";
    process.env.ADVISOR_LLM_BASE_URL = baseUrl;
    process.env.ADVISOR_LLM_API_KEY = "fixture-secret-never-persist";
    process.env.ADVISOR_LLM_TIMEOUT_MS = "1000";
    delete process.env.KERN_LIMIT_MODEL_CALLS_PER_MONTH;
    delete process.env.KERN_MODEL_BUDGET_ATTEMPTS;
    delete process.env.KERN_MODEL_BUDGET_MS;
    const legacy = (beforeAttempt?: () => Promise<void>) => executeLegacyAdvisorModel({ organizationId: org.id, source: "facts.test", taskClass: "ASSISTANT_DIALOGUE", messages: [{ role: "user", content: "request content must not persist" }], beforeAttempt });

    console.log("▶ MF1: legacy configuration executes through gateway with truthful provenance");
    const result = await legacy();
    let rows = await ledger();
    assert.equal(requests, 1); assert.equal(rows.length, 1);
    assert.equal(rows[0].id, result.modelRunId); assert.equal(rows[0].provider, "openai-compatible");
    assert.equal(rows[0].transportKnown, true); assert.ok(rows[0].transportStartedAt);
    assert.ok(rows[0].logicalCallId); assert.equal(rows[0].status, "SUCCEEDED");
    assert.deepEqual(result.usage, { promptTokens: 4, completionTokens: 2, totalTokens: 6 });
    assert.ok(!JSON.stringify(rows).includes("fixture-secret"));
    assert.ok(!JSON.stringify(rows).includes("request content must not persist"));
    const cost = costFromModelRuns(rows);
    assert.equal(cost.modelCalls, 1); assert.equal(cost.logicalCalls, 1); assert.equal(cost.actualAttempts, 1); assert.equal(cost.successfulAttempts, 1); assert.equal(cost.tokens, 6);

    console.log("▶ MF2: unsent cancellation releases quota; a failed HTTP request consumes it");
    await clear(); requests = 0; process.env.KERN_LIMIT_MODEL_CALLS_PER_MONTH = "1";
    let gates = 0;
    await assert.rejects(legacy(async () => { if (++gates === 2) throw new ExecutionStoppedError(); }), ExecutionStoppedError);
    assert.equal(requests, 0); rows = await ledger(); assert.equal(rows.length, 1);
    assert.equal(rows[0].transportStartedAt, null); assert.equal(rows[0].status, "FAILED");
    assert.equal((await getUsage(org.id)).used.modelCalls, 0);
    mode = "fail"; await assert.rejects(legacy());
    assert.equal(requests, 1); assert.equal((await getUsage(org.id)).used.modelCalls, 1);
    await assert.rejects(legacy(), UsageLimitError); assert.equal(requests, 1);
    rows = await ledger(); assert.equal(costFromModelRuns(rows).actualAttempts, 1);
    assert.equal(costFromModelRuns(rows).tokens, null, "failed remote attempts have unknown usage");

    console.log("▶ MF3: missing and invalid usage never becomes fabricated tokens; historical transport stays unknown");
    await clear(); delete process.env.KERN_LIMIT_MODEL_CALLS_PER_MONTH;
    mode = "missing"; assert.equal((await legacy()).usage, null);
    mode = "invalid"; assert.equal((await legacy()).usage, null);
    mode = "ok"; await legacy(); rows = await ledger();
    assert.equal(costFromModelRuns(rows).tokens, null); assert.equal(costFromModelRuns(rows).knownTokens, 6);
    await prisma.modelRun.update({ where: { id: rows[0].id }, data: { transportKnown: false } });
    rows = await ledger(); assert.equal(costFromModelRuns(rows).actualAttempts, null);
    assert.equal(costFromModelRuns(rows).unknownTransportAttempts, 1);
    await prisma.modelRun.update({ where: { id: rows[0].id }, data: { logicalCallId: null } });
    assert.equal(costFromModelRuns(await ledger()).logicalCalls, null, "historical retries must not be invented as distinct logical calls");
    assert.equal((await getUsage(org.id)).used.unknownModelAttempts, 1);

    console.log("▶ MF4: concurrent sibling runs share one persisted task budget");
    await clear(); mode = "ok"; requests = 0;
    process.env.KERN_MODEL_BUDGET_ATTEMPTS = "1";
    const parent = await prisma.agentTask.create({ data: { organizationId: org.id, agentId: agent.id, goal: "Budget parent" } });
    const children = await Promise.all([0, 1].map(i => prisma.agentTask.create({ data: { organizationId: org.id, agentId: agent.id, parentTaskId: parent.id, goal: `Budget child ${i}` } })));
    const runs = await Promise.all(children.map(task => prisma.agentRun.create({ data: { organizationId: org.id, userId: user.id, agentTaskId: task.id, goal: task.goal } })));
    const call = (agentRunId: string) => executeLegacyAdvisorModel({ organizationId: org.id, agentRunId, source: "facts.test", taskClass: "PRODUCT_ANALYSIS", messages: [{ role: "user", content: "task budget" }] });
    const settled = await Promise.allSettled(runs.map(run => call(run.id)));
    assert.equal(settled.filter(r => r.status === "fulfilled").length, 1);
    const failure = settled.find(r => r.status === "rejected"); assert.ok(failure && failure.status === "rejected" && failure.reason instanceof ModelExecutionBudgetError);
    assert.equal(requests, 1); rows = await ledger(); assert.equal(rows[0].budgetScopeKey, `task:${parent.id}`);
    process.env.KERN_MODEL_BUDGET_ATTEMPTS = "10";
    await assert.rejects(call(runs[0].id), ModelExecutionBudgetError); assert.equal(requests, 1, "changing settings cannot silently increase a running budget");

    console.log("▶ MF5: elapsed budget aborts hanging HTTP without fallback; subsequent model admission remains healthy");
    await clear(); requests = 0; mode = "hang"; process.env.KERN_MODEL_BUDGET_MS = "200";
    const profiles: ModelProfile[] = ["primary", "backup"].map(name => ({ id: `facts-${name}-${org.id}`, provider: "facts", modelId: name, displayName: name, enabled: true, health: "HEALTHY", capabilities: ["TEXT"], locality: "LOCAL", qualityTier: "FAST", latencyTier: "FAST", costTier: "FREE" }));
    const policy: ModelPolicy = { id: "facts", version: "1", taskClass: "QUICK_RESEARCH", candidates: profiles.map((p, priority) => ({ profileId: p.id, priority })), cloudAllowed: false, requiredCapabilities: ["TEXT"], failurePolicy: { failureThreshold: 1, cooldownMs: 60_000 } };
    process.env.MODEL_PROVIDER_FACTS_BASE_URL = baseUrl;
    const execute = () => executePersistedModelGateway({ organizationId: org.id, agentRunId: runs[0].id, profiles, policy, request: { taskClass: policy.taskClass, messages: [] } });
    const closed = new Promise<void>(resolve => { disconnected = resolve; });
    const started = Date.now(); await assert.rejects(execute(), ModelExecutionBudgetError);
    await Promise.race([closed, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error("HTTP remained open")), 1000); timer.unref(); })]);
    assert.ok(Date.now() - started < 2000); assert.equal(requests, 1, "budget cannot start fallback");
    rows = await ledger(); assert.equal(rows[0].status, "FAILED"); assert.equal(rows[0].budgetMaxAttempts, 10);
    await assert.rejects(execute(), ModelExecutionBudgetError); assert.equal(requests, 1, "persisted elapsed budget rejects later calls");
    await clear(); mode = "ok"; delete process.env.KERN_MODEL_BUDGET_MS;
    await execute(); assert.equal(requests, 2); assert.equal((await ledger())[0].profileKey, profiles[0].id, "budget abort must not open provider circuit");
    console.log("▶ MF6: professional analysis shares ledger; invalid model output stays unaccepted");
    await clear(); mode = "ok";
    const draft = await generateProfessionalAnalysisDraft({
      session: { organizationId: org.id, userId: user.id, userName: user.name, userEmail: user.email },
      productId: "fixture-product", productVersionId: "fixture-version", agentRunId: runs[0].id,
      context: { companyBrief: null, productVersion: null, knowledge: { query: "fixture", citations: [], facts: [] },
        evidence: [], costScenarios: [], decisions: [], citationWhitelist: [], inputFingerprint: "fixture",
        truncations: [], totalChars: 0 },
    });
    assert.equal(draft.isLLMGenerated, false); assert.match(draft.failureReason ?? "", /无法解析/);
    rows = await ledger(); assert.equal(rows.length, 1); assert.equal(rows[0].taskClass, "PRODUCT_ANALYSIS");
    assert.equal(rows[0].status, "SUCCEEDED", "transport success is separate from business output acceptance");
    assert.equal(costFromModelRuns(rows).actualAttempts, 1); assert.equal(costFromModelRuns(rows).tokens, 6);
    console.log("▶ MF7: mission metrics read its real attempt ledger, excluding unrelated dialogue");
    const plan = buildNewProductMissionPlan("Model facts fixture");
    await prisma.agentTask.update({ where: { id: parent.id }, data: { contextSnapshot: toJson({
      schemaVersion: "kern-mission/v1", plan, state: initialMissionState(plan),
      conversationId: null, sourceRunId: null, requestedByUserId: user.id, log: [], outcome: null,
    }) } });
    await legacy();
    assert.equal((await ledger()).length, 2);
    const missionMetrics = await refreshMissionMetrics(org.id, parent.id);
    assert.ok(missionMetrics); assert.equal(missionMetrics.cost.actualAttempts, 1);
    assert.equal(missionMetrics.cost.logicalCalls, 1); assert.equal(missionMetrics.cost.successfulAttempts, 1);
    assert.equal(missionMetrics.cost.tokens, 6); assert.equal(missionMetrics.completed, false);
    const persisted = await prisma.agentTask.findUniqueOrThrow({ where: { id: parent.id } });
    assert.deepEqual((persisted.contextSnapshot as { metrics?: unknown }).metrics, missionMetrics);
    assert.equal(await refreshMissionMetrics(randomUUID(), parent.id), null, "another organization cannot refresh this task");
    console.log("▶ MF8: already elapsed task time blocks its very first model request");
    await clear(); requests = 0; process.env.KERN_MODEL_BUDGET_MS = "1000";
    await prisma.agentTask.update({ where: { id: parent.id }, data: { startedAt: new Date(Date.now() - 5000) } });
    await assert.rejects(call(runs[0].id), ModelExecutionBudgetError);
    assert.equal(requests, 0); assert.equal((await ledger()).length, 0);
    console.log("PASS MF1–MF8: legacy metered, unsent slots released, token provenance honest, sibling budget atomic, timeout stops transport");
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    for (const [key, value] of old) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await prisma.modelRun.deleteMany({ where: { organizationId: org.id } });
    await prisma.agentRun.deleteMany({ where: { organizationId: org.id } });
    await prisma.agentTask.deleteMany({ where: { organizationId: org.id } });
    await prisma.agent.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
