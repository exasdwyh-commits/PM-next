/**
 * 能力包离线审计 —— **只报告，不拦截**。
 *
 * 两个独立检查，都是「读一遍 SKILL.md 就把现状说清楚」，不改解析器、不改能力包、
 * 不进执行路径：
 *
 *   W1 `auditTriggerConflicts` —— 触发词冲突：同一个触发词被 2 个及以上能力包共用。
 *      命中只提分、不独占（见 resolver），所以冲突不会让系统崩，但会让「用户这句话
 *      到底该走哪个能力」变得不可预测。先清点出来，再决定是改词还是改打分。
 *
 *   W2 `auditToolNames` —— 工具名存在性：requiredTools / forbiddenTools 里写的名字，
 *      是否真的在内置工具表里。写错的工具名**永远不会报错**（这两个字段目前只进
 *      提示词、执行侧无人消费），所以只能靠离线校验兜住。
 *
 * 用法：
 *   npx tsx scripts/capability-audit.ts          # 人类可读
 *   npx tsx scripts/capability-audit.ts --json   # 机器可读
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCapabilitySkills } from "@/modules/assistant-runtime/capabilities/skill-registry";
import type { CapabilitySkillDefinition } from "@/modules/kern-contracts/capability";

/**
 * 内置工具名（supervisor 工具循环真正可用的那些）。
 *
 * ⚠️ 这张表是**手写**的，会漂移 —— 所以 `tests/kern-capability-audit.test.ts`
 * 会读 `src/modules/supervisor/tools.ts` 源码正则提取 `name: "..."` 与之比对，
 * 加了新工具却忘了同步这里，测试会红。
 *
 * 注意它不等于 `BUILTIN_TOOLS`（后者只导出 knowledge_search / calculate 两个）；
 * 这里列的是 `toolsFor()` 在实际执行里会组装出来的全集。
 */
export const BUILTIN_TOOL_NAMES: readonly string[] = [
  "calculate",
  "knowledge_search",
  "web_search",
  "web_fetch",
  "web_crawl",
  "ask_user",
];

/** 触发词归一化：中英混排，英文按小写归并（Claim / claim 视为同一个词）。 */
function normalizeTrigger(raw: string): string {
  return raw.trim().toLowerCase();
}

export interface TriggerConflict {
  trigger: string;
  skills: string[];
}

export interface TriggerAuditReport {
  skillCount: number;
  /** 去重后的触发词总数（按归一化口径）。 */
  triggerCount: number;
  conflicts: TriggerConflict[];
}

/**
 * W1：同一个触发词被多个能力包共用 → 冲突清单。
 * 无冲突时 `conflicts` 为空数组（**不是** null / undefined），调用方可以直接遍历。
 */
export function auditTriggerConflicts(
  skills: readonly CapabilitySkillDefinition[]
): TriggerAuditReport {
  const byTrigger = new Map<string, { display: string; skills: Set<string> }>();
  for (const skill of skills) {
    for (const raw of skill.triggers ?? []) {
      const key = normalizeTrigger(raw);
      if (!key) continue;
      let entry = byTrigger.get(key);
      if (!entry) {
        entry = { display: raw.trim(), skills: new Set<string>() };
        byTrigger.set(key, entry);
      }
      entry.skills.add(skill.id);
    }
  }
  const conflicts: TriggerConflict[] = [];
  for (const entry of byTrigger.values()) {
    if (entry.skills.size < 2) continue;
    conflicts.push({ trigger: entry.display, skills: [...entry.skills].sort() });
  }
  conflicts.sort((a, b) => b.skills.length - a.skills.length || a.trigger.localeCompare(b.trigger));
  return { skillCount: skills.length, triggerCount: byTrigger.size, conflicts };
}

export type ToolDeclarationField = "requiredTools" | "forbiddenTools";

export interface ToolNameFinding {
  skillId: string;
  sourcePath: string;
  field: ToolDeclarationField;
  tool: string;
  exists: boolean;
  /** SKILL.md 里该工具名所在行（1-based）；文件读不到时为 null。 */
  line: number | null;
  note?: string;
}

export interface ToolAuditReport {
  skillCount: number;
  /** 声明过工具的能力包个数。 */
  declaringSkillCount: number;
  builtinTools: readonly string[];
  findings: ToolNameFinding[];
  /** `findings` 中不存在的子集，方便调用方直接看问题。 */
  unknown: ToolNameFinding[];
}

/** 在 SKILL.md 里定位工具名出现的行号（找不到返回 null）。 */
function findDeclarationLine(sourcePath: string, tool: string): number | null {
  try {
    const target = path.resolve(process.cwd(), sourcePath);
    const lines = fs.readFileSync(target, "utf8").split(/\r?\n/);
    const index = lines.findIndex((line) => line.includes(tool));
    return index >= 0 ? index + 1 : null;
  } catch {
    return null;
  }
}

