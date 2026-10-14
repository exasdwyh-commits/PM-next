/** Pure, lossless projection of a personal mission into the existing Muse v3 report. */
import type { ExecutiveReportPayload } from "@/shared/executive-report-types";
import type { ExecutiveReportCitation } from "@/shared/executive-report-citation";
import { conclusionLead, resolveSourceMarkers, type MissionReport } from "./report-format";
import type { ReportQuality } from "./report-quality";

/** Only actual list items become risk cards; a section heading is never a risk. */
function riskItems(text: string): string[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const start = lines.findIndex(line => /^\s*#{1,6}\s+.*(?:风险评估|主要风险)/.test(line));
  if (start < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*#{1,6}\s/.test(line)) break;
    const match = /^\s*(?:[-*•]|\d+[.、)])\s+(.+)$/.exec(line);
    if (match) out.push(match[1]);
  }
  return out;
}

/** Keep the entire original Markdown, including unrecognized sections and fenced code. */
export function buildMissionPoster(report: MissionReport, quality?: ReportQuality): ExecutiveReportPayload {
  const sources = report.demo ? [] : report.researchSources ?? [];
  const text = resolveSourceMarkers(report.conclusion ?? "", sources);
  const unknowns = [...new Set([text, ...report.steps.map(step => step.output ?? "")]
    .flatMap(body => body.split(/\r?\n/).filter(line => /UNKNOWN\s*[：:]/i.test(line)).map(line => line.trim())))];
  if (!sources.length) unknowns.unshift(report.demo ? "演示数据：不能作为真实研究、报价或审批依据。" : "尚无已捕获的外部来源：需补齐真实研究资料；执行完成不等于结论已核实。");
  const summary = resolveSourceMarkers(report.recommendation ?? conclusionLead(text.split("\n").filter(line => !/^\s*#/.test(line)).join("\n")) ?? "研究已完成，请结合来源、缺口与 QA 记录审阅。", sources);
  return {
    title: `${report.title}${report.demo ? "（演示）" : ""} · 新产品研究报告`,
    createdAt: report.createdAt,
    summary,
    verificationStatus: quality?.status === "BLOCKED" ? "BLOCKED_BY_QUALITY" : "READY_FOR_HUMAN_REVIEW",
    quality: quality ?? null,
    // Never turn a model's self-declared FACT, QA PASS, or a captured URL into verified evidence.
    conclusions: summary ? [{ claim: summary, claimKind: "INFERENCE", verificationRefs: [] }] : [],
    unknowns,
    risks: riskItems(text),
    decisionsRequired: report.decision ? [resolveSourceMarkers(report.decision, sources)] : [],
    recommendedActions: report.recommendation ? [resolveSourceMarkers(report.recommendation, sources)] : [],
    advisoryNotes: report.steps.map(step => ({ agentCode: step.key, agentName: step.agent, status: step.status, summary: step.output ? resolveSourceMarkers(step.output, sources) : step.output })),
    provenance: { sourceRefs: sources.map(source => source.url), agentRunRefs: [], modelRunRefs: [], knowledgeDebtRefs: [], researchSnapshotRef: null },
    researchBody: text,
    researchSources: sources.map(source => ({ id: source.sourceId, title: source.title, url: source.url, fetchedAt: source.fetchedAt })),
  };
}

export function missionPosterCitation(report: ExecutiveReportPayload, missionId: string): ExecutiveReportCitation {
  return {
    kind: "mission-report", ref: missionId, title: report.title ?? "新产品研究报告",
    summary: report.summary,
    ...(report.quality ? { qualityStatus: report.quality.status } : {}),
    stats: {
      conclusions: report.conclusions?.length ?? 0,
      verified: 0,
      risks: report.risks?.length ?? 0,
      unknowns: report.unknowns?.length ?? 0,
      decisions: report.decisionsRequired?.length ?? 0,
    },
  };
}
