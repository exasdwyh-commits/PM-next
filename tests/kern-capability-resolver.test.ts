/**
 * KX-73 Capability Resolver：四档选择（EXPLICIT → INTENT → TRIGGER → NONE）。
 *
 * 断言：不会在没命中时编一个出来；命中时会把并集后的 Agent / 知识域 / 证据要求
 * 一并交出去；KNOWLEDGE_SEARCH 一定补默认知识域；仓库里那批能力包真的能被命中。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CapabilitySkillDefinition } from "@/modules/kern-contracts";
import { resolveCapabilities } from "@/modules/assistant-runtime/capabilities/resolver";
import { clearCapabilitySkillCache } from "@/modules/assistant-runtime/capabilities/skill-registry";

function mk(over: Partial<CapabilitySkillDefinition> & { id: string }): CapabilitySkillDefinition {
  const [domain, name] = over.id.split(".");
  return {
    domain,
    name,
    label: "测试能力",
    description: "测试用能力包描述",
    triggers: [],
    intents: [],
    preferredAgents: [],
    knowledgeScopes: [],
    requiredTools: [],
    forbiddenTools: [],
    evidencePolicy: null,
    outputTypes: [],
    modelPreference: null,
    priority: 5,
    enabled: true,
    version: "1",
    summary: "摘要",
    instructions: "## 做法\n1. 步骤",
    sourcePath: `capabilities/${domain}/${name}/SKILL.md`,
    error: null,
    ...over,
  };
}

const A = mk({
  id: "research.synth",
  label: "知识综合",
  triggers: ["综合", "归纳"],
  intents: ["KNOWLEDGE_SEARCH"],
  preferredAgents: ["research_agent"],
  knowledgeScopes: ["web"],
  evidencePolicy: "结论须带来源",
  outputTypes: ["brief"],
  modelPreference: "deep",
  priority: 9,
});

const B = mk({
  id: "software.release",
  label: "发布评审",
  description: "判断一批改动现在能不能交付：完成度、测试、回滚与未决项",
  triggers: ["交付", "发布", "上线"],
  preferredAgents: ["tech_lead"],
  knowledgeScopes: ["files"],
  outputTypes: ["review"],
  priority: 8,
});

test("EXPLICIT：会话点名的能力包优先，即使文本完全不匹配", () => {
  const r = resolveCapabilities({
    text: "今天天气怎么样",
    intent: "UNSUPPORTED",
    explicitSkillIds: ["software.release"],
    skills: [A, B],
  });
  assert.equal(r.source, "EXPLICIT");
  assert.deepEqual(r.skills.map((s) => s.id), ["software.release"]);
  assert.match(r.reason, /点名/);
  assert.deepEqual(r.agents, ["tech_lead"]);
  assert.deepEqual(r.knowledgeScopes, ["files"]);
});

test("EXPLICIT 里点名了不存在的能力包则被丢弃，继续往下走", () => {
  const r = resolveCapabilities({
    text: "综合一下这些材料",
    intent: "KNOWLEDGE_SEARCH",
    explicitSkillIds: ["ghost.ghost", "research.synth"],
    skills: [A, B],
  });
  assert.equal(r.source, "EXPLICIT");
  assert.deepEqual(r.skills.map((s) => s.id), ["research.synth"]);
});

test("INTENT：能力包声明了服务该 intent 即命中，优先于关键词", () => {
  const r = resolveCapabilities({ text: "完全无关的文本", intent: "KNOWLEDGE_SEARCH", skills: [A, B] });
  assert.equal(r.source, "INTENT");
  assert.deepEqual(r.skills.map((s) => s.id), ["research.synth"]);
  // KNOWLEDGE_SEARCH 必须补默认知识域（项目 + 公司事实），且不重复已有
  assert.deepEqual(r.knowledgeScopes, ["web", "project", "company-facts"]);
  assert.equal(r.evidencePolicy, "结论须带来源");
  assert.equal(r.modelPreference, "deep", "选中能力的模型偏好要透传（是偏好不是必选）");
});

test("TRIGGER：没 intent 声明时靠关键词打分，且带解释", () => {
  const r = resolveCapabilities({
    text: "这批改动到底能不能交付，帮我看看发布风险",
    intent: "UNSUPPORTED",
    skills: [A, B],
  });
  assert.equal(r.source, "TRIGGER");
  assert.deepEqual(r.skills.map((s) => s.id), ["software.release"]);
  assert.ok(r.candidates.length >= 1);
  assert.ok(r.candidates.every((c) => Array.isArray(c.matchedOn) && c.matchedOn.length > 0));
  assert.match(r.reason, /关键词/);
  assert.equal(r.evidencePolicy, null, "没命中的能力不该凭空产生证据要求");
});

test("NONE：没命中就是没命中，不编一个出来", () => {
  const r = resolveCapabilities({ text: "zzz qqq 无关文本", intent: "UNSUPPORTED", skills: [A, B] });
  assert.equal(r.source, "NONE");
  assert.deepEqual(r.skills, []);
  assert.deepEqual(r.knowledgeScopes, []);
  assert.equal(r.evidencePolicy, null);
  assert.ok(r.reason.length > 0, "必须给出为什么没选中");
});

test("NONE + 空能力包清单：直接说明能力包还没落地", () => {
  const r = resolveCapabilities({ text: "随便", intent: "UNSUPPORTED", skills: [] });
  assert.equal(r.source, "NONE");
  assert.match(r.reason, /还没有可用的能力包/);
});

test("并集：多个能力包的 Agent / 知识域 / 证据要求合并，不互相覆盖", () => {
  const r = resolveCapabilities({
    text: "综合 交付 发布",
    intent: "UNSUPPORTED",
    explicitSkillIds: ["research.synth", "software.release"],
    skills: [A, B],
  });
  assert.equal(r.source, "EXPLICIT");
  assert.deepEqual(r.agents, ["research_agent", "tech_lead"]);
  assert.deepEqual(r.knowledgeScopes, ["web", "files"]);
  assert.deepEqual(r.outputTypes, ["brief", "review"]);
  assert.equal(r.evidencePolicy, "结论须带来源", "只有一个能力有证据要求时取它");
});

test("低分关键词 + 高 priority 不足以进候选（priority 是常数项，不能靠它顶进来）", () => {
  const loud = mk({
    id: "z.loud",
    label: "别的能力",
    description: "在一些场合会顺带提到交付的通用能力",
    priority: 9,
  });
  const real = mk({
    id: "b.real",
    label: "发布评审",
    description: "判断这一批改动能不能交付",
    triggers: ["交付"],
    priority: 5,
  });
  const r = resolveCapabilities({ text: "交付", intent: "UNSUPPORTED", skills: [loud, real] });
  assert.equal(r.source, "TRIGGER");
  assert.deepEqual(r.skills.map((s) => s.id), ["b.real"], "只命中关键词实打实的那一个");
  assert.deepEqual(r.candidates.map((c) => c.id), ["b.real"], "擦边的不进候选表");
});

test("仓库里的能力包可被真实文本命中（三句 demo 文案之一）", () => {
  clearCapabilitySkillCache();
  const r = resolveCapabilities({
    text: "分析 PM-next 最近改动判断是否可交付",
    intent: "UNSUPPORTED",
    limit: 3,
  });
  assert.notEqual(r.source, "NONE", `三句 demo 之一必须命中，实际原因：${r.reason}`);
  assert.ok(r.skills.length >= 1);
  assert.ok(r.skills.some((s) => s.domain === "software"), `期望命中 software 域，实际：${r.skills.map((s) => s.id)}`);
  assert.ok(r.knowledgeScopes.includes("files") || r.knowledgeScopes.includes("project"));
});

test("拉丁短词只认整词：ai 不许靠子串撞 claim 把宣称评审顶进来", () => {
  clearCapabilitySkillCache();
  const r = resolveCapabilities({ text: "今天 AI 行业有什么值得关注", intent: "UNSUPPORTED", limit: 3 });
  assert.notEqual(r.source, "NONE", `demo 文案之一必须命中，实际原因：${r.reason}`);
  assert.ok(
    !r.skills.some((s) => s.id === "nutrition-rd.claim-review"),
    `宣称评审不该被 ai⊂claim 顶进选中集，实际：${r.skills.map((s) => s.id)}`
  );
  assert.equal(
    r.candidates.find((c) => c.id === "nutrition-rd.claim-review"),
    undefined,
    "连候选表都不该进——子串白拿的分必须归零"
  );
  assert.equal(r.skills[0]?.id, "research.digest", "这条文案的正解是动态摘要");
});
