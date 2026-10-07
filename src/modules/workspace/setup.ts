import type { SessionContext } from "@/modules/identity/session";
import { assertOrgAdmin } from "@/modules/identity/admin";
import { bootstrapDefaultWorkforce } from "@/modules/workforce/service";
import { installRecommendedModelControlPresets } from "@/modules/model-control/service";

/** Install absent defaults; never enable or overwrite an existing configuration. */
export async function ensureWorkspaceSetup(session: SessionContext) {
  await assertOrgAdmin(session);
  const workforce = await bootstrapDefaultWorkforce(session, { missingOnly: true });
  const models = await installRecommendedModelControlPresets(session, { missingOnly: true });
  return { agents: workforce.agents.length, ...models };
}
