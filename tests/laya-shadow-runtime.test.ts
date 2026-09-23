import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";

import {
  DecisionIntelligenceKernel,
  LayaJudgmentProvider,
  createDefaultDecisionSpecs,
  createDefaultRulesDecisionEngine,
  runJudgmentShadow,
} from "../src/modules/decision-intelligence";

interface TestRuntime {
  endpoint: string;
  requests: Array<{ method: string; path: string; body: unknown }>;
  close(): Promise<void>;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) return null;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function startRuntime(
  handler: (
    req: IncomingMessage,
    body: unknown
  ) => Promise<{ status?: number; body: unknown }> | { status?: number; body: unknown }
): Promise<TestRuntime> {
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const body = req.method === "POST" ? await readJson(req) : null;
    requests.push({
      method: req.method ?? "GET",
      path: req.url ?? "/",
      body,
    });
    const result = await handler(req, body);
    const payload = JSON.stringify(result.body);
    res.statusCode = result.status ?? 200;
    res.setHeader("content-type", "application/json");
    res.end(payload);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind fake judgment runtime");
  }

  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function buildKernel(provider: LayaJudgmentProvider) {
  const kernel = new DecisionIntelligenceKernel(createDefaultDecisionSpecs());
  kernel.registerEngine(createDefaultRulesDecisionEngine());
  kernel.registerProvider(provider);
  return kernel;
}

test("Laya shadow：BOOLEAN noul 映射正确且 MODEL 仍不能越过 RULES_ONLY", async () => {
  const runtime = await startRuntime(async (_req, body) => {
    const request = body as { questions?: Record<string, unknown> };
    assert.ok(request.questions?.decision);
    return {
      body: {
        model: "laya-rl-agent",
        answers: {
          decision: {
            type: "noul",
            noul: 0.91,
            confidence: 0.91,
            action: { act_probability: 0.88 },
          },
        },
        routing: {
          model: "english",
          repo: "convaiinnovations/laya",
          reason: "test fixture",
        },
        usage: { input_tokens: 14, output_tokens: 0 },
        runtime: {
          status: "ok",
          serviceVersion: "hermes-judgment-runtime/v1",
          provider: "laya",
          providerVersion: "0.3.6",
          loadedModels: ["english"],
        },
      },
    };
  });

  try {
    const provider = new LayaJudgmentProvider({
      endpoint: runtime.endpoint,
      timeoutMs: 1000,
    });
    const kernel = buildKernel(provider);

    const result = await kernel.decideWithProvider(
      {
        decisionKey: "workforce.needs_human",
        specVersion: "v2",
        state: { budgetApproval: true },
        contextRefs: ["test:boolean"],
      },
      provider.key
    );

    assert.equal(result.engineResult.value, true);
    assert.equal(result.engineResult.providerKey, "laya-shadow");
    assert.equal(result.engineResult.providerVersion, "laya@0.3.6/english");
    assert.equal(result.engineResult.confidence, 0.91);
    assert.equal(result.engineResult.distribution?.true, 0.91);
    assert.ok(result.engineResult.reasonCodes.includes("LAYA_ROUTE_ENGLISH"));
    assert.equal(result.policy.action, "ESCALATE_HUMAN");
    assert.equal(runtime.requests.length, 1);
  } finally {
    await runtime.close();
  }
});

