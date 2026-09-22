import assert from "node:assert/strict";
import test from "node:test";

import {
  ModelGateway,
  ModelGatewayExecutionError,
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
