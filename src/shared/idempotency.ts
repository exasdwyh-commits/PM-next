import { Prisma } from "@prisma/client";
import { ConflictError } from "./errors";
import crypto from "crypto";

export function computeRequestHash(body: unknown): string {
  const content = JSON.stringify(body ?? {});
  return crypto.createHash("sha256").update(content).digest("hex");
}

export async function checkOrRecordIdempotency<T>(
  tx: Prisma.TransactionClient,
  key: string,
  actorId: string,
  commandScope: string,
  requestHash: string,
  execute: () => Promise<{ status: number; body: T }>
): Promise<{ status: number; body: T; wasReplayed: boolean }> {
  const existing = await tx.idempotencyRecord.findUnique({
    where: { key },
  });

  if (existing) {
    // TASK-003b: 幂等键作用域 = (actorId, commandScope)（契约 §2.3）。读取分支必须同时比对
    // commandScope——否则同 key 跨命令会命中旧记录并返回**别的命令**的历史响应（跨命令重放）。
    // 错误信息按原因分类，但**不回显请求体内容**。
    const conflicts: string[] = [];
    if (existing.commandScope !== commandScope) conflicts.push("commandScope");
    if (existing.requestHash !== requestHash) conflicts.push("requestHash");
    if (existing.actorId !== actorId) conflicts.push("actorId");
    if (conflicts.length > 0) {
      throw new ConflictError(
        `Idempotency key reused with different ${conflicts.join(" / ")}`
      );
    }
    return {
      status: existing.responseStatus,
      body: existing.responseBody as T,
      wasReplayed: true,
    };
  }

  const result = await execute();

  await tx.idempotencyRecord.create({
    data: {
      key,
      actorId,
      commandScope,
      requestHash,
      responseStatus: result.status,
      responseBody: result.body as Prisma.InputJsonValue,
    },
  });

  return {
    status: result.status,
    body: result.body,
    wasReplayed: false,
  };
}
