import { Prisma } from "@prisma/client";
import prisma from "@/shared/db";
import { ConflictError, NotFoundError } from "@/shared/errors";
import type { SessionContext } from "./session";

const SYSTEM_NAME = "Hermes System";

function systemEmail(organizationId: string): string {
  return `system+${organizationId}@hermes.invalid`;
}

/**
 * Return a non-interactive, organization-scoped identity for internal
 * automation/audit attribution.
 *
 * Invariants:
 * - no password;
 * - no web/session login;
 * - no OrganizationMember row is granted here;
 * - no project membership/admin role is granted here;
 * - one deterministic reserved identity per organization.
 */
export async function getOrCreateSystemPrincipalSession(
  organizationId: string
): Promise<SessionContext> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });
  if (!organization) throw new NotFoundError("Organization not found");

  const email = systemEmail(organizationId);
  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    try {
      user = await prisma.user.create({
        data: {
          organizationId,
          email,
          name: SYSTEM_NAME,
          passwordHash: null,
          isSystem: true,
          isActive: true,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        user = await prisma.user.findUnique({ where: { email } });
      } else {
        throw error;
      }
    }
  }

  if (
    !user ||
    user.organizationId !== organizationId ||
    !user.isSystem ||
    user.passwordHash !== null
  ) {
    throw new ConflictError(
      "Reserved Hermes system principal identity is inconsistent"
    );
  }

  if (!user.isActive) {
    throw new ConflictError("Hermes system principal is inactive");
  }

  return {
    userId: user.id,
    organizationId: user.organizationId,
    userEmail: user.email,
    userName: user.name,
  };
}
