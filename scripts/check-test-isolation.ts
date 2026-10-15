// Read-only preflight. The original three-layer guard remains the authority.
import { assertTestDatabaseSafety, testPrisma } from "../tests/test-safety";

assertTestDatabaseSafety()
  .catch(() => { console.error("Test database isolation preflight failed; migrations/tests must not proceed."); process.exitCode = 1; })
  .finally(() => testPrisma.$disconnect());
