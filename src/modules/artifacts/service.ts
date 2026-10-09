/**
 * Kern artifacts — persistence and owner-scoped reads.
 * Every read is scoped to (organizationId, ownerId) of the conversation owner; anything
 * else is a 404 so existence never leaks across accounts or tenants.
 */
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import prisma from "@/shared/db";
import { NotFoundError } from "@/shared/errors";
import type { SessionContext } from "@/modules/identity/session";
import {
  ANY_MARKER_RE,
  artifactMarker,
  type ArtifactCitation,
  type ArtifactKind,
  type ExtractedArtifact,
} from "./protocol";

type Tx = Prisma.TransactionClient;

/**
 * Persist the artifacts extracted from one assistant reply inside the caller's transaction.
 * Same key in the same conversation → next version of the same artifact.
 * Returns the citations to attach and the content with persisted markers.
 */
export async function persistReplyArtifacts(tx: Tx, input: {
  organizationId: string;
  ownerId: string;
  conversationId: string;
  messageId: string;
  runId: string | null;
  content: string;
  artifacts: ExtractedArtifact[];
}): Promise<{ content: string; citations: ArtifactCitation[] }> {
  let content = input.content;
  const citations: ArtifactCitation[] = [];
  for (const item of input.artifacts) {
    // Row lock on the artifact (if it exists) keeps version numbers gap-free under concurrency.
    await tx.$queryRaw`SELECT id FROM "KernArtifact" WHERE "conversationId" = ${input.conversationId} AND "key" = ${item.key} FOR UPDATE`;
    const existing = await tx.kernArtifact.findUnique({
      where: { conversationId_key: { conversationId: input.conversationId, key: item.key } },
      include: { versions: { orderBy: { version: "desc" }, take: 1, select: { version: true } } },
    });
    const version = (existing?.versions[0]?.version ?? 0) + 1;
    const status = item.complete ? "READY" : "FAILED";
    const artifact = existing
      ? await tx.kernArtifact.update({
          where: { id: existing.id },
          data: {
            ...(item.complete ? { title: item.title, kind: item.kind, currentVersion: version } : {}),
          },
        })
      : await tx.kernArtifact.create({
          data: {
            organizationId: input.organizationId, ownerId: input.ownerId, conversationId: input.conversationId,
            key: item.key, kind: item.kind, title: item.title, currentVersion: item.complete ? version : 0,
          },
        });
    await tx.kernArtifactVersion.create({
      data: {
        artifactId: artifact.id, version, messageId: input.messageId, runId: input.runId,
        title: item.title, status, error: item.error, html: item.html,
        bytes: Buffer.byteLength(item.html, "utf8"),
        contentHash: createHash("sha256").update(item.html).digest("hex"),
      },
    });
    citations.push({
      kind: "kern-artifact", ref: artifact.id, key: item.key, version, title: item.title,
      artifactKind: item.kind, status, error: item.error,
    });
    content = content.split(artifactMarker(item.key)).join(`[[kern-artifact:${artifact.id}@${version}]]`);
  }
  // Any marker left without a persisted artifact (should not happen) is removed rather than shown raw.
  content = content.replace(ANY_MARKER_RE, (m, id: string, v?: string) => (v ? m : "")).trim();
  return { content, citations };
}

export type ArtifactSummary = {
  id: string;
  key: string;
  kind: ArtifactKind;
  title: string;
  conversationId: string;
  currentVersion: number;
  updatedAt: string;
  versions: { version: number; title: string; status: "READY" | "FAILED"; error: string | null; messageId: string | null; bytes: number; createdAt: string }[];
};

async function ownedArtifact(session: SessionContext, id: string) {
  const artifact = await prisma.kernArtifact.findFirst({
    where: { id, organizationId: session.organizationId, ownerId: session.userId, conversation: { ownerId: session.userId, organizationId: session.organizationId } },
  });
  if (!artifact) throw new NotFoundError("Artifact not found");
  return artifact;
}

export async function getArtifactSummary(session: SessionContext, id: string): Promise<ArtifactSummary> {
  const artifact = await ownedArtifact(session, id);
  const versions = await prisma.kernArtifactVersion.findMany({
    where: { artifactId: artifact.id }, orderBy: { version: "asc" },
    select: { version: true, title: true, status: true, error: true, messageId: true, bytes: true, createdAt: true },
  });
  return {
    id: artifact.id, key: artifact.key, kind: artifact.kind as ArtifactKind, title: artifact.title,
    conversationId: artifact.conversationId, currentVersion: artifact.currentVersion, updatedAt: artifact.updatedAt.toISOString(),
    versions: versions.map((v) => ({ ...v, status: v.status === "FAILED" ? "FAILED" : "READY", createdAt: v.createdAt.toISOString() })),
  };
}

export async function getArtifactVersion(session: SessionContext, id: string, version: number) {
  const artifact = await ownedArtifact(session, id);
  if (!Number.isInteger(version) || version < 1) throw new NotFoundError("Artifact version not found");
  const row = await prisma.kernArtifactVersion.findUnique({ where: { artifactId_version: { artifactId: artifact.id, version } } });
  if (!row) throw new NotFoundError("Artifact version not found");
  return {
    artifactId: artifact.id, key: artifact.key, kind: artifact.kind as ArtifactKind, version: row.version, title: row.title,
    status: row.status === "FAILED" ? ("FAILED" as const) : ("READY" as const), error: row.error,
    html: row.html, contentHash: row.contentHash, createdAt: row.createdAt.toISOString(), messageId: row.messageId,
  };
}

const PROMPT_HTML_BUDGET = 14_000;

/**
 * Context for the model: which artifacts this conversation already has (so edits reuse the
 * key) and the current HTML of the most recent ones (so edits start from the real document).
 */
export async function buildArtifactPromptContext(conversationId: string): Promise<string> {
  const artifacts = await prisma.kernArtifact.findMany({
    where: { conversationId, currentVersion: { gt: 0 } }, orderBy: { updatedAt: "desc" }, take: 6,
  });
  if (!artifacts.length) return "";
  const lines = ["本会话已有的可视化成果（修改时沿用同一 key 并输出完整 HTML；新主题才用新 key）："];
  let budget = PROMPT_HTML_BUDGET;
  for (const [index, a] of artifacts.entries()) {
    lines.push(`- key=${a.key} · 标题「${a.title}」 · 当前 v${a.currentVersion}${index === 0 ? "（最近一次）" : ""}`);
    if (index > 1 || budget <= 0) continue;
    const current = await prisma.kernArtifactVersion.findUnique({ where: { artifactId_version: { artifactId: a.id, version: a.currentVersion } }, select: { html: true } });
    if (!current) continue;
    const html = current.html.length > budget ? `${current.html.slice(0, budget)}\n<!-- 以下省略 ${current.html.length - budget} 字符 -->` : current.html;
    budget -= html.length;
    lines.push("```html", html, "```");
  }
  return lines.join("\n");
}
