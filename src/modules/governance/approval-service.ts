import crypto from "node:crypto";
import prisma from "@/shared/db";
import type { SessionContext } from "@/modules/identity/session";

export interface ApprovalGrantRecord {
  id: string;
  organizationId: string;
  approvedById: string;
  taskRef: string;
  capability: string;
  resource: string;
  actionHash: string;
  issuer: string;
  channel: string | null;
  signature: string;
  singleUse: boolean;
  issuedAt: Date;
  validUntil: Date;
  usedAt: Date | null;
  usedByRunId: string | null;
}

export interface ApprovalGrantStore {
  create(input: Omit<ApprovalGrantRecord, "usedAt" | "usedByRunId">): Promise<ApprovalGrantRecord>;
  find(id: string): Promise<ApprovalGrantRecord | null>;
  consume(id: string, usedByRunId: string, now: Date): Promise<boolean>;
}

export function createPrismaApprovalGrantStore(): ApprovalGrantStore {
  return {
    async create(input) {
      return prisma.approvalGrant.create({ data: input });
    },
    async find(id) {
      return prisma.approvalGrant.findUnique({ where: { id } });
    },
    async consume(id, usedByRunId, now) {
      const result = await prisma.approvalGrant.updateMany({
        where: {
          id,
          usedAt: null,
          validUntil: { gt: now },
        },
        data: { usedAt: now, usedByRunId },
      });
      return result.count === 1;
    },
  };
}

function canonical(grant: Omit<ApprovalGrantRecord, "signature" | "usedAt" | "usedByRunId">): string {
  return JSON.stringify({
    id: grant.id,
    organizationId: grant.organizationId,
    approvedById: grant.approvedById,
    taskRef: grant.taskRef,
    capability: grant.capability,
    resource: grant.resource,
    actionHash: grant.actionHash,
    issuer: grant.issuer,
    channel: grant.channel,
    singleUse: grant.singleUse,
    issuedAt: grant.issuedAt.toISOString(),
    validUntil: grant.validUntil.toISOString(),
  });
}

function sign(secret: string, grant: Omit<ApprovalGrantRecord, "signature" | "usedAt" | "usedByRunId">): string {
  return crypto.createHmac("sha256", secret).update(canonical(grant)).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const left = Buffer.from(a, "hex");
    const right = Buffer.from(b, "hex");
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

export class ApprovalService {
  readonly issuer = "pm-os-approval/v1";

  constructor(
    private readonly store: ApprovalGrantStore = createPrismaApprovalGrantStore(),
    private readonly secret: string = process.env.PM_OS_APPROVAL_HMAC_SECRET ?? ""
  ) {
    if (this.secret.length < 32) {
      throw new Error("PM_OS_APPROVAL_HMAC_SECRET must be at least 32 characters");
    }
  }

  async issue(
    session: SessionContext,
    input: {
      taskRef: string;
      capability: string;
      resource: string;
      actionHash: string;
      validUntil: Date;
      channel?: string | null;
    },
    now = new Date()
  ): Promise<ApprovalGrantRecord> {
    if (!input.taskRef.trim()) throw new Error("Approval taskRef is required");
    if (!input.capability.trim()) throw new Error("Approval capability is required");
    if (!input.resource.trim()) throw new Error("Approval resource is required");
    if (!input.actionHash.trim()) throw new Error("Approval actionHash is required");
    if (!(input.validUntil > now)) throw new Error("Approval validUntil must be in the future");

    const unsigned = {
      id: crypto.randomUUID(),
      organizationId: session.organizationId,
      approvedById: session.userId,
      taskRef: input.taskRef,
      capability: input.capability,
      resource: input.resource,
      actionHash: input.actionHash,
      issuer: this.issuer,
      channel: input.channel ?? null,
      singleUse: true,
      issuedAt: now,
      validUntil: input.validUntil,
    };
    const signature = sign(this.secret, unsigned);
    return this.store.create({ ...unsigned, signature });
  }

  verify(
    grant: ApprovalGrantRecord | null,
    expected: {
      organizationId: string;
      taskRef: string;
      capability: string;
      resource: string;
      actionHash: string;
    },
    now = new Date()
  ): boolean {
    if (!grant) return false;
    if (grant.issuer !== this.issuer || !grant.singleUse || grant.usedAt) return false;
    if (grant.validUntil <= now) return false;
    if (grant.organizationId !== expected.organizationId) return false;
    if (grant.taskRef !== expected.taskRef) return false;
    if (grant.capability !== expected.capability) return false;
    if (grant.resource !== expected.resource) return false;
    if (grant.actionHash !== expected.actionHash) return false;

    const unsigned = {
      id: grant.id,
      organizationId: grant.organizationId,
      approvedById: grant.approvedById,
      taskRef: grant.taskRef,
      capability: grant.capability,
      resource: grant.resource,
      actionHash: grant.actionHash,
      issuer: grant.issuer,
      channel: grant.channel,
      singleUse: grant.singleUse,
      issuedAt: grant.issuedAt,
      validUntil: grant.validUntil,
    };
    return safeEqualHex(grant.signature, sign(this.secret, unsigned));
  }

  async consume(
    grantId: string,
    expected: {
      organizationId: string;
      taskRef: string;
      capability: string;
      resource: string;
      actionHash: string;
      runId: string;
    },
    now = new Date()
  ): Promise<ApprovalGrantRecord> {
    const grant = await this.store.find(grantId);
    if (!this.verify(grant, expected, now)) {
      throw new Error("approval-grant-invalid");
    }
    if (!(await this.store.consume(grantId, expected.runId, now))) {
      throw new Error("approval-grant-already-consumed");
    }
    return { ...grant!, usedAt: now, usedByRunId: expected.runId };
  }
}
