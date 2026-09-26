import type { SessionContext } from "@/modules/identity/session";
import { runLegacyAdvisorCapability } from "@/modules/advisor/service";
import type {
  KernCapabilityContext,
  KernCapabilityHandler,
  KernCapabilityIntent,
  KernCapabilityResult,
} from "./contracts";
import { handleDesktopCapability } from "./desktop";
import { handleProductRndCapability } from "./product-rnd";
import { handleWorkspaceReadCapability } from "./workspace-read";

const HANDLERS: KernCapabilityHandler[] = [
  handleDesktopCapability,
  handleProductRndCapability,
  handleWorkspaceReadCapability,
];

export async function executeKernCapability(
  session: SessionContext,
  intent: KernCapabilityIntent,
  context: KernCapabilityContext
): Promise<KernCapabilityResult> {
  for (const handler of HANDLERS) {
    const result = await handler(session, intent, context);
    if (result) return result;
  }

  // Migration seam: only capabilities not yet extracted remain here.
  return runLegacyAdvisorCapability(session, intent, context);
}

export const KERN_NATIVE_CAPABILITY_INTENTS = new Set<KernCapabilityIntent>([
  "DESKTOP_EXECUTION",
  "START_PRODUCT_RND",
  "PRODUCT_RND_STATUS",
  "PRODUCT_RND_REPORT",
  "PENDING_DECISIONS",
  "PRODUCT_STATUS",
  "WORKSPACE_STATUS",
]);
