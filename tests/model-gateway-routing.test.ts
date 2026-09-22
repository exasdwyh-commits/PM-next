import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryModelHealthStore,
  ModelGateway,
  ModelGatewayExecutionError,
  ModelProviderError,
  ModelRegistry,
  selectModelRoute,
  type ModelPolicy,
  type ModelProfile,
  type ModelProviderPlugin,
} from "../src/modules/model-gateway";

const agnes: ModelProfile = {
  id: "agnes-fast",
  provider: "agnes",
  modelId: "agnes-3-flash",
  displayName: "Agnes Flash",
  capabilities: ["TEXT", "TOOLS", "STRUCTURED_OUTPUT"],
  locality: "CLOUD",
  health: "HEALTHY",
  enabled: true,
  qualityTier: "BALANCED",
  latencyTier: "FAST",
  costTier: "FREE",
  contextWindow: 128000,
};

const gpt: ModelProfile = {
  id: "gpt-frontier",
  provider: "openai",
  modelId: "gpt-frontier",
  displayName: "GPT Frontier",
  capabilities: ["TEXT", "TOOLS", "STRUCTURED_OUTPUT", "REASONING", "LONG_CONTEXT"],
  locality: "CLOUD",
  health: "HEALTHY",
  enabled: true,
  qualityTier: "FRONTIER",
  latencyTier: "NORMAL",
  costTier: "PREMIUM",
  contextWindow: 200000,
};

const local: ModelProfile = {
  id: "local-reasoner",
  provider: "local",
  modelId: "local-27b",
  displayName: "Local Reasoner",
  capabilities: ["TEXT", "STRUCTURED_OUTPUT", "REASONING"],
  locality: "LOCAL",
  health: "HEALTHY",
  enabled: true,
  qualityTier: "BALANCED",
  latencyTier: "NORMAL",
  costTier: "FIXED_LOCAL",
  contextWindow: 64000,
};

test("Model Gateway：日常研究策略优先使用低成本快速模型", () => {
  const policy: ModelPolicy = {
    id: "research-balanced",
    version: "1",
    taskClass: "QUICK_RESEARCH",
    candidates: [
      { profileId: "agnes-fast", priority: 1 },
      { profileId: "gpt-frontier", priority: 2 },
    ],
    requiredCapabilities: ["TEXT"],
    cloudAllowed: true,
  };

  const route = selectModelRoute(policy, [gpt, agnes], {
    taskClass: "QUICK_RESEARCH",
    messages: [{ role: "user", content: "整理竞品资料" }],
  });

  assert.equal(route.selected.id, "agnes-fast");
});

test("Model Gateway：战略咨询策略可明确把 Frontier 模型放在第一优先级", () => {
  const policy: ModelPolicy = {
    id: "strategic-frontier",
    version: "1",
    taskClass: "STRATEGIC_CONSULTING",
    candidates: [
      { profileId: "gpt-frontier", priority: 1 },
      { profileId: "agnes-fast", priority: 2 },
    ],
    requiredCapabilities: ["TEXT", "REASONING"],
    cloudAllowed: true,
  };

  const route = selectModelRoute(policy, [agnes, gpt], {
    taskClass: "STRATEGIC_CONSULTING",
    messages: [{ role: "user", content: "评估开品路线" }],
  });

  assert.equal(route.selected.id, "gpt-frontier");
});

test("Model Gateway：任务禁止出云时自动跳过云模型并选择本地模型", () => {
  const policy: ModelPolicy = {
    id: "private-analysis",
    version: "1",
    taskClass: "PRODUCT_ANALYSIS",
    candidates: [
      { profileId: "gpt-frontier", priority: 1 },
      { profileId: "local-reasoner", priority: 2 },
    ],
    requiredCapabilities: ["TEXT", "REASONING"],
    cloudAllowed: true,
  };

  const route = selectModelRoute(policy, [gpt, local], {
    taskClass: "PRODUCT_ANALYSIS",
    cloudAllowed: false,
    messages: [{ role: "user", content: "分析内部新品" }],
  });

  assert.equal(route.selected.id, "local-reasoner");
  assert.ok(route.skipped.some((item) => item.profileId === "gpt-frontier"));
});

