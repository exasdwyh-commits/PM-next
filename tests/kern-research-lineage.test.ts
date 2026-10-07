import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { collectMissionSources, uniqueMissionSources } from "../src/modules/supervisor/research-sources";
import type { MissionEventRecord } from "../src/modules/supervisor/events";
import { envelopeFromMission } from "../src/modules/response-format/from-mission";
import { missionReportMarkdown, resolveSourceMarkers, type MissionReport } from "../src/modules/supervisor/report-format";
import { toolsFor } from "../src/modules/supervisor/tools";
import { validate } from "../src/modules/response-format/validate";

const event = (seq: number, type: MissionEventRecord["type"], payload: Record<string, unknown>, nodeKey = "research"): MissionEventRecord => ({ id: `event-${seq}`, seq, type, payload, nodeKey, actorUserId: null, demo: false, createdAt: "2026-10-05T00:00:00Z" });
const snapshot = "Example source text, not independently verified";
const citation = { taskId: "task-1", sourceId: "capture-1", sourceKind: "FETCHED_PAGE", title: "Source", url: "https://example.com/research", fetchedAt: "2026-10-05T00:00:00Z", snapshot, contentHash: createHash("sha256").update(snapshot).digest("hex"), truncated: false };
const report: MissionReport = { missionTaskId: "mission", title: "Research", goal: "Research", status: "SUCCEEDED", outcome: "COMPLETED", demo: false, createdAt: "2026-10-05T00:00:00Z", conclusion: "## 结论\n需要补证。", decision: null, recommendation: null, constraints: [], steps: [], meta: { tasksCreated: 1, maxTasks: 4, memoriesUsed: [], successCriteria: [], humanGates: [] } };

test("durable citations reach the report and export without becoming verified facts", () => {
  const sources = collectMissionSources([event(1, "node.started", { taskId: "task-1" }), event(2, "node.cite", citation)]);
  assert.equal(sources[0].eventId, "event-2");
  assert.equal(resolveSourceMarkers("结论 [source:capture-1] [source:invented]", sources), "结论 [1] （来源未记录）");
  const env = envelopeFromMission(report, { model: "test", elapsedMs: 1, quota: null, researchSources: sources });
  assert.equal(env.meta.sources, 1);
  assert.equal(env.blocks.some((b) => b.type === "callout" && b.title === "这次没有联网研究"), false);
  const evidence = env.blocks.find((b) => b.type === "evidence");
  assert.equal(evidence?.items[0].trust, "untrusted");
  assert.equal(evidence?.items[0].contentHash, citation.contentHash);
  assert.deepEqual(validate(env), []);
  const md = missionReportMarkdown({ ...report, researchSources: sources });
  for (const text of [citation.url, citation.sourceId, citation.contentHash, snapshot, "尚未独立核验"]) assert.ok(md.includes(text), text);
});

test("reruns reject old and late citations; inherited records retain original identity", () => {
  const events = [event(1, "node.started", { taskId: "task-1" }), event(2, "node.cite", citation), event(3, "node.rerun", { resetKeys: ["research", "qa"] }), event(4, "node.cite", citation)];
  assert.equal(collectMissionSources(events).length, 0);
  events.push(event(5, "node.started", { taskId: "task-2" }), event(6, "node.cite", citation));
  assert.equal(collectMissionSources(events).length, 0);
  events.push(event(7, "node.cite", { ...citation, taskId: "task-2" }), event(8, "node.started", { taskId: "qa-1" }, "qa"), event(9, "node.cite", { ...citation, taskId: "qa-1", inherited: true, eventId: "event-7" }, "qa"));
  assert.equal(uniqueMissionSources(collectMissionSources(events)).length, 1);
  assert.equal(uniqueMissionSources(collectMissionSources(events))[0].eventId, "event-7");
  assert.equal(collectMissionSources([event(1, "node.cite", { ...citation, snapshot: "tampered" })]).length, 0);
  assert.equal(collectMissionSources([event(1, "node.cite", { ...citation, url: "javascript:alert(1)" })]).length, 0);
});

test("web tools capture search snippets and fetched text separately", async () => {
  const ctx = { organizationId: "org", webSearch: async () => [{ title: "Search", url: citation.url, snippet: "search only" }], webFetch: async () => ({ url: citation.url, title: "Page", text: snapshot, truncated: true }) };
  const tools = toolsFor(ctx);
  const search = await tools.find((t) => t.name === "web_search")!.run({ query: "test" }, ctx);
  const fetch = await tools.find((t) => t.name === "web_fetch")!.run({ url: citation.url }, ctx);
  assert.equal(search.citations?.[0].sourceKind, "SEARCH_RESULT");
  assert.equal(fetch.citations?.[0].sourceKind, "FETCHED_PAGE");
  assert.equal(fetch.citations?.[0].contentHash, citation.contentHash);
  assert.equal(fetch.citations?.[0].truncated, true);
  assert.notEqual(search.citations?.[0].sourceId, fetch.citations?.[0].sourceId);
});
