import fs from "fs";
import path from "path";
import crypto from "crypto";
import prisma from "@/shared/db";
import { ForbiddenError, NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import { KnowledgeSyncStatus } from "@prisma/client";
import { SessionContext } from "../identity/session";

export interface ParsedMarkdown {
  frontmatter: Record<string, any> | null;
  body: string;
  title: string;
}

export interface MarkdownChunk {
  chunkIndex: number;
  headingPath: string;
  content: string;
}

export function parseFrontmatterAndBody(content: string, fallbackTitle: string): ParsedMarkdown {
  let body = content;
  let frontmatter: Record<string, any> | null = null;

  if (content.startsWith("---")) {
    const endIdx = content.indexOf("\n---", 3);
    if (endIdx !== -1) {
      const rawYaml = content.slice(3, endIdx).trim();
      body = content.slice(endIdx + 4).trim();
      const fm: Record<string, any> = {};
      for (const line of rawYaml.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx > 0) {
          const key = trimmed.slice(0, colonIdx).trim();
          let val = trimmed.slice(colonIdx + 1).trim();
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          fm[key] = val;
        }
      }
      if (Object.keys(fm).length > 0) {
        frontmatter = fm;
      }
    }
  }

  // Determine Title: frontmatter.title > first # Heading > fallbackTitle
  let title = frontmatter?.title || "";
  if (!title) {
    const h1Match = body.match(/^#\s+(.+)$/m);
    if (h1Match) {
      title = h1Match[1].trim();
    } else {
      title = fallbackTitle;
    }
  }

  return { frontmatter, body, title };
}

export function chunkMarkdownByHeadings(body: string, docTitle: string): MarkdownChunk[] {
  const lines = body.split("\n");
  const chunks: MarkdownChunk[] = [];
  const headingStack: { level: number; text: string }[] = [];

  let currentHeadingPath = docTitle;
  let currentBuffer: string[] = [];
  let chunkIndex = 0;

  function flushChunk() {
    const text = currentBuffer.join("\n").trim();
    if (text.length > 0) {
      chunks.push({
        chunkIndex: chunkIndex++,
        headingPath: currentHeadingPath,
        content: text,
      });
    }
    currentBuffer = [];
  }

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushChunk();
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();

      // Pop headings that are deeper or equal
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, text });

      currentHeadingPath = [docTitle, ...headingStack.map((h) => h.text)].join(" > ");
      currentBuffer.push(line);
    } else {
      currentBuffer.push(line);
    }
  }

  flushChunk();

  if (chunks.length === 0) {
    chunks.push({
      chunkIndex: 0,
      headingPath: docTitle,
      content: body.trim() || docTitle,
    });
  }

  return chunks;
}

function computeHash(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function scanMarkdownFiles(dir: string, baseDir: string = dir): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === ".trash") {
      continue;
    }
    if (entry.isDirectory()) {
      results.push(...scanMarkdownFiles(fullPath, baseDir));
    } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".markdown"))) {
      const rel = path.relative(baseDir, fullPath);
      results.push(rel);
    }
  }
  return results;
}

