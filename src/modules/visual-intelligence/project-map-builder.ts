import path from "node:path";
import type {
  KernGraphEdge,
  KernGraphNode,
  KernGraphV1,
} from "./contracts";
import { assertValidKernGraph } from "./contracts";

export interface ProjectSourceFile {
  path: string;
  imports?: string[];
}

export interface ProjectMapInput {
  id: string;
  title: string;
  repository?: string;
  revision?: string;
  files: ProjectSourceFile[];
}

type Area = {
  id: string;
  label: string;
  type: string;
  layer: number;
  prefixes: string[];
  detail: string;
};

const AREAS: Area[] = [
  {
    id: "chat-ui",
    label: "Kern Chat",
    type: "CHAT_UI",
    layer: 0,
    prefixes: ["src/app/muse/"],
    detail: "Conversation-first user surface.",
  },
  {
    id: "workbench",
    label: "Management Workbench",
    type: "WORKBENCH",
    layer: 0,
    prefixes: ["src/app/manage/", "src/app/workbench-client"],
    detail: "Products, projects, tasks, evidence and audit management.",
  },
  {
    id: "conversation-api",
    label: "Conversation API",
    type: "API",
    layer: 1,
    prefixes: ["src/app/api/conversations/"],
    detail: "Single HTTP entry for Kern conversations.",
  },
  {
    id: "assistant-runtime",
    label: "Kern Assistant Runtime",
    type: "ASSISTANT_RUNTIME",
    layer: 2,
    prefixes: ["src/modules/assistant-runtime/"],
    detail: "Conversation orchestration, context, autonomy and routing.",
  },
  {
    id: "legacy-capabilities",
    label: "Legacy Advisor Capabilities",
    type: "CAPABILITY_PROVIDER",
    layer: 3,
    prefixes: ["src/modules/advisor/"],
    detail: "Compatibility provider for domain intents/tools during migration.",
  },
  {
    id: "model-gateway",
    label: "Model Gateway",
    type: "MODEL_GATEWAY",
    layer: 3,
    prefixes: ["src/modules/model-gateway/", "src/modules/model-control/"],
    detail: "Model policy, routing and provider execution.",
  },
  {
    id: "work-engine",
    label: "Work Engine",
    type: "WORK_ENGINE",
    layer: 4,
    prefixes: ["src/modules/product-rnd/", "src/modules/workforce/"],
    detail: "Longer-running Product R&D and workforce execution.",
  },
  {
    id: "desktop-runtime",
    label: "Desktop Runtime",
    type: "DESKTOP_RUNTIME",
    layer: 4,
    prefixes: ["src/modules/desktop-runtime/"],
    detail: "Local computer execution and receipts.",
  },
  {
    id: "governance",
    label: "Governance",
    type: "GOVERNANCE",
    layer: 5,
    prefixes: ["src/modules/governance/"],
    detail: "Protected approvals, ToolBroker and capability boundaries.",
  },
  {
    id: "persistence",
    label: "Persistence",
    type: "PERSISTENCE",
    layer: 6,
    prefixes: ["prisma/", "src/shared/db"],
    detail: "PostgreSQL schema and persisted runs, work and receipts.",
  },
];

function clean(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function areaFor(filePath: string): Area | null {
  const normalized = clean(filePath);
  return (
    AREAS.find((area) =>
      area.prefixes.some((prefix) => normalized.startsWith(prefix))
    ) ?? null
  );
}

function targetCandidates(source: string, specifier: string): string[] {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = `src/${specifier.slice(2)}`;
  } else if (specifier.startsWith(".")) {
    base = clean(path.posix.normalize(path.posix.join(path.posix.dirname(source), specifier)));
  } else {
    return [];
  }

  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ];
}

function resolveImport(
  source: string,
  specifier: string,
  fileSet: Set<string>
): string | null {
  for (const candidate of targetCandidates(source, specifier)) {
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

export function extractStaticImports(source: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) found.add(match[1]);
    }
  }
  return [...found];
}

