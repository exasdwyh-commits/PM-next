import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import prisma from "@/shared/db";
import { NotFoundError, ForbiddenError } from "@/shared/errors";
import fs from "fs/promises";
import path from "path";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id: evidenceId } = await params;

    const evidence = await prisma.evidence.findUnique({
      where: { id: evidenceId },
      include: {
        project: {
          include: {
            members: true,
          },
        },
      },
    });

    if (!evidence || !evidence.fileKey) {
      throw new NotFoundError("Attachment not found");
    }

    if (evidence.project.organizationId !== session.organizationId) {
      throw new NotFoundError("Attachment not found");
    }

    const isMember = evidence.project.members.some((m) => m.userId === session.userId);
    if (!isMember) {
      throw new ForbiddenError("You are not authorized to download attachments from this project");
    }

    const uploadDir = path.join(process.cwd(), ".uploads");
    const filePath = path.join(uploadDir, evidence.fileKey);

    const buffer = await fs.readFile(filePath);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": evidence.mimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename="${encodeURIComponent(evidence.originalFilename || "file")}"`,
        "Content-Length": buffer.length.toString(),
      },
    });
  } catch (error) {
    return handleApiError(error, req);
  }
}
