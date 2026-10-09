/**
 * KX-70 分层依赖守卫的扫描器（纯静态，不执行任何源码）。
 *
 * 目标架构（docs/mcp-architecture-review.md §3）：五层，只允许上层依赖同层或更下层。
 *
 *   L1 界面     src/app、src/components
 *   L2 Kern 核心 对话 → 目标计划 → Supervisor → 注意力
 *   L3 领域     研究、知识、决策、产品生命周期（第一个任务包）
 *   L4 执行底座 worker、定时、ToolBroker（连接器 / 本机 / 网页）、凭证、治理门
 *   L5 平台     身份 / 租户、模型网关、证据 / 审计 / 事件外发、db
 *
 * 违规 = 某文件 import 了「更上层」的单元（例如 L4 worker 引 L2 supervisor，L2 模块引 L1 页面）。
 * 现有违规记在 tests/fixtures/architecture-baseline.json，只许减少、不许新增，
 * 且每条必须带论证 why（论证例外表，见 BaselineEntry；AL8 校验）。
 *
 * 同层之间（例如 L3 领域互相 import）目前不计违规；那是 KX-71 的事。
 */
import fs from "node:fs";
import path from "node:path";

export const ROOT = process.cwd();
export const BASELINE_PATH = path.join(ROOT, "tests", "fixtures", "architecture-baseline.json");

export type LayerId = 1 | 2 | 3 | 4 | 5;

export const LAYER_NAMES: Record<LayerId, string> = {
  1: "L1 界面",
  2: "L2 Kern 核心",
  3: "L3 领域",
  4: "L4 执行底座",
  5: "L5 平台",
};

/** 单元 → 层。单元名：`app/pages`、`app/api`、`components`、`shared`、`config`、`modules/<name>`。 */
export const UNIT_LAYERS: Record<string, LayerId> = {
  // L1 界面
  "app/pages": 1,
  "app/api": 1,
  components: 1,
  // L2 Kern 核心
  "modules/assistant-runtime": 2,
  "modules/supervisor": 2,
  "modules/advisor": 2,
  "modules/muse": 2,
  "modules/response-format": 2,
  // Kern 富回复协议与可视化成果（kern-ui 块、隔离 HTML Artifact 及其版本）：对话核心的一部分。
  "modules/artifacts": 2,
  "modules/visual-intelligence": 2,
  "modules/memory": 2,
  "modules/playbooks": 2,
  "modules/workspace": 2,
  // Kern 提示词构造（纯字符串常量，无依赖；只被 app/api/kern 使用）
  "modules/kern-prompts": 2,
  // 反馈 → Kern 记忆（modules/memory 属 L2）。依赖 L2，故自身也必须在 L2：
  // 若归 L3 领域，就成了 L3 依赖 L2 的越界。
  "modules/feedback": 2,
  // L3 领域（含产品生命周期任务包）
  "modules/research": 3,
  "modules/knowledge": 3,
  "modules/decisions": 3,
  "modules/decision-intelligence": 3,
  "modules/products": 3,
  "modules/product-development": 3,
  "modules/product-rnd": 3,
  "modules/production": 3,
  "modules/launch": 3,
  "modules/projects": 3,
  "modules/collaboration": 3,
  "modules/signal": 3,
  "modules/workforce": 3,
  "modules/autopilot": 3,
  "modules/evaluation-harness": 3,
  // business-events 的 outbox 是通用的，但 dispatcher 把事件映射到 autopilot（领域编排），整体按领域层算
  "modules/business-events": 3,
  // L4 执行底座
  "modules/worker": 4,
  "modules/schedule": 4,
  "modules/connectors": 4,
  "modules/desktop-runtime": 4,
  "modules/vault": 4,
  "modules/governance": 4,
  "modules/automation-trace": 4,
  "modules/notify": 4,
  "modules/work": 4,
  // L5 平台
  "modules/identity": 5,
  "modules/tenant": 5,
  "modules/model-gateway": 5,
  "modules/model-control": 5,
  "modules/cost-engine": 5,
  "modules/usage": 5,
  "modules/evidence": 5,
  "modules/kern-contracts": 5,
  shared: 5,
  config: 5,
};

export interface Violation {
  /** 越界的源文件（仓库相对路径） */
  file: string;
  /** 源文件所属单元 */
  from: string;
  /** 被引用的单元 */
  to: string;
  /** 越了几层（正数） */
  jump: number;
  /** 只是 `import type` / `export type`（不产生运行时依赖，但仍是边界耦合） */
  typeOnly: boolean;
}