test("Laya shadow：CHOICE 只返回允许选项并保持非授权状态", async () => {
  const runtime = await startRuntime(() => ({
    body: {
      model: "laya-rl-agent",
      answers: {
        decision: {
          type: "choice",
          choice: "research_agent",
          probabilities: {
            hermes_pm: 0.05,
            product_agent: 0.05,
            research_agent: 0.8,
            marketing_agent: 0.03,
            ops_agent: 0.02,
            red_team: 0.05,
          },
          confidence: 0.8,
        },
      },
      routing: { model: "typed-decisions", reason: "test fixture" },
    },
  }));

  try {
    const provider = new LayaJudgmentProvider({
      endpoint: runtime.endpoint,
      timeoutMs: 1000,
    });
    const kernel = buildKernel(provider);

    const result = await kernel.decideWithProvider(
      {
        decisionKey: "workforce.route_agent",
        specVersion: "v2",
        state: { taskClass: "RESEARCH" },
        contextRefs: ["test:choice"],
      },
      provider.key
    );

    assert.equal(result.engineResult.value, "research_agent");
    assert.equal(result.engineResult.engine, "MODEL");
    assert.equal(result.policy.action, "ESCALATE_AGENT");
  } finally {
    await runtime.close();
  }
});

test("Laya shadow：分歧不会覆盖 Rules 权威结果", async () => {
  const runtime = await startRuntime(() => ({
    body: {
      model: "laya-rl-agent",
      answers: {
        decision: {
          type: "choice",
          choice: "product_agent",
          probabilities: {
            hermes_pm: 0.02,
            product_agent: 0.9,
            research_agent: 0.03,
            marketing_agent: 0.02,
            ops_agent: 0.01,
            red_team: 0.02,
          },
          confidence: 0.9,
        },
      },
      routing: { model: "english", reason: "test fixture" },
    },
  }));

  try {
    const provider = new LayaJudgmentProvider({ endpoint: runtime.endpoint });
    const kernel = buildKernel(provider);

    const shadow = await runJudgmentShadow(
      kernel,
      {
        decisionKey: "workforce.route_agent",
        specVersion: "v2",
        state: { taskClass: "RESEARCH", needsResearch: true },
        contextRefs: ["test:disagreement"],
      },
      provider.key
    );

    assert.equal(shadow.status, "DISAGREE");
    assert.equal(shadow.authoritative.engineResult.engine, "RULES");
    assert.equal(shadow.authoritativeValue, "research_agent");
    assert.equal(shadow.shadowValue, "product_agent");
    assert.equal(shadow.authoritative.policy.action, "AUTO");
  } finally {
    await runtime.close();
  }
});

test("Laya shadow：Runtime 失败只记录 SHADOW_FAILED，不影响 Rules", async () => {
  const runtime = await startRuntime(() => ({
    status: 503,
    body: { error: "LAYA_RUNTIME_FAILED" },
  }));

  try {
    const provider = new LayaJudgmentProvider({
      endpoint: runtime.endpoint,
      maxConsecutiveFailures: 1,
    });
    const kernel = buildKernel(provider);

    const shadow = await runJudgmentShadow(
      kernel,
      {
        decisionKey: "workforce.route_agent",
        specVersion: "v2",
        state: { taskClass: "PRODUCT" },
        contextRefs: ["test:runtime-fail"],
      },
      provider.key
    );

    assert.equal(shadow.status, "SHADOW_FAILED");
    assert.equal(shadow.authoritativeValue, "product_agent");
    assert.equal(shadow.shadow, null);
    assert.match(shadow.shadowError ?? "", /HTTP 503/);
  } finally {
    await runtime.close();
  }
});

test("Laya shadow：连续失败后熔断，熔断期间不再触发网络调用", async () => {
  const runtime = await startRuntime(() => ({
    status: 503,
    body: { error: "down" },
  }));

  try {
    let now = 1000;
    const provider = new LayaJudgmentProvider({
      endpoint: runtime.endpoint,
      maxConsecutiveFailures: 2,
      cooldownMs: 10_000,
      now: () => now,
    });

    const spec = createDefaultDecisionSpecs().get(
      "workforce.route_agent",
      "v2"
    );
    const request = {
      decisionKey: "workforce.route_agent",
      specVersion: "v2",
      state: { taskClass: "RESEARCH" },
      contextRefs: [] as string[],
    };

    await assert.rejects(() => provider.evaluate(spec, request), /HTTP 503/);
    await assert.rejects(() => provider.evaluate(spec, request), /HTTP 503/);
    assert.equal(runtime.requests.length, 2);
    assert.equal(provider.isCircuitOpen(), true);

    await assert.rejects(
      () => provider.evaluate(spec, request),
      /circuit is open/
    );
    assert.equal(runtime.requests.length, 2);

    now += 10_001;
    assert.equal(provider.isCircuitOpen(), false);
  } finally {
    await runtime.close();
  }
});

