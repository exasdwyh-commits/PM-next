import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { abortableDelay } from "../src/shared/abort";
import { ExecutionStoppedError } from "../src/modules/worker/claim";
import { connectorTools } from "../src/modules/connectors/runtime";
import { McpHttpClient, safeTransport } from "../src/modules/connectors/mcp-client";
import { toToolSpecs } from "../src/modules/connectors/policy";
import { ModelGateway, ModelRegistry, InMemoryModelHealthStore, ModelProviderError, type ModelPolicy, type ModelProfile } from "../src/modules/model-gateway";
import { runToolLoop } from "../src/modules/supervisor/tools";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
const profile: ModelProfile = { id: "abort", provider: "fixture", modelId: "fixture", displayName: "fixture", enabled: true, capabilities: ["TEXT"], locality: "LOCAL", health: "HEALTHY", qualityTier: "FAST", latencyTier: "FAST", costTier: "FREE" };
const policy: ModelPolicy = { id: "abort", version: "1", taskClass: "QUICK_RESEARCH", candidates: [{ profileId: profile.id, priority: 0 }], requiredCapabilities: ["TEXT"], cloudAllowed: false, failurePolicy: { failureThreshold: 2, cooldownMs: 1000, rateLimitRetries: 1, rateLimitMaxWaitMs: 5000 } };

test("EA1: abort rate-limit wait without retrying or charging another attempt", { timeout: 5000 }, async () => {
  const registry = new ModelRegistry(); registry.registerProfile(profile);
  let attempts = 0;
  registry.registerProvider({ provider: profile.provider, execute: async () => { attempts++; throw new ModelProviderError("rate limit", "RATE_LIMIT", 429, 4000); } });
  const waiting = deferred();
  const gateway = new ModelGateway(registry, undefined, Date.now, (ms, signal) => { waiting.resolve(); return abortableDelay(ms, signal); });
  const controller = new AbortController();
  const result = gateway.execute(policy, { signal: controller.signal, taskClass: policy.taskClass, messages: [{ role: "user", content: "test" }] });
  const rejected = assert.rejects(result, ExecutionStoppedError);
  await waiting.promise; controller.abort(new ExecutionStoppedError()); await rejected;
  assert.equal(attempts, 1);
});

test("EA2: fresh admission rejection never calls provider or damages health", async () => {
  const registry = new ModelRegistry(); registry.registerProfile(profile);
  let calls = 0;
  registry.registerProvider({ provider: profile.provider, execute: async () => { calls++; return { text: "unreachable" }; } });
  const health = new InMemoryModelHealthStore();
  await assert.rejects(new ModelGateway(registry, health).execute(policy, { taskClass: policy.taskClass, messages: [], beforeAttempt: async () => { throw new ExecutionStoppedError(); } }), ExecutionStoppedError);
  assert.equal(calls, 0);
  assert.equal(await health.get(profile.id), null);
});

test("EA3: connector revocation during credential wait prevents any remote transport", async () => {
  const credentials = deferred(); const entered = deferred();
  let active = true; let requests = 0;
  const tools = connectorTools([{ id: "c", name: "fixture", slug: "fixture", url: "https://fixture.invalid/mcp", tools: toToolSpecs([{ name: "list_items", annotations: { readOnlyHint: true } }]) }], {
    owner: { userId: "u", organizationId: "o" }, taskRef: "t", runId: "r",
    assertActive: async () => { if (!active) throw new ExecutionStoppedError(); },
    inject: async () => { entered.resolve(); await credentials.promise; return null; },
    transport: async () => { requests++; throw new Error("unreachable transport"); },
  });
  const call = tools[0].run({}, { organizationId: "o" });
  const rejected = assert.rejects(call, ExecutionStoppedError);
  await entered.promise; active = false; credentials.resolve(); await rejected;
  assert.equal(requests, 0);
});

test("EA4: in-flight MCP HTTP aborts and never sends follow-up initialize or tools/call", { timeout: 5000 }, async () => {
  const entered = deferred(); const disconnected = deferred();
  let requests = 0;
  const server = createServer((req, res) => {
    requests++; req.resume();
    req.on("end", () => { entered.resolve(); });
    res.on("close", () => disconnected.resolve());
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const host = `127.0.0.1:${address.port}`;
  const controller = new AbortController();
  try {
    const client = new McpHttpClient(`http://${host}/mcp`, safeTransport({ allowHosts: [host] }), {}, controller.signal);
    const result = client.callTool("list_items", {});
    const rejected = assert.rejects(result, /abort/i);
    await entered.promise; controller.abort(new ExecutionStoppedError()); await rejected;
    await disconnected.promise; assert.equal(requests, 1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("EA5: cancel after model responds blocks the selected tool and next model iteration", async () => {
  const controller = new AbortController(); let tools = 0; let models = 0;
  await assert.rejects(runToolLoop({
    messages: [{ role: "user", content: "test" }], ctx: { organizationId: "o", signal: controller.signal },
    invoke: async () => { models++; controller.abort(new ExecutionStoppedError()); return { text: '{"tool":"read","input":{}}', provenance: { modelId: "fixture", provider: "fixture", modelRunId: null } }; },
    tools: [{ name: "read", label: "read", description: "read", risk: "read", inputHint: "{}", run: async () => { tools++; return { ok: true, output: "unreachable" }; } }],
  }), ExecutionStoppedError);
  assert.equal(models, 1); assert.equal(tools, 0);
});
