// Module projects: Project lifecycle, stage management, revision concurrency
export interface CreateProjectInput {
  organizationId: string;
  title: string;
  target: string;
  mode: "NEW_PRODUCT" | "FIXED_PRODUCT";
  ownerId: string;
  decisionMakerId?: string;
  constraints?: string;
}