export function buildProjectArchitectureGraph(
  input: ProjectMapInput
): KernGraphV1 {
  const normalizedFiles = input.files.map((file) => ({
    path: clean(file.path),
    imports: file.imports ?? [],
  }));
  const fileSet = new Set(normalizedFiles.map((file) => file.path));

  const areaFiles = new Map<string, ProjectSourceFile[]>();
  for (const file of normalizedFiles) {
    const area = areaFor(file.path);
    if (!area) continue;
    const list = areaFiles.get(area.id) ?? [];
    list.push(file);
    areaFiles.set(area.id, list);
  }

  const nodes: KernGraphNode[] = AREAS.filter((area) => areaFiles.has(area.id)).map(
    (area) => {
      const sources = (areaFiles.get(area.id) ?? []).slice(0, 3);
      return {
        id: area.id,
        type: area.type,
        label: area.label,
        detail: area.detail,
        layer: area.layer,
        truth: "VERIFIED",
        metadata: {
          fileCount: areaFiles.get(area.id)?.length ?? 0,
          repository: input.repository ?? null,
          revision: input.revision ?? null,
        },
        evidenceRefs: sources.map((source) => ({
          ref: source.path,
          title: source.path,
          kind: "repository-source",
        })),
      };
    }
  );

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edgeEvidence = new Map<string, Set<string>>();

  for (const file of normalizedFiles) {
    const sourceArea = areaFor(file.path);
    if (!sourceArea || !nodeIds.has(sourceArea.id)) continue;

    for (const specifier of file.imports) {
      const targetPath = resolveImport(file.path, specifier, fileSet);
      if (!targetPath) continue;
      const targetArea = areaFor(targetPath);
      if (
        !targetArea ||
        sourceArea.id === targetArea.id ||
        !nodeIds.has(targetArea.id)
      ) {
        continue;
      }
      const key = `${sourceArea.id}->${targetArea.id}`;
      const refs = edgeEvidence.get(key) ?? new Set<string>();
      refs.add(file.path);
      refs.add(targetPath);
      edgeEvidence.set(key, refs);
    }
  }

  const edges: KernGraphEdge[] = [...edgeEvidence.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, refs]) => {
      const [from, to] = key.split("->");
      return {
        id: `import-${from}-${to}`,
        from,
        to,
        relation: "IMPORTS",
        label: "代码依赖",
        truth: "VERIFIED",
        evidenceRefs: [...refs].slice(0, 3).map((ref) => ({
          ref,
          title: ref,
          kind: "repository-source",
        })),
      };
    });

  const graph: KernGraphV1 = {
    version: "kern-graph/v1",
    id: input.id,
    title: input.title,
    summary:
      "基于仓库文件与静态 import 关系生成；未观察到的运行时关系不会被猜测为 VERIFIED。",
    view: "SYSTEM",
    subject: {
      kind: "repository",
      label: input.repository ?? input.title,
      ref: input.revision,
    },
    generator: "DETERMINISTIC",
    nodes,
    edges,
    notices: [
      "VERIFIED 仅表示该模块或依赖可从输入的 repository source/index 中直接观察。",
      "动态加载、环境注入和外部服务若未出现在 source index 中，会保持在图外而不是被猜测。",
    ],
  };

  assertValidKernGraph(graph);
  return graph;
}

export interface ArchifyArchitectureSpec {
  schema_version: 1;
  diagram_type: "architecture";
  meta: {
    title: string;
    locale: "zh-CN" | "en";
    quality_profile: "showcase";
  };
  layout: {
    mode: "grid";
    cols: number;
    gapX: number;
    gapY: number;
    cellW: number;
    cellH: number;
  };
  components: Array<{
    id: string;
    type:
      | "frontend"
      | "backend"
      | "database"
      | "cloud"
      | "security"
      | "messagebus"
      | "external";
    label: string;
    sublabel?: string;
    row: number;
    col: number;
    sources?: Array<{ path: string; label?: string }>;
  }>;
  connections: Array<{
    id: string;
    from: string;
    to: string;
    label?: string;
    variant?: "default" | "emphasis" | "security" | "dashed";
  }>;
}

function archifyType(node: KernGraphNode): ArchifyArchitectureSpec["components"][number]["type"] {
  if (node.type === "CHAT_UI" || node.type === "WORKBENCH") return "frontend";
  if (node.type === "GOVERNANCE") return "security";
  if (node.type === "PERSISTENCE") return "database";
  if (node.type === "MODEL_GATEWAY") return "cloud";
  if (node.type === "DESKTOP_RUNTIME") return "external";
  return "backend";
}

export function toArchifyArchitectureSpec(
  graph: KernGraphV1,
  locale: "zh-CN" | "en" = "zh-CN"
): ArchifyArchitectureSpec {
  assertValidKernGraph(graph);
  const layerRow = new Map<number, number>();
  return {
    schema_version: 1,
    diagram_type: "architecture",
    meta: {
      title: graph.title,
      locale,
      quality_profile: "showcase",
    },
    layout: {
      mode: "grid",
      cols: 7,
      gapX: 56,
      gapY: 42,
      cellW: 150,
      cellH: 78,
    },
    components: graph.nodes.map((node) => {
      const row = layerRow.get(node.layer) ?? 0;
      layerRow.set(node.layer, row + 1);
      return {
        id: node.id,
        type: archifyType(node),
        label: node.label,
        sublabel: node.detail,
        row,
        col: node.layer,
        sources: node.evidenceRefs?.slice(0, 3).map((ref) => ({
          path: ref.ref,
          label: ref.title,
        })),
      };
    }),
    connections: graph.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      label: edge.label || edge.relation,
      variant:
        edge.to === "governance" || edge.from === "governance"
          ? "security"
          : "default",
    })),
  };
}
