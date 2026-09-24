export type CollaborationMode = "ASSISTANT" | "DELEGATION" | "EXECUTIVE";

export interface DepartmentAssistantContext {
  runtimeVersion: "department-assistant/v1";
  organizationId: string;
  conversationId: string;
  productId: string | null;
  linkedProjectIds: string[];
  confirmedCompanyFactRefs: string[];
  collaborationMode: CollaborationMode;
  reflexMode: "SHADOW_UNCONFIGURED" | "SHADOW";
}
