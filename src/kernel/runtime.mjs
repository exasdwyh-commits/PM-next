import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SqliteStorage } from './storage/sqlite-storage.mjs';
import { createRepositories } from './repositories/domain-repositories.mjs';
import { CapabilityGateway } from './core/capability-gateway.mjs';
import { ModelRegistry } from './core/model-registry.mjs';
import { DecisionPlane } from './core/decision-plane.mjs';
import { EvidenceVerifier } from './core/evidence-verifier.mjs';
import { ResearchExecutor } from './core/research-executor.mjs';
import { SourceFetchExecutor } from './core/source-fetch-executor.mjs';
import { ApprovalService } from './core/approval-service.mjs';
import { recoverStaleTasks } from './core/recovery.mjs';
import { resolveDataClass } from './core/request-policy.mjs';
import { createResearchProviderFromEnv } from './adapters/research-provider.mjs';
import { runProductRndSlice } from './workflows/product-rnd-slice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const kernelRoot = path.resolve(here, '../..');

function dataDir() {
  return process.env.PM_OS_KERNEL_DB_DIR || path.join(kernelRoot, 'data', 'kernel');
}

function dbFile() {
  if (process.env.PM_OS_KERNEL_DB) return process.env.PM_OS_KERNEL_DB;
  return path.join(dataDir(), 'pm-os-kernel.db');
}

function approvalSecret() {
  return (
    process.env.PM_OS_APPROVAL_SECRET ||
    process.env.AUTH_SECRET ||
    'pm-os-kernel-local-dev-secret-change-me'
  );
}

let cached = null;

export function getKernelRuntime() {
  if (cached) return cached;

  const file = dbFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const storage = new SqliteStorage(file);
  recoverStaleTasks(storage);

  const gateway = new CapabilityGateway(path.join(here, 'config', 'policies.json'), {
    auditSink: entry => storage.appendAudit(entry),
  });
  const registry = new ModelRegistry(path.join(here, 'config', 'models.json'));
  const decisionPlane = new DecisionPlane({
    registry,
    mode: process.env.ROUTER_MODE || 'shadow',
  });
  const approvalService = new ApprovalService({
    storage,
    secret: approvalSecret(),
    principal: process.env.PM_OS_PRINCIPAL || 'principal',
    issuer: 'pm-next-approval-v1',
  });
  const verifier = new EvidenceVerifier({ identity: 'evidence-verifier-v1' });
  const repositories = createRepositories(storage);

  cached = {
    storage,
    repositories,
    gateway,
    registry,
    decisionPlane,
    approvalService,
    verifier,
    dbFile: file,
  };
  return cached;
}

export function runKernelProductRnd({
  idea,
  dataClass = 'INTERNAL',
  actor = 'department-assistant',
  idempotencyKey = null,
  provider = null,
  sourceFetchExecutor = null,
}) {
  const rt = getKernelRuntime();
  const resolvedClass = resolveDataClass(process.env.PROJECT_DATA_CLASS || 'INTERNAL', dataClass);
  const researchProvider = provider || createResearchProviderFromEnv();
  const researchExecutor = new ResearchExecutor({
    gateway: rt.gateway,
    storage: rt.storage,
    provider: researchProvider,
    actor,
  });
  const fetcher =
    sourceFetchExecutor || new SourceFetchExecutor({ gateway: rt.gateway, storage: rt.storage, actor });

  return runProductRndSlice({
    idea,
    dataClass: resolvedClass,
    actor,
    repositories: rt.repositories,
    decisionPlane: rt.decisionPlane,
    researchExecutor,
    sourceFetchExecutor: fetcher,
    verifier: rt.verifier,
    idempotencyKey,
  });
}

export function listKernelProductRnd() {
  const rt = getKernelRuntime();
  const reports = rt.repositories.reports.list({ limit: 50 });
  const projects = rt.repositories.projects.list({ limit: 50 });
  const tasks = rt.repositories.tasks.list({ limit: 100 });
  const knowledgeDebt = rt.repositories.knowledgeDebt.list({ limit: 100 });
  return { reports, projects, tasks, knowledgeDebt };
}