/**
 * W2：校验能力包声明的工具名是否存在于内置工具表。
 *
 * ⚠️ 判不了的部分要说清楚：MCP connector 的工具是**运行时**由对方服务器 listTools
 * 动态返回的（名字形如 `<connector-slug>.<tool>`），离线枚举不出来。因此「不在内置表里」
 * 不等于「一定写错」 —— 报告里标注为 `note`，由人工确认，脚本不做拦截。
 */
export function auditToolNames(
  skills: readonly CapabilitySkillDefinition[],
  options: { builtinTools?: readonly string[] } = {}
): ToolAuditReport {
  const builtin = options.builtinTools ?? BUILTIN_TOOL_NAMES;
  const known = new Set(builtin.map((name) => name.toLowerCase()));
  const findings: ToolNameFinding[] = [];
  let declaringSkillCount = 0;

  for (const skill of skills) {
    const declarations: [ToolDeclarationField, string[]][] = [
      ["requiredTools", skill.requiredTools ?? []],
      ["forbiddenTools", skill.forbiddenTools ?? []],
    ];
    const declared = declarations.some(([, list]) => list.length > 0);
    if (declared) declaringSkillCount += 1;

    for (const [field, tools] of declarations) {
      for (const tool of tools) {
        const name = tool.trim();
        if (!name) continue;
        const exists = known.has(name.toLowerCase());
        findings.push({
          skillId: skill.id,
          sourcePath: skill.sourcePath ?? "",
          field,
          tool: name,
          exists,
          line: skill.sourcePath ? findDeclarationLine(skill.sourcePath, name) : null,
          note: exists
            ? undefined
            : "不在内置工具表；若来自 MCP connector（运行时动态返回）需人工确认",
        });
      }
    }
  }

  return {
    skillCount: skills.length,
    declaringSkillCount,
    builtinTools: builtin,
    findings,
    unknown: findings.filter((f) => !f.exists),
  };
}

export interface CapabilityAuditReport {
  triggers: TriggerAuditReport;
  tools: ToolAuditReport;
  /** 加载期的解析诊断（坏文件）。正常应为空。 */
  diagnostics: string[];
}

export function auditCapabilities(options: { root?: string } = {}): CapabilityAuditReport {
  const { skills, diagnostics } = loadCapabilitySkills(options.root ? { root: options.root } : {});
  return {
    triggers: auditTriggerConflicts(skills),
    tools: auditToolNames(skills),
    diagnostics: diagnostics.map((d) => `${d.sourcePath}: ${d.reason}`),
  };
}

function render(report: CapabilityAuditReport): string {
  const out: string[] = [];
  const t = report.triggers;
  out.push("═".repeat(60));
  out.push("W1 能力包触发词冲突检测（只报告，不拦截）");
  out.push("═".repeat(60));
  out.push(`扫描能力包：${t.skillCount} 个 · 去重触发词：${t.triggerCount} 个`);
  out.push(`冲突：${t.conflicts.length} 组`);
  if (t.conflicts.length === 0) {
    out.push("  （无冲突：没有任何触发词被 2 个及以上能力包共用）");
  } else {
    for (const conflict of t.conflicts) {
      out.push(`  「${conflict.trigger}」 → ${conflict.skills.join(" / ")}`);
    }
  }

  out.push("");
  out.push("═".repeat(60));
  out.push("W2 能力包工具名离线校验（只报告，不拦截）");
  out.push("═".repeat(60));
  const w = report.tools;
  out.push(`扫描能力包：${w.skillCount} 个 · 声明了工具：${w.declaringSkillCount} 个`);
  out.push(`内置工具表（${w.builtinTools.length}）：${w.builtinTools.join(" / ")}`);
  out.push(`声明条目：${w.findings.length} 条 · 不在内置表：${w.unknown.length} 条`);
  if (w.findings.length === 0) {
    out.push("  （当前没有任何能力包声明 requiredTools / forbiddenTools）");
  } else {
    for (const f of w.findings) {
      const where = f.line ? `${f.sourcePath}:${f.line}` : f.sourcePath;
      out.push(`  ${f.exists ? "✓" : "✗"} ${f.skillId} · ${f.field} · ${f.tool}  (${where})`);
      if (f.note) out.push(`      ↳ ${f.note}`);
    }
  }

  if (report.diagnostics.length) {
    out.push("");
    out.push(`⚠️ 加载诊断 ${report.diagnostics.length} 条：`);
    for (const d of report.diagnostics) out.push(`  ${d}`);
  }
  return out.join("\n");
}

function main(): void {
  const report = auditCapabilities();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(render(report));
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) main();
