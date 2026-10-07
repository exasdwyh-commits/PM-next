import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { executePersistedModelGateway, type ModelProfile, type ModelPolicy } from "../src/modules/model-gateway";
import { UsageLimitError } from "../src/modules/usage";

async function main() {
  await assertTestDatabaseSafety(prisma);
  const org = await prisma.organization.create({ data: { name: "Attempt quota test", code: `ATTEMPT_${randomUUID()}` } });
  let mode = "fallback";
  let requests = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      requests++;
      const model = JSON.parse(body).model as string;
      if (mode === "fallback" && model.startsWith("primary")) { res.writeHead(503); res.end('{"error":"unavailable"}'); return; }
      if (mode === "retry" && requests === 1) { res.writeHead(429, { "retry-after": "0" }); res.end('{"error":"rate limit"}'); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model, choices: [{ message: { content: "test response" } }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } }));
    });
  });
  const oldLimit = process.env.KERN_LIMIT_MODEL_CALLS_PER_MONTH;
  const oldBase = process.env.MODEL_PROVIDER_ATTEMPT_TEST_BASE_URL;
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    process.env.MODEL_PROVIDER_ATTEMPT_TEST_BASE_URL = `http://127.0.0.1:${address.port}`;
    const run = (tag: string, retry = false) => {
      const profiles: ModelProfile[] = (retry ? ["primary"] : ["primary", "backup"]).map((name) => ({ id: `${tag}-${name}`, provider: "attempt-test", modelId: `${name}-${tag}`, displayName: name, enabled: true, capabilities: ["TEXT"], locality: "LOCAL", health: "HEALTHY", qualityTier: "BALANCED", latencyTier: "FAST", costTier: "FREE" }));
      const policy: ModelPolicy = { id: tag, version: "1", taskClass: "ASSISTANT_DIALOGUE", candidates: profiles.map((p, i) => ({ profileId: p.id, priority: i })), requiredCapabilities: ["TEXT"], cloudAllowed: false, failurePolicy: { failureThreshold: 2, cooldownMs: 1000, rateLimitRetries: 1, rateLimitMaxWaitMs: 100 } };
      return executePersistedModelGateway({ organizationId: org.id, policy, profiles, request: { taskClass: "ASSISTANT_DIALOGUE", messages: [{ role: "user", content: "quota regression" }] } });
    };
    process.env.KERN_LIMIT_MODEL_CALLS_PER_MONTH = "1";
    await assert.rejects(run("blocked-fallback"), UsageLimitError);
    assert.equal(requests, 1, "quota must stop before the fallback HTTP request");
    assert.equal(await prisma.modelRun.count({ where: { organizationId: org.id } }), 1);
    await prisma.modelRun.deleteMany({ where: { organizationId: org.id } });
    requests = 0; process.env.KERN_LIMIT_MODEL_CALLS_PER_MONTH = "2";
    const result = await run("per-attempt-fallback");
    const rows = await prisma.modelRun.findMany({ where: { organizationId: org.id }, orderBy: { createdAt: "asc" } });
    assert.equal(requests, 2); assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.status), ["FAILED", "SUCCEEDED"]);
    assert.equal(rows[1].id, result.modelRunId);
    assert.ok(rows[1].usageJson);
    assert.ok(rows.every(row => row.transportKnown && row.transportStartedAt));
    assert.ok(rows[0].logicalCallId && rows[0].logicalCallId === rows[1].logicalCallId, "fallback attempts belong to one logical call");
    await prisma.modelRun.deleteMany({ where: { organizationId: org.id } });
    mode = "retry"; requests = 0;
    await run("per-attempt-retry", true);
    assert.equal(requests, 2);
    assert.equal(await prisma.modelRun.count({ where: { organizationId: org.id } }), 2);
    console.log("PASS: fallback blocked at quota; fallback and retry each charge actual attempts; usage persisted");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (oldLimit === undefined) delete process.env.KERN_LIMIT_MODEL_CALLS_PER_MONTH; else process.env.KERN_LIMIT_MODEL_CALLS_PER_MONTH = oldLimit;
    if (oldBase === undefined) delete process.env.MODEL_PROVIDER_ATTEMPT_TEST_BASE_URL; else process.env.MODEL_PROVIDER_ATTEMPT_TEST_BASE_URL = oldBase;
    await prisma.modelRun.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
