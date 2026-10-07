import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { executePersistedModelGateway, type ModelPolicy, type ModelProfile } from "../src/modules/model-gateway";
import { ExecutionStoppedError } from "../src/modules/worker/claim";

async function main() {
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID();
  const org = await prisma.organization.create({ data: { name: "Model cancellation", code: `MC_${tag}` } });
  let notify!: () => void; const entered = new Promise<void>(resolve => { notify = resolve; });
  let disconnected!: () => void; const closed = new Promise<void>(resolve => { disconnected = resolve; });
  const models: string[] = [];
  let hang = true;
  const server = createServer((req, res) => {
    let body = ""; req.on("data", data => { body += data; });
    req.on("end", () => {
      models.push(JSON.parse(body).model);
      if (hang) { res.on("close", disconnected); notify(); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model: models.at(-1), choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } }));
    });
  });
  const envKey = "MODEL_PROVIDER_CANCEL_FIXTURE_BASE_URL";
  const oldBase = process.env[envKey];
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); assert.ok(address && typeof address !== "string");
    process.env[envKey] = `http://127.0.0.1:${address.port}`;
    const profiles: ModelProfile[] = ["primary", "fallback"].map(name => ({ id: `${tag}-${name}`, provider: "cancel-fixture", modelId: name, displayName: name, enabled: true, capabilities: ["TEXT"], locality: "LOCAL", health: "HEALTHY", qualityTier: "FAST", latencyTier: "FAST", costTier: "FREE" }));
    const policy: ModelPolicy = { id: tag, version: "1", taskClass: "QUICK_RESEARCH", candidates: profiles.map((p, i) => ({ profileId: p.id, priority: i })), requiredCapabilities: ["TEXT"], cloudAllowed: false, failurePolicy: { failureThreshold: 1, cooldownMs: 60_000 } };
    const run = (signal?: AbortSignal) => executePersistedModelGateway({ organizationId: org.id, policy, profiles, request: { signal, taskClass: policy.taskClass, messages: [{ role: "user", content: "cancel fixture" }] } });
    const controller = new AbortController();
    const rejected = assert.rejects(run(controller.signal), ExecutionStoppedError);
    await entered; controller.abort(new ExecutionStoppedError()); await rejected; await closed;
    assert.deepEqual(models, ["primary"], "cancellation cannot launch fallback HTTP");
    const ledger = await prisma.modelRun.findMany({ where: { organizationId: org.id } });
    assert.equal(ledger.length, 1); assert.equal(ledger[0].status, "FAILED");
    assert.ok(ledger[0].finishedAt); assert.match(ledger[0].errorReason!, /取消|接管/);
    hang = false;
    await run();
    assert.deepEqual(models, ["primary", "primary"], "cancellation must not open provider circuit");
    assert.equal(await prisma.modelRun.count({ where: { organizationId: org.id, status: "RUNNING" } }), 0);
    let admissions = 0;
    await assert.rejects(executePersistedModelGateway({ organizationId: org.id, policy, profiles, request: { taskClass: policy.taskClass, messages: [], beforeAttempt: async () => { if (++admissions === 2) throw new ExecutionStoppedError(); } } }), ExecutionStoppedError);
    assert.deepEqual(models, ["primary", "primary"], "stop after quota admission must still prevent transport");
    assert.equal(await prisma.modelRun.count({ where: { organizationId: org.id, status: "RUNNING" } }), 0);
    assert.equal(await prisma.modelRun.count({ where: { organizationId: org.id } }), 3, "admitted but stopped attempt remains auditable");
    console.log("PASS: actual model HTTP aborted, ledger closed, fallback stopped, provider health preserved, final admission rechecked");
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    if (oldBase === undefined) delete process.env[envKey]; else process.env[envKey] = oldBase;
    await prisma.modelRun.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
