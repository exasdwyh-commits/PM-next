import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import {
  authenticateUser,
  createSession,
  getServerSessionFromContext,
  hashPassword,
  hashToken,
} from "../src/modules/identity/session";
import { getOrCreateSystemPrincipalSession } from "../src/modules/identity/system-principal";

async function main() {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error("Explicit test database required");
  }
  await assertTestDatabaseSafety(prisma);

  const tag = randomUUID();
  const org = await prisma.organization.create({
    data: { name: "System Principal Test", code: "SYS_" + tag },
  });

  try {
    console.log("▶ S1 system principal is deterministic and non-interactive");
    const first = await getOrCreateSystemPrincipalSession(org.id);
    const second = await getOrCreateSystemPrincipalSession(org.id);
    assert.equal(first.userId, second.userId);
    assert.equal(first.organizationId, org.id);

    const systemUser = await prisma.user.findUniqueOrThrow({
      where: { id: first.userId },
    });
    assert.equal(systemUser.isSystem, true);
    assert.equal(systemUser.passwordHash, null);
    assert.equal(systemUser.isActive, true);
    assert.match(systemUser.email, /^system\+.+@hermes\.invalid$/);

    const orgMembershipCount = await prisma.organizationMember.count({
      where: { userId: systemUser.id },
    });
    const projectMembershipCount = await prisma.projectMember.count({
      where: { userId: systemUser.id },
    });
    assert.equal(orgMembershipCount, 0);
    assert.equal(projectMembershipCount, 0);
    console.log("  ✔ no human/admin/project membership is granted");

    console.log("▶ S2 system principal cannot authenticate or create a web session");
    await assert.rejects(
      authenticateUser(systemUser.email, "anything"),
      (error: any) => error?.statusCode === 401
    );
    await assert.rejects(
      createSession(systemUser.id),
      (error: any) => error?.statusCode === 403
    );
    console.log("  ✔ password and direct session issuance are both closed");

    console.log("▶ S3 even a manually inserted Session cannot pass interactive auth");
    const rawToken = "system-test-" + tag;
    await prisma.session.create({
      data: {
        userId: systemUser.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await assert.rejects(
      getServerSessionFromContext(
        { get: () => null },
        {
          get: (name: string) =>
            name === "hermes_session_token" ? { value: rawToken } : undefined,
        }
      ),
      (error: any) => error?.statusCode === 401
    );
    console.log("  ✔ cookie/session path also rejects system identities");

    console.log("▶ S4 normal human authentication remains unchanged");
    const human = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: "human-" + tag + "@hermes.test",
        name: "Human",
        passwordHash: hashPassword("test-password-123"),
      },
    });

    const auth = await authenticateUser(human.email, "test-password-123");
    assert.equal(auth.userId, human.id);
    const session = await createSession(human.id, 1);
    assert.ok(session.token.length > 20);
    console.log("  ✔ ordinary users still authenticate and receive sessions");

    console.log("\n✅ System principal regression passed");
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error("❌ System principal regression failed:", error);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exitCode = 1;
});
