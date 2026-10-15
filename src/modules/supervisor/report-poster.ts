/** Pure, lossless projection of a personal mission into the existing Muse v3 report. */
import type { ExecutiveReportPayload } from "@/shared/executive-report-types";
import type { ExecutiveReportCitation } from "@/shared/executive-report-citation";
import { conclusionLead, resolveSourceMarkers, type MissionReport } from "./report-format";
import { stripToolRequestNoise } from "./tools";
import type { ReportQuality } from "./report-quality";

/** 交付前最后一道复读防护：历史任务正文里已存下的工具请求行，打开报告时也应干净。 */
function clean(body: string): string {
  const stripped = stripToolRequestNoise(body);
  return stripped === null ? body : stripped;
}

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
export function buildMissionPoster(report: MissionReport, quality?: ReportQuality, draftPreview = false): ExecutiveReportPayload {
  const content = report.content && (report.content.status === "READY" || (draftPreview && report.content.status === "DRAFT")) ? report.content : undefined;
  const sources = report.demo ? [] : report.researchSources ?? [];
  const text = clean(resolveSourceMarkers(report.conclusion ?? "", sources));
  const originalText = report.originalConclusion ? clean(resolveSourceMarkers(report.originalConclusion, sources)) : "";
  const unknowns = [...new Set([text, originalText, ...report.steps.map(step => step.output ?? "")]
    .flatMap(body => body.split(/\r?\n/).filter(line => /UNKNOWN\s*[：:]/i.test(line)).map(line => line.trim())))];
  unknowns.push(...(content?.unknowns ?? []).map(item => resolveSourceMarkers(item, sources)).filter(item => !unknowns.includes(item)));
  if (!content) unknowns.unshift("内容提炼或审校尚未完成：当前为草稿，不是成品卡片。");
  if (!sources.length) unknowns.unshift(report.demo ? "演示数据：不能作为真实研究、报价或审批依据。" : "尚无已捕获的外部来源：需补齐真实研究资料；执行完成不等于结论已核实。");
  const summary = resolveSourceMarkers(content?.summary ?? report.recommendation ?? conclusionLead(text.split("\n").filter(line => !/^\s*#/.test(line)).join("\n")) ?? "研究已完成，请结合来源、缺口与 QA 记录审阅。", sources);
  return {
    title: `${content?.title ?? "研究报告"}${report.demo ? "（演示）" : ""}${!content ? " · 待审校草稿" : ""}`,
    contentStatus: content?.status ?? report.contentStatus ?? "MISSING",
    presentation: content?.layout,
    createdAt: report.createdAt,
    summary,
    verificationStatus: quality?.status === "BLOCKED" || report.contentStatus === "REJECTED" ? "BLOCKED_BY_QUALITY" : !content || quality?.status === "DRAFT_UNVERIFIED" ? "DRAFT_UNVERIFIED" : "READY_FOR_HUMAN_REVIEW",
    quality: quality ?? null,
    // Never turn a model's self-declared FACT, QA PASS, or a captured URL into verified evidence.
    conclusions: summary ? [{ claim: summary, claimKind: "INFERENCE", verificationRefs: [] }] : [],
    unknowns,
    risks: [...new Set([...riskItems(text), ...riskItems(originalText), ...(content?.risks ?? []).map(item => resolveSourceMarkers(item, sources))])],
    decisionsRequired: content ? content.decisions.map(item => resolveSourceMarkers(item, sources)) : report.decision ? [resolveSourceMarkers(report.decision, sources)] : [],
    recommendedActions: content ? content.actions.map(item => resolveSourceMarkers(item, sources)) : report.recommendation ? [resolveSourceMarkers(report.recommendation, sources)] : [],
    advisoryNotes: report.steps.map(step => ({ agentCode: step.key, agentName: step.agent, status: step.status, summary: step.output ? clean(resolveSourceMarkers(step.output, sources)) : step.output })),
    provenance: { sourceRefs: sources.map(source => source.url), agentRunRefs: [], modelRunRefs: [], knowledgeDebtRefs: [], researchSnapshotRef: null },
    researchBody: text,
    ...(originalText && originalText !== text ? { originalResearchBody: originalText } : {}),
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
