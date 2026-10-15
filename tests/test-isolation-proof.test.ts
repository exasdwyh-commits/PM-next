import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as proof from "../scripts/lib/test-isolation-proof";

const TEST = "postgresql://hermes_test:fake%40password@db.invalid:5432/kern_test?schema=public";
const GUARD = "postgresql://admin:never-use@db.invalid/kern_dev";

test("isolation URL: keep tested account/options; replace only database, never admin credentials", () => {
  const result = new URL(proof.testIsolationProbeUrl(TEST, GUARD));
  assert.equal(result.username, "hermes_test"); assert.equal(result.password, "fake%40password");
  assert.equal(result.pathname, "/kern_dev"); assert.equal(result.search, "?schema=public");
});
for (const [name, url] of [
  ["wrong host", "postgresql://admin:x@elsewhere.invalid/kern_dev"],
  ["wrong port", "postgresql://admin:x@db.invalid:5433/kern_dev"],
  ["test guard", "postgresql://admin:x@db.invalid/another_test"],
  ["same database", TEST], ["not postgres", "https://db.invalid/kern_dev"],
  ["missing database", "postgresql://admin:x@db.invalid/"], ["bad URL", "bad-url"],
]) test(`isolation URL: reject ${name}`, () => assert.throws(() => proof.testIsolationProbeUrl(TEST, url)));

const denied = [
  { errorCode: "P1010" }, { code: "P1010" },
  { code: "42501", message: 'permission denied for database "kern_dev"' },
  { code: "P2010", meta: { code: "42501", message: 'permission denied for database "kern_dev"' } },
];
test("isolation proof: explicit database permission denials accepted", () => {
  for (const e of denied) assert.equal(proof.isConnectPermissionDenied(e), true);
});
for (const code of ["P1000", "P1001", "P1003", "P1008", "3D000", "28P01"]) {
  test(`isolation proof: ${code} is NOT evidence of CONNECT denial`, () => {
    assert.equal(proof.isConnectPermissionDenied({ errorCode: code }), false);
  });
}
test("isolation proof: messages and non-database permissions cannot substitute for structured denial", () => {
  for (const e of [null, "permission denied", new Error("permission denied"), { code: "42501" },
    { code: "42501", message: "permission denied for schema public" },
    { code: "P2010", meta: { code: "42501", message: "permission denied for table Artifact" } }]) {
    assert.equal(proof.isConnectPermissionDenied(e), false);
  }
});

/** Transpile the ACTUAL guard into a sandbox. Unknown require is forbidden;
 * fake process/env + fake Prisma mean this cannot read .env or open a transport. */
async function actualGuard(probeError: unknown | null, guardUrl = GUARD) {
  let instances = 0;
  class FakePrisma {
    private readonly identity = instances++ === 0;
    async $queryRaw() {
      if (this.identity) return [{ current_database: "kern_test", current_user: "hermes_test" }];
      if (probeError) throw probeError; return [{ result: 1 }];
    }
    async $disconnect() {}
  }
  const exports: Record<string, unknown> = {};
  const source = fs.readFileSync(path.resolve("tests/test-safety.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const logs: unknown[][] = [];
  vm.runInNewContext(compiled, { exports, URL,
    require: (name: string) => {
      if (name === "@prisma/client") return { PrismaClient: FakePrisma };
      if (name === "../src/shared/env") return { loadEnvFiles() {} };
      if (name === "../scripts/lib/test-isolation-proof") return proof;
      throw new Error(`Unexpected import; transport forbidden: ${name}`);
    },
    process: { env: { TEST_DATABASE_URL: TEST, TEST_DB_ROLE: "hermes_test", DEV_DATABASE_GUARD_URL: guardUrl },
      exit: (code: number) => { throw new Error(`SAFETY_EXIT:${code}`); } },
    console: { log: (...args: unknown[]) => logs.push(args), error: (...args: unknown[]) => logs.push(args) },
  }, { filename: "actual-test-safety.ts", timeout: 1000 });
  await (exports.assertTestDatabaseSafety as () => Promise<void>)();
  assert.equal(instances, 2); return logs;
}
for (const code of ["P1000", "P1001", "P1003"]) {
  test(`actual guard: ${code} must fail closed, not report isolation success`, async () => {
    await assert.rejects(actualGuard({ errorCode: code, message: "synthetic failure, no connection attempted" }), /SAFETY_EXIT:1/);
  });
}
test("actual guard: unclassified transport error must fail closed", async () => {
  await assert.rejects(actualGuard(new Error("network fixture")), /SAFETY_EXIT:1/);
});
test("actual guard: reachable development database must fail", async () => {
  await assert.rejects(actualGuard(null), /SAFETY_EXIT:1/);
});
test("actual guard: a different guard host cannot be silently replaced", async () => {
  await assert.rejects(actualGuard(denied[0], "postgresql://admin:x@elsewhere.invalid/kern_dev"), /SAFETY_EXIT:1/);
});
test("actual guard: explicit permission denial succeeds without opening a real connection", async () => {
  const logs = await actualGuard(denied[0]);
  assert(logs.some(args => String(args[0]).includes("校验通过")));
});
