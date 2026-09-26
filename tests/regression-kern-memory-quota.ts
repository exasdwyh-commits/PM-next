/**
 * Memory quota enforcement (plan.memoryItems) — DB regression.
 * - FREE plan: the 51st active memory is refused with QuotaExceededError;
 * - concurrent inserts cannot overshoot the limit (advisory lock);
 * - updating an existing source-keyed memory does not consume quota;
 * - forgetting a memory frees a slot; TEAM plan is unlimited.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { KernMemoryKind, KernPlanTier } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { QuotaExceededError, limitsFor, setOrganizationTier } from "../src/modules/billing";
import { forgetMemory, rememberForUser } from "../src/modules/memory";

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Explicit test database required");
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID();
  const org = await prisma.organization.create({ data: { name: "Memory quota", code: "MQ_" + tag } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, email: `mq-${tag}@hermes.test`, name: "MQ" },
  });
  const session = { organizationId: org.id, userId: user.id };
  const limit = limitsFor(KernPlanTier.FREE).memoryItems!;
  assert.ok(limit > 4);

  try {
    console.log(`▶ MQ1 fill FREE plan to limit-3 (${limit - 3})`);
    await prisma.kernMemory.createMany({
      data: Array.from({ length: limit - 3 }, (_, i) => ({
        organizationId: org.id,
        userId: user.id,
        kind: KernMemoryKind.PREFERENCE,
        content: `seed ${i}`,
      })),
    });

    console.log("▶ MQ2 six concurrent inserts → exactly 3 succeed");
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        rememberForUser(session, { kind: KernMemoryKind.PREFERENCE, content: `concurrent ${i}` })
      )
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const refused = results.filter(
      (r) => r.status === "rejected" && r.reason instanceof QuotaExceededError
    ).length;
    assert.equal(ok, 3, "must not overshoot quota under concurrency");
    assert.equal(refused, 3);
    assert.equal(await prisma.kernMemory.count({ where: { organizationId: org.id, forgottenAt: null } }), limit);

    console.log("▶ MQ3 at limit: new memory refused; existing source-keyed update allowed");
    await assert.rejects(
      rememberForUser(session, { kind: KernMemoryKind.OUTCOME, content: "x", source: "mission:new" }),
      QuotaExceededError
    );
    const existing = await prisma.kernMemory.findFirstOrThrow({ where: { organizationId: org.id } });
    await prisma.kernMemory.update({ where: { id: existing.id }, data: { source: "mission:old" } });
    const updated = await rememberForUser(session, {
      kind: KernMemoryKind.OUTCOME,
      content: "re-synthesized outcome",
      source: "mission:old",
    });
    assert.equal(updated?.id, existing.id);
    assert.equal(updated?.content, "re-synthesized outcome");

    console.log("▶ MQ4 forgetting frees one slot");
    assert.equal(await forgetMemory(session, existing.id), true);
    assert.ok(await rememberForUser(session, { kind: KernMemoryKind.PREFERENCE, content: "after forget" }));
    await assert.rejects(
      rememberForUser(session, { kind: KernMemoryKind.PREFERENCE, content: "one too many" }),
      QuotaExceededError
    );

    console.log("▶ MQ5 TEAM plan is unlimited");
    await setOrganizationTier(org.id, KernPlanTier.TEAM);
    assert.ok(await rememberForUser(session, { kind: KernMemoryKind.PREFERENCE, content: "team" }));

    console.log("\n✅ Kern memory quota regression passed");
  } finally {
    await prisma.kernMemory.deleteMany({ where: { organizationId: org.id } });
    await prisma.organizationSubscription.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
