import { randomUUID } from 'node:crypto';
import { SCHEMA_VERSION } from './domain.mjs';

export const EVENT_TYPES = Object.freeze([
  'TASK_CREATED','TASK_CLASSIFIED','TASK_QUEUED','TASK_STARTED','TASK_PAUSED','TASK_RESUMED',
  'TASK_DECOMPOSED','TASK_CANCELLED','TASK_COMPLETED','TASK_FAILED',
  'ROUTER_RECOMMENDED','ROUTER_OUTCOME_RECORDED','ROUTER_DISAGREEMENT','EXPERT_SELECTED','TOOL_REQUESTED',
  'CAPABILITY_ALLOWED','CAPABILITY_DENIED',
  'HUMAN_APPROVAL_REQUESTED','APPROVAL_GRANTED','APPROVAL_DENIED',
  'CHECKPOINT_SAVED','EVIDENCE_ADDED','EVIDENCE_VERIFIED','SOURCE_FETCHED','EXTERNAL_DISCLOSURE','INJECTION_SUSPECT',
  'KNOWLEDGE_GAP_DETECTED','KNOWLEDGE_DEBT_CREATED','KNOWLEDGE_SUPERSEDED',
  'USER_CORRECTION_RECORDED','IMPROVEMENT_PROPOSED',
  'PROACTIVE_CANDIDATE_CREATED','PROACTIVE_CANDIDATE_DEFERRED','PROACTIVE_CANDIDATE_STARTED',
  'BUDGET_EXCEEDED','OUTCOME_RECORDED','REFLECTION_RECORDED'
]);

export function createEvent(input = {}, now = new Date()) {
  if (!EVENT_TYPES.includes(input.type)) throw new TypeError(`event.type must be one of: ${EVENT_TYPES.join(', ')}`);
  return {
    schemaVersion: SCHEMA_VERSION,
    id: input.id ?? `EVT-${randomUUID()}`,
    type: input.type,
    at: input.at ?? now.toISOString(),
    actor: input.actor ?? 'system',
    projectId: input.projectId ?? null,
    taskId: input.taskId ?? null,
    correlationId: input.correlationId ?? input.taskId ?? null,
    causationId: input.causationId ?? null,
    sequence: input.sequence ?? null,
    payload: { ...(input.payload ?? {}) }
  };
}