export async function syncKnowledgeSource(
  session: SessionContext,
  sourceId: string
): Promise<{ syncRunId: string; scanned: number; created: number; updated: number; deleted: number; failed: number }> {
  const source = await prisma.knowledgeSource.findUnique({
    where: { id: sourceId },
  });

  if (!source || source.organizationId !== session.organizationId) {
    throw new NotFoundError("Knowledge source not found");
  }

  if (!fs.existsSync(source.rootPath)) {
    throw new UnprocessableEntityError(`指定的知识目录不存在或不可访问: ${source.rootPath}`);
  }

  const syncRun = await prisma.knowledgeSyncRun.create({
    data: {
      sourceId: source.id,
      organizationId: session.organizationId,
      status: KnowledgeSyncStatus.RUNNING,
      startedById: session.userId,
      startedAt: new Date(),
    },
  });

  let scanned = 0;
  let created = 0;
  let updated = 0;
  let deleted = 0;
  let failed = 0;
  const failures: { path: string; reason: string }[] = [];

  try {
    const diskRelPaths = scanMarkdownFiles(source.rootPath);
    scanned = diskRelPaths.length;
    const diskPathSet = new Set(diskRelPaths);

    const existingDocs = await prisma.knowledgeDocument.findMany({
      where: { sourceId: source.id, organizationId: session.organizationId },
    });
    const existingMap = new Map<string, typeof existingDocs[0]>();
    for (const doc of existingDocs) {
      existingMap.set(doc.relativePath, doc);
    }

    for (const relPath of diskRelPaths) {
      const fullPath = path.join(source.rootPath, relPath);
      try {
        const fileContent = fs.readFileSync(fullPath, "utf8");
        const stat = fs.statSync(fullPath);
        const contentHash = computeHash(fileContent);
        const fallbackTitle = path.basename(relPath, path.extname(relPath));
        const { frontmatter, body, title } = parseFrontmatterAndBody(fileContent, fallbackTitle);
        const chunks = chunkMarkdownByHeadings(body, title);
        const byteSize = Buffer.byteLength(fileContent, "utf8");
        const wordCount = body.replace(/\s+/g, "").length;
        const sourceUpdatedAt = stat.mtime;

        const existing = existingMap.get(relPath);

        if (!existing) {
          await prisma.$transaction(async (tx) => {
            const doc = await tx.knowledgeDocument.create({
              data: {
                sourceId: source.id,
                organizationId: session.organizationId,
                relativePath: relPath,
                title,
                frontmatter: frontmatter as any,
                contentHash,
                byteSize,
                wordCount,
                sourceUpdatedAt,
                indexedAt: new Date(),
              },
            });

            await tx.knowledgeChunk.createMany({
              data: chunks.map((c) => ({
                documentId: doc.id,
                organizationId: session.organizationId,
                chunkIndex: c.chunkIndex,
                headingPath: c.headingPath,
                content: c.content,
                tokens: Math.ceil(c.content.length / 2),
              })),
            });
          });
          created++;
        } else if (existing.contentHash !== contentHash || existing.deletedAt !== null) {
          await prisma.$transaction(async (tx) => {
            await tx.knowledgeChunk.deleteMany({
              where: { documentId: existing.id },
            });

            await tx.knowledgeDocument.update({
              where: { id: existing.id },
              data: {
                title,
                frontmatter: frontmatter as any,
                contentHash,
                byteSize,
                wordCount,
                sourceUpdatedAt,
                deletedAt: null,
                indexedAt: new Date(),
              },
            });

            await tx.knowledgeChunk.createMany({
              data: chunks.map((c) => ({
                documentId: existing.id,
                organizationId: session.organizationId,
                chunkIndex: c.chunkIndex,
                headingPath: c.headingPath,
                content: c.content,
                tokens: Math.ceil(c.content.length / 2),
              })),
            });
          });
          updated++;
        }
      } catch (err: any) {
        failed++;
        failures.push({ path: relPath, reason: err?.message || String(err) });
      }
    }

    for (const [relPath, doc] of existingMap.entries()) {
      if (!diskPathSet.has(relPath) && doc.deletedAt === null) {
        await prisma.knowledgeDocument.update({
          where: { id: doc.id },
          data: { deletedAt: new Date() },
        });
        deleted++;
      }
    }

    const finishedAt = new Date();
    await prisma.knowledgeSyncRun.update({
      where: { id: syncRun.id },
      data: {
        status: KnowledgeSyncStatus.SUCCEEDED,
        scanned,
        created,
        updated,
        deleted,
        failed,
        failures: failures.length > 0 ? (failures as any) : null,
        finishedAt,
      },
    });

    await prisma.knowledgeSource.update({
      where: { id: source.id },
      data: { lastSyncAt: finishedAt },
    });

    return {
      syncRunId: syncRun.id,
      scanned,
      created,
      updated,
      deleted,
      failed,
    };
  } catch (err: any) {
    await prisma.knowledgeSyncRun.update({
      where: { id: syncRun.id },
      data: {
        status: KnowledgeSyncStatus.FAILED,
        scanned,
        created,
        updated,
        deleted,
        failed,
        failures: failures as any,
        errorReason: err?.message || "Sync failed",
        finishedAt: new Date(),
      },
    });
    throw err;
  }
}