export interface ScanResult {
  units: string[];
  unknownUnits: string[];
  /** 跨层向上的 import */
  violations: Violation[];
  /** app 层（页面 / 接口）直接使用 prisma / @/shared/db 的文件 */
  appDbFiles: string[];
  /** 模块 → 模块 有向边（去重，单元级，含类型导入） */
  edges: Map<string, Set<string>>;
  /** 只含运行时导入的边（排除 import type / export type） */
  runtimeEdges: Map<string, Set<string>>;
}

const IMPORT_RE =
  /((?:import|export)\s+type\s)?(?:import|export)?\s*[^'";]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

export function relPath(abs: string): string {
  return path.relative(ROOT, abs).replace(/\\/g, "/");
}

/** 把仓库相对路径归到单元名；不属于 src 的返回 null。 */
export function unitOf(rel: string): string | null {
  const m = rel.match(/^src\/modules\/([^/]+)(?:\/|$)/);
  if (m) return `modules/${m[1]}`;
  if (rel.startsWith("src/app/api/")) return "app/api";
  if (rel.startsWith("src/app/") || rel === "src/app") return "app/pages";
  if (rel.startsWith("src/components/") || rel === "src/components") return "components";
  if (rel.startsWith("src/shared/") || rel === "src/shared") return "shared";
  if (rel.startsWith("src/config/") || rel === "src/config") return "config";
  return null;
}

function resolveSpecifier(fromFile: string, spec: string): string | null {
  if (spec.startsWith("@/")) return `src/${spec.slice(2)}`;
  if (spec.startsWith(".")) return relPath(path.resolve(path.dirname(fromFile), spec));
  return null;
}

export function scan(): ScanResult {
  const files = walk(path.join(ROOT, "src"));
  const violations: Violation[] = [];
  const appDbFiles: string[] = [];
  const edges = new Map<string, Set<string>>();
  const runtimeEdges = new Map<string, Set<string>>();
  const seenUnits = new Set<string>();
  const unknown = new Set<string>();

  for (const abs of files) {
    const rel = relPath(abs);
    const from = unitOf(rel);
    if (!from) continue;
    seenUnits.add(from);
    const src = fs.readFileSync(abs, "utf8");

    if (
      (from === "app/pages" || from === "app/api") &&
      (/["']@\/shared\/db["']/.test(src) || /["'][./]*shared\/db["']/.test(src) || /@prisma\/client/.test(src))
    ) {
      appDbFiles.push(rel);
    }

    const fromLayer = UNIT_LAYERS[from];
    if (fromLayer === undefined) unknown.add(from);

    let m: RegExpExecArray | null;
    IMPORT_RE.lastIndex = 0;
    const seenTargets = new Set<string>();
    while ((m = IMPORT_RE.exec(src))) {
      const spec = m[2] ?? m[3] ?? m[4];
      const typeOnly = Boolean(m[1]) || /^(import|export)\s+type\s/.test(m[0].trimStart());
      const target = resolveSpecifier(abs, spec);
      if (!target) continue;
      const to = unitOf(target);
      if (!to || to === from) continue;
      if (!edges.has(from)) edges.set(from, new Set());
      edges.get(from)!.add(to);
      if (!typeOnly) {
        if (!runtimeEdges.has(from)) runtimeEdges.set(from, new Set());
        runtimeEdges.get(from)!.add(to);
      }
      const toLayer = UNIT_LAYERS[to];
      if (toLayer === undefined) {
        unknown.add(to);
        continue;
      }
      if (fromLayer !== undefined && toLayer < fromLayer && !seenTargets.has(to)) {
        seenTargets.add(to);
        violations.push({ file: rel, from, to, jump: fromLayer - toLayer, typeOnly });
      } else if (fromLayer !== undefined && toLayer < fromLayer && !typeOnly) {
        const prev = violations.find((v) => v.file === rel && v.to === to);
        if (prev) prev.typeOnly = false;
      }
    }
  }

  violations.sort((a, b) => (a.file + a.to).localeCompare(b.file + b.to));
  appDbFiles.sort();
  return {
    units: [...seenUnits].sort(),
    unknownUnits: [...unknown].sort(),
    violations,
    appDbFiles,
    edges,
    runtimeEdges,
  };
}

export interface BaselineEntry {
  /** 与旧格式相同的键：越界是 `file -> to`，app 直连 db 是文件路径 */
  key: string;
  /**
   * 论证（必填）：这条为什么还留着。参考 authz-route-coverage 的 PUBLIC_ANON_2XX
   * 与 ui-quiet-enterprise 的已论证例外 —— 例外不带理由就是一张空头基线，
   * 后人无法判断它是深思熟虑的技术债还是腐烂，`arch:baseline` 重写时也会
   * 把上下文洗掉。新条目先空着，AL8 会把它打红，补上论证才放行。
   */
  why: string;
}

export interface Baseline {
  /** 生成说明，方便人读 */
  note: string;
  /** `file -> to` 形式的越界 import（带论证） */
  layerViolations: BaselineEntry[];
  /** app 层直连数据库的文件（带论证） */
  appDbFiles: BaselineEntry[];
}

export function violationKey(v: Violation): string {
  return `${v.file} -> ${v.to}`;
}

/**
 * 由扫描结果生成基线。`prev` 是旧基线（有则传）：仍在的条目把旧论证带过来，
 * 绝不在重写时丢弃上下文；新出现的条目 `why` 留空，由 AL8 打红、等人补论证。
 * 不传 `prev`（如基线文件不存在）则全部留空 —— 同样会被 AL8 拦下。
 */
export function toBaseline(result: ScanResult, prev?: Baseline | null): Baseline {
  const carry = new Map<string, string>();
  for (const e of [...(prev?.layerViolations ?? []), ...(prev?.appDbFiles ?? [])]) {
    if (e && typeof e.key === "string") carry.set(e.key, e.why ?? "");
  }
  const entry = (key: string): BaselineEntry => ({ key, why: carry.get(key) ?? "" });
  return {
    note:
      "KX-70 分层守卫基线：只许减少、不许新增；每条须带论证 why（见 tests/helpers/architecture-layers.ts 的 BaselineEntry）。还掉一条后运行 `npm run arch:baseline` 重写本文件，旧论证会自动保留，新条目留空待补。",
    layerViolations: result.violations.map((v) => entry(violationKey(v))),
    appDbFiles: result.appDbFiles.map(entry),
  };
}

export function readBaseline(): Baseline {
  return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as Baseline;
}

export function writeBaseline(result: ScanResult): void {
  let prev: Baseline | null = null;
  try {
    prev = readBaseline();
  } catch {
    prev = null;
  }
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(toBaseline(result, prev), null, 2)}\n`, "utf8");
}

/** 只保留 modules/ 之间的边（界面层不参与环的统计）。 */
export function moduleEdges(edges: Map<string, Set<string>>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [a, bs] of edges) {
    if (!a.startsWith("modules/")) continue;
    const kept = new Set([...bs].filter((b) => b.startsWith("modules/")));
    if (kept.size) out.set(a, kept);
  }
  return out;
}

/** 强连通分量（Tarjan），用于报告「大环」规模；KX-71 拆环时作为验收数字。 */
export function stronglyConnectedComponents(edges: Map<string, Set<string>>): string[][] {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const out: string[][] = [];
  const nodes = new Set<string>();
  for (const [a, bs] of edges) {
    nodes.add(a);
    for (const b of bs) nodes.add(b);
  }
  const visit = (v: string) => {
    idx.set(v, index);
    low.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, idx.get(w)!));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) out.push(comp.sort());
    }
  };
  for (const n of [...nodes].sort()) if (!idx.has(n)) visit(n);
  return out.sort((a, b) => b.length - a.length);
}

// CLI：`npx tsx tests/helpers/architecture-layers.ts [--write]`
const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] &&
  /architecture-layers\.(ts|js|mts|mjs)$/.test(process.argv[1].replace(/\\/g, "/"));

if (invokedDirectly) {
  const result = scan();
  const write = process.argv.includes("--write");
  const sccs = stronglyConnectedComponents(moduleEdges(result.runtimeEdges));
  const sccsAll = stronglyConnectedComponents(moduleEdges(result.edges));
  const byLayer = new Map<string, number>();
  for (const v of result.violations) {
    const k = `${LAYER_NAMES[UNIT_LAYERS[v.from]]} → ${LAYER_NAMES[UNIT_LAYERS[v.to]]}`;
    byLayer.set(k, (byLayer.get(k) ?? 0) + 1);
  }
  const typeOnlyCount = result.violations.filter((v) => v.typeOnly).length;
  console.log(`单元 ${result.units.length}，越界 import ${result.violations.length} 条（其中仅类型 ${typeOnlyCount}），app 层直连数据库 ${result.appDbFiles.length} 个文件`);
  for (const [k, n] of [...byLayer].sort()) console.log(`  ${k}: ${n}`);
  if (result.unknownUnits.length) console.log(`未归层的单元: ${result.unknownUnits.join(", ")}`);
  const fmt = (list: string[][]) => (list.length ? list.map((c) => `[${c.length}] ${c.map((x) => x.replace(/^modules\//, "")).join(", ")}`).join("\n       ") : "无");
  console.log(`模块环（运行时导入）: ${fmt(sccs)}`);
  console.log(`模块环（含类型导入）: ${fmt(sccsAll)}`);
  if (write) {
    writeBaseline(result);
    console.log(`已写入 ${relPath(BASELINE_PATH)}`);
  } else {
    for (const v of result.violations) console.log(`  ${violationKey(v)}${v.typeOnly ? "（仅类型）" : ""}`);
  }
}
