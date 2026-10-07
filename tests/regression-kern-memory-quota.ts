/**
 * Memory limit enforcement (deployment KERN_LIMIT_MEMORY_ITEMS) — DB regression.
 * - with the deployment limit set, the (limit+1)th active memory is refused with UsageLimitError;
 * - concurrent inserts cannot overshoot the limit (advisory lock);
 * - updating an existing source-keyed memory does not consume quota;
 * - forgetting a memory frees a slot; unset limit = unlimited (no plans in product).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { KernMemoryKind } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { UsageLimitError as QuotaExceededError } from "../src/modules/usage";
import { forgetMemory, rememberForUser } from "../src/modules/memory";

/**
 * Rejections that are not an honest quota refusal. Reported as themselves so a
 * failure names the real cause (e.g. P2028 from a drained connection pool)
 * instead of surfacing as a puzzling "ok !== 3".
 */
function describeUnexpected(results: PromiseSettledResult<unknown>[]): string[] {
  return results.flatMap((r) => {
    if (r.status !== "rejected" || r.reason instanceof QuotaExceededError) return [];
    const error = r.reason as { constructor?: { name?: string }; code?: string; message?: string };
    const name = error?.constructor?.name ?? typeof r.reason;
    return [`${name}/${error?.code ?? "-"}: ${String(error?.message ?? r.reason).split("\n")[0]}`];
  });
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Explicit test database required");
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID();
  const org = await prisma.organization.create({ data: { name: "Memory quota", code: "MQ_" + tag } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, email: `mq-${tag}@hermes.test`, name: "MQ" },
  });
  const session = { organizationId: org.id, userId: user.id };
  process.env.KERN_LIMIT_MEMORY_ITEMS = "20";
  const limit = 20;
  assert.ok(limit > 4);

  try {
    console.log(`▶ MQ1 fill to limit-3 (${limit - 3})`);
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
    assert.deepEqual(
      describeUnexpected(results),
      [],
      "concurrent writes may only win or be refused for quota"
    );
    assert.equal(ok, 3, "must not overshoot quota under concurrency");
    assert.equal(refused, 3);
    assert.equal(await prisma.kernMemory.count({ where: { organizationId: org.id, forgottenAt: null } }), limit);

    console.log("▶ MQ2b a 40-writer burst at the limit refuses honestly (no pool exhaustion)");
    const burst = await Promise.allSettled(
      Array.from({ length: 40 }, (_, i) =>
        rememberForUser(session, { kind: KernMemoryKind.PREFERENCE, content: `burst ${i}` })
      )
    );
    assert.deepEqual(
      describeUnexpected(burst),
      [],
      "a burst at the limit must refuse with QuotaExceededError, never fail to start"
    );
    assert.equal(burst.filter((r) => r.status === "fulfilled").length, 0);
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

    console.log("▶ MQ5 no limit configured → unlimited");
    delete process.env.KERN_LIMIT_MEMORY_ITEMS;
    assert.ok(await rememberForUser(session, { kind: KernMemoryKind.PREFERENCE, content: "team" }));

    console.log("\n✅ Kern memory limit regression passed");
  } finally {
    await prisma.kernMemory.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
