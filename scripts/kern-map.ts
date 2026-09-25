import fs from "node:fs";
import path from "node:path";
import {
  buildProjectArchitectureGraph,
  extractStaticImports,
  toArchifyArchitectureSpec,
  type ProjectSourceFile,
} from "../src/modules/visual-intelligence/project-map-builder";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "docs", "maps");

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

function sourceIndex(): ProjectSourceFile[] {
  const paths = [
    ...walk(path.join(ROOT, "src")),
    path.join(ROOT, "prisma", "schema.prisma"),
  ].filter((file) => fs.existsSync(file));

  return paths.map((absolutePath) => {
    const rel = path.relative(ROOT, absolutePath).replaceAll(path.sep, "/");
    const source = fs.readFileSync(absolutePath, "utf8");
    return {
      path: rel,
      imports: /\.(?:ts|tsx|js|jsx)$/.test(rel)
        ? extractStaticImports(source)
        : [],
    };
  });
}

const revision =
  process.env.GITHUB_SHA?.trim() ||
  process.env.KERN_MAP_REVISION?.trim() ||
  "WORKTREE";

const graph = buildProjectArchitectureGraph({
  id: "kern-runtime-map",
  title: "Kern Runtime Architecture",
  repository: "exasdwyh-commits/PM-next",
  revision,
  files: sourceIndex(),
});
const archify = toArchifyArchitectureSpec(graph);

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const graphPath = path.join(OUTPUT_DIR, "kern-runtime.kern-graph.json");
const archifyPath = path.join(OUTPUT_DIR, "kern-runtime.archify.json");

fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2) + "\n");
fs.writeFileSync(archifyPath, JSON.stringify(archify, null, 2) + "\n");

console.log(
  [
    `KernGraph: ${path.relative(ROOT, graphPath)}`,
    `Archify: ${path.relative(ROOT, archifyPath)}`,
    `Areas: ${graph.nodes.length}`,
    `Verified dependency edges: ${graph.edges.length}`,
  ].join("\n")
);
