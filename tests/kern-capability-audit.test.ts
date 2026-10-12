/**
 * 能力包离线审计（scripts/capability-audit.ts）—— W1 触发词冲突 / W2 工具名校验。
 *
 * 只测**审计逻辑本身**，不改能力包、不改 resolver、不进执行路径。
 *
 * 关键：仓库当前是「0 冲突 / 0 工具声明」，所以必须有**构造数据**证明脚本真能
 * 检出冲突与拼错的工具名 —— 否则「0」到底是「确实没有」还是「脚本坏了」分不清。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  BUILTIN_TOOL_NAMES,
  auditCapabilities,
  auditToolNames,
  auditTriggerConflicts,
} from "../scripts/capability-audit";
import { loadCapabilitySkills } from "@/modules/assistant-runtime/capabilities/skill-registry";

function makeTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kern-cap-audit-"));
}

/** 写入一个最小可用能力包（label/description/正文是解析器的硬要求）。 */
function writeSkill(root: string, domain: string, name: string, frontmatter: string): string {
  const dir = path.join(root, domain, name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "SKILL.md");
  fs.writeFileSync(
    file,
    `---\nlabel: ${name}\ndescription: 测试用能力包 ${name}\n${frontmatter}\n---\n\n正文：用于通过解析校验的做法说明。\n`,
    "utf8"
  );
  return file;
}

function skillsFrom(root: string) {
  const { skills, diagnostics } = loadCapabilitySkills({ root });
  assert.equal(diagnostics.length, 0, `临时能力包不应有诊断：${JSON.stringify(diagnostics)}`);
  return skills;
}

test("W1 两个能力包共用同一触发词 → 检出 1 组冲突", () => {
  const root = makeTempRoot();
  writeSkill(root, "research", "competitive-research", "triggers: [竞品, 竞争对手]");
  writeSkill(root, "product", "competitive-brief", "triggers: [竞品, 可行性]");
  const report = auditTriggerConflicts(skillsFrom(root));

  assert.equal(report.skillCount, 2);
  assert.equal(report.conflicts.length, 1, "共用的「竞品」应被判为冲突");
  const conflict = report.conflicts[0];
  assert.equal(conflict.trigger, "竞品");
  assert.deepEqual(conflict.skills, ["product.competitive-brief", "research.competitive-research"]);
});

test("W1 触发词大小写不同视为同一个词（Claim / claim）", () => {
  const root = makeTempRoot();
  writeSkill(root, "nutrition-rd", "claim-review", "triggers: [Claim]");
  writeSkill(root, "marketing", "content-strategy", "triggers: [claim]");
  const report = auditTriggerConflicts(skillsFrom(root));
  assert.equal(report.conflicts.length, 1, "英文触发词应忽略大小写归并");
});

test("W1 无冲突时输出空数组而不是 null（明确输出 0）", () => {
  const root = makeTempRoot();
  writeSkill(root, "research", "digest", "triggers: [摘要, digest]");
  writeSkill(root, "software", "code-review", "triggers: [代码评审]");
  const report = auditTriggerConflicts(skillsFrom(root));

  assert.ok(Array.isArray(report.conflicts), "无冲突也要是数组，方便调用方直接遍历");
  assert.equal(report.conflicts.length, 0);
  assert.equal(report.triggerCount, 3, "去重后的触发词总数仍应统计出来");
});

test("W2 声明的工具名在内置表内 → exists=true；拼错 → exists=false 且给出行号", () => {
  const root = makeTempRoot();
  writeSkill(root, "research", "digest", "requiredTools: [knowledge_search, 不存在的工具]");
  const report = auditToolNames(skillsFrom(root));

  assert.equal(report.declaringSkillCount, 1);
  assert.equal(report.findings.length, 2);
  assert.equal(report.unknown.length, 1, "拼错的工具名应被单列出来");

  const ok = report.findings.find((f) => f.tool === "knowledge_search");
  assert.ok(ok && ok.exists, "knowledge_search 在内置表里，应判为存在");

  const bad = report.unknown[0];
  assert.equal(bad.tool, "不存在的工具");
  assert.equal(bad.exists, false);
  assert.equal(bad.field, "requiredTools");
  // 第 4 行：`requiredTools: [...]`（1:`---` 2:label 3:description 4:本行）
  assert.equal(bad.line, 4, "应给出 SKILL.md 里的具体行号，便于直接定位");
  assert.match(String(bad.note), /MCP connector/, "要说明「不在内置表」不等于「一定写错」");
  assert.match(bad.sourcePath, /research\/digest\/SKILL\.md$/);
});

test("W2 forbiddenTools 同样纳入校验", () => {
  const root = makeTempRoot();
  writeSkill(root, "software", "release-review", "forbiddenTools: [web_crawl, typo_tool]");
  const report = auditToolNames(skillsFrom(root));
  assert.equal(report.findings.length, 2);
  assert.equal(report.unknown.length, 1);
  assert.equal(report.unknown[0].field, "forbiddenTools");
});

test("W2 未声明任何工具时，报告为空且不误报", () => {
  const root = makeTempRoot();
  writeSkill(root, "research", "digest", "triggers: [摘要]");
  const report = auditToolNames(skillsFrom(root));
  assert.equal(report.declaringSkillCount, 0);
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.unknown, []);
});

test("内置工具名清单与 supervisor/tools.ts 源码一致（防止手写清单漂移）", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/modules/supervisor/tools.ts"),
    "utf8"
  );
  // `ask_user` 定义在函数返回值里（4 空格缩进），其余是 2 空格 —— 故用 `^\s+`。
  const fromSource = [...source.matchAll(/^\s+name:\s*"([^"]+)"/gm)]
    .map((m) => m[1])
    .filter((name) => /^[a-z_]+$/.test(name))
    .sort();

  assert.deepEqual(
    [...BUILTIN_TOOL_NAMES].sort(),
    fromSource,
    "新增/改名内置工具后，请同步 scripts/capability-audit.ts 的 BUILTIN_TOOL_NAMES"
  );
});

test("真实仓库跑一遍：能力包全部加载、无解析诊断、报告结构完整", () => {
  const report = auditCapabilities();

  assert.deepEqual(report.diagnostics, [], "仓库内的能力包不应有解析诊断");
  assert.ok(report.triggers.skillCount >= 25, `能力包数量应 ≥25，实际 ${report.triggers.skillCount}`);
  assert.ok(report.triggers.triggerCount > 50, `触发词总数应 >50，实际 ${report.triggers.triggerCount}`);
  assert.ok(Array.isArray(report.triggers.conflicts));
  assert.ok(Array.isArray(report.tools.findings));
  assert.equal(report.tools.skillCount, report.triggers.skillCount);
});
