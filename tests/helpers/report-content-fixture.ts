/** Explicit test-only semantic verdicts; production never fabricates these from a goal. */
import type { MissionReport } from "../../src/modules/supervisor/report-format";
import { REPORT_CONTENT_SCHEMA } from "../../src/shared/report-content";
export function withReviewedContent(report: MissionReport, topicMatch = true, subject = "红参胶原蛋白肽女士奶粉"): MissionReport {
  return { ...report, title: subject, contentStatus: topicMatch ? "READY" : "REJECTED", content: {
    schemaVersion: REPORT_CONTENT_SCHEMA, inputVersion: "test-only", missionTaskId: report.missionTaskId, nodeTaskId: "test-node",
    status: topicMatch ? "READY" : "REJECTED", subject, title: subject,
    summary: report.recommendation ?? report.conclusion?.split("\n").find(line => !line.startsWith("#")) ?? "",
    risks: [], unknowns: [], decisions: report.decision ? [report.decision] : [], actions: report.recommendation ? [report.recommendation] : [],
    source: { goal: report.goal, body: report.conclusion ?? "", originalBody: report.originalConclusion ?? report.conclusion ?? "", sources: [] },
    layout: { density: "comfortable", summaryLines: 4 }, note: "Explicit fixture review",
    review: { topicMatch, goalQuote: subject, bodyQuote: report.conclusion?.slice(0, 100) ?? "", note: topicMatch ? "Explicit matching fixture" : "需求与正文主题不匹配" },
  } };
}
