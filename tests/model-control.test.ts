import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_MODEL_BINDING_PRESETS,
  MODEL_POLICY_PRESETS,
  MODEL_PROFILE_PRESETS,
} from "@/modules/model-control/presets";

test("official model-control presets are internally consistent", () => {
  const profileKeys = new Set(MODEL_PROFILE_PRESETS.map((profile) => profile.key));
  const policyKeys = new Set(MODEL_POLICY_PRESETS.map((policy) => policy.key));

  assert.equal(profileKeys.size, MODEL_PROFILE_PRESETS.length, "Profile keys must be unique");
  assert.equal(policyKeys.size, MODEL_POLICY_PRESETS.length, "Policy keys must be unique");

  for (const policy of MODEL_POLICY_PRESETS) {
    assert.ok(policy.candidates.length > 0, policy.key + " must have candidates");
    for (const candidate of policy.candidates) {
      assert.ok(profileKeys.has(candidate.profileKey), policy.key + " references unknown Profile");
    }
  }
});

test("official presets fail closed until provider/model ids are explicitly configured", () => {
  for (const profile of MODEL_PROFILE_PRESETS) {
    assert.equal(profile.enabled, false);
    assert.equal(profile.provider, "UNCONFIGURED");
    assert.equal(profile.modelId, "UNCONFIGURED");
  }
});

test("local-only policies never reference cloud profiles", () => {
  const profileByKey = new Map(MODEL_PROFILE_PRESETS.map((profile) => [profile.key, profile]));

  for (const policy of MODEL_POLICY_PRESETS.filter((item) => !item.cloudAllowed)) {
    for (const candidate of policy.candidates) {
      assert.equal(profileByKey.get(candidate.profileKey)?.locality, "LOCAL");
    }
  }
});

test("agent binding presets match the policy task class", () => {
  const policyByKey = new Map(MODEL_POLICY_PRESETS.map((policy) => [policy.key, policy]));

  for (const binding of AGENT_MODEL_BINDING_PRESETS) {
    const policy = policyByKey.get(binding.policyKey);
    assert.ok(policy, binding.policyKey + " must exist");
    assert.equal(policy.taskClass, binding.taskClass);
  }
});

test("strategic and red-team presets keep reasoning as a hard capability", () => {
  const guarded = MODEL_POLICY_PRESETS.filter((policy) =>
    ["PRODUCT_ANALYSIS", "STRATEGIC_CONSULTING", "RED_TEAM", "DECISION_REVIEW"].includes(
      policy.taskClass
    )
  );
  assert.ok(guarded.length >= 4);
  for (const policy of guarded) {
    assert.ok(policy.requiredCapabilities.includes("REASONING"), policy.key + " must require REASONING");
  }
});
