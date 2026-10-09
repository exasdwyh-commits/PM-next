/**
 * KX-73 文件式能力包（capabilities 下各域的 SKILL.md）：加载、校验、缓存。
 *
 * 断言：仓库里这批能力包真的能被加载且零诊断；frontmatter 的标量/行内列表/块级列表
 * 都能解析；坏文件进诊断而不是抛错；disabled 不进清单；签名缓存生效。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  clearCapabilitySkillCache,
  loadCapabilitySkill,
  loadCapabilitySkills,
  parseSkillFrontmatter,
  parseSkillMarkdown,
} from "@/modules/assistant-runtime/capabilities/skill-registry";

const EXPECTED_DOMAINS = ["research", "product", "marketing", "software", "nutrition-rd"];

test("仓库内的能力包全部加载成功，域齐全，无诊断", () => {
  clearCapabilitySkillCache();
  const { skills, diagnostics } = loadCapabilitySkills();
  assert.equal(diagnostics.length, 0, `应无诊断，实际：${JSON.stringify(diagnostics, null, 2)}`);
  assert.ok(skills.length >= 20, `能力包数量应 ≥20，实际 ${skills.length}`);

  const domains = new Set(skills.map((s) => s.domain));
  for (const d of EXPECTED_DOMAINS) {
    assert.ok(domains.has(d), `缺少能力域 ${d}`);
  }

  for (const s of skills) {
    assert.match(s.id, /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/, `${s.sourcePath} 的 id 不合法：${s.id}`);
    assert.ok(s.label && s.description, `${s.id} 缺 label/description`);
    assert.ok(s.summary.length > 0, `${s.id} 的 summary 为空（正文应有首个二级标题之前的内容）`);
    assert.ok(s.instructions.includes("##"), `${s.id} 正文缺小节结构`);
    assert.ok(s.triggers.length > 0, `${s.id} 没有 triggers，只能靠 intent 命中`);
    assert.ok(s.knowledgeScopes.length > 0, `${s.id} 未声明 knowledgeScopes`);
    assert.ok(s.evidencePolicy, `${s.id} 未声明证据要求`);
    assert.ok(s.preferredAgents.length > 0, `${s.id} 未声明首选 Agent`);
    assert.equal(s.enabled, true);
    assert.ok(s.version.length > 0);
    assert.equal(s.error, null);
    assert.ok(s.sourcePath.startsWith("capabilities/"), `${s.sourcePath} 不在 capabilities/ 下`);
  }
});

test("二次加载命中签名缓存（同一批对象引用）", () => {
  clearCapabilitySkillCache();
  const first = loadCapabilitySkills();
  const second = loadCapabilitySkills();
  assert.equal(first.skills, second.skills, "签名没变时应直接返回缓存对象");
});

test("按 id 查单个能力包；查不到返回 null", () => {
  clearCapabilitySkillCache();
  assert.ok(loadCapabilitySkill("research.knowledge-synthesis"));
  assert.equal(loadCapabilitySkill("nope.nope"), null);
});

test("frontmatter：标量、行内列表、块级列表都能解析", () => {
  const { frontmatter, body } = parseSkillFrontmatter(
    [
      "---",
      "label: 测试能力",
      "description: 一句话",
      "triggers: [a, b, c]",
      "intents:",
      "  - KNOWLEDGE_SEARCH",
      "  - WORKSPACE_STATUS",
      "priority: 3",
      "enabled: false",
      'evidencePolicy: "必须带来源"',
      "---",
      "",
      "## 什么时候用",
      "正文。",
    ].join("\n")
  );
  assert.equal(frontmatter.label, "测试能力");
  assert.deepEqual(frontmatter.triggers, ["a", "b", "c"]);
  assert.deepEqual(frontmatter.intents, ["KNOWLEDGE_SEARCH", "WORKSPACE_STATUS"]);
  assert.equal(frontmatter.priority, "3");
  assert.equal(frontmatter.enabled, "false");
  // frontmatter 键统一小写存储（`knowledgeScopes` → `knowledgescopes`）
  assert.equal(frontmatter.evidencepolicy, "必须带来源");
  assert.match(body, /^## 什么时候用/);
});

test("坏文件进诊断：缺字段只报错不抛异常", () => {
  const def = parseSkillMarkdown("---\nlabel: 只有标签\n---\n\n正文\n", "capabilities/x/y/SKILL.md");
  assert.ok(def.error, "缺 description 与结构化正文应报错");
  assert.match(def.error!, /description|做法正文/);
});

test("临时目录：disabled 的能力包不进清单，坏文件进诊断", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cap-"));
  try {
    const write = (rel: string, content: string) => {
      const file = path.join(root, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, "utf8");
    };
    write(
      "alpha/good/SKILL.md",
      ["---", "label: 好的", "description: 描述", "triggers: [x]", "scopes: [project]", "---", "", "## 做法", "1. 一步", ""].join("\n")
    );
    write(
      "alpha/off/SKILL.md",
      ["---", "label: 关掉的", "description: 描述", "enabled: false", "scopes: [project]", "---", "", "## 做法", "1. 一步", ""].join("\n")
    );
    write("alpha/broken/SKILL.md", "---\nlabel: 缺描述\n---\n\n## 做法\n1. 一步\n");
    fs.writeFileSync(path.join(root, "alpha/notes.md"), "不该被扫进来", "utf8");

    const { skills, diagnostics } = loadCapabilitySkills({ root });
    assert.deepEqual(skills.map((s) => s.id), ["alpha.good"], "只应加载 enabled 且合法的那个");
    assert.equal(diagnostics.length, 1, `应有 1 条诊断，实际 ${JSON.stringify(diagnostics)}`);
    assert.match(diagnostics[0].sourcePath, /broken\/SKILL\.md$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    clearCapabilitySkillCache();
  }
});
