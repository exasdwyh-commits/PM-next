export function getKernelRuntime(): {
  storage: any;
  repositories: any;
  gateway: any;
  registry: any;
  decisionPlane: any;
  approvalService: any;
  verifier: { identity: string };
  dbFile: string;
};

export function runKernelProductRnd(args: {
  idea: string;
  dataClass?: string;
  actor?: string;
  idempotencyKey?: string | null;
  provider?: unknown;
  sourceFetchExecutor?: unknown;
}): Promise<{
  project: any;
  task: any;
  route: any;
  report: any;
  evidence: any[];
  knowledgeDebt: any[];
  provider: { id: string; error?: string | null };
  recoveryRequired?: boolean;
}>;

export function listKernelProductRnd(): {
  reports: any[];
  projects: any[];
  tasks: any[];
  knowledgeDebt: any[];
};
