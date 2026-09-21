import { Role } from "@prisma/client";
import prisma from "@/shared/db";
import { ForbiddenError, UnauthorizedError } from "@/shared/errors";

export interface SessionContext {
  userId: string;
  organizationId: string;
  isMockAuth?: boolean;
}

export async function requireProjectMembership(
  session: SessionContext,
  projectId: string,
  allowedRoles?: Role[]
) {
  const member = await prisma.projectMember.findUnique({
    where: {
      projectId_userId: {
        projectId,
        userId: session.userId,
      },
    },
    include: {
      project: {
        select: {
          organizationId: true,
          ownerId: true,
          decisionMakerId: true,
        },
      },
    },
  });

  if (!member || member.project.organizationId !== session.organizationId) {
    throw new ForbiddenError("You do not have access to this project");
  }

  if (allowedRoles && !allowedRoles.includes(member.role)) {
    throw new ForbiddenError(`Action not permitted for role ${member.role}`);
  }

  return member;
}
