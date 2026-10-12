export interface ExecutiveReportCitation { kind: string; ref: string; title: string; contentVersion?: number; reviewStatus?: string; }

/** Legacy report citations used the generic artifact kind. Recognize only named R&D reports. */
export function isExecutiveReportCitation(raw: unknown): raw is ExecutiveReportCitation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const item = raw as Record<string, unknown>;
  return typeof item.ref === "string" && !!item.ref && typeof item.title === "string" &&
    (item.kind === "executive-report" || (item.kind === "artifact" && /产品研发.*报告|研发管理报告/.test(item.title)));
}

export function executiveReportPath(id: string) { return `/reports/${encodeURIComponent(id)}`; }

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
    });
  }
  return [...reports.values()];
}
