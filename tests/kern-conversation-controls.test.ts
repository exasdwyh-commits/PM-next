import assert from "node:assert/strict";
import test from "node:test";
import {
  buildKernConversationSelectionPrompt,
  normalizeKernConversationRuntimeConfig,
  validateKernConversationRuntimeConfig,
} from "../src/modules/assistant-runtime/conversation-config";
import {
  capabilityKeyForIntent,
  toolWhitelistForCapabilityKeys,
} from "../src/modules/assistant-runtime/capabilities/catalog";
import { executeKernCapability } from "../src/modules/assistant-runtime/capabilities/registry";
import { loadCapabilitySkills } from "../src/modules/assistant-runtime/capabilities/skill-registry";

test("conversation controls preserve AUTO versus explicit empty selection", () => {
  const automatic = normalizeKernConversationRuntimeConfig({});
  assert.equal(automatic.modelProfileKey, null);
  assert.equal(automatic.advisorCodes, null);
  assert.equal(automatic.skillKeys, null);
  assert.equal(automatic.capabilityKeys, null);
  assert.equal(automatic.capabilityPackIds, null);

  const explicitNone = normalizeKernConversationRuntimeConfig({
    advisorCodes: [],
    skillKeys: [],
    capabilityKeys: [],
    capabilityPackIds: [],
  });
  assert.deepEqual(explicitNone.advisorCodes, []);
  assert.deepEqual(explicitNone.skillKeys, []);
  assert.deepEqual(explicitNone.capabilityKeys, []);
  assert.deepEqual(explicitNone.capabilityPackIds, []);
});

test("capability packs normalize like other selection fields and drop blanks/dupes", () => {
  const parsed = normalizeKernConversationRuntimeConfig({
    capabilityPackIds: [" research.digest ", "research.digest", "", "marketing.positioning", 42],
  });
  assert.deepEqual(parsed.capabilityPackIds, ["research.digest", "marketing.positioning"]);

  // 非数组一律视为「不限」，不抛错——历史/脏配置不能让对话开不起来。
  assert.equal(normalizeKernConversationRuntimeConfig({ capabilityPackIds: "research.digest" }).capabilityPackIds, null);
});

test("loaded capability packs expose the fields the control panel maps to options", () => {
  const { skills } = loadCapabilitySkills();
  assert.ok(skills.length > 0, "能力包目录不应为空");
  for (const skill of skills) {
    assert.equal(typeof skill.id, "string");
    assert.ok(skill.id.length > 0);
    assert.equal(typeof skill.label, "string");
    assert.equal(typeof skill.description, "string");
    assert.equal(typeof skill.domain, "string");
    // 只有 enabled 且无解析错误的能力才会进入 .skills，界面方可直接列出。
    assert.equal(skill.enabled, true);
    assert.equal(skill.error, null);
  }
});

test("runtime config write rejects unknown capability packs but accepts loaded ones", async () => {
  const fakeSession = { organizationId: "org-test", userId: "user-test" } as any;
  const { skills } = loadCapabilitySkills();
  const goodId = skills[0]?.id;
  assert.ok(goodId, "需要有可用的能力包供本用例使用");

  await assert.rejects(
    () =>
      validateKernConversationRuntimeConfig(fakeSession, {
        capabilityPackIds: ["no.such-pack"],
      }),
    /能力包选择包含不存在或未启用的包/
  );

  const ok = await validateKernConversationRuntimeConfig(fakeSession, {
    capabilityPackIds: [goodId],
  });
  assert.deepEqual(ok.capabilityPackIds, [goodId]);
});

test("delegation mode defaults to auto, keeps full, and never invents a third value", () => {
  assert.equal(normalizeKernConversationRuntimeConfig({}).delegationMode, "auto");
  assert.equal(
    normalizeKernConversationRuntimeConfig({ delegationMode: "full" }).delegationMode,
    "full"
  );
  // 历史/脏配置一律回落 auto（存储侧容忍），不抛错。
  assert.equal(
    normalizeKernConversationRuntimeConfig({ delegationMode: "FULL" }).delegationMode,
    "auto"
  );
});

test("runtime config write rejects an unknown delegation mode", async () => {
  const fakeSession = { organizationId: "org-test", userId: "user-test" } as any;

  await assert.rejects(
    () =>
      validateKernConversationRuntimeConfig(fakeSession, { delegationMode: "yolo" }),
    /授权档位只能是 auto 或 full/
  );

  const full = await validateKernConversationRuntimeConfig(fakeSession, {
    delegationMode: "full",
  });
  assert.equal(full.delegationMode, "full");
});

test("capability catalog maps intents and narrows the audited tool whitelist", () => {
  assert.equal(capabilityKeyForIntent("DESKTOP_EXECUTION"), "desktop");
  assert.equal(capabilityKeyForIntent("START_PRODUCT_RND"), "product-rnd");
  assert.equal(capabilityKeyForIntent("KNOWLEDGE_SEARCH"), "knowledge");

  const whitelist = toolWhitelistForCapabilityKeys(["knowledge", "visualize"]);
  assert.ok(whitelist.includes("knowledge.search"));
  assert.ok(whitelist.includes("kern.visualize"));
  assert.equal(whitelist.includes("desktop.runtime"), false);
  assert.equal(whitelist.includes("product-rnd.start"), false);
});

test("disabled conversation function is rejected before its handler can execute", async () => {
  const result = await executeKernCapability(
    { organizationId: "org-test", userId: "user-test", userName: "Test" } as any,
    "DESKTOP_EXECUTION",
    {
      conversationId: "conversation-test",
      productId: null,
      text: "本机执行 git status",
      capabilityKeys: ["knowledge"],
    }
  );

  assert.equal(result.toolKey, "kern.capability.disabled");
  assert.match(result.text, /没有启用/);
});

test("unsupported dialogue cannot bypass a disabled knowledge capability", async () => {
  const result = await executeKernCapability(
    { organizationId: "org-test", userId: "user-test", userName: "Test" } as any,
    "UNSUPPORTED",
    {
      conversationId: "conversation-test",
      productId: null,
      text: "你好",
      capabilityKeys: [],
    }
  );

  assert.equal(result.toolKey, "none");
  assert.match(result.text, /不会调用/);
});

test("selected advisors and skills become explicit model instructions without expanding permission", () => {
  const prompt = buildKernConversationSelectionPrompt({
    config: {
      version: "kern-conversation-config/v1",
      modelProfileKey: "frontier",
      advisorCodes: ["research_agent", "compliance_agent"],
      skillKeys: ["market_research"],
      capabilityKeys: ["knowledge"],
    },
    model: null,
    advisors: [
      {
        id: "a1",
        code: "research_agent",
        name: "Market Research Agent",
        roleKey: "MARKET_RESEARCH",
        instructions: "核对市场事实。",
      },
      {
        id: "a2",
        code: "compliance_agent",
        name: "Compliance Agent",
        roleKey: "COMPLIANCE",
        instructions: "核对法规边界。",
      },
    ],
    skills: [
      {
        key: "market_research",
        name: "市场研究",
        instructions: "优先使用可追溯来源。",
        allowedTools: null,
      },
    ],
  } as any);

  assert.ok(prompt);
  assert.match(prompt!, /Market Research Agent/);
  assert.match(prompt!, /Compliance Agent/);
  assert.match(prompt!, /市场研究/);
  assert.match(prompt!, /不扩大工具、权限或 Governance 授权/);
  assert.match(prompt!, /knowledge/);
});
