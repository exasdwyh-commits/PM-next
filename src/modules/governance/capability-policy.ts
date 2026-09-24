export const PROTECTED_CAPABILITIES = new Set([
  "external.send",
  "git.merge",
  "deploy.production",
  "database.migrate",
  "artifact.delete",
  "secret.use",
  "shell.exec",
] as const);

export interface ToolIdentity {
  actorId: string;
  organizationId: string;
  agentCode?: string | null;
  runId?: string | null;
}

export interface CapabilityRequest {
  identity: ToolIdentity;
  capability: string;
  resource: string;
  taskRef: string;
}

export type CapabilityAuthorizer = (
  request: CapabilityRequest
) => boolean | Promise<boolean>;

export const denyAllCapabilities: CapabilityAuthorizer = () => false;
