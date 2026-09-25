import { randomUUID } from 'node:crypto';

export const SCHEMA_VERSION = '2.3.0-mvp';

export const COLLABORATION_MODES = Object.freeze(['ASSISTANT','DELEGATION','EXECUTIVE']);
export const TASK_STATUS = Object.freeze([
  'INTAKE','QUEUED','SCHEDULED','PLANNED','RUNNING','PAUSED','DEFERRED',
  'WAITING_HUMAN','BLOCKED','VERIFYING','COMPLETED','FAILED','CANCELLED'
]);
export const TASK_ORIGINS = Object.freeze(['USER','PROACTIVE','SCHEDULED','SYSTEM']);
export const TASK_STAGES = Object.freeze(['INTAKE','PLAN','EXECUTE','VERIFY','REPORT','LEARN']);
export const AUTONOMY_LEVELS = Object.freeze(['A0','A1','A2','A3','A4']);
export const DATA_CLASSES = Object.freeze(['PUBLIC','INTERNAL','CONFIDENTIAL','RESTRICTED']);
export const RISK_LEVELS = Object.freeze(['LOW','MEDIUM','HIGH','CRITICAL']);
export const PRIORITY_LEVELS = Object.freeze(['LOW','MEDIUM','HIGH','CRITICAL']);

export const CLAIM_KINDS = Object.freeze(['FACT','INFERENCE','ESTIMATE','OPINION','FORECAST']);
export const EVIDENCE_LEVELS = Object.freeze(['VERIFIED','STRONG','SUPPORTED','WEAK','UNKNOWN']);
export const FRESHNESS_STATES = Object.freeze(['FRESH','STALE','EXPIRED','UNKNOWN']);

export const GAP_CAUSES = Object.freeze(['KNOWLEDGE','TOOL','MODEL','WORKFLOW','REASONING','MEMORY','DATA']);
export const GAP_SIGNALS = Object.freeze(['FAILURE','CORRECTION','LOW_QUALITY','UNCERTAINTY','COST','LATENCY']);

export function assertEnum(value, allowed, field) {
  if (!allowed.includes(value)) throw new TypeError(`${field} must be one of: ${allowed.join(', ')}`);
  return value;
}
function nowIso(now) { return (now ?? new Date()).toISOString(); }

export function createProject(input = {}, now) {
  if (!input.title?.trim()) throw new TypeError('project.title is required');
  return {
    schemaVersion: SCHEMA_VERSION,
    id: input.id ?? `PRJ-${randomUUID()}`,
    title: input.title.trim(),
    goal: input.goal?.trim() ?? '',
    goalIds: [...(input.goalIds ?? [])],
    status: input.status ?? 'ACTIVE',
    owner: input.owner ?? null,
    owners: [...(input.owners ?? [])],
    dataClass: assertEnum(input.dataClass ?? 'INTERNAL', DATA_CLASSES, 'project.dataClass'),
    budget: input.budget ?? null,
    deadline: input.deadline ?? null,
    createdAt: input.createdAt ?? nowIso(now),
    updatedAt: input.updatedAt ?? nowIso(now),
    tags: [...(input.tags ?? [])],
    metadata: { ...(input.metadata ?? {}) }
  };
}

export function createTask(input = {}, now) {
  if (!input.title?.trim()) throw new TypeError('task.title is required');
  return {
    schemaVersion: SCHEMA_VERSION,
    id: input.id ?? `TSK-${randomUUID()}`,
    projectId: input.projectId ?? null,
    parentTaskId: input.parentTaskId ?? null,
    title: input.title.trim(),
    request: input.request ?? '',
    mode: assertEnum(input.mode ?? 'ASSISTANT', COLLABORATION_MODES, 'task.mode'),
    status: assertEnum(input.status ?? 'INTAKE', TASK_STATUS, 'task.status'),
    stage: assertEnum(input.stage ?? 'INTAKE', TASK_STAGES, 'task.stage'),
    origin: assertEnum(input.origin ?? 'USER', TASK_ORIGINS, 'task.origin'),
    autonomyLevel: assertEnum(input.autonomyLevel ?? 'A0', AUTONOMY_LEVELS, 'task.autonomyLevel'),
    risk: assertEnum(input.risk ?? 'LOW', RISK_LEVELS, 'task.risk'),
    priority: assertEnum(input.priority ?? 'MEDIUM', PRIORITY_LEVELS, 'task.priority'),
    dataClass: assertEnum(input.dataClass ?? 'INTERNAL', DATA_CLASSES, 'task.dataClass'),
    reasonLinks: [...(input.reasonLinks ?? [])],
    budget: input.budget ?? null,
    deadline: input.deadline ?? null,
    ownerAgent: input.ownerAgent ?? 'department-assistant',
    assignedExperts: [...(input.assignedExperts ?? [])],
    checkpoint: input.checkpoint ?? null,
    lastCheckpointStage: input.lastCheckpointStage ?? null,
    attempt: input.attempt ?? 0,
    runId: input.runId ?? null,
    leaseUntil: input.leaseUntil ?? null,
    reportId: input.reportId ?? null,
    createdAt: input.createdAt ?? nowIso(now),
    updatedAt: input.updatedAt ?? nowIso(now),
    metadata: { ...(input.metadata ?? {}) }
  };
}

