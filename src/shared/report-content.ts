/** Agent-authored presentation; not a fact-verification result or an arbitrary HTML/CSS payload. */
export const REPORT_CONTENT_SCHEMA = "report-content/v1";
export type ReportContentStatus = "DRAFT" | "READY" | "REJECTED" | "FAILED";
export interface ReportContentDraft {
  subject: string;
  title: string;
  summary: string;
  risks: string[];
  unknowns: string[];
  decisions: string[];
  actions: string[];
}
export interface ReportContentDocument extends ReportContentDraft {
  schemaVersion: typeof REPORT_CONTENT_SCHEMA;
  inputVersion: string;
  missionTaskId: string;
  nodeTaskId: string;
  status: ReportContentStatus;
  /** Lossless input snapshot; compacting presentation never deletes original material. */
  source: { goal: string; body: string; originalBody: string; sources: {
    id: string; title: string; url: string; fetchedAt: string; hash: string; snapshot: string; truncated: boolean;
  }[] };
  /** Only allowlisted display choices. Full text is retained; no free-form CSS or HTML. */
  layout: { density: "comfortable" | "compact"; summaryLines: 3 | 4 | 5 };
  review: null | { topicMatch: boolean; goalQuote: string; bodyQuote: string; note: string };
  note: string;
}
