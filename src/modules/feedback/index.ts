/**
 * P0-E Feedback → Memory → Harness Promotion
 */

import prisma from "@/shared/db";
import { rememberForUser } from "@/modules/memory";
import { KernMemoryKind } from "@prisma/client";

export interface FeedbackInput {
  organizationId: string;
  userId: string;
  missionId?: string;
  messageId?: string;
  type: "thumbs_up" | "thumbs_down" | "correction";
  content?: string;
  topics?: string[];
  source?: string;
}

export interface FeedbackOutput {
  feedback: any;
  memoryCandidate: { kind: string; content: string; isPinned: boolean } | null;
  harnessSample: { query: string; expected: string; actual: string; topics: string[] } | null;
}

export async function submitFeedback(input: FeedbackInput): Promise<FeedbackOutput> {
  const feedback = await prisma.userFeedback.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      missionId: input.missionId || null,
      messageId: input.messageId || null,
      type: input.type,
      content: input.content || null,
      topics: input.topics || [],
      source: input.source || null,
    },
  });

  let memoryCandidate: FeedbackOutput["memoryCandidate"] = null;
  if (input.type === "correction" && input.content) {
    memoryCandidate = { kind: KernMemoryKind.CORRECTION, content: input.content.slice(0, 400), isPinned: false };
    await rememberForUser(
      { organizationId: input.organizationId, userId: input.userId },
      { kind: KernMemoryKind.CORRECTION, content: input.content, source: input.source || `feedback:${feedback.id}`, pinned: false, topics: input.topics }
    );
  } else if (input.type === "thumbs_up" && input.content) {
    memoryCandidate = { kind: KernMemoryKind.PREFERENCE, content: input.content.slice(0, 400), isPinned: true };
    await rememberForUser(
      { organizationId: input.organizationId, userId: input.userId },
      { kind: KernMemoryKind.PREFERENCE, content: input.content, source: `feedback:${feedback.id}`, pinned: true, topics: input.topics }
    );
  } else if (input.type === "thumbs_down" && input.content) {
    memoryCandidate = { kind: KernMemoryKind.CORRECTION, content: `避免: ${input.content.slice(0, 380)}`, isPinned: false };
    await rememberForUser(
      { organizationId: input.organizationId, userId: input.userId },
      { kind: KernMemoryKind.CORRECTION, content: `避免: ${input.content}`, source: `feedback:${feedback.id}`, pinned: false, topics: input.topics }
    );
  }

  let harnessSample: FeedbackOutput["harnessSample"] = null;
  if (input.content && input.topics && input.topics.length > 0) {
    harnessSample = { query: input.topics.join(" "), expected: input.content, actual: "", topics: input.topics };
    await prisma.harnessSample.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        query: harnessSample.query,
        expected: harnessSample.expected,
        topics: harnessSample.topics,
        source: `feedback:${feedback.id}`,
        status: "PENDING",
      },
    });
  }

  return { feedback, memoryCandidate, harnessSample };
}

export async function evaluateHarnessSample(organizationId: string, sampleId: string, actual: string, outcome: "better" | "worse" | "same") {
  const sample = await prisma.harnessSample.findFirst({ where: { id: sampleId, organizationId } });
  if (!sample) throw new Error("HarnessSample not found");
  await prisma.harnessSample.update({ where: { id: sampleId }, data: { actual, outcome, evaluatedAt: new Date() } });
  if (outcome === "better") {
    await prisma.harnessSample.update({ where: { id: sampleId }, data: { promoted: true, promotedAt: new Date() } });
    return { promoted: true, reason: `Outcome 证明变好 (${sample.query}), Promotion 新策略, 可回滚` };
  } else if (outcome === "worse") {
    await prisma.harnessSample.update({ where: { id: sampleId }, data: { promoted: false, rolledBackAt: new Date() } });
    return { promoted: false, reason: `Outcome 证明变差, 回滚旧策略` };
  }
  return { promoted: false, reason: `Outcome 相同, 保持观察` };
}

export async function listFeedback(organizationId: string, userId: string, take = 50) {
  return prisma.userFeedback.findMany({ where: { organizationId, userId }, orderBy: { createdAt: "desc" }, take });
}

export async function deduplicateMemories(organizationId: string, userId: string) {
  const memories = await prisma.kernMemory.findMany({ where: { organizationId, userId, source: null, forgottenAt: null }, orderBy: { createdAt: "asc" } });
  const seen = new Map<string, string>();
  let deduped = 0;
  for (const mem of memories) {
    const normalized = mem.content.trim().toLowerCase().replace(/\s+/g, " ");
    if (seen.has(normalized)) {
      await prisma.kernMemory.update({ where: { id: mem.id }, data: { forgottenAt: new Date() } });
      deduped++;
    } else {
      seen.set(normalized, mem.id);
    }
  }
  return { total: memories.length, deduped, remaining: memories.length - deduped };
}

export function describeFeedback() {
  return {
    flow: "用户 👍/纠正(含原因) → Feedback → PREFERENCE/LESSON 候选 + Harness 评估样本 → 同类场景优先新策略并记录结果 → 只有 Outcome/Eval 证明变好才 Promotion, 可回滚",
    types: ["thumbs_up", "thumbs_down", "correction"],
    memoryKinds: ["PREFERENCE", "CORRECTION", "LESSON"],
    harness: "同类场景优先新策略, Outcome 证明变好才 Promotion, 可回滚, 禁止模型自评代替 Outcome",
    dedup: "source=null 记忆语义去重, 标准化小写+空白",
  };
}
