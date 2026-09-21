import { NextRequest, NextResponse } from "next/server";
import { getServerSession, requireProjectRole } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import prisma from "@/shared/db";
import { EvidenceNature, EvidenceVerifyStatus, Role } from "@prisma/client";
import { UnprocessableEntityError, UnsupportedMediaTypeError } from "@/shared/errors";
import { EVIDENCE_PUBLIC_SELECT } from "@/modules/evidence/evidence-view";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".csv", ".docx", ".xlsx", ".txt"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id: projectId } = await params;

    await requireProjectRole(session, projectId, [
      Role.OWNER,
      Role.DECISION_MAKER,
      Role.FEEDBACK_PROVIDER,
    ]);

    // D-008：Content-Type 不是 multipart/form-data 时，req.formData() 抛原生 TypeError，
    // 冒到统一错误处理即 500 —— 但这不是服务端故障，是调用方用错了编码。按 415 明确回绝。
    // 注意这段在鉴权之后：未通过 requireProjectRole 的调用方拿不到 415（不构成存在性旁证）。
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      throw new UnsupportedMediaTypeError(
        "附件上传需使用 multipart/form-data（字段：file，可选 source / nature / obtainedAt）"
      );
    }
    const file = formData.get("file") as File | null;
    const source = (formData.get("source") as string) || "受控附件上传";
    const nature = (formData.get("nature") as string) === "DEMO" ? EvidenceNature.DEMO : EvidenceNature.REAL;
    // P1-01: 记录独立采集时点（区别于「上传时刻」），便于来源追溯；非法格式直接拒绝
    const rawObtainedAt = formData.get("obtainedAt") as string | null;
    const obtainedAt = rawObtainedAt ? new Date(rawObtainedAt) : undefined;
    if (rawObtainedAt && Number.isNaN(obtainedAt!.getTime())) {
      throw new UnprocessableEntityError("非法采集时间格式，应为 ISO 日期时间");
    }

    if (!file) {
      throw new UnprocessableEntityError("No file provided");
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new UnprocessableEntityError(`File size exceeds 20MB limit (actual: ${(file.size / 1024 / 1024).toFixed(1)}MB)`);
    }

    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new UnprocessableEntityError(`Unsupported file extension ${ext}. Allowed: ${Array.from(ALLOWED_EXTENSIONS).join(", ")}`);
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Compute cryptographic SHA-256 hash on server
    const serverHash = crypto.createHash("sha256").update(buffer).digest("hex");

    const uploadDir = path.join(process.cwd(), ".uploads");
    await fs.mkdir(uploadDir, { recursive: true });

    const fileKey = `${serverHash.slice(0, 16)}_${Date.now()}${ext}`;
    const filePath = path.join(uploadDir, fileKey);
    await fs.writeFile(filePath, buffer);

    const evidence = await prisma.evidence.create({
      data: {
        projectId,
        contentOrUri: `[附件] ${file.name}`,
        source,
        author: session.userName,
        hash: serverHash,
        nature,
        verifyStatus: EvidenceVerifyStatus.UNVERIFIED,
        obtainedAt,
        fileKey,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
        originalFilename: file.name,
      },
      // B6：只回传白名单字段 —— 此前直接返回整行，把服务端存储键 fileKey
      // 随响应送到浏览器。下载走 GET /api/attachments/<evidenceId>，客户端不需要它。
      select: EVIDENCE_PUBLIC_SELECT,
    });

    await prisma.auditEvent.create({
      data: {
        actorId: session.userId,
        action: "ATTACHMENT_UPLOADED",
        objectType: "Evidence",
        objectId: evidence.id,
        summary: `上传受控附件 "${file.name}" (${(file.size / 1024).toFixed(1)}KB)，哈希: ${serverHash.slice(0, 16)}`,
      },
    });

    return NextResponse.json(evidence, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