export function createKnowledgeItem(input = {}, now) {
  if (!input.topic?.trim()) throw new TypeError('knowledge.topic is required');
  return {
    schemaVersion: SCHEMA_VERSION,
    id: input.id ?? `KN-${randomUUID()}`,
    topic: input.topic.trim(),
    content: input.content ?? '',
    claimKind: assertEnum(input.claimKind ?? 'FACT', CLAIM_KINDS, 'knowledge.claimKind'),
    evidenceLevel: assertEnum(input.evidenceLevel ?? 'UNKNOWN', EVIDENCE_LEVELS, 'knowledge.evidenceLevel'),
    freshness: assertEnum(input.freshness ?? 'UNKNOWN', FRESHNESS_STATES, 'knowledge.freshness'),
    dataClass: assertEnum(input.dataClass ?? 'INTERNAL', DATA_CLASSES, 'knowledge.dataClass'),
    evidenceIds: [...(input.evidenceIds ?? [])],
    sourceDate: input.sourceDate ?? null,
    capturedAt: input.capturedAt ?? nowIso(now),
    reviewAt: input.reviewAt ?? null,
    validFrom: input.validFrom ?? null,
    validTo: input.validTo ?? null,
    scope: input.scope ?? null,
    projectId: input.projectId ?? null,
    supersedes: input.supersedes ?? null,
    supersededBy: input.supersededBy ?? null,
    conflicts: [...(input.conflicts ?? [])],
    metadata: { ...(input.metadata ?? {}) }
  };
}

export function createKnowledgeDebt(input = {}, now) {
  if (!input.topic?.trim()) throw new TypeError('knowledgeDebt.topic is required');
  return {
    schemaVersion: SCHEMA_VERSION,
    id: input.id ?? `KD-${randomUUID()}`,
    topic: input.topic.trim(),
    normalizedKey: input.normalizedKey ?? input.topic.trim().toLowerCase(),
    reason: input.reason ?? '',
    importance: assertEnum(input.importance ?? 'MEDIUM', PRIORITY_LEVELS, 'knowledgeDebt.importance'),
    missing: [...(input.missing ?? [])],
    suggestedExperts: [...(input.suggestedExperts ?? [])],
    projectId: input.projectId ?? null,
    taskId: input.taskId ?? null,
    taskIds: [...(input.taskIds ?? (input.taskId ? [input.taskId] : []))],
    resolvedByEvidenceId: input.resolvedByEvidenceId ?? null,
    resolvedAt: input.resolvedAt ?? null,
    resolutionStatus: input.resolutionStatus ?? null,
    status: input.status ?? 'OPEN',
    occurrences: input.occurrences ?? 1,
    createdAt: input.createdAt ?? nowIso(now),
    lastSeenAt: input.lastSeenAt ?? nowIso(now),
    metadata: { ...(input.metadata ?? {}) }
  };
}

export function createImprovement(input = {}, now) {
  if (!input.title?.trim()) throw new TypeError('improvement.title is required');
  return {
    schemaVersion: SCHEMA_VERSION,
    id: input.id ?? `REQ-${randomUUID()}`,
    title: input.title.trim(),
    cause: assertEnum(input.cause ?? 'WORKFLOW', GAP_CAUSES, 'improvement.cause'),
    signal: assertEnum(input.signal ?? 'LOW_QUALITY', GAP_SIGNALS, 'improvement.signal'),
    description: input.description ?? '',
    impact: assertEnum(input.impact ?? 'MEDIUM', PRIORITY_LEVELS, 'improvement.impact'),
    occurrenceCount: input.occurrenceCount ?? 1,
    evidenceIds: [...(input.evidenceIds ?? [])],
    proposedChanges: [...(input.proposedChanges ?? [])],
    regressionCases: [...(input.regressionCases ?? [])],
    status: input.status ?? 'PROPOSED',
    taskIds: [...(input.taskIds ?? [])],
    createdAt: input.createdAt ?? nowIso(now),
    metadata: { ...(input.metadata ?? {}) }
  };
}
