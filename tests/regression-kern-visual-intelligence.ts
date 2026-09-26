import assert from "node:assert/strict";
import {
  buildKernCouncilGraph,
  readKernGraphCitation,
  toKernGraphCitation,
  validateKernGraph,
} from "../src/modules/visual-intelligence";
import type { KernCollaborationPlanShadow } from "../src/modules/assistant-runtime/collaboration-planner";

const plan: KernCollaborationPlanShadow = {
  version: "kern-collaboration-shadow/v1",
  mode: "COUNCIL",
  experts: [
    "research_agent",
    "scientific_evidence_agent",
    "formulation_agent",
  ],
  synthesisTier: "FRONTIER",
  researchRequired: true,
  independentFirstPass: true,
  qaRequired: true,
  redTeamRequired: false,
  autoDispatchCandidate: false,
  autoDispatchEligible: false,
  authority: "ADVISORY_ONLY",
  source: "DETERMINISTIC",
  reasons: ["MARKET_SIGNAL", "SCIENCE_SIGNAL", "FORMULATION_SIGNAL"],
};

const graph = buildKernCouncilGraph({
  graphId: "test-run:council",
  goal: "拆解这个配方，并让市场、科学和配方顾问一起评估",
  plan,
});

const validation = validateKernGraph(graph);
assert.equal(validation.ok, true);
assert.equal(graph.view, "DECISION");
assert.equal(graph.nodes.find((node) => node.id === "goal")?.truth, "VERIFIED");
assert.equal(
  graph.nodes.find((node) => node.id === "kern-router")?.truth,
  "INFERRED"
);
assert.ok(graph.nodes.some((node) => node.id === "qa-check"));
assert.ok(graph.nodes.some((node) => node.id === "kern-synthesis"));

const citation = toKernGraphCitation(graph);
assert.equal(readKernGraphCitation(citation)?.id, graph.id);

const broken = {
  ...graph,
  edges: [
    ...graph.edges,
    {
      id: "broken",
      from: "missing-node",
      to: "goal",
      relation: "BROKEN",
      truth: "INFERRED",
    },
  ],
};
const brokenValidation = validateKernGraph(broken);
assert.equal(brokenValidation.ok, false);
assert.ok(
  brokenValidation.diagnostics.some(
    (diagnostic) => diagnostic.code === "EDGE_ENDPOINT_MISSING"
  )
);

console.log("✅ Kern Visual Intelligence: typed graph + validator + council graph");
