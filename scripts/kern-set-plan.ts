/**
 * Ops: set an organization's plan until online payment is wired.
 *   npx tsx scripts/kern-set-plan.ts <organizationId|orgCode> <FREE|PRO|TEAM> [externalRef]
 */
import { KernPlanTier } from "@prisma/client";
import prisma from "../src/shared/db";
import { setOrganizationTier } from "../src/modules/billing";

async function main() {
  const [orgArg, tierArg, ref] = process.argv.slice(2);
  if (!orgArg || !tierArg || !(tierArg in KernPlanTier)) throw new Error("usage: kern-set-plan <org> <FREE|PRO|TEAM> [ref]");
  const org = await prisma.organization.findFirst({ where: { OR: [{ id: orgArg }, { code: orgArg }] }, select: { id: true, name: true } });
  if (!org) throw new Error("organization not found");
  await setOrganizationTier(org.id, tierArg as KernPlanTier, ref ?? null);
  console.log(`${org.name} → ${tierArg}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
