/**
 * C4 能力约束执行化：能力包加载期的工具名严格校验。
 *
 * 背景（W2 离线审计的结论）：requiredTools / forbiddenTools 之前只进提示词、
 * 执行侧无人消费，所以写错的工具名永远不会报错。现在这两个字段进了执行侧
 * （`toolsFor` 按它们过滤工具候选），写错的名字必须在**加载期**就拦下，
 * 不许等到模型真正调用时才暴露。
 *
 * 校验用的工具名表来自执行侧自身（`allToolNames()`，由 `toolsFor` 推导），
 * 不手写第二张表，避免漂移。
 *
 * - `findUnknownCapabilityToolNames`：纯函数，列出所有不在工具表里的声明；
 * - `assertCapabilityToolNamesValid`：有未知名字就抛 `CapabilityToolNameError`；
 * - `loadCapabilitySkillsStrict`：加载 + 校验，应用侧（directory-loader）
 *   用它代替 `loadCapabilitySkills`，坏包在能力目录构建时就失败。
 *
 * 注意与 `skill-registry.loadCapabilitySkills` 的分工：后者保持「坏内容只记
 * 诊断、不抛错」，对话链路的「失败不挡对话」契约不动；严格校验只发生在
 * 明确选择严格加载的入口。
 */
import type { CapabilitySkillDefinition } from "@/modules/kern-contracts";
import { allToolNames } from "@/modules/supervisor/tools";
import {
  loadCapabilitySkills,
  type CapabilitySkillsLoadResult,
} from "./skill-registry";

export type CapabilityToolNameField = "requiredTools" | "forbiddenTools";

export interface UnknownCapabilityToolName {
  skillId: string;
  sourcePath: string;
  field: CapabilityToolNameField;
  /** 能力包里写的名字（原样，未归一化）。 */
  tool: string;
}

/** 能力包声明了工具表里没有的工具名（加载期拦下）。 */
export class CapabilityToolNameError extends Error {
  readonly findings: UnknownCapabilityToolName[];

  constructor(findings: UnknownCapabilityToolName[]) {
    const lines = findings.map(
      (f) =>
        `能力包 ${f.skillId} 的 ${f.field} 声明了未知工具「${f.tool}」（${f.sourcePath || "未知路径"}）`
    );
    super(
      `能力包工具名校验失败：${findings.length} 个声明不在执行侧工具表里。` +
        `请检查 SKILL.md 的 requiredTools / forbiddenTools。\n` +
        lines.join("\n")
    );
    this.name = "CapabilityToolNameError";
    this.findings = findings;
  }
}

/**
 * 找出所有声明了、但执行侧工具表里没有的工具名。
 * 大小写不敏感（`toolsFor` 的过滤也是这个口径）。
 */
export function findUnknownCapabilityToolNames(
  skills: readonly CapabilitySkillDefinition[]
): UnknownCapabilityToolName[] {
  const known = new Set(allToolNames().map((name) => name.trim().toLowerCase()));
  const findings: UnknownCapabilityToolName[] = [];
  const fields: CapabilityToolNameField[] = ["requiredTools", "forbiddenTools"];
  for (const skill of skills) {
    for (const field of fields) {
      for (const raw of skill[field] ?? []) {
        const tool = String(raw ?? "").trim();
        if (!tool) continue;
        if (!known.has(tool.toLowerCase())) {
          findings.push({
            skillId: skill.id,
            sourcePath: skill.sourcePath ?? "",
            field,
            tool,
          });
        }
      }
    }
  }
  return findings;
}

/** 有未知工具名就抛错；全合法时静默通过。 */
export function assertCapabilityToolNamesValid(
  skills: readonly CapabilitySkillDefinition[]
): void {
  const findings = findUnknownCapabilityToolNames(skills);
  if (findings.length > 0) throw new CapabilityToolNameError(findings);
}

/**
 * 严格加载：`loadCapabilitySkills` + 工具名校验。
 * 能力包目录是应用能力体系的入口之一，这里抛错 = 启动/加载期失败，
 * 不会把写错的工具名漏到运行时。
 */
export function loadCapabilitySkillsStrict(
  options: { root?: string } = {}
): CapabilitySkillsLoadResult {
  const result = loadCapabilitySkills(options);
  assertCapabilityToolNamesValid(result.skills);
  return result;
}
