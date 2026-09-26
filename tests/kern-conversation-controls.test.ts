import assert from "node:assert/strict";
import test from "node:test";
import {
  buildKernConversationSelectionPrompt,
  normalizeKernConversationRuntimeConfig,
} from "../src/modules/assistant-runtime/conversation-config";
import {
  capabilityKeyForIntent,
  toolWhitelistForCapabilityKeys,
} from "../src/modules/assistant-runtime/capabilities/catalog";
import { executeKernCapability } from "../src/modules/assistant-runtime/capabilities/registry";

test("conversation controls preserve AUTO versus explicit empty selection", () => {
  const automatic = normalizeKernConversationRuntimeConfig({});
  assert.equal(automatic.modelProfileKey, null);
  assert.equal(automatic.advisorCodes, null);
  assert.equal(automatic.skillKeys, null);
  assert.equal(automatic.capabilityKeys, null);

  const explicitNone = normalizeKernConversationRuntimeConfig({
    advisorCodes: [],
    skillKeys: [],
    capabilityKeys: [],
  });
  assert.deepEqual(explicitNone.advisorCodes, []);
  assert.deepEqual(explicitNone.skillKeys, []);
  assert.deepEqual(explicitNone.capabilityKeys, []);
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
