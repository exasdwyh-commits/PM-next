/**
 * 文件式能力包（Capability Pack）的加载：`capabilities/<域>/<名称>/SKILL.md`。
 *
 * 为什么是文件而不是数据库表：
 *  - 能力是**做法**，跟着代码走、进版本库、能被 review，和 prompts/packs 同一性质；
 *  - 装一个能力包 = 落一个目录，不需要迁移、不需要改 Schema；
 *  - 界面与 Resolver 读的仍是同一条定义，不存在「库里一份、文件里一份」。
 *
 * 三条刻意的约束（与 tenant/soul.ts 同一思路）：
 *  1. **仅服务端**。用 fs 读文件，绝不能进客户端包。
 *  2. **缺目录即空**。没有 capabilities/ 是合法状态，返回空清单 + 诊断，不抛错、不挡对话。
 *  3. **内容是外部输入**。SKILL.md 由部署方编辑却要进 system prompt，属于注入面：
 *     这里只负责读取、限长与清洗；真正加框的是 `buildCapabilityContextPrompt`（纯函数）。
 *
 * frontmatter 语法与 knowledge/sync.ts#parseFrontmatterAndBody 同约定（`---` 包裹、
 * `key: value`、单双引号剥掉）；差别是这里额外支持列表（行内 `[a, b]` 与块级 `- a`），
 * 因为 preferredAgents / knowledgeScopes 这类字段天然是列表，而知识同步那边只标量。
 */
import fs from "node:fs";
import path from "node:path";
import type {
  CapabilitySkillDefinition,
  CapabilitySkillDiagnostic,
} from "@/modules/kern-contracts";

/** 能力名与域名：小写字母数字与连字符，杜绝 `../` 之类的路径注入。 */
const SAFE_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;

/** 单个能力包做法正文的上限：能力是「怎么做」的纲要，不是文档库。 */
export const MAX_INSTRUCTION_CHARS = 6000;

export interface CapabilitySkillsLoadResult {
  skills: CapabilitySkillDefinition[];
  diagnostics: CapabilitySkillDiagnostic[];
}

// ---------------------------------------------------------------------------
// frontmatter
// ---------------------------------------------------------------------------

function parseScalar(raw: string): string {
  const v = raw.trim();
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
  ) {
    return v.slice(1, -1);
  }
  return v;
}

function parseListValue(raw: string): string[] {
  const v = raw.trim();
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((s) => parseScalar(s)).filter(Boolean);
  }
  if (v) return [parseScalar(v)];
  return [];
}

function parseBool(raw: string, fallback: boolean): boolean {
  const v = raw.trim().toLowerCase();
  if (v === "true" || v === "yes" || v === "on") return true;
  if (v === "false" || v === "no" || v === "off") return false;
  return fallback;
}

function parseNumber(raw: string, fallback: number): number {
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : fallback;
}

const LIST_KEYS = new Set([
  "triggers",
  "trigger",
  "intents",
  "agents",
  "preferredagents",
  "knowledgescopes",
  "scopes",
  "requiredtools",
  "forbiddentools",
  "outputtypes",
]);

const SCALAR_KEYS = new Set([
  "label",
  "name",
  "description",
  "evidencepolicy",
  "modelpreference",
  "version",
  "priority",
  "enabled",
  "domain",
]);

export interface ParsedSkillFrontmatter {
  frontmatter: Record<string, string | string[]>;
  body: string;
}

/**
 * 解析 `---` frontmatter。标量与行内列表照常；块级列表（`- a` / `  - a`）按同名键聚合。
 * 解析不抛错：坏行跳过，最后由 `validateSkill` 报缺字段。
 */
export function parseSkillFrontmatter(content: string): ParsedSkillFrontmatter {
  const text = content.replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) return { frontmatter: {}, body: text.trim() };

  const endIdx = text.indexOf("\n---", 3);
  if (endIdx === -1) return { frontmatter: {}, body: text.trim() };

  const rawYaml = text.slice(3, endIdx).trim();
  const body = text.slice(endIdx + 4).trim();
  const fm: Record<string, string | string[]> = {};
  let currentListKey: string | null = null;

  for (const rawLine of rawYaml.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const listItem = trimmed.match(/^(?:-\s+|\*\s+)(.*)$/);
    if (listItem && currentListKey) {
      const value = parseScalar(listItem[1]);
      if (value) (fm[currentListKey] as string[]).push(value);
      continue;
    }

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx <= 0) {
      currentListKey = null;
      continue;
    }
    const key = trimmed.slice(0, colonIdx).trim();
    const rest = trimmed.slice(colonIdx + 1);
    const lower = key.toLowerCase();

    if (!rest.trim()) {
      // 后面跟块级列表
      if (LIST_KEYS.has(lower)) {
        fm[lower] = [];
        currentListKey = lower;
      } else {
        currentListKey = null;
      }
      continue;
    }
    currentListKey = null;
    if (!LIST_KEYS.has(lower) && !SCALAR_KEYS.has(lower)) continue;

    const value = parseScalar(rest);
    if (LIST_KEYS.has(lower)) {
      const list = parseListValue(rest);
      if (list.length) fm[lower] = list;
    } else {
      fm[lower] = value;
    }
  }

  return { frontmatter: fm, body };
}

function asString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function asList(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : parseListValue(v);
}

// ---------------------------------------------------------------------------
// 单文件 → 定义
// ---------------------------------------------------------------------------

