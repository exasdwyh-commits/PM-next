import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildProjectArchitectureGraph,
  extractStaticImports,
  listUnmappedSourceFiles,
  projectAreaPrefixes,
  toArchifyArchitectureSpec,
  type ProjectSourceFile,
} from "../src/modules/visual-intelligence/project-map-builder";

const ROOT = process.cwd();

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".next", ".git"].includes(entry.name)) continue;
      out.push(...walk(full));
    } else if (/\.(?:ts|tsx|js|jsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const sourcePaths = [
  ...walk(path.join(ROOT, "src")),
  path.join(ROOT, "prisma", "schema.prisma"),
].filter((file) => fs.existsSync(file));

const files: ProjectSourceFile[] = sourcePaths.map((absolutePath) => {
  const rel = path.relative(ROOT, absolutePath).replaceAll(path.sep, "/");
  const source = fs.readFileSync(absolutePath, "utf8");
  return {
    path: rel,
    imports: /\.(?:ts|tsx|js|jsx)$/.test(rel)
      ? extractStaticImports(source)
      : [],
  };
});

const graph = buildProjectArchitectureGraph({
  id: "pm-next-runtime-map",
  title: "PM-next / Kern Runtime Map",
  repository: "exasdwyh-commits/PM-next",
  revision: "WORKTREE",
  files,
});

const nodeIds = new Set(graph.nodes.map((node) => node.id));
for (const required of [
  "chat-ui",
  "workbench",
  "conversation-api",
  "assistant-runtime",
  "kern-router",
  "capability-registry",
  "advisor-support",
  "model-gateway",
  "work-engine",
  "desktop-runtime",
  "governance",
  "persistence",
  "platform-api",
  "supervisor",
  "worker",
  "research",
  "cost-engine",
  "decision-intelligence",
  "evidence",
  "domain-data",
  "platform-services",
  "shared-kernel",
]) {
  assert.ok(nodeIds.has(required), `missing project-map node: ${required}`);
}

const unmapped = listUnmappedSourceFiles(files);
const unmappedRatio = files.length ? unmapped.length / files.length : 0;
assert.ok(
  unmappedRatio <= 0.02,
  [
    `project map coverage regressed: ${unmapped.length}/${files.length} source files fall outside every declared area (${(unmappedRatio * 100).toFixed(1)}%).`,
    "Add the new module to AREAS in src/modules/visual-intelligence/project-map-builder.ts.",
    ...unmapped.slice(0, 20),
  ].join("\n")
);

const edgeKeys = new Set(graph.edges.map((edge) => `${edge.from}->${edge.to}`));
assert.ok(
  edgeKeys.has("conversation-api->assistant-runtime"),
  "conversation API must enter Kern Assistant Runtime"
);
assert.ok(
  edgeKeys.has("assistant-runtime->kern-router"),
  "Assistant Runtime must route through Kern Router"
);
assert.ok(
  edgeKeys.has("assistant-runtime->capability-registry"),
  "Assistant Runtime must execute through the native capability registry"
);
assert.ok(
  edgeKeys.has("assistant-runtime->model-gateway"),
  "Assistant Runtime must own model routing"
);
assert.ok(
  edgeKeys.has("capability-registry->work-engine"),
  "capability registry must delegate Product R&D / workforce work"
);
assert.ok(
  edgeKeys.has("capability-registry->desktop-runtime"),
  "capability registry must delegate desktop work"
);
assert.ok(
  edgeKeys.has("capability-registry->advisor-support"),
  "legacy Advisor code may remain only as supporting libraries behind native capabilities"
);
assert.ok(
  edgeKeys.has("capability-registry->supervisor"),
  "capability registry must delegate missions to the Mission Supervisor"
);
assert.ok(
  edgeKeys.has("supervisor->worker"),
  "Mission Supervisor must hand execution to the Worker Runtime"
);
assert.ok(
  edgeKeys.has("supervisor->governance"),
  "Mission Supervisor must pass protected work through Governance"
);
assert.ok(
  edgeKeys.has("evidence->governance"),
  "evidence verification must stay connected to Governance"
);
assert.ok(
  edgeKeys.has("platform-api->supervisor"),
  "platform API must reach the Mission Supervisor"
);

const archify = toArchifyArchitectureSpec(graph);
assert.equal(archify.schema_version, 1);
assert.equal(archify.diagram_type, "architecture");
assert.equal(archify.meta.quality_profile, "showcase");
assert.equal(archify.components.length, graph.nodes.length);
assert.equal(archify.connections.length, graph.edges.length);
assert.ok(
  archify.components.every((component) => component.sources?.length),
  "every project-map area should preserve source evidence"
);

// ===========================================================================
// AREAS 归属唯一性（2026-10-14 事故固化）
// ===========================================================================
//
// 事故形态：两个会话各自往 AREAS 的相邻但不同锚点补登同一批文件，git 按行合并
// 把两份都留下 —— 无冲突标记、覆盖率仍 100%、节点数不变，**测试全绿而数据已坏**。
// 唯一的暴露窗口是「将来有人重排 AREAS 时该文件静默换区」，diff 里看不出这个意图。
//
// 因此把三条不变量钉死：
//   ① 区内不得重复登记同一前缀（重复登记即死数据，今天不改变行为但会掩盖未来的重排意图）；
//   ② 跨区不得重复登记同一前缀（`AREAS.find()` 首个匹配胜出 → 后来的那条永远够不到）；
//   ③ 不得被更早的区的更宽前缀遮蔽（顺序即语义：`src/app/api/` 若排到
//      `src/app/api/conversations/` 前面，后者的细分归属会整体失效）。
//
// 判据只依赖 prefixes 本身，不依赖仓库内恰好有哪些文件 —— 否则「某个前缀暂时没文件命中」
// 会让守卫假绿，正是这次事故能潜伏的原因。
const areaPrefixes = projectAreaPrefixes();
assert.ok(areaPrefixes.length > 0, "AREAS must not be empty");

const duplicateAreaIds = areaPrefixes
  .map((area) => area.id)
  .filter((id, index, all) => all.indexOf(id) !== index);
assert.deepEqual(duplicateAreaIds, [], `areas 的 id 必须唯一（重复：${duplicateAreaIds.join(", ")}）`);

const emptyPrefixAreas = areaPrefixes.filter((area) => area.prefixes.length === 0).map((area) => area.id);
assert.deepEqual(emptyPrefixAreas, [], `每个 area 至少要有一个 prefix（空 prefixes 的区：${emptyPrefixAreas.join(", ")}）`);

const intraAreaDuplicates: string[] = [];
for (const area of areaPrefixes) {
  const seen = new Set<string>();
  for (const prefix of area.prefixes) {
    if (seen.has(prefix)) intraAreaDuplicates.push(`${area.id} → ${prefix}`);
    seen.add(prefix);
  }
}
assert.deepEqual(
  intraAreaDuplicates,
  [],
  [
    "同一个 area 内不得重复登记同一 prefix（这是 2026-10-14 静默合并的直接产物）：",
    ...intraAreaDuplicates,
    "修法：删掉重复的那一条，而不是调整顺序。",
  ].join("\n")
);

const prefixOwners = new Map<string, string[]>();
for (const area of areaPrefixes) {
  for (const prefix of area.prefixes) prefixOwners.set(prefix, [...(prefixOwners.get(prefix) ?? []), area.id]);
}
const crossAreaDuplicates = [...prefixOwners.entries()]
  .filter(([, ids]) => ids.length > 1)
  .map(([prefix, ids]) => `${prefix} → ${ids.join(" / ")}`);
assert.deepEqual(
  crossAreaDuplicates,
  [],
  [
    "同一 prefix 不得登记进两个 area（AREAS.find() 首个匹配胜出，后来的那条永远不可达）：",
    ...crossAreaDuplicates,
  ].join("\n")
);

const flatPrefixes = areaPrefixes.flatMap((area, index) => area.prefixes.map((prefix) => ({ index, area: area.id, prefix })));
const shadowed: string[] = [];
for (const later of flatPrefixes) {
  for (const earlier of flatPrefixes) {
    if (earlier.index === later.index) continue; // 区内顺序不影响 areaFor 的结果（同区 some(any)）
    if (earlier.index < later.index && earlier.prefix !== later.prefix && later.prefix.startsWith(earlier.prefix)) {
      shadowed.push(`${later.prefix}（${later.area}）被更早的 ${earlier.prefix}（${earlier.area}）遮蔽`);
    }
  }
}
assert.deepEqual(
  shadowed,
  [],
  [
    "更宽的前缀不得排在更窄的前缀之前 —— 顺序即语义，被遮蔽的细分归属会整体失效：",
    ...shadowed.slice(0, 10),
  ].join("\n")
);

console.log(
  [
    `✅ Kern Project Map: ${graph.nodes.length} areas / ${graph.edges.length} verified dependency edges / Archify adapter ready`,
    `Coverage: ${files.length - unmapped.length}/${files.length} source files mapped (${((1 - unmappedRatio) * 100).toFixed(1)}%)`,
  ].join("\n")
);

// Coverage regression: classify real compatibility surfaces explicitly, not via a catch-all.
const compatibilityFiles: ProjectSourceFile[] = [
  { path: "src/app/demo-cost-rich/page.tsx", imports: [] },
];
assert.deepEqual(listUnmappedSourceFiles(compatibilityFiles), []);
assert.deepEqual(
  listUnmappedSourceFiles([{ path: "src/modules/not-yet-classified/index.ts" }]),
  ["src/modules/not-yet-classified/index.ts"],
  "unknown future modules must still trip the coverage guard"
);
const compatibilityGraph = buildProjectArchitectureGraph({
  id: "compatibility-source-fixture", title: "Compatibility source fixture", files: compatibilityFiles,
});
assert.ok(compatibilityGraph.nodes.some((node) => node.id === "demo-surfaces"));
assert.equal(
  toArchifyArchitectureSpec(compatibilityGraph).components.find((node) => node.id === "demo-surfaces")?.type,
  "frontend"
);
