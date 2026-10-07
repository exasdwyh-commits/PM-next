import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildProjectArchitectureGraph,
  extractStaticImports,
  listUnmappedSourceFiles,
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

console.log(
  [
    `✅ Kern Project Map: ${graph.nodes.length} areas / ${graph.edges.length} verified dependency edges / Archify adapter ready`,
    `Coverage: ${files.length - unmapped.length}/${files.length} source files mapped (${((1 - unmappedRatio) * 100).toFixed(1)}%)`,
  ].join("\n")
);
