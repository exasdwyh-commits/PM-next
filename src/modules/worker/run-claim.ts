import { Prisma } from "@prisma/client";
import prisma from "@/shared/db";
import { ExecutionStoppedError } from "./claim";

export interface RunExecutionGuard {
  runId: string;
  organizationId: string;
  userId: string;
  token: string;
}
export interface ConversationExecution {
  guard: RunExecutionGuard;
  inputMessageId: string;
  signal: AbortSignal;
  assertActive: () => Promise<void>;
}
export async function assertRunExecutionActive(guard: RunExecutionGuard, db: Prisma.TransactionClient = prisma): Promise<void> {
  const run = await db.agentRun.findFirst({ where: {
    id: guard.runId, organizationId: guard.organizationId, userId: guard.userId,
    status: "RUNNING", executionToken: guard.token, cancelRequestedAt: null,
    user: { isActive: true, isSystem: false }, conversation: { ownerId: guard.userId, archivedAt: null },
  }, select: { id: true } });
  if (!run) throw new ExecutionStoppedError("消息执行已经停止，不能提交旧结果");
}
export async function lockRunExecutionTx(tx: Prisma.TransactionClient, guard: RunExecutionGuard): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "AgentRun" WHERE id = ${guard.runId} AND "organizationId" = ${guard.organizationId} FOR UPDATE`;
  await assertRunExecutionActive(guard, tx);
}
export function watchRunExecution(guard: RunExecutionGuard) {
  const controller = new AbortController();
  let pending: Promise<void> = Promise.resolve();
  let polling = false;
  const assertActive = async () => { controller.signal.throwIfAborted(); await assertRunExecutionActive(guard); controller.signal.throwIfAborted(); };
  const timer = setInterval(() => {
    if (polling || controller.signal.aborted) return;
    polling = true;
    pending = assertActive().catch((error: unknown) => {
      if (error instanceof ExecutionStoppedError) controller.abort(error);
    }).finally(() => { polling = false; });
  }, 750);
  timer.unref();
  return { signal: controller.signal, assertActive, dispose: async () => { clearInterval(timer); await pending; } };
}
