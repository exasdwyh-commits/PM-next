import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { produceReportContent, reportContentInputVersion, reviewReportContent, validateReportContentDraft, type ReportContentStore } from "../src/modules/supervisor/report-content-agent";
import { buildMissionPoster } from "../src/modules/supervisor/report-poster";
import { reportTitle, reportSubject, type MissionReport } from "../src/modules/supervisor/report-format";
import { assessMissionReportQuality } from "../src/modules/supervisor/report-quality";
import type { ReportContentDocument } from "../src/shared/report-content";
const report: MissionReport = {
  playbook: "NEW_PRODUCT", missionTaskId: "mission/coffee", title: "研究报告", goal: "我想开发一个新产品：便携咖啡机，面向白领",
  status: "SUCCEEDED", outcome: "COMPLETED", demo: false, createdAt: "2026-10-15T00:00:00Z", constraints: [],
  conclusion: "## 结论摘要\n先验证便携咖啡机的通勤需求（推断）。\n## 风险评估\n- 成本尚无报价。\nUNKNOWN：电池寿命（需要样机测试）\n是否开展样机测试。\n先访谈通勤用户。\n末尾原始正文不可丢弃。",
  originalConclusion: "便携咖啡机原始综合稿：成本和电池寿命未知。",
  decision: "是否开展样机测试。", recommendation: "先访谈通勤用户。", steps: [],
  researchSources: [{ sourceId: "s1", eventId: "e1", title: "研究资料", url: "https://example.com/source", fetchedAt: "2026-10-15T00:00:00Z", sourceKind: "FETCHED_PAGE", contentHash: "sha", snapshot: "未核验的来源快照", truncated: false }],
  meta: { tasksCreated: 1, maxTasks: 5, memoriesUsed: [], successCriteria: [], humanGates: [] },
};
const draft = { subject: "便携咖啡机", title: "新产品：便携咖啡机", summary: "先验证便携咖啡机的通勤需求（推断）。", risks: ["成本尚无报价。"], unknowns: ["UNKNOWN：电池寿命（需要样机测试）"], decisions: ["是否开展样机测试。"], actions: ["先访谈通勤用户。"] };
const review = { topicMatch: true, goalQuote: "新产品：便携咖啡机", bodyQuote: "先验证便携咖啡机的通勤需求（推断）。", note: "内容匹配，保留风险和待验证项；不是事实核验。", title: "便携咖啡机", summary: draft.summary, layout: { density: "compact", summaryLines: 3 } };
function memory() {
  let value: ReportContentDocument | null = null;
  const order: string[] = [];
  const store: ReportContentStore = { read: async () => { order.push("read"); return value && structuredClone(value); }, write: async next => { order.push(`write:${next.status}`); value = structuredClone(next); } };
  return { store, order, get value() { return value; } };
}
async function run(reviewer: unknown = review, extractor: unknown = draft, extra: Partial<Parameters<typeof produceReportContent>[0]> = {}) {
  const db = memory(); let calls = 0;
  const document = await produceReportContent({ report, nodeTaskId: "node/1", store: db.store,
    call: async messages => {
      const data = JSON.parse(messages[1].content);
      if (++calls === 1) { db.order.push("extract"); return { text: typeof extractor === "string" ? extractor : JSON.stringify(extractor) }; }
      db.order.push("review");
      assert.equal(db.value?.status, "DRAFT", "review must happen after durable DRAFT write");
      assert.equal(data.preview.title, draft.title);
      assert.ok(data.preview.unknowns.includes(draft.unknowns[0]));
      return { text: typeof reviewer === "string" ? reviewer : JSON.stringify(reviewer) };
    }, ...extra });
  return { document, db, calls };
}