test("Laya shadow：health/version 契约可验证", async () => {
  const runtime = await startRuntime((req) => {
    assert.equal(req.url, "/health");
    return {
      body: {
        status: "ok",
        serviceVersion: "hermes-judgment-runtime/v1",
        provider: "laya",
        providerVersion: "0.3.6",
        loadedModels: ["english", "multilingual"],
      },
    };
  });

  try {
    const provider = new LayaJudgmentProvider({ endpoint: runtime.endpoint });
    const health = await provider.health();
    assert.equal(health.status, "ok");
    assert.equal(health.provider, "laya");
    assert.equal(health.providerVersion, "0.3.6");
    assert.deepEqual(health.loadedModels, ["english", "multilingual"]);
  } finally {
    await runtime.close();
  }
});

test("Laya shadow：非法 Runtime payload 在执行前被拒绝", async () => {
  const runtime = await startRuntime(() => ({
    body: {
      model: "laya-rl-agent",
      answers: {
        decision: {
          type: "choice",
          choice: "research_agent",
          probabilities: { research_agent: 1.4 },
          confidence: 0.9,
        },
      },
    },
  }));

  try {
    const provider = new LayaJudgmentProvider({ endpoint: runtime.endpoint });
    const kernel = buildKernel(provider);
    await assert.rejects(
      () =>
        kernel.decideWithProvider(
          {
            decisionKey: "workforce.route_agent",
            specVersion: "v2",
            state: {},
            contextRefs: [],
          },
          provider.key
        ),
      /Invalid Laya probability/
    );
  } finally {
    await runtime.close();
  }
});


test("Laya shadow：超时会失败关闭且不会改写 Rules 结果", async () => {
  const runtime = await startRuntime(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    return {
      body: {
        model: "laya-rl-agent",
        answers: {
          decision: {
            type: "choice",
            choice: "product_agent",
            probabilities: { product_agent: 1 },
            confidence: 1,
          },
        },
      },
    };
  });

  try {
    const provider = new LayaJudgmentProvider({
      endpoint: runtime.endpoint,
      timeoutMs: 100,
      maxConsecutiveFailures: 1,
    });
    const kernel = buildKernel(provider);

    const shadow = await runJudgmentShadow(
      kernel,
      {
        decisionKey: "workforce.route_agent",
        specVersion: "v2",
        state: { taskClass: "RESEARCH" },
        contextRefs: ["test:timeout"],
      },
      provider.key
    );

    assert.equal(shadow.status, "SHADOW_FAILED");
    assert.equal(shadow.authoritativeValue, "research_agent");
    assert.equal(shadow.shadow, null);
    assert.equal(provider.isCircuitOpen(), true);
  } finally {
    await runtime.close();
  }
});


test("Laya shadow：CHOICE selected value 必须存在于 probability map", async () => {
  const runtime = await startRuntime(() => ({
    body: {
      model: "laya-rl-agent",
      answers: {
        decision: {
          type: "choice",
          choice: "research_agent",
          probabilities: { product_agent: 1 },
          confidence: 1,
        },
      },
      routing: { model: "english", reason: "inconsistent fixture" },
    },
  }));

  try {
    const provider = new LayaJudgmentProvider({ endpoint: runtime.endpoint });
    const kernel = buildKernel(provider);
    await assert.rejects(
      () =>
        kernel.decideWithProvider(
          {
            decisionKey: "workforce.route_agent",
            specVersion: "v2",
            state: {},
            contextRefs: [],
          },
          provider.key
        ),
      /selected choice missing/
    );
  } finally {
    await runtime.close();
  }
});
