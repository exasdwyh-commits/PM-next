import { createKnowledgeDebt } from '../../kernel/contracts/domain.mjs';

export function normalizeKnowledgeDebtKey(topic) {
  return String(topic ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu,'')
    .slice(0,240);
}

function unique(items) { return [...new Set(items.filter(Boolean))]; }

export class KnowledgeDebtService {
  constructor({ repositories }) {
    if (!repositories?.knowledgeDebt) throw new TypeError('repositories.knowledgeDebt required');
    this.repositories = repositories;
  }

  createOrMerge(input, now = new Date()) {
    const normalizedKey=input.normalizedKey ?? normalizeKnowledgeDebtKey(input.topic);
    const existing=this.repositories.knowledgeDebt
      .list({projectId:input.projectId ?? null,limit:1000})
      .find(x => x.status === 'OPEN' && x.normalizedKey === normalizedKey);

    if (!existing) {
      const created=createKnowledgeDebt({
        ...input,
        normalizedKey,
        taskIds: unique([...(input.taskIds ?? []), input.taskId])
      }, now);
      this.repositories.knowledgeDebt.save(created);
      return {record:created,merged:false};
    }

    const taskIds=unique([...(existing.taskIds ?? []), existing.taskId, ...(input.taskIds ?? []), input.taskId]);
    const merged={
      ...existing,
      occurrences:(existing.occurrences ?? 1)+1,
      lastSeenAt:now.toISOString(),
      taskIds,
      taskId:existing.taskId ?? input.taskId ?? null,
      missing:unique([...(existing.missing ?? []), ...(input.missing ?? [])]),
      suggestedExperts:unique([...(existing.suggestedExperts ?? []), ...(input.suggestedExperts ?? [])]),
      metadata:{...(existing.metadata ?? {}),...(input.metadata ?? {})}
    };
    this.repositories.knowledgeDebt.save(merged);
    return {record:merged,merged:true};
  }
}
