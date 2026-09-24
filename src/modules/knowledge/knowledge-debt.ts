import prisma from "@/shared/db";

function normalizeKey(topic: string): string {
  return topic.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

export async function createOrMergeKnowledgeDebt(input: {
  organizationId: string;
  projectId?: string | null;
  topic: string;
  reason: string;
  importance?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  suggestedExpertClass?: string | null;
  relatedDataGapId?: string | null;
}) {
  const topic = input.topic.trim();
  if (!topic) throw new Error("KnowledgeDebt topic is required");
  const normalizedKey = normalizeKey(topic);
  const now = new Date();

  return prisma.knowledgeDebt.upsert({
    where: {
      organizationId_normalizedKey: {
        organizationId: input.organizationId,
        normalizedKey,
      },
    },
    create: {
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      normalizedKey,
      topic,
      reason: input.reason.trim(),
      importance: input.importance ?? "MEDIUM",
      suggestedExpertClass: input.suggestedExpertClass ?? null,
      relatedDataGapId: input.relatedDataGapId ?? null,
      occurrences: 1,
      lastSeenAt: now,
    },
    update: {
      occurrences: { increment: 1 },
      lastSeenAt: now,
      projectId: input.projectId ?? undefined,
      reason: input.reason.trim() || undefined,
      importance: input.importance ?? undefined,
      suggestedExpertClass: input.suggestedExpertClass ?? undefined,
      relatedDataGapId: input.relatedDataGapId ?? undefined,
    },
  });
}