test("Model Gateway：Provider 调用失败时只在同一策略候选中回退", async () => {
  const registry = new ModelRegistry();
  registry.registerProfile(agnes);
  registry.registerProfile(gpt);

  const failingAgnes: ModelProviderPlugin = {
    provider: "agnes",
    async execute() {
      throw new Error("temporary provider failure");
    },
  };
  const workingOpenAI: ModelProviderPlugin = {
    provider: "openai",
    async execute(profile) {
      return { text: "deep answer", modelId: profile.modelId, usage: { totalTokens: 42 } };
    },
  };

  registry.registerProvider(failingAgnes);
  registry.registerProvider(workingOpenAI);

  const gateway = new ModelGateway(registry);
  const result = await gateway.execute(
    {
      id: "research-fallback",
      version: "1",
      taskClass: "QUICK_RESEARCH",
      candidates: [
        { profileId: "agnes-fast", priority: 1 },
        { profileId: "gpt-frontier", priority: 2 },
      ],
      requiredCapabilities: ["TEXT"],
      cloudAllowed: true,
    },
    {
      taskClass: "QUICK_RESEARCH",
      messages: [{ role: "user", content: "research" }],
    }
  );

  assert.equal(result.profileId, "gpt-frontier");
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0]?.success, false);
  assert.equal(result.attempts[1]?.success, true);
});

test("Model Gateway：策略内没有满足能力的模型时显式失败", async () => {
  const registry = new ModelRegistry();
  registry.registerProfile(agnes);
  registry.registerProvider({
    provider: "agnes",
    async execute() {
      return { text: "unused" };
    },
  });

  const gateway = new ModelGateway(registry);

  await assert.rejects(
    () =>
      gateway.execute(
        {
          id: "reasoning-only",
          version: "1",
          taskClass: "RED_TEAM",
          candidates: [{ profileId: "agnes-fast", priority: 1 }],
          requiredCapabilities: ["REASONING"],
          cloudAllowed: true,
        },
        {
          taskClass: "RED_TEAM",
          messages: [{ role: "user", content: "challenge" }],
        }
      ),
    ModelGatewayExecutionError
  );
});


test("Model Gateway：限流后进入 cooldown，后续请求直接路由策略内 fallback", async () => {
  let now = 1_000;
  let agnesCalls = 0;
  const registry = new ModelRegistry();
  registry.registerProfile(agnes);
  registry.registerProfile(gpt);
  registry.registerProvider({
    provider: "agnes",
    async execute() {
      agnesCalls += 1;
      throw new ModelProviderError("429 rate limit", "RATE_LIMIT", 429);
    },
  });
  registry.registerProvider({
    provider: "openai",
    async execute(profile) {
      return { text: "fallback", modelId: profile.modelId };
    },
  });

  const health = new InMemoryModelHealthStore(() => now);
  const gateway = new ModelGateway(registry, health, () => now);
  const policy: ModelPolicy = {
    id: "rate-limit-circuit",
    version: "1",
    taskClass: "QUICK_RESEARCH",
    candidates: [
      { profileId: "agnes-fast", priority: 1 },
      { profileId: "gpt-frontier", priority: 2 },
    ],
    requiredCapabilities: ["TEXT"],
    cloudAllowed: true,
    failurePolicy: {
      failureThreshold: 2,
      cooldownMs: 10_000,
      rateLimitCooldownMs: 5_000,
      authCooldownMs: 60_000,
    },
  };
  const request = {
    taskClass: "QUICK_RESEARCH" as const,
    messages: [{ role: "user" as const, content: "research" }],
  };

  const first = await gateway.execute(policy, request);
  assert.equal(first.profileId, "gpt-frontier");
  assert.equal(agnesCalls, 1);
  const snapshot = await health.get("agnes-fast");
  assert.equal(snapshot?.lastFailureKind, "RATE_LIMIT");
  assert.equal(snapshot?.cooldownUntilMs, 6_000);

  const second = await gateway.execute(policy, request);
  assert.equal(second.profileId, "gpt-frontier");
  assert.equal(agnesCalls, 1);
  assert.ok(
    second.routingSkips.some(
      (item) =>
        item.profileId === "agnes-fast" &&
        item.reason.includes("冷却")
    )
  );

  now = 6_001;
  const third = await gateway.execute(policy, request);
  assert.equal(third.profileId, "gpt-frontier");
  assert.equal(agnesCalls, 2);
});

