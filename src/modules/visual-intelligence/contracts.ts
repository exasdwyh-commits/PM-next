export type KernGraphView =
  | "SYSTEM"
  | "DEPENDENCY"
  | "CAUSAL"
  | "DECISION"
  | "EXECUTION";

export type KernGraphTruth = "VERIFIED" | "INFERRED" | "UNKNOWN";
export type KernGraphGenerator = "DETERMINISTIC" | "MODEL" | "HYBRID";

export interface KernGraphEvidenceRef {
  ref: string;
  title?: string;
  kind?: string;
}

export interface KernGraphNode {
  id: string;
  type: string;
  label: string;
  detail?: string;
  layer: number;
  truth: KernGraphTruth;
  metadata?: Record<string, string | number | boolean | null>;
  evidenceRefs?: KernGraphEvidenceRef[];
}

export interface KernGraphEdge {
  id: string;
  from: string;
  to: string;
  relation: string;
  label?: string;
  truth: KernGraphTruth;
  evidenceRefs?: KernGraphEvidenceRef[];
}

export interface KernGraphV1 {
  version: "kern-graph/v1";
  id: string;
  title: string;
  summary: string;
  view: KernGraphView;
  subject: {
    kind: string;
    label: string;
    ref?: string;
  };
  generator: KernGraphGenerator;
  nodes: KernGraphNode[];
  edges: KernGraphEdge[];
  notices: string[];
}

export interface KernGraphCitation {
  kind: "kern-graph";
  ref: string;
  title: string;
  graph: KernGraphV1;
}

export interface KernGraphDiagnostic {
  code: string;
  message: string;
  subjectId?: string;
}

