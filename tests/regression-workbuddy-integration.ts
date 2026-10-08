import assert from "node:assert/strict";
import fs from "node:fs";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { createSession } from "../src/modules/identity/session";
import { checkAndCharge, releaseReservation } from "../src/modules/model-gateway/cost-guard";
import { fetchSource } from "../src/modules/research/source-fetch";
import { executeResearchNode } from "../src/modules/research/research-integration";
import { executeComputerUseAction } from "../src/modules/desktop-runtime/computer-use";

async function main() {
  assertTestDatabaseSafety();
  const tag = `workbuddy-boundary-${Date.now()}`;
  const org = await prisma.organization.create({ data: { code: tag, name: "集成边界验收", modelCallQuota: 1 } });
  const user = await prisma.user.create({ data: { organizationId: org.id, email: `${tag}@test.local`, name: "验收" } });
  const session = await createSession(user.id);
  try {
    const calls = await Promise.all(Array.from({ length: 8 }, () => checkAndCharge({ organizationId: org.id })));
    assert.equal(calls.filter(call => call.allowed).length, 1, "concurrent requests must not exceed the quota");
    assert.equal(await prisma.usageLedger.count({ where: { organizationId: org.id } }), 1);
    assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).modelCallUsed, 1);
    const reservationId = calls.find(call => call.allowed)!.reservationId!;
    const refunds = await Promise.all(Array.from({ length: 4 }, () => releaseReservation(reservationId, org.id, false)));
    assert.equal(refunds.filter(refund => refund.released).length, 1);
    assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).modelCallUsed, 0);
    assert.equal((await releaseReservation("unknown-reservation", org.id, false)).released, false);
    console.log("PASS quota concurrency admits exactly one; refunds are idempotent and require a real reservation");

    await assert.rejects(fetchSource({ organizationId: org.id, url: "https://www.fda.gov" }), { code: "SOURCE_FETCH_UNAVAILABLE" });
    await assert.rejects(executeResearchNode({ organizationId: org.id, userId: user.id, projectId: "not-written", missionId: "not-written", nodeKey: "market", revisionRound: 0, question: "test" }), { code: "SOURCE_FETCH_UNAVAILABLE" });
    await assert.rejects(executeComputerUseAction({ id: "test", type: "click", input: {}, status: "PENDING" }), { code: "COMPUTER_USE_UNAVAILABLE" });
    const base = process.env.BASE_URL!;
    const headers = { "Content-Type": "application/json", Cookie: `hermes_session_token=${session.token}` };
    for (const [path, body, code] of [
      ["/api/research/fetch", { url: "https://www.fda.gov" }, "SOURCE_FETCH_UNAVAILABLE"],
      ["/api/desktop/action", { type: "file_write", input: { path: "/tmp/should-not-write", content: "test" } }, "COMPUTER_USE_UNAVAILABLE"],
    ] as const) {
      const response = await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, code);
    }
    assert.equal(await prisma.evidenceSourceCapture.count({ where: { organizationId: org.id } }), 0);
    assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).modelCallUsed, 0);
    console.log("PASS experimental fetch/desktop actions return 503; no mock evidence or quota charge is persisted");

    const sql = fs.readFileSync("prisma/migrations/20261008160000_cost_scenarios_and_p0_extensions/migration.sql", "utf8");
    assert.ok(!sql.includes('DROP COLUMN "supportSpan"'));
    const conversion = sql.match(/ALTER COLUMN "supportSpan" TYPE JSONB USING to_jsonb\("supportSpan"\)/)?.[0];
    assert.ok(conversion);
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('CREATE TEMP TABLE "support_span_probe" ("supportSpan" TEXT) ON COMMIT DROP');
      await tx.$executeRaw`INSERT INTO "support_span_probe" ("supportSpan") VALUES (${"原始片段 \"quoted\"\n第二行"}), (NULL)`;
      await tx.$executeRawUnsafe(`ALTER TABLE "support_span_probe" ${conversion}`);
      const rows = await tx.$queryRaw<{ supportSpan: string | null }[]>`SELECT "supportSpan" FROM "support_span_probe"`;
      assert.deepEqual(rows.map(row => row.supportSpan), ['原始片段 "quoted"\n第二行', null]);
    });
    console.log("PASS actual PostgreSQL conversion preserves existing quoted/CJK/multiline evidence and null");
  } finally {
    await prisma.usageLedger.deleteMany({ where: { organizationId: org.id } });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
