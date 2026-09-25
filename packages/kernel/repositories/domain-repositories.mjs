export function createRepositories(storage) {
  if (!storage?.put || !storage?.get || !storage?.list) throw new TypeError('storage adapter required');

  const repo = kind => ({
    save: record => storage.put(kind, record),
    get: id => storage.get(kind, id),
    list: filter => storage.list(kind, filter)
  });

  return {
    projects: repo('project'),
    tasks: repo('task'),
    evidence: repo('evidence'),
    reports: repo('report'),
    knowledge: repo('knowledge'),
    knowledgeDebt: repo('knowledgeDebt'),
    improvements: repo('improvement'),
    decisions: repo('decision'),
    delegations: repo('delegation'),
    goals: repo('goal'),
    corrections: repo('correction'),
    events: {
      append: (event, options) => storage.appendEvent(event, options),
      list: filter => storage.listEvents(filter)
    },
    audit: {
      append: entry => storage.appendAudit(entry),
      list: limit => storage.listAudit(limit)
    },
    approvals: {
      save: grant => storage.putApproval(grant),
      get: id => storage.getApproval(id),
      consume: (id, runId, usedAt) => storage.consumeApproval(id, runId, usedAt)
    },
    idempotency: {
      get: (namespace, key) => storage.getIdempotent(namespace, key),
      set: (namespace, key, result) => storage.setIdempotent(namespace, key, result)
    },
    transaction(fn) {
      return storage.transaction(tx => fn(createRepositories(tx)));
    }
  };
}
