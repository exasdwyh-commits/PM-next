/** Pure, fail-closed rules. No environment, Prisma, network or database access. */
export function testIsolationProbeUrl(testUrl: string, guardUrl: string): string {
  let test: URL; let guard: URL;
  try { test = new URL(testUrl); guard = new URL(guardUrl); }
  catch { throw new Error("Invalid database isolation endpoints"); }
  const pg = (u: URL) => ["postgres:", "postgresql:"].includes(u.protocol);
  const database = (u: URL) => decodeURIComponent(u.pathname.slice(1));
  const testName = database(test), guardName = database(guard);
  if (!pg(test) || !pg(guard) || !testName.endsWith("_test") || !guardName ||
      guardName.includes("/") || guardName.endsWith("_test") || guardName === testName ||
      test.hostname.toLowerCase() !== guard.hostname.toLowerCase() ||
      (test.port || "5432") !== (guard.port || "5432")) {
    throw new Error("Isolation probe requires a distinct non-test database on the same PostgreSQL endpoint");
  }
  // Retain ONLY the tested account's credentials/options; never use the guard account.
  test.pathname = guard.pathname;
  return test.href;
}

export function isConnectPermissionDenied(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: unknown; errorCode?: unknown; code?: unknown; message?: unknown; meta?: { code?: unknown; message?: unknown } };
  // Prisma's structured database-access denial, not authentication/unreachable/not-found.
  if (e.errorCode === "P1010" || e.code === "P1010") return true;
  // SQLSTATE 42501 alone is broader than CONNECT (e.g. schema/table permissions).
  const deniedDatabase = (message: unknown) => typeof message === "string" && /permission denied for database\b/i.test(message);
  if ((e.code === "42501" && deniedDatabase(e.message)) ||
      (e.code === "P2010" && e.meta?.code === "42501" && deniedDatabase(e.meta.message))) return true;
  // Prisma 6.19.x raises a connection-level FATAL (e.g. CONNECT revoked) as
  // PrismaClientInitializationError: no errorCode/code/cause, SQLSTATE 42501 lives only in the
  // message text. Judging by code alone never matches, which fails the guard closed on a
  // correctly isolated database. The name check keeps auth/network failures unclassified.
  return e.name === "PrismaClientInitializationError" && deniedDatabase(e.message);
}