export interface KernGraphValidation {
  ok: boolean;
  diagnostics: KernGraphDiagnostic[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const VIEWS = new Set<KernGraphView>([
  "SYSTEM",
  "DEPENDENCY",
  "CAUSAL",
  "DECISION",
  "EXECUTION",
]);
const TRUTHS = new Set<KernGraphTruth>(["VERIFIED", "INFERRED", "UNKNOWN"]);
const GENERATORS = new Set<KernGraphGenerator>(["DETERMINISTIC", "MODEL", "HYBRID"]);

export function validateKernGraph(value: unknown): KernGraphValidation {
  const diagnostics: KernGraphDiagnostic[] = [];
  if (!isRecord(value)) {
    return {
      ok: false,
      diagnostics: [{ code: "GRAPH_NOT_OBJECT", message: "Graph must be an object." }],
    };
  }

  if (value.version !== "kern-graph/v1") {
    diagnostics.push({
      code: "GRAPH_VERSION_UNSUPPORTED",
      message: "Only kern-graph/v1 is supported.",
    });
  }
  if (typeof value.id !== "string" || !value.id.trim()) {
    diagnostics.push({ code: "GRAPH_ID_REQUIRED", message: "Graph id is required." });
  }
  if (typeof value.title !== "string" || !value.title.trim()) {
    diagnostics.push({ code: "GRAPH_TITLE_REQUIRED", message: "Graph title is required." });
  }
  if (typeof value.summary !== "string") {
    diagnostics.push({ code: "GRAPH_SUMMARY_REQUIRED", message: "Graph summary must be a string." });
  }
  if (typeof value.view !== "string" || !VIEWS.has(value.view as KernGraphView)) {
    diagnostics.push({ code: "GRAPH_VIEW_INVALID", message: "Graph view is invalid." });
  }
  if (
    typeof value.generator !== "string" ||
    !GENERATORS.has(value.generator as KernGraphGenerator)
  ) {
    diagnostics.push({
      code: "GRAPH_GENERATOR_INVALID",
      message: "Graph generator is invalid.",
    });
  }

  const nodes = Array.isArray(value.nodes) ? value.nodes : [];
  const edges = Array.isArray(value.edges) ? value.edges : [];
  if (nodes.length === 0) {
    diagnostics.push({ code: "GRAPH_EMPTY", message: "Graph must contain at least one node." });
  }
  if (nodes.length > 60) {
    diagnostics.push({
      code: "GRAPH_TOO_LARGE",
      message: "Graph exceeds the V1 limit of 60 nodes.",
    });
  }

  const nodeIds = new Set<string>();
  for (const raw of nodes) {
    if (!isRecord(raw)) {
      diagnostics.push({ code: "NODE_INVALID", message: "Graph node must be an object." });
      continue;
    }
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!id) {
      diagnostics.push({ code: "NODE_ID_REQUIRED", message: "Node id is required." });
      continue;
    }
    if (nodeIds.has(id)) {
      diagnostics.push({
        code: "NODE_ID_DUPLICATE",
        message: "Node ids must be unique.",
        subjectId: id,
      });
    }
    nodeIds.add(id);

    if (typeof raw.label !== "string" || !raw.label.trim()) {
      diagnostics.push({
        code: "NODE_LABEL_REQUIRED",
        message: "Node label is required.",
        subjectId: id,
      });
    }
    if (
      typeof raw.layer !== "number" ||
      !Number.isInteger(raw.layer) ||
      raw.layer < 0 ||
      raw.layer > 12
    ) {
      diagnostics.push({
        code: "NODE_LAYER_INVALID",
        message: "Node layer must be an integer between 0 and 12.",
        subjectId: id,
      });
    }
    if (typeof raw.truth !== "string" || !TRUTHS.has(raw.truth as KernGraphTruth)) {
      diagnostics.push({
        code: "NODE_TRUTH_INVALID",
        message: "Node truth state is invalid.",
        subjectId: id,
      });
    }
  }

  const edgeIds = new Set<string>();
  for (const raw of edges) {
    if (!isRecord(raw)) {
      diagnostics.push({ code: "EDGE_INVALID", message: "Graph edge must be an object." });
      continue;
    }
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const from = typeof raw.from === "string" ? raw.from.trim() : "";
    const to = typeof raw.to === "string" ? raw.to.trim() : "";
    if (!id) {
      diagnostics.push({ code: "EDGE_ID_REQUIRED", message: "Edge id is required." });
      continue;
    }
    if (edgeIds.has(id)) {
      diagnostics.push({
        code: "EDGE_ID_DUPLICATE",
        message: "Edge ids must be unique.",
        subjectId: id,
      });
    }
    edgeIds.add(id);
    if (!nodeIds.has(from) || !nodeIds.has(to)) {
      diagnostics.push({
        code: "EDGE_ENDPOINT_MISSING",
        message: "Every edge must reference existing nodes.",
        subjectId: id,
      });
    }
    if (from && from === to) {
      diagnostics.push({
        code: "EDGE_SELF_REFERENCE",
        message: "Self-referencing edges are not supported in V1.",
        subjectId: id,
      });
    }
    if (typeof raw.relation !== "string" || !raw.relation.trim()) {
      diagnostics.push({
        code: "EDGE_RELATION_REQUIRED",
        message: "Edge relation is required.",
        subjectId: id,
      });
    }
    if (typeof raw.truth !== "string" || !TRUTHS.has(raw.truth as KernGraphTruth)) {
      diagnostics.push({
        code: "EDGE_TRUTH_INVALID",
        message: "Edge truth state is invalid.",
        subjectId: id,
      });
    }
  }

  return { ok: diagnostics.length === 0, diagnostics };
}

export function assertValidKernGraph(value: unknown): asserts value is KernGraphV1 {
  const result = validateKernGraph(value);
  if (!result.ok) {
    const summary = result.diagnostics
      .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
      .join("; ");
    throw new Error(`Invalid KernGraphV1: ${summary}`);
  }
}

export function toKernGraphCitation(graph: KernGraphV1): KernGraphCitation {
  assertValidKernGraph(graph);
  return {
    kind: "kern-graph",
    ref: graph.id,
    title: graph.title,
    graph,
  };
}

export function readKernGraphCitation(value: unknown): KernGraphV1 | null {
  if (!isRecord(value) || value.kind !== "kern-graph") return null;
  const graph = value.graph;
  const validation = validateKernGraph(graph);
  return validation.ok ? (graph as KernGraphV1) : null;
}
