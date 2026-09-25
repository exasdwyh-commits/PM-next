import { randomUUID } from 'node:crypto';
import {
  SCHEMA_VERSION, DATA_CLASSES, CLAIM_KINDS, EVIDENCE_LEVELS,
  assertEnum
} from './domain.mjs';

export const SOURCE_TYPES=Object.freeze([
  'OFFICIAL','PRIMARY','REPUTABLE','EXTERNAL','MODEL_OUTPUT','MOCK','INTERNAL_VERIFIED'
]);
export const TRUST_TIERS=Object.freeze([
  'OFFICIAL','PRIMARY','REPUTABLE','ADVISORY','UNRATED','QUARANTINED'
]);

function nowIso(now) { return (now ?? new Date()).toISOString(); }

export function createEvidence(input = {}, now) {
  if (!input.title?.trim()) throw new TypeError('evidence.title is required');
  const sourceType=assertEnum(input.sourceType ?? 'EXTERNAL',SOURCE_TYPES,'evidence.sourceType');
  return {
    schemaVersion: SCHEMA_VERSION,
    id: input.id ?? `EVD-${randomUUID()}`,
    title: input.title.trim(),
    sourceType,
    sourceUri: input.sourceUri ?? null,
    sourceName: input.sourceName ?? null,
    trustTier: assertEnum(input.trustTier ?? 'UNRATED',TRUST_TIERS,'evidence.trustTier'),
    dataClass: assertEnum(input.dataClass ?? 'PUBLIC', DATA_CLASSES, 'evidence.dataClass'),
    untrustedInput: input.untrustedInput ?? !['OFFICIAL','INTERNAL_VERIFIED'].includes(sourceType),
    capturedAt: input.capturedAt ?? nowIso(now),
    sourceDate: input.sourceDate ?? null,
    publicationDate: input.publicationDate ?? null,
    fetchedAt: input.fetchedAt ?? null,
    fetcherRunId: input.fetcherRunId ?? null,
    httpStatus: input.httpStatus ?? null,
    contentHash: input.contentHash ?? null,
    rawContentRef: input.rawContentRef ?? null,
    rawContentPreview: input.rawContentPreview ?? null,
    injectionScanResult: input.injectionScanResult ?? null,
    projectId: input.projectId ?? null,
    taskId: input.taskId ?? null,
    metadata: { ...(input.metadata ?? {}) }
  };
}

export function createReport(input = {}, now) {
  if (!input.title?.trim()) throw new TypeError('report.title is required');
  return {
    schemaVersion: SCHEMA_VERSION,
    id: input.id ?? `RPT-${randomUUID()}`,
    title: input.title.trim(),
    projectId: input.projectId ?? null,
    taskId: input.taskId ?? null,
    executiveSummary: input.executiveSummary ?? '',
    conclusions: [...(input.conclusions ?? [])].map(c => ({
      claim: c.claim ?? '',
      claimKind: assertEnum(c.claimKind ?? 'FACT', CLAIM_KINDS, 'report.conclusion.claimKind'),
      evidenceLevel: assertEnum(c.evidenceLevel ?? 'UNKNOWN', EVIDENCE_LEVELS, 'report.conclusion.evidenceLevel'),
      evidenceIds: [...(c.evidenceIds ?? [])],
      verification: c.verification ?? null
    })),
    decisionsRequired: [...(input.decisionsRequired ?? [])],
    risks: [...(input.risks ?? [])],
    unresolvedQuestions: [...(input.unresolvedQuestions ?? [])],
    knowledgeDebtIds: [...(input.knowledgeDebtIds ?? [])],
    nextActions: [...(input.nextActions ?? [])],
    advisoryNotes: [...(input.advisoryNotes ?? [])],
    costSummary: input.costSummary ?? null,
    verifierRunId: input.verifierRunId ?? null,
    verifierIdentity: input.verifierIdentity ?? null,
    verifiedAt: input.verifiedAt ?? null,
    createdAt: input.createdAt ?? nowIso(now)
  };
}

export function createApprovalGrant(input = {}, now) {
  if (!input.capability) throw new TypeError('approval.capability is required');
  if (!input.resource) throw new TypeError('approval.resource is required');
  return {
    schemaVersion: SCHEMA_VERSION,
    id: input.id ?? `APR-${randomUUID()}`,
    approvedBy: input.approvedBy ?? null,
    taskId: input.taskId ?? null,
    capability: input.capability,
    resource: input.resource,
    actionHash: input.actionHash ?? null,
    singleUse: input.singleUse ?? true,
    issuedAt: input.issuedAt ?? nowIso(now),
    validUntil: input.validUntil ?? null,
    issuer: input.issuer ?? null,
    channel: input.channel ?? null,
    signature: input.signature ?? null,
    usedAt: input.usedAt ?? null,
    usedByRunId: input.usedByRunId ?? null
  };
}

export function createDelegation(input = {}, now) {
  if (!input.taskId) throw new TypeError('delegation.taskId is required');
  if (!input.assignee) throw new TypeError('delegation.assignee is required');
  return {
    schemaVersion: SCHEMA_VERSION,
    id: input.id ?? `DLG-${randomUUID()}`,
    taskId: input.taskId,
    assignee: input.assignee,
    expectedOutputSchema: input.expectedOutputSchema ?? null,
    budget: input.budget ?? null,
    deadline: input.deadline ?? null,
    timeoutMs: input.timeoutMs ?? null,
    status: input.status ?? 'PENDING',
    checkpointId: input.checkpointId ?? null,
    createdAt: input.createdAt ?? nowIso(now),
    updatedAt: input.updatedAt ?? nowIso(now)
  };
}

export function createGoal(input = {}, now) {
  if (!input.title?.trim()) throw new TypeError('goal.title is required');
  return {
    schemaVersion: SCHEMA_VERSION,
    id: input.id ?? `GOAL-${randomUUID()}`,
    title: input.title.trim(),
    description: input.description ?? '',
    owner: input.owner ?? null,
    status: input.status ?? 'ACTIVE',
    deadline: input.deadline ?? null,
    createdAt: input.createdAt ?? nowIso(now)
  };
}

export function createCorrection(input = {}, now) {
  if (!input.taskId) throw new TypeError('correction.taskId is required');
  return {
    schemaVersion: SCHEMA_VERSION,
    id: input.id ?? `COR-${randomUUID()}`,
    taskId: input.taskId,
    projectId: input.projectId ?? null,
    statement: input.statement ?? '',
    correctedBy: input.correctedBy ?? 'user',
    evidenceIds: [...(input.evidenceIds ?? [])],
    rootCause: input.rootCause ?? null,
    createdAt: input.createdAt ?? nowIso(now)
  };
}
