import { randomUUID } from 'node:crypto';

export class CompanyBrain {
  constructor(storage) {
    if (!storage?.put || !storage?.list) throw new TypeError('CompanyBrain requires a storage adapter');
    this.storage = storage;
  }

  all() { return this.storage.list('decision', { limit: 1000 }).reverse(); }

  remember(entry) {
    const id = entry.id ?? `D-${randomUUID()}`;
    const record = {
      id,
      at: entry.at ?? new Date().toISOString(),
      type: entry.type ?? 'decision',
      ...entry
    };
    this.storage.put('decision', {
      ...record,
      createdAt: record.at,
      updatedAt: record.at,
      projectId: entry.projectId ?? null,
      taskId: entry.taskId ?? null,
      dataClass: entry.dataClass ?? 'INTERNAL'
    });
    return record;
  }

  lessons(limit = 5) {
    return this.all()
      .filter(x => x.reflection)
      .slice(-limit)
      .map(x => ({ decision: x.decision, reflection: x.reflection, outcome: x.outcome }));
  }
}
