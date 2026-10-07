import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { OrgRole } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { bootstrapDefaultWorkforce, finishAgentTask } from "../src/modules/workforce/service";
import { resolveWorkerSession } from "../src/modules/worker/identity";
import { ExecutionStoppedError, type ExecutorGuard } from "../src/modules/worker/claim";
import "../src/modules/supervisor/worker-runtime";
import { recoverOrphanedTasks } from "../src/modules/worker/recovery";
import { executeAgentTask } from "../src/modules/worker/executor";
import { registerWorkerHandlers, workerHandlers } from "../src/modules/worker/registry";
import {
  appendMissionEvents, buildNewProductMissionPlan, controlKernMission,
  getKernMissionStatus, launchKernMission, setMissionModelInvokerForTest,
} from "../src/modules/supervisor";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Execution control regression timed out")), 10_000); });
  try { return await Promise.race([promise, deadline]); } finally { clearTimeout(timeout!); }
}
const response = (text: string) => ({ text, provenance: { provider: "fixture", modelId: "fixture", modelRunId: null } });

async function main() {
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID();
  const org = await prisma.organization.create({ data: { name: "Execution control", code: `EXEC_${tag}` } });
  const owner = await prisma.user.create({ data: { organizationId: org.id, email: `exec-${tag}@hermes.test`, name: "Owner" } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: owner.id, role: OrgRole.ORG_ADMIN } });
  const session = { userId: owner.id, organizationId: org.id, userEmail: owner.email, userName: owner.name };
  await bootstrapDefaultWorkforce(session);
  const worker = await resolveWorkerSession(org.id);
  const missions: string[] = [];
  const launch = async () => {
    const { missionTaskId } = await launchKernMission(session, { plan: buildNewProductMissionPlan("测试竞品研究"), conversationId: null, sourceRunId: randomUUID() });
    missions.push(missionTaskId);
    const task = await prisma.agentTask.findFirstOrThrow({ where: { parentTaskId: missionTaskId, contextSnapshot: { path: ["nodeKey"], equals: "market" } } });
    return { missionTaskId, taskId: task.id };
  };
  const guardFor = async (taskId: string): Promise<ExecutorGuard> => {
    const task = await prisma.agentTask.findUniqueOrThrow({ where: { id: taskId }, include: { runs: { where: { status: "RUNNING" } } } });
    const token = (task.contextSnapshot as { executorLease: { token: string } }).executorLease.token;
    return { taskId, organizationId: org.id, token, runId: task.runs[0].id };
  };
  try {
    console.log("▶ EC1: cancel an in-flight model; close run, reject late events and result, never retry");
    const a = await launch();
    const entered = deferred<AbortSignal>();
    setMissionModelInvokerForTest(async ({ signal }) => {
      assert.ok(signal);
      entered.resolve(signal);
      await new Promise<void>((_, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
      return response("unreachable");
    });
    const executing = executeAgentTask(worker, a.taskId);
    const signal = await bounded(entered.promise);
    const oldGuard = await guardFor(a.taskId);
    await controlKernMission(session, a.missionTaskId, { action: "cancel" });
    const afterCancel = await prisma.kernMissionEvent.count({ where: { missionTaskId: a.missionTaskId } });
    assert.equal((await bounded(executing)).skippedReason, "execution-stopped");
    assert.ok(signal.aborted);
    const cancelled = await prisma.agentTask.findUniqueOrThrow({ where: { id: a.taskId }, include: { runs: true } });
    assert.equal(cancelled.status, "CANCELLED");
    assert.ok(cancelled.runs.every(r => r.status === "CANCELLED" && r.finishedAt));
    assert.equal((cancelled.contextSnapshot as Record<string, unknown>).executorResult, undefined);
    assert.equal((cancelled.contextSnapshot as Record<string, unknown>).executorLease, undefined);
    await assert.rejects(appendMissionEvents({ organizationId: org.id, missionTaskId: a.missionTaskId, execution: oldGuard, events: [{ type: "node.delta", nodeKey: "market", payload: { text: "late" } }] }), ExecutionStoppedError);
    assert.equal(await prisma.kernMissionEvent.count({ where: { missionTaskId: a.missionTaskId } }), afterCancel);

    console.log("▶ EC2: recover then resume old executor; preserve new lease and new result");
    const b = await launch();
    const oldEntered = deferred<void>();
    const oldResponse = deferred<void>();
    const newEntered = deferred<void>();
    const newResponse = deferred<void>();
    let calls = 0;
    setMissionModelInvokerForTest(async () => {
      if (++calls === 1) { oldEntered.resolve(); await oldResponse.promise; return response("OLD RESULT"); }
      newEntered.resolve(); await newResponse.promise; return response("NEW RESULT");
    });
    const oldExecution = executeAgentTask(worker, b.taskId);
    await bounded(oldEntered.promise);
    const staleGuard = await guardFor(b.taskId);
    await prisma.$executeRaw`UPDATE "AgentTask" SET "contextSnapshot" = jsonb_set("contextSnapshot", '{executorLease}', ${JSON.stringify({ token: staleGuard.token, owner: `dead-${tag}`, claimedAt: new Date(Date.now() - 120_000), expiresAt: new Date(Date.now() - 1000) })}::jsonb) WHERE id = ${b.taskId}`;
    assert.deepEqual((await recoverOrphanedTasks({ organizationId: org.id })).requeued, [b.taskId]);
    const newExecution = executeAgentTask(worker, b.taskId);
    await bounded(newEntered.promise);
    const newGuard = await guardFor(b.taskId);
    assert.notEqual(newGuard.token, staleGuard.token);
    oldResponse.resolve();
    assert.equal((await bounded(oldExecution)).skippedReason, "execution-stopped");
    assert.equal((await guardFor(b.taskId)).token, newGuard.token, "old finally cannot delete new lease");
    await assert.rejects(finishAgentTask(worker, b.taskId, { runId: staleGuard.runId!, outcome: "SUCCEEDED", resultSummary: "late", executor: { token: staleGuard.token, result: { output: "OLD" } } }), ExecutionStoppedError);
    await assert.rejects(appendMissionEvents({ organizationId: org.id, missionTaskId: b.missionTaskId, execution: staleGuard, events: [{ type: "node.delta", nodeKey: "market", payload: { text: "OLD" } }] }), ExecutionStoppedError);
    newResponse.resolve();
    assert.equal((await bounded(newExecution)).outcome, "SUCCEEDED");
    const completed = await prisma.agentTask.findUniqueOrThrow({ where: { id: b.taskId }, include: { runs: { orderBy: { createdAt: "asc" } } } });
    assert.equal((completed.contextSnapshot as { executorResult: { output: string } }).executorResult.output, "NEW RESULT");
    assert.deepEqual(completed.runs.map(r => r.status), ["FAILED", "SUCCEEDED"]);
    assert.equal(calls, 2);

    console.log("▶ EC3: failure closes run and queues retry atomically; parent stays active");
    await controlKernMission(session, b.missionTaskId, { action: "cancel" });
    const c = await launch();
    setMissionModelInvokerForTest(async () => { throw new Error("temporary fixture failure"); });
    assert.equal((await executeAgentTask(worker, c.taskId)).outcome, "FAILED");
    const retry = await prisma.agentTask.findUniqueOrThrow({ where: { id: c.taskId }, include: { runs: true } });
    assert.equal(retry.status, "QUEUED");
    assert.equal(retry.completedAt, null);
    assert.ok(retry.availableAt > new Date());
    assert.equal(retry.runs[0].status, "FAILED");
    assert.equal((retry.contextSnapshot as { executorState: { attempts: number } }).executorState.attempts, 1);
    assert.equal((retry.contextSnapshot as Record<string, unknown>).executorLease, undefined);
    const status = await getKernMissionStatus(session, c.missionTaskId);
    assert.equal(status.nodes.find(n => n.key === "market")!.status, "ACTIVE");
    assert.equal(status.outcome, null);
    assert.equal(await prisma.kernMissionEvent.count({ where: { missionTaskId: c.missionTaskId, nodeKey: "market", type: "node.finished" } }), 0);
    console.log("▶ EC4: generic delegated retry emits no terminal business event");
    const original = workerHandlers();
    const parentAgent = await prisma.agent.findFirstOrThrow({ where: { organizationId: org.id, code: "hermes_pm" } });
    const childAgent = await prisma.agent.findFirstOrThrow({ where: { organizationId: org.id, code: "tech_architect_agent" } });
    const parent = await prisma.agentTask.create({ data: { organizationId: org.id, agentId: parentAgent.id, goal: "Generic parent", status: "RUNNING" } });
    const child = await prisma.agentTask.create({ data: { organizationId: org.id, agentId: childAgent.id, parentTaskId: parent.id, goal: "Generic child" } });
    try {
      registerWorkerHandlers({ ...original, strategies: { ...original.strategies, tech_architect_agent: async () => { throw new Error("retry fixture"); } } });
      await executeAgentTask(worker, child.id);
      assert.equal((await prisma.agentTask.findUniqueOrThrow({ where: { id: child.id } })).status, "QUEUED");
      assert.equal(await prisma.businessEvent.count({ where: { organizationId: org.id, aggregateId: child.id, eventType: "AGENT_CHILD_TERMINAL" } }), 0);
    } finally { registerWorkerHandlers(original); }
    console.log("PASS: cancellation, stale commits/events, conditional release and atomic retry");
  } finally {
    setMissionModelInvokerForTest(null);
    for (const id of missions) await controlKernMission(session, id, { action: "cancel" }).catch(() => null);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
