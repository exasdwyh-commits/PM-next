// Module evidence: Verifiable facts, data provenance, hash verification, REAL/DEMO isolation
export interface CreateEvidenceInput {
  projectId: string;
  contentOrUri: string;
  source: string;
  author?: string;
  hash: string;
  nature: "REAL" | "DEMO";
}
