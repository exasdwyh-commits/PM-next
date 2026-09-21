import { Prisma } from "@prisma/client";

export interface AuditParams {
  actorId: string;
  action: string;
  objectType: string;
  objectId: string;
  revision?: number;
  requestId?: string;
  summary: string;
  details?: Prisma.InputJsonValue;
}

export async function createAuditEventInTx(
  tx: Prisma.TransactionClient,
  params: AuditParams
) {
  return tx.auditEvent.create({
    data: {
      actorId: params.actorId,
      action: params.action,
      objectType: params.objectType,
      objectId: params.objectId,
      revision: params.revision,
      requestId: params.requestId,
      summary: params.summary,
      details: params.details,
    },
  });
}
