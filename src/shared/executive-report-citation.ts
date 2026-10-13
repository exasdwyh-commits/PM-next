/**
 * Executive Report 在对话里的引用契约（纯模块，服务端与 /muse 渲染端共用）。
 *
 * 背景：产品研发综合评估的最终成果是一份独立的 Executive Report（artifact），
 * 对话里不再贴全文，而是回一条 headline + 一个方块缩略图卡片，点开进
 * /reports/[id] 看排版完整的 HTML 报告页。
 *
 * 卡片需要的 headline 数字直接随引用落库，客户端不必再为缩略图多发一次请求。
 */

export const EXECUTIVE_REPORT_CITATION_KIND = "executive-report";

export interface ExecutiveReportCitationStats {
  conclusions: number;
  verified: number;
  risks: number;
  unknowns: number;
  decisions: number;
}

export interface ExecutiveReportCitation {
  kind: string;
  /** artifact id，同时也是 /reports/<ref> 的路径参数。 */
  ref: string;
  title: string;
  contentVersion?: number;
  reviewStatus?: string;
  summary?: string | null;
  stats?: ExecutiveReportCitationStats;
}

function isStat(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Legacy report citations used the generic artifact kind. Recognize both the
 * named `executive-report` kind and the older `artifact` kind whose title looks
 * like a research / management report —— 历史数据仍要能渲染，故保留兼容分支。
 */
export function isExecutiveReportCitation(raw: unknown): raw is ExecutiveReportCitation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const item = raw as Record<string, unknown>;
  return typeof item.ref === "string" && !!item.ref && typeof item.title === "string" &&
    (item.kind === EXECUTIVE_REPORT_CITATION_KIND ||
      (item.kind === "artifact" && /产品研发.*报告|研发管理报告/.test(item.title)));
}

/** Personal mission reports inherit requester-only access, not project artifact access. */
export function missionPosterPath(id: string) { return `/reports/missions/${encodeURIComponent(id)}`; }

/** 报告的站内页面路径。客户端直接用相对链接，同源即可打开。 */
export function executiveReportPath(id: string) { return `/reports/${encodeURIComponent(id)}`; }

/** 把 stats 收窄成固定形状；缺失字段一律按 0 处理，绝不猜测。 */
export function readExecutiveReportStats(
  citation: ExecutiveReportCitation
): ExecutiveReportCitationStats {
  const s = (citation.stats ?? {}) as Record<string, unknown>;
  const pick = (key: keyof ExecutiveReportCitationStats) =>
    isStat(s[key]) ? (s[key] as number) : 0;
  return {
    conclusions: pick("conclusions"),
    verified: pick("verified"),
    risks: pick("risks"),
    unknowns: pick("unknowns"),
    decisions: pick("decisions"),
  };
}

/** Old and new citation kinds can coexist on one reply. Render each artifact once. */
export function executiveReportCitations(citations: unknown[]): ExecutiveReportCitation[] {
  const reports = new Map<string, ExecutiveReportCitation>();
  for (const raw of citations) {
    if (!isExecutiveReportCitation(raw)) continue;
    const previous = reports.get(raw.ref);
    reports.set(raw.ref, {
      ...previous, kind: raw.kind, ref: raw.ref, title: raw.title,
      ...(typeof raw.contentVersion === "number" && Number.isFinite(raw.contentVersion) && raw.contentVersion > 0 ? { contentVersion: raw.contentVersion } : {}),
      ...(typeof raw.reviewStatus === "string" ? { reviewStatus: raw.reviewStatus } : {}),
      ...(typeof raw.summary === "string" || raw.summary === null ? { summary: raw.summary } : {}),
      ...(raw.stats ? { stats: raw.stats } : {}),
    });
  }
  return [...reports.values()];
}
