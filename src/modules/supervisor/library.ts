/**
 * KX-62 · 产出库（只读汇总，不新建表）
 * ===================================
 * - 列出当前用户自己发起、已成功完成的任务，每条都能按 md / PDF / Word / Excel / PPT 再次下载。
 * - 下载复用 GET /api/missions/{id}/export（仅发起人，他人 404），这里只给出链接。
 * - 范围：本组织 + 任务快照 schemaVersion=kern-mission/v1 + requestedByUserId=本人 + 状态 SUCCEEDED。
 * - 以后若要存文件元数据再加 KernArtifact 表；现阶段先验证这个入口有没有用。
 */
import { AgentTaskStatus } from "@prisma/client";
import prisma from "@/shared/db";
import type { SessionContext } from "@/modules/identity/session";
import { goalHeadline } from "./report-format";
import { MISSION_SCHEMA } from "./service";

export const LIBRARY_LIMIT = 60;
export const LIBRARY_QUERY_MAX = 60;

export const LIBRARY_FORMATS = [
  { format: "md", label: "Markdown" },
  { format: "pdf", label: "PDF" },
  { format: "docx", label: "Word" },
  { format: "xlsx", label: "Excel" },
  { format: "pptx", label: "PPT" },
] as const;

export type LibraryItem = {
  missionTaskId: string;
  title: string;
  goal: string;
  createdAt: string;
  finishedAt: string;
  downloads: Array<{ format: string; label: string; href: string }>;
};

type Row = { id: string; goal: string | null; createdAt: Date; updatedAt: Date };

export function libraryItem(r: Row): LibraryItem {
  const goal = (r.goal ?? "").replace(/\s+/g, " ").trim();
  const id = encodeURIComponent(r.id);
  return {
    missionTaskId: r.id,
    title: goalHeadline(goal) || "未命名任务",
    goal: goal.slice(0, 200),
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.updatedAt.toISOString(),
    downloads: LIBRARY_FORMATS.map((f) => ({ ...f, href: `/api/missions/${id}/export?format=${f.format}` })),
  };
}

export function normalizeLibraryQuery(q: string | null | undefined): string | null {
  const s = (q ?? "").replace(/\s+/g, " ").trim().slice(0, LIBRARY_QUERY_MAX);
  return s || null;
}

export async function listLibrary(session: SessionContext, opts: { q?: string | null } = {}): Promise<LibraryItem[]> {
  const q = normalizeLibraryQuery(opts.q);
  const rows = await prisma.agentTask.findMany({
    where: {
      organizationId: session.organizationId,
      status: AgentTaskStatus.SUCCEEDED,
      AND: [
        { contextSnapshot: { path: ["schemaVersion"], equals: MISSION_SCHEMA } },
        { contextSnapshot: { path: ["requestedByUserId"], equals: session.userId } },
      ],
      ...(q ? { goal: { contains: q, mode: "insensitive" as const } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: LIBRARY_LIMIT,
    select: { id: true, goal: true, createdAt: true, updatedAt: true },
  });
  return rows.map(libraryItem);
}
