// Module jarvis: Read-only enterprise fact projection conventions; no direct execution entry
export const JARVIS_MODULE_STATUS = "READ_CONVENTION_ONLY" as const;

export interface JarvisFactProjection {
  organizationId: string;
  source: string;
  version: string;
  cutoffTime: string;
  knownGaps: string[];
  facts: Record<string, any>;
}