test("便携咖啡机: Agent extracts, draft persists, template reads it, review removes label, final read publishes", async () => {
  const { document, db, calls } = await run();
  assert.equal(calls, 2); assert.equal(document.status, "READY"); assert.equal(document.title, "便携咖啡机");
  assert.deepEqual(db.order, ["read", "extract", "write:DRAFT", "read", "review", "write:READY", "read"]);
  assert.deepEqual(document.risks, draft.risks); assert.deepEqual(document.unknowns, draft.unknowns);
  assert.equal(document.source.body, report.conclusion); assert.equal(document.source.originalBody, report.originalConclusion);
  assert.equal(document.source.sources[0].snapshot, report.researchSources![0].snapshot);
  const poster = buildMissionPoster({ ...report, content: document, contentStatus: document.status });
  assert.equal(poster.title, "便携咖啡机"); assert.equal(poster.researchBody, report.conclusion);
  assert.ok(poster.risks?.includes(draft.risks[0])); assert.ok(poster.unknowns?.includes(draft.unknowns[0]));
  assert.equal(poster.presentation?.density, "compact");
  assert.deepEqual(poster.conclusions?.[0].verificationRefs, [], "content review is not evidence verification");
});
test("no Agent content: no regex title guessing and no false finished card", () => {
  assert.equal(reportSubject(report.goal), null); assert.equal(reportTitle(report.goal), "研究报告");
  const poster = buildMissionPoster(report);
  assert.match(poster.title!, /待审校草稿/); assert.equal(poster.verificationStatus, "DRAFT_UNVERIFIED");
  assert.ok(assessMissionReportQuality(report).issues.some(i => i.rule === "R-PRESENTATION"));
});
test("mismatched content is rejected, cannot be polished into READY", async () => {
  const { document } = await run({ ...review, topicMatch: false, note: "正文对象错配，需要重新研究。" });
  assert.equal(document.status, "REJECTED"); assert.equal(document.review?.topicMatch, false);
  const quality = assessMissionReportQuality({ ...report, content: document, contentStatus: document.status });
  assert.equal(quality.status, "BLOCKED"); assert.ok(quality.issues.some(i => i.rule === "R-TOPIC"));
});
for (const [label, extractor] of [
  ["malformed JSON", "not json"], ["hallucinated subject", { ...draft, subject: "海苔脆" }],
  ["invented summary", { ...draft, summary: "市场规模已达到100亿。" }], ["invented risk", { ...draft, risks: ["零风险"] }],
  ["non-array unknowns", { ...draft, unknowns: "未知" }], ["oversized title", { ...draft, title: "长".repeat(70) }],
] as const) test(`invalid extraction: ${label} stays FAILED and never reviews`, async () => {
  const { document, calls } = await run(review, extractor); assert.equal(document.status, "FAILED"); assert.equal(calls, 1);
  assert.equal(document.source.body, report.conclusion);
});
for (const [label, patch] of [
  ["unanchored goal", { goalQuote: "奶粉" }], ["invented quote", { bodyQuote: "已验证市场增长" }],
  ["rewritten summary", { summary: "可直接上市。" }], ["redundant label", { title: "新产品：便携咖啡机" }],
  ["invented title fact", { title: "便携咖啡机销量已翻倍" }],
  ["renamed subject", { title: "咖啡杯", subject: "咖啡杯" }], ["risk deletion", { risks: [] }], ["unknown deletion", { unknowns: [] }],
  ["arbitrary CSS", { layout: { density: "position:absolute", summaryLines: 99 } }],
] as const) test(`bounded review rejects ${label}, preserving draft and all original material`, async () => {
  const { document } = await run({ ...review, ...patch }); assert.equal(document.status, "FAILED");
  assert.deepEqual(document.risks, draft.risks); assert.deepEqual(document.unknowns, draft.unknowns);
  assert.equal(document.source.body, report.conclusion);
});
test("review may shorten source excerpts but cannot expand or fabricate them", async () => {
  const good = await run({ ...review, summary: "便携咖啡机的通勤需求" }); assert.equal(good.document.status, "READY");
  const bad = await run({ ...review, summary: report.conclusion }); assert.equal(bad.document.status, "FAILED");
});
test("ready input is idempotent: read cache, no second model or artifact write", async () => {
  const first = await run(); const before = first.db.order.length;
  const second = await produceReportContent({ report, nodeTaskId: "node/1", store: first.db.store, call: async () => { throw new Error("must not call"); } });
  assert.deepEqual(second, first.document); assert.deepEqual(first.db.order.slice(before), ["read"]);
});
test("read-back mismatch prevents review/publication", async () => {
  let reads = 0; let calls = 0; const writes: ReportContentDocument[] = [];
  const document = await produceReportContent({ report, nodeTaskId: "node/1", store: { read: async () => { reads++; return null; }, write: async d => { writes.push(d); } }, call: async () => { calls++; return { text: JSON.stringify(draft) }; } });
  assert.equal(document.status, "FAILED"); assert.equal(calls, 1); assert.equal(reads, 2); assert.deepEqual(writes.map(x => x.status), ["DRAFT", "FAILED"]);
});
test("timeouts terminate at a bounded failure, not fake READY", async () => {
  const db = memory(); const document = await produceReportContent({ report, nodeTaskId: "node/1", store: db.store, timeoutMs: 10, call: async () => new Promise(() => {}) });
  assert.equal(document.status, "FAILED"); assert.deepEqual(db.order, ["read", "write:FAILED"]);
});
test("cancelled workers propagate cancellation and do not commit after review", async () => {
  const db = memory(); const controller = new AbortController(); let calls = 0;
  await assert.rejects(produceReportContent({ report, nodeTaskId: "node/1", store: db.store, signal: controller.signal,
    call: async () => { if (++calls === 2) controller.abort(); return { text: JSON.stringify(calls === 1 ? draft : review) }; } }));
  assert.equal(db.value?.status, "DRAFT"); assert.ok(!db.order.includes("write:READY")); assert.ok(!db.order.includes("write:FAILED"));
});
test("lost execution admission propagates without publication", async () => {
  const db = memory(); let active = true; let calls = 0;
  await assert.rejects(produceReportContent({ report, nodeTaskId: "node/1", store: db.store,
    assertActive: async () => { if (!active) throw new Error("lease lost"); },
    call: async () => { if (++calls === 2) active = false; return { text: JSON.stringify(calls === 1 ? draft : review) }; } }), /lease lost/);
  assert.equal(db.value?.status, "DRAFT");
});
test("body, goal, original draft and source changes invalidate the input fingerprint", () => {
  const hash = reportContentInputVersion(report);
  for (const changed of [{ ...report, conclusion: report.conclusion + "补充" }, { ...report, goal: report.goal + "补充" },
    { ...report, originalConclusion: "另一个原稿" }, { ...report, researchSources: [{ ...report.researchSources![0], contentHash: "new" }] }]) assert.notEqual(reportContentInputVersion(changed), hash);
});
test("empty and demo reports stay FAILED without silently truncating or calling the model", async () => {
  for (const changed of [{ ...report, conclusion: null }, { ...report, demo: true }, { ...report, conclusion: "长".repeat(100_001) }]) {
    const db = memory(); let calls = 0; const document = await produceReportContent({ report: changed, nodeTaskId: "n", store: db.store, call: async () => { calls++; return { text: "{}" }; } });
    assert.equal(document.status, "FAILED"); assert.equal(calls, 0);
  }
});
test("validator checks provenance rather than using category suffix heuristics", () => {
  assert.throws(() => validateReportContentDraft({ ...draft, subject: "新对象" }, report));
  assert.equal(validateReportContentDraft(draft, report).subject, "便携咖啡机");
});
test("wiring: tenant filter, schema, node/mission/input binding, transaction fencing and no GET model calls", () => {
  const store = fs.readFileSync("src/modules/supervisor/report-content-store.ts", "utf8");
  assert.match(store, /where: \{ id, organizationId, type: TYPE, schemaVersion/);
  assert.match(store, /document\.missionTaskId !== missionTaskId/); assert.match(store, /document\.nodeTaskId !== nodeTaskId/); assert.match(store, /document\.inputVersion !== inputVersion/);
  assert.ok(store.indexOf("await lockExecutorGuardTx") < store.indexOf("await tx.artifact.upsert"));
  assert.match(store, /expiresAt/);
  const loader = fs.readFileSync("src/modules/supervisor/takeaway.ts", "utf8");
  assert.ok(loader.indexOf("getKernMissionStatus(session, missionTaskId)") < loader.indexOf("readReportContentArtifact(session"));
  assert.match(loader, /result\.contentInputVersion === inputVersion/); assert.doesNotMatch(loader, /produceReportContent\(/);
  const executor = fs.readFileSync("src/modules/supervisor/generic-executor.ts", "utf8");
  assert.match(executor, /await produceReportContent/); assert.match(executor, /contentArtifactId: id/);
});


test("pre-edit risks and UNKNOWNs remain visible even if the editor omits them", async () => {
  const { document } = await run();
  const poster = buildMissionPoster({ ...report, originalConclusion: "## 风险评估\n- 编辑前的重大风险\nUNKNOWN：原始证据缺口（需要补齐原始资料）", content: document, contentStatus: "READY" });
  assert.ok(poster.risks?.includes("编辑前的重大风险"));
  assert.ok(poster.unknowns?.includes("UNKNOWN：原始证据缺口（需要补齐原始资料）"));
  assert.match(poster.originalResearchBody!, /重大风险/);
});

// Await boundaries must revalidate authority; an earlier admission is not a publication token.
for (const stop of ["cancel", "lease"] as const) {
  test(`boundary: ${stop} during cached READY read never returns a success`, async () => {
    const first = await run(); const controller = new AbortController(); let active = true, calls = 0, writes = 0;
    await assert.rejects(produceReportContent({ report, nodeTaskId: "node/1", signal: controller.signal,
      assertActive: async () => { if (!active) throw new Error("lease lost at cache read"); },
      store: { read: async () => { if (stop === "cancel") controller.abort(); else active = false; return first.document; }, write: async () => { writes++; } },
      call: async () => { calls++; return { text: "{}" }; } }));
    assert.equal(calls, 0); assert.equal(writes, 0);
  });
  test(`boundary: ${stop} during final read cannot acknowledge READY`, async () => {
    const db = memory(), controller = new AbortController(); let active = true, reads = 0, calls = 0;
    await assert.rejects(produceReportContent({ report, nodeTaskId: "node/1", signal: controller.signal,
      assertActive: async () => { if (!active) throw new Error("lease lost at final read"); },
      store: { ...db.store, read: async () => { const value = await db.store.read(); if (++reads === 3) { if (stop === "cancel") controller.abort(); else active = false; } return value; } },
      call: async () => ({ text: JSON.stringify(++calls === 1 ? draft : review) }) }));
    assert.equal(calls, 2); assert.ok(!db.order.includes("write:FAILED"), "revoked worker must not make a compensating write");
  });
}
test("boundary: cache from another mission is not reusable even with the same input text", async () => {
  const first = await run(), db = memory(); let reads = 0, calls = 0;
  const changed = { ...report, missionTaskId: "mission/another" };
  const result = await produceReportContent({ report: changed, nodeTaskId: "node/1",
    store: { ...db.store, read: async () => ++reads === 1 ? first.document : db.store.read() },
    call: async () => ({ text: JSON.stringify(++calls === 1 ? draft : review) }) });
  assert.equal(result.missionTaskId, changed.missionTaskId); assert.equal(calls, 2);
});
test("boundary: cancellation during DRAFT write stops the next read and model call", async () => {
  const db = memory(), controller = new AbortController(); let reads = 0, calls = 0;
  await assert.rejects(produceReportContent({ report, nodeTaskId: "node/1", signal: controller.signal,
    store: { read: async () => { reads++; return db.store.read(); }, write: async d => { await db.store.write(d); controller.abort(); } },
    call: async () => { calls++; return { text: JSON.stringify(draft) }; } }));
  assert.equal(reads, 1); assert.equal(calls, 1); assert.deepEqual(db.order, ["read", "write:DRAFT"]);
});
test("boundary: cancellation during FAILED write propagates rather than returning normally", async () => {
  const controller = new AbortController(); let writes = 0;
  await assert.rejects(produceReportContent({ report, nodeTaskId: "node/1", signal: controller.signal,
    store: { read: async () => null, write: async d => { assert.equal(d.status, "FAILED"); writes++; controller.abort(); } },
    call: async () => ({ text: "malformed" }) }));
  assert.equal(writes, 1);
});
test("boundary: model deadline expiring during final read never acknowledges READY", async () => {
  const db = memory(); let reads = 0, calls = 0;
  const result = await produceReportContent({ report, nodeTaskId: "node/1", timeoutMs: 30,
    store: { ...db.store, read: async () => { if (++reads === 3) await new Promise(r => setTimeout(r, 60)); return db.store.read(); } },
    call: async () => ({ text: JSON.stringify(++calls === 1 ? draft : review) }) });
  assert.equal(result.status, "FAILED"); assert.ok(calls <= 2);
});
test("boundary: already cancelled content processing performs no read, call or write", async () => {
  const controller = new AbortController(); controller.abort(); let work = 0;
  await assert.rejects(produceReportContent({ report, nodeTaskId: "node/1", signal: controller.signal,
    store: { read: async () => { work++; return null; }, write: async () => { work++; } }, call: async () => { work++; return { text: "{}" }; } }));
  assert.equal(work, 0);
});

test("boundary: demo input never reuses a forged READY cache or calls a model", async () => {
  const first = await run(), changed = { ...report, demo: true }; let calls = 0;
  const cached = { ...first.document, inputVersion: reportContentInputVersion(changed) };
  const result = await produceReportContent({ report: changed, nodeTaskId: "node/1", store: { read: async () => cached, write: async () => {} },
    call: async () => { calls++; return { text: "{}" }; } });
  assert.equal(result.status, "FAILED"); assert.equal(calls, 0);
});
