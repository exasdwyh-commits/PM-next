import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";

async function main() {
  await assertTestDatabaseSafety(prisma);
  const sentinel = await prisma.organization.create({ data: { code: randomUUID(), name: "Independent sentinel" } });
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const before = await prisma.organization.count();
      const result = spawnSync(process.execPath, ["--import", "tsx", "tests/db-transaction-verification.ts"], {
        env: process.env, encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.ok(await prisma.organization.findUnique({ where: { id: sentinel.id } }));
      assert.equal(await prisma.organization.count(), before, "Fixture organization must be cleaned up");
      console.log(`Run ${attempt + 1}: transaction suite passed; sentinel preserved; fixture cleaned`);
    }
  } finally {
    await prisma.organization.deleteMany({ where: { id: sentinel.id } });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
