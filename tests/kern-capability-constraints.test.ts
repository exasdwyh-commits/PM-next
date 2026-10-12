/**
 * C4 能力约束执行化：
 *  1. resolver 按组织/租户/角色过滤候选能力包（只过滤、不碰打分）；
 *  2. toolsFor 按能力包约束（requiredTools/forbiddenTools）过滤工具候选；
 *  3. 工具名不存在的能力包在加载期抛错（不漏到运行时）；
 *  4. 未声明约束的包行为不变（仓库 26 个真实包回归）。
 *
 * 夹具能力包全部写进临时目录，不碰仓库真实的 capabilities 目录下的 SKILL.md。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { CapabilitySkillDefinition } from "@/modules/kern-contracts";
import {
  filterSkillsByTenantAndRole,
  resolveCapabilities,
} from "@/modules/assistant-runtime/capabilities/resolver";
import {
  loadCapabilitySkills,
} from "@/modules/assistant-runtime/capabilities/skill-registry";
import {
  CapabilityToolNameError,
  assertCapabilityToolNamesValid,
  findUnknownCapabilityToolNames,
  loadCapabilitySkillsStrict,
} from "@/modules/assistant-runtime/capabilities/skill-validation";
import {
  allToolNames,
  filterToolsByConstraints,
  toolsFor,
  type ToolContext,
} from "@/modules/supervisor/tools";
import { BUILTIN_TOOL_NAMES } from "../scripts/capability-audit";

function makeTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kern-cap-constraint-"));
}

/** 写入一个最小可用能力包（label/description/正文是解析器的硬要求）。 */
function writeSkill(root: string, domain: string, name: string, frontmatter: string): void {
  const dir = path.join(root, domain, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nlabel: ${name}\ndescription: 测试用能力包 ${name}\n${frontmatter}\n---\n\n正文：用于通过解析校验的做法说明。\n`,
    "utf8"
  );
}

function skillsFrom(root: string): CapabilitySkillDefinition[] {
  const { skills, diagnostics } = loadCapabilitySkills({ root });
  assert.equal(diagnostics.length, 0, `临时能力包不应有诊断：${JSON.stringify(diagnostics)}`);
  return skills;
}

/** 全量 stub 的 ToolContext：toolsFor 能组装出的完整工具表。 */
function fullCtx(): ToolContext {
  return {
    organizationId: "org-test",
    searchKnowledge: async () => [],
    webSearch: async () => [],
    webFetch: async () => ({ url: "", title: null, text: "", truncated: false }),
    webCrawl: async () => [],
    askUser: async () => ({ mode: "ignore" as const }),
  };
}

const toolNames = (ctx: ToolContext, constraints?: { requiredTools?: string[]; forbiddenTools?: string[] }) =>
  toolsFor(ctx, constraints ?? {}).map((t) => t.name).sort();

// ---------------------------------------------------------------------------
// 1. requiredTools：允许名单
// ---------------------------------------------------------------------------

test("声明 requiredTools 的包 → 工具候选只剩声明过的", () => {
  const root = makeTempRoot();
  writeSkill(
    root,
    "test",
    "calc-pack",
    "intents: [TEST_CALC]\nrequiredTools: [calculate]"
  );
  const skills = skillsFrom(root);
  assert.deepEqual(skills[0].requiredTools, ["calculate"]);

  const r = resolveCapabilities({ text: "算一下", intent: "TEST_CALC", skills });
  assert.deepEqual(r.skills.map((s) => s.id), ["test.calc-pack"]);
  assert.deepEqual(r.requiredTools, ["calculate"]);

  // 执行侧：resolver 交过来的并集直接喂给 toolsFor
  const names = toolNames(fullCtx(), r);
  assert.deepEqual(names, ["calculate"]);
});

// ---------------------------------------------------------------------------
// 2. forbiddenTools：黑名单；与 required 重叠时禁止优先
// ---------------------------------------------------------------------------

test("声明 forbiddenTools 的包 → 被禁工具拿不到，其他不受影响", () => {
  const root = makeTempRoot();
  writeSkill(
    root,
    "test",
    "no-web",
    "intents: [TEST_NOWEB]\nforbiddenTools: [web_search]"
  );
  const skills = skillsFrom(root);
  const r = resolveCapabilities({ text: "查", intent: "TEST_NOWEB", skills });
  assert.deepEqual(r.forbiddenTools, ["web_search"]);

  const names = toolNames(fullCtx(), r);
  assert.ok(!names.includes("web_search"), "web_search 应被拿掉");
  assert.ok(names.includes("web_fetch"), "web_fetch 不应受影响");
  assert.ok(names.includes("calculate"), "calculate 不应受影响");
});

test("forbidden 与 required 重叠 → 禁止优先", () => {
  const names = filterToolsByConstraints(
    toolsFor(fullCtx()),
    { requiredTools: ["calculate", "web_search"], forbiddenTools: ["web_search"] }
  ).map((t) => t.name);
  assert.deepEqual(names, ["calculate"]);
});

test("约束为空 → toolsFor 行为与以前完全一致", () => {
  const plain = toolsFor(fullCtx()).map((t) => t.name).sort();
  assert.deepEqual(toolNames(fullCtx(), {}), plain);
  assert.deepEqual(toolNames(fullCtx(), { requiredTools: [], forbiddenTools: [] }), plain);
});

// ---------------------------------------------------------------------------
// 3. tenants / roles：解析阶段过滤
// ---------------------------------------------------------------------------

test("tenants 不匹配的包在解析阶段被过滤掉", () => {
  const root = makeTempRoot();
  writeSkill(root, "test", "org-a-pack", "intents: [TEST_TENANT]\ntenants: [org-a]");
  writeSkill(root, "test", "open-pack", "intents: [TEST_TENANT]");
  const skills = skillsFrom(root);
  assert.deepEqual(skills.find((s) => s.id === "test.org-a-pack")?.tenants, ["org-a"]);
  assert.deepEqual(skills.find((s) => s.id === "test.open-pack")?.tenants, []);

  const other = resolveCapabilities({
    text: "x", intent: "TEST_TENANT", skills, organizationId: "org-b",
  });
  assert.deepEqual(other.skills.map((s) => s.id), ["test.open-pack"]);

  const own = resolveCapabilities({
    text: "x", intent: "TEST_TENANT", skills, organizationId: "org-a",
  });
  assert.deepEqual(own.skills.map((s) => s.id).sort(), ["test.open-pack", "test.org-a-pack"]);
});

test("roles 不匹配的包被过滤；未声明 roles 的包不受影响", () => {
  const root = makeTempRoot();
  writeSkill(root, "test", "admin-pack", "intents: [TEST_ROLE]\nroles: [admin]");
  writeSkill(root, "test", "member-pack", "intents: [TEST_ROLE]");
  const skills = skillsFrom(root);

  const asMember = filterSkillsByTenantAndRole(skills, { role: "member" });
  assert.deepEqual(asMember.map((s) => s.id), ["test.member-pack"]);

  const asAdmin = filterSkillsByTenantAndRole(skills, { role: "admin" });
  assert.deepEqual(asAdmin.map((s) => s.id).sort(), ["test.admin-pack", "test.member-pack"]);

  // 声明了 roles 但调用方没给 role → 按声明收紧（默认不放行）
  const noRole = filterSkillsByTenantAndRole(skills, {});
  assert.deepEqual(noRole.map((s) => s.id), ["test.member-pack"]);
});

test("租户/角色过滤不改变打分：未声明的包分数前后一致", () => {
  const root = makeTempRoot();
  writeSkill(root, "test", "pack-a", "intents: [TEST_SCORE]\ntriggers: [苹果]");
  writeSkill(root, "test", "pack-b", "intents: [TEST_SCORE]\ntriggers: [香蕉]");
  const skills = skillsFrom(root);
  const withoutScope = resolveCapabilities({ text: "苹果", intent: "TEST_SCORE", skills });
  const withScope = resolveCapabilities({
    text: "苹果", intent: "TEST_SCORE", skills, organizationId: "org-a", role: "admin",
  });
  assert.deepEqual(
    withScope.candidates.map((c) => [c.id, c.score]),
    withoutScope.candidates.map((c) => [c.id, c.score])
  );
  assert.deepEqual(
    withScope.skills.map((s) => s.id),
    withoutScope.skills.map((s) => s.id)
  );
});

// ---------------------------------------------------------------------------
// 4. 未知工具名：加载期抛错，不漏到运行时
// ---------------------------------------------------------------------------

test("声明了工具表里没有的工具名 → 严格加载当场抛错", () => {
  const root = makeTempRoot();
  writeSkill(
    root,
    "test",
    "bad-pack",
    "intents: [TEST_BAD]\nrequiredTools: [no_such_tool_xyz]"
  );
  const { skills } = loadCapabilitySkills({ root });
  assert.equal(skills.length, 1);

  const findings = findUnknownCapabilityToolNames(skills);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tool, "no_such_tool_xyz");
  assert.equal(findings[0].skillId, "test.bad-pack");
  assert.equal(findings[0].field, "requiredTools");

  assert.throws(() => assertCapabilityToolNamesValid(skills), CapabilityToolNameError);
  assert.throws(
    () => loadCapabilitySkillsStrict({ root }),
    (err: unknown) =>
      err instanceof CapabilityToolNameError &&
      err.message.includes("test.bad-pack") &&
      err.message.includes("no_such_tool_xyz")
  );
});

test("普通加载不抛错（对话链路的失败不挡对话契约不动）", () => {
  const root = makeTempRoot();
  writeSkill(
    root,
    "test",
    "bad-pack",
    "intents: [TEST_BAD]\nforbiddenTools: [also_not_a_tool]"
  );
  // 非严格加载：只记诊断、不抛错
  const { skills } = loadCapabilitySkills({ root });
  assert.equal(skills.length, 1);
});

// ---------------------------------------------------------------------------
// 5. 执行侧工具名表：与审计脚本的手写表一致（防漂移）
// ---------------------------------------------------------------------------

test("allToolNames 与执行侧真实工具表一致", () => {
  const names = allToolNames().sort();
  assert.deepEqual(names, [...BUILTIN_TOOL_NAMES].sort());
  assert.ok(names.includes("calculate"));
  assert.ok(names.includes("knowledge_search"));
});

// ---------------------------------------------------------------------------
// 6. 回归：仓库真实能力包（当前 26 个全未声明约束）行为不变
// ---------------------------------------------------------------------------

test("真实能力包：声明的工具名全部合法，严格加载不抛错", () => {
  // 默认 root = 仓库 capabilities/（测试在仓库根运行）
  const result = loadCapabilitySkillsStrict();
  assert.ok(result.skills.length > 0, "应加载到真实能力包");
  for (const skill of result.skills) {
    assert.deepEqual(
      findUnknownCapabilityToolNames([skill]),
      [],
      `真实包 ${skill.id} 声明了未知工具名`
    );
  }
});

test("真实能力包：未声明约束的包，toolsFor 过滤前后一致", () => {
  const { skills } = loadCapabilitySkills();
  const ctx = fullCtx();
  const baseline = toolsFor(ctx).map((t) => t.name);
  let undeclared = 0;
  for (const skill of skills) {
    const hasDecl =
      (skill.requiredTools?.length ?? 0) > 0 ||
      (skill.forbiddenTools?.length ?? 0) > 0 ||
      (skill.tenants?.length ?? 0) > 0 ||
      (skill.roles?.length ?? 0) > 0;
    if (!hasDecl) {
      undeclared += 1;
      // 该包自己的约束喂给 toolsFor → 必须与无约束完全一致
      assert.deepEqual(
        toolsFor(ctx, skill).map((t) => t.name),
        baseline,
        `包 ${skill.id} 未声明约束但工具表变了`
      );
    }
  }
  assert.ok(undeclared > 0, "应有未声明约束的真实包参与回归");
});