test("Model Gateway：配置错误不允许静默切到策略内付费 fallback", async () => {
  let gptCalls = 0;
  const registry = new ModelRegistry();
  registry.registerProfile(agnes);
  registry.registerProfile(gpt);
  registry.registerProvider({
    provider: "openai",
    async execute() {
      gptCalls += 1;
      return { text: "should not be used" };
    },
  });

  const gateway = new ModelGateway(registry);
  await assert.rejects(
    () =>
      gateway.execute(
        {
          id: "config-fail-closed",
          version: "1",
          taskClass: "QUICK_RESEARCH",
          candidates: [
            { profileId: "agnes-fast", priority: 1 },
            { profileId: "gpt-frontier", priority: 2 },
          ],
          requiredCapabilities: ["TEXT"],
          cloudAllowed: true,
        },
        {
          taskClass: "QUICK_RESEARCH",
          messages: [{ role: "user", content: "research" }],
        }
      ),
    (error: unknown) => {
      assert.ok(error instanceof ModelGatewayExecutionError);
      assert.equal(error.attempts[0]?.failureKind, "CONFIG");
      assert.equal(error.attempts[0]?.fallbackAllowed, false);
      return true;
    }
  );
  assert.equal(gptCalls, 0);
});

test("Model Gateway：内容策略拒绝不通过切换模型绕过", async () => {
  let gptCalls = 0;
  const registry = new ModelRegistry();
  registry.registerProfile(agnes);
  registry.registerProfile(gpt);
  registry.registerProvider({
    provider: "agnes",
    async execute() {
      throw new ModelProviderError(
        "provider content policy rejected request",
        "CONTENT_POLICY"
      );
    },
  });
  registry.registerProvider({
    provider: "openai",
    async execute() {
      gptCalls += 1;
      return { text: "should not be used" };
    },
  });

  const gateway = new ModelGateway(registry);
  await assert.rejects(
    () =>
      gateway.execute(
        {
          id: "content-policy-fail-closed",
          version: "1",
          taskClass: "QUICK_RESEARCH",
          candidates: [
            { profileId: "agnes-fast", priority: 1 },
            { profileId: "gpt-frontier", priority: 2 },
          ],
          requiredCapabilities: ["TEXT"],
          cloudAllowed: true,
        },
        {
          taskClass: "QUICK_RESEARCH",
          messages: [{ role: "user", content: "request" }],
        }
      ),
    (error: unknown) => {
      assert.ok(error instanceof ModelGatewayExecutionError);
      assert.equal(error.attempts[0]?.failureKind, "CONTENT_POLICY");
      return true;
    }
  );
  assert.equal(gptCalls, 0);
});

test("Model Gateway：cooldown 后模型恢复成功会清零 failure streak", async () => {
  let now = 10_000;
  let shouldFail = true;
  const registry = new ModelRegistry();
  registry.registerProfile(agnes);
  registry.registerProfile(gpt);
  registry.registerProvider({
    provider: "agnes",
    async execute(profile) {
      if (shouldFail) {
        throw new ModelProviderError("temporary timeout", "TIMEOUT");
      }
      return { text: "recovered", modelId: profile.modelId };
    },
  });
  registry.registerProvider({
    provider: "openai",
    async execute(profile) {
      return { text: "fallback", modelId: profile.modelId };
    },
  });

  const health = new InMemoryModelHealthStore(() => now);
  const gateway = new ModelGateway(registry, health, () => now);
  const policy: ModelPolicy = {
    id: "recovery",
    version: "1",
    taskClass: "QUICK_RESEARCH",
    candidates: [
      { profileId: "agnes-fast", priority: 1 },
      { profileId: "gpt-frontier", priority: 2 },
    ],
    requiredCapabilities: ["TEXT"],
    cloudAllowed: true,
    failurePolicy: {
      failureThreshold: 1,
      cooldownMs: 100,
    },
  };
  const request = {
    taskClass: "QUICK_RESEARCH" as const,
    messages: [{ role: "user" as const, content: "research" }],
  };

  const first = await gateway.execute(policy, request);
  assert.equal(first.profileId, "gpt-frontier");
  assert.equal((await health.get("agnes-fast"))?.consecutiveFailures, 1);

  now += 101;
  shouldFail = false;
  const recovered = await gateway.execute(policy, request);
  assert.equal(recovered.profileId, "agnes-fast");
  const snapshot = await health.get("agnes-fast");
  assert.equal(snapshot?.consecutiveFailures, 0);
  assert.equal(snapshot?.cooldownUntilMs, null);
});
