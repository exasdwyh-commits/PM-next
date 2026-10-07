import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { runPmWorker } from "../src/modules/supervisor/worker-runtime";
import { workerHandlers, registerWorkerHandlers } from "../src/modules/worker/registry";
import { PROCESS_WORKER_ID } from "../src/modules/worker/heartbeat";

async function main() {
  await assertTestDatabaseSafety(prisma);
  const org = await prisma.organization.create({ data: { code: `BEAT_${randomUUID().slice(0, 8)}`, name: "Heartbeat test" } });
  const directory = mkdtempSync(join(tmpdir(), "kern-beat-"));
  const previousDir = process.env.PM_WORKER_LOCK_DIR;
  process.env.PM_WORKER_LOCK_DIR = directory;
  const handlers = workerHandlers();
  let advanced = false;
  try {
    registerWorkerHandlers({ ...handlers, missions: {
      listActiveIds: async () => [{ id: "slow-fixture", organizationId: org.id }],
      advance: async () => {
        const before = await prisma.pmWorkerHeartbeat.findUniqueOrThrow({ where: { workerId: PROCESS_WORKER_ID } });
        const lockBefore = JSON.parse(readFileSync(join(directory, "lock.json"), "utf8")) as { heartbeatAt: string };
        await new Promise(resolve => setTimeout(resolve, 12_000));
        const during = await prisma.pmWorkerHeartbeat.findUniqueOrThrow({ where: { workerId: PROCESS_WORKER_ID } });
        const lockDuring = JSON.parse(readFileSync(join(directory, "lock.json"), "utf8")) as { heartbeatAt: string };
        assert.ok(during.heartbeatAt.getTime() > before.heartbeatAt.getTime() + 5_000, "DB heartbeat advances while a loop is waiting");
        assert.ok(new Date(lockDuring.heartbeatAt).getTime() > new Date(lockBefore.heartbeatAt).getTime() + 5_000, "file lock stays fresh during a slow loop");
        assert.equal(during.stoppedAt, null);
        advanced = true;
        return { progress: { done: 1, total: 1 } };
      },
    } });
    const result = await runPmWorker({ once: true, organizationId: org.id, quiet: true, loops: ["reconcile"] });
    assert.equal(result.results.reconcile?.errors, 0); assert.equal(advanced, true);
    assert.ok((await prisma.pmWorkerHeartbeat.findUniqueOrThrow({ where: { workerId: PROCESS_WORKER_ID } })).stoppedAt);
    assert.equal(existsSync(join(directory, "lock.json")), false);
    console.log("HB1: DB and file heartbeat remain fresh during a slow loop, exit drains writes and releases lock");

    advanced = false;
    const ctrl = new AbortController(); ctrl.abort();
    const beforeListeners = process.listenerCount("SIGTERM");
    const stopped = await runPmWorker({ once: true, organizationId: org.id, quiet: true, loops: ["reconcile"], signal: ctrl.signal });
    assert.equal(stopped.stoppedBy, "signal"); assert.equal(advanced, false);
    assert.equal(process.listenerCount("SIGTERM"), beforeListeners);
    assert.ok((await prisma.pmWorkerHeartbeat.findUniqueOrThrow({ where: { workerId: PROCESS_WORKER_ID } })).stoppedAt);
    console.log("HB2: a pre-aborted run executes no loop and leaves no process signal listener");
  } finally {
    registerWorkerHandlers(handlers);
    if (previousDir === undefined) delete process.env.PM_WORKER_LOCK_DIR; else process.env.PM_WORKER_LOCK_DIR = previousDir;
    rmSync(directory, { recursive: true, force: true });
    await prisma.pmWorkerHeartbeat.deleteMany({ where: { workerId: PROCESS_WORKER_ID } });
    const users = await prisma.user.findMany({ where: { organizationId: org.id }, select: { id: true } });
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: users.map(u => u.id) } } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
