import { withReviewedContent } from "./helpers/report-content-fixture";
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { buildMissionPoster, missionPosterCitation } from "../src/modules/supervisor/report-poster";
import { missionPosterPath } from "../src/shared/executive-report-citation";
import type { MissionReport } from "../src/modules/supervisor/report-format";
import { buildClarifyQuestions, answerText, buildBriefPlan } from "../src/modules/supervisor/brief";

const report: MissionReport = withReviewedContent({
  playbook: "NEW_PRODUCT", missionTaskId: "mission/test", title: "便携咖啡机", goal: "开发便携咖啡机",
  status: "SUCCEEDED", outcome: "COMPLETED", demo: false, createdAt: "2026-10-13T00:00:00Z",
  constraints: [], conclusion: "## 结论摘要\n**结论与建议**：先验证通勤需求（推断）[source:s1]\n\n## 风险评估\n- 成本缺少报价\n\n## 验证计划与待决策\nUNKNOWN：实际报价（需要 供应商询价）\n\n```text\n## code heading\n```\n\n最终尾注不可丢失",
  decision: "是否开展样品测试", recommendation: "先验证通勤需求", steps: [{ key: "market", label: "市场", agent: "研究员", status: "SUCCEEDED", output: "（事实）需求稳定 [source:s1]\nUNKNOWN：实际报价（需要 供应商询价）" }],
  researchSources: [{ sourceId: "s1", eventId: "e1", title: "真实来源", url: "https://example.com/research", fetchedAt: "2026-10-13T01:00:00Z", sourceKind: "FETCHED_PAGE", contentHash: "hash", snapshot: "body", truncated: false }],
  meta: { tasksCreated: 1, maxTasks: 12, memoriesUsed: [], successCriteria: [], humanGates: [] },
}, true, "便携咖啡机");

test("Mission poster preserves every original section, code fence, trailing text and source markers", () => {
  const poster = buildMissionPoster(report);
  assert.equal(poster.researchBody, report.conclusion!.replace("[source:s1]", "[1]"));
  assert.equal(poster.researchSources?.[0].url, report.researchSources![0].url);
  assert.match(poster.researchBody!, /最终尾注不可丢失/);
  assert.equal(poster.advisoryNotes?.[0].status, "SUCCEEDED");
});

test("Execution success and model FACT labels never create verified evidence", () => {
  const poster = buildMissionPoster(report);
  assert.equal(poster.verificationStatus, "READY_FOR_HUMAN_REVIEW");
  assert.deepEqual(poster.conclusions?.[0].verificationRefs, []);
  assert.equal(missionPosterCitation(poster, report.missionTaskId).stats?.verified, 0);
  assert.deepEqual(poster.provenance?.modelRunRefs, []);
});

test("Unknowns are retained and deduplicated without discarding their remediation", () => {
  const poster = buildMissionPoster(report);
  assert.deepEqual(poster.unknowns, ["UNKNOWN：实际报价（需要 供应商询价）"]);
  assert.deepEqual(poster.decisionsRequired, ["是否开展样品测试"]);
  assert.deepEqual(poster.risks, ["成本缺少报价"]);
  assert.equal(poster.summary, "先验证通勤需求");
});

test("Demo sources never leak into the real evidence list", () => {
  const poster = buildMissionPoster({ ...report, demo: true, content: undefined, contentStatus: "MISSING" });
  assert.deepEqual(poster.researchSources, []);
  assert.deepEqual(poster.provenance?.sourceRefs, []);
  assert.match(poster.unknowns![0], /演示数据/);
  assert.match(poster.title!, /演示/);
  assert.doesNotMatch(poster.researchBody!, /\[1\]/);
});

test("No-source mission remains explicitly unverified and retains the raw analysis", () => {
  const poster = buildMissionPoster({ ...report, researchSources: [] });
  assert.match(poster.unknowns![0], /执行完成不等于结论已核实/);
  assert.match(poster.researchBody!, /来源未记录/);
});

test("Mission route uses a same-origin encoded URL, never the artifact API", () => {
  assert.equal(missionPosterPath("a/b ?"), "/reports/missions/a%2Fb%20%3F");
  const citation = missionPosterCitation(buildMissionPoster(report), report.missionTaskId);
  assert.equal(citation.kind, "mission-report");
  const card = fs.readFileSync("src/app/muse/rich/report-card.tsx", "utf8");
  assert.match(card, /isMission \? missionPosterPath/);
});

test("Poster route inherits the requester-only loader and never makes an anonymous report public", () => {
  const page = fs.readFileSync("src/app/reports/missions/[id]/page.tsx", "utf8");
  assert.match(page, /getServerSessionFromContext/);
  assert.match(page, /loadMissionReport\(session, id\)/);
  assert.match(page, /report\.playbook !== "NEW_PRODUCT"/);
  assert.match(page, /report\.outcome !== "COMPLETED"/);
  assert.match(page, /UnauthorizedError.*redirect/);
  assert.match(page, /NotFoundError.*notFound/);
});

test("Historical mission conclusions use a thumbnail in conversation and V3 inside workspace", () => {
  const component = fs.readFileSync("src/app/muse/components/mission-conclusion.tsx", "utf8");
  assert.match(component, /props\.density === "full"/);
  assert.match(component, /<ReportV3 report=\{presentation.poster\} embedded/);
  assert.match(component, /<ReportCard citation=\{presentation.citation\}/);
  assert.doesNotMatch(component, /props: any/);
});

test("Opening brief keeps three questions but provides broad choices with stable IDs", () => {
  const questions = buildClarifyQuestions("NEW_PRODUCT", "新产品", []);
  assert.equal(questions.length, 3);
  assert.ok(questions[0].options.length >= 9);
  assert.ok(questions[1].options.length >= 6);
  assert.ok(questions[2].options.length >= 9);
  for (const question of questions) {
    assert.equal(new Set(question.options.map(option => option.id)).size, question.options.length);
    assert.ok(question.options.some(option => option.id === "open"));
    question.answer = { optionId: "open", text: "" };
    assert.equal(answerText(question), null);
  }
  assert.equal(buildBriefPlan({ goal: "新产品", playbook: "NEW_PRODUCT", questions }).goal, "新产品");
});

test("New audience and combined-channel choices are passed into the real plan", () => {
  const questions = buildClarifyQuestions("NEW_PRODUCT", "新产品", []);
  questions[0].answer = { optionId: "senior", text: "" };
  questions[2].answer = { optionId: "omni", text: "" };
  const plan = buildBriefPlan({ goal: "新产品", playbook: "NEW_PRODUCT", questions });
  assert.match(plan.goal, /银发人群/);
  assert.match(plan.goal, /线上线下协同/);
});