/** 摘要 = 首个二级标题之前的内容（progressive loading 的第二档）。 */
function summarize(body: string): string {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/^##\s/.test(line)) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

function sanitizeInstructions(body: string): string {
  const cleaned = body
    .split(/\r?\n/)
    .map((l) => l.replace(/\t/g, "  "))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned.length > MAX_INSTRUCTION_CHARS
    ? `${cleaned.slice(0, MAX_INSTRUCTION_CHARS)}\n\n…（做法正文超过 ${MAX_INSTRUCTION_CHARS} 字，已截断；请拆成多个能力包）`
    : cleaned;
}

/**
 * 把一个 SKILL.md 解析成定义。任何校验失败都返回 `error` 而不是抛错——
 * 一个坏掉的能力包不应该让整个能力目录构建失败。
 */
export function parseSkillMarkdown(content: string, sourcePath: string): CapabilitySkillDefinition {
  const { frontmatter, body } = parseSkillFrontmatter(content);
  const parts = sourcePath.replace(/\\/g, "/").split("/");
  const name = parts[parts.length - 2] ?? "";
  const domain = asString(frontmatter.domain) ?? parts[parts.length - 3] ?? "";
  const id = `${domain}.${name}`;

  const label = asString(frontmatter.label)?.trim() ?? "";
  const description = asString(frontmatter.description)?.trim() ?? "";
  const errors: string[] = [];
  if (!SAFE_SEGMENT.test(domain)) errors.push("域目录名不合法（需小写字母数字与连字符）");
  if (!SAFE_SEGMENT.test(name)) errors.push("能力目录名不合法");
  if (!label) errors.push("frontmatter 缺 label");
  if (!description) errors.push("frontmatter 缺 description");
  if (!body) errors.push("没有做法正文");

  const summary = summarize(body);
  const priorityRaw = asString(frontmatter.priority);

  return {
    id,
    domain,
    name,
    label: label || id,
    description,
    triggers: asList(frontmatter.triggers ?? frontmatter.trigger),
    intents: asList(frontmatter.intents),
    preferredAgents: asList(frontmatter.agents ?? frontmatter.preferredagents),
    knowledgeScopes: asList(frontmatter.knowledgescopes ?? frontmatter.scopes),
    requiredTools: asList(frontmatter.requiredtools),
    forbiddenTools: asList(frontmatter.forbiddentools),
    evidencePolicy: asString(frontmatter.evidencepolicy)?.trim() || null,
    outputTypes: asList(frontmatter.outputtypes),
    modelPreference: asString(frontmatter.modelpreference)?.trim() || null,
    priority: priorityRaw ? parseNumber(priorityRaw, 0) : 0,
    enabled: frontmatter.enabled === undefined
      ? true
      : parseBool(String(frontmatter.enabled), true),
    version: asString(frontmatter.version)?.trim() || "1",
    summary: summary.slice(0, 1200),
    instructions: sanitizeInstructions(body),
    sourcePath,
    error: errors.length ? errors.join("；") : null,
  };
}

// ---------------------------------------------------------------------------
// 目录扫描 + 缓存
// ---------------------------------------------------------------------------

interface CacheEntry {
  signature: string;
  result: CapabilitySkillsLoadResult;
}

let cache: CacheEntry | null = null;

function defaultRoot(): string {
  return path.join(process.cwd(), "capabilities");
}

function walkSkillFiles(root: string, out: { file: string; mtimeMs: number; size: number }[] = []) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) walkSkillFiles(full, out);
    else if (entry.isFile() && entry.name === "SKILL.md") {
      try {
        const st = fs.statSync(full);
        out.push({ file: full, mtimeMs: st.mtimeMs, size: st.size });
      } catch {
        // 竞态删除：跳过
      }
    }
  }
  return out;
}

/**
 * 加载全部能力包。带签名缓存（路径 + mtime + 大小），改一个文件只重读那一次目录。
 * `clearCapabilitySkillCache()` 供测试与热更使用。
 */
export function loadCapabilitySkills(
  options: { root?: string } = {}
): CapabilitySkillsLoadResult {
  const root = options.root ?? defaultRoot();
  const files = walkSkillFiles(root).sort((a, b) => a.file.localeCompare(b.file));
  // 签名里带上 root：不同根目录（测试用临时目录）不能互相命中缓存。
  const signature = `${root}|${files.map((f) => `${f.file}|${f.mtimeMs}|${f.size}`).join(";")}`;
  if (cache && cache.signature === signature) return cache.result;

  const skills: CapabilitySkillDefinition[] = [];
  const diagnostics: CapabilitySkillDiagnostic[] = [];
  const seen = new Map<string, string>();

  for (const f of files) {
    const rel = path.relative(process.cwd(), f.file).replace(/\\/g, "/");
    let raw: string;
    try {
      raw = fs.readFileSync(f.file, "utf8");
    } catch (error) {
      diagnostics.push({ sourcePath: rel, reason: `读取失败：${String(error)}` });
      continue;
    }
    const def = parseSkillMarkdown(raw, rel);
    if (def.error) {
      diagnostics.push({ sourcePath: rel, reason: def.error });
      continue;
    }
    const duplicate = seen.get(def.id);
    if (duplicate) {
      diagnostics.push({
        sourcePath: rel,
        reason: `能力 id 冲突：${def.id} 已由 ${duplicate} 声明，本文件被忽略`,
      });
      continue;
    }
    seen.set(def.id, rel);
    if (def.enabled) skills.push(def);
  }

  skills.sort(
    (a, b) => b.priority - a.priority || a.id.localeCompare(b.id)
  );
  const result = { skills, diagnostics };
  cache = { signature, result };
  return result;
}

export function loadCapabilitySkill(id: string): CapabilitySkillDefinition | null {
  return loadCapabilitySkills().skills.find((s) => s.id === id) ?? null;
}

export function clearCapabilitySkillCache(): void {
  cache = null;
}
