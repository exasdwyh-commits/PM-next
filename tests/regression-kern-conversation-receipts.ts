/** Real PostgreSQL regression: durable specialist receipts, not model/E2E proof. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { executorLoopOnce } from "../src/modules/supervisor/worker-runtime";
import { resetRecoveryThrottleForTest } from "../src/modules/worker/loops";
import { recoverOrphanedTasks } from "../src/modules/worker/recovery";
import type { Prisma, AgentTaskStatus } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import * as returns from "../src/modules/workforce/conversation-return";

async function main() {
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID();
  const org = await prisma.organization.create({ data: { code: `receipt-${tag}`, name: "Receipt recovery regression" } });
  const owner = await prisma.user.create({ data: { organizationId: org.id, email: `receipt-${tag}@hermes.test`, name: "Receipt owner" } });
  const agent = await prisma.agent.create({ data: { organizationId: org.id, code: "receipt_probe", name: "回执测试员工", roleKey: "PM", accessMode: "ORGANIZATION" } });
  const conversation = await prisma.conversation.create({ data: { organizationId: org.id, ownerId: owner.id, title: "Receipt recovery" } });
  const failures: string[] = [];
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    try { await run(); passed++; console.log(`PASS ${name}`); }
    catch (error) { failures.push(name); console.error(`FAIL ${name}:`, error); }
  }
  async function fixture(status: AgentTaskStatus = "SUCCEEDED", extra: Record<string, unknown> = {}) {
    const task = await prisma.agentTask.create({ data: {
      organizationId: org.id, agentId: agent.id, createdByUserId: owner.id, goal: "Verify reliable receipt", status,
      contextSnapshot: { kernConversationReturn: { version: "kern-conversation-return/v1", conversationId: conversation.id, requestedByUserId: owner.id, agentCode: agent.code }, ...extra } as Prisma.InputJsonValue,
    } });
    const run = await prisma.agentRun.create({ data: {
      organizationId: org.id, agentId: agent.id, agentTaskId: task.id, userId: owner.id, goal: task.goal,
      status: status === "SUCCEEDED" ? "SUCCEEDED" : status === "FAILED" ? "FAILED" : status === "BLOCKED" || status === "WAITING_HUMAN" ? "WAITING_CONFIRMATION" : "RUNNING",
      startedAt: new Date(Date.now() - 5000), finishedAt: status === "RUNNING" || status === "QUEUED" ? null : new Date(), outputSummary: `persisted ${status} result`,
    } });
    return { task, run, input: { organizationId: org.id, taskId: task.id, runId: run.id, outcome: status as "SUCCEEDED" | "FAILED" | "BLOCKED" | "WAITING_HUMAN", summary: `persisted ${status} result` } };
  }
  try {
    await check("CR01 foreign-task run cannot create a receipt", async () => {
      const a = await fixture(); const b = await fixture();
      assert.equal(await returns.appendAgentTaskConversationReturn({ ...a.input, runId: b.run.id }), null);
      assert.equal(await prisma.message.count({ where: { runId: b.run.id } }), 0);
    });
    await check("CR02 running task cannot be announced as succeeded", async () => {
      const f = await fixture("RUNNING");
      assert.equal(await returns.appendAgentTaskConversationReturn({ ...f.input, outcome: "SUCCEEDED" }), null);
      assert.equal(await prisma.message.count({ where: { runId: f.run.id } }), 0);
    });
    await check("CR03 wrong outcome cannot turn a failure into success", async () => {
      const f = await fixture("FAILED");
      assert.equal(await returns.appendAgentTaskConversationReturn({ ...f.input, outcome: "SUCCEEDED" }), null);
      assert.equal(await prisma.message.count({ where: { runId: f.run.id } }), 0);
    });
    await check("CR04 committed terminal task has a recovery entrypoint", async () => {
      assert.equal(typeof Reflect.get(returns, "recoverAgentTaskConversationReturns"), "function");
      const r = await returns.recoverAgentTaskConversationReturns({ organizationId: org.id });
      assert.equal(r.created, 3); assert.equal(r.errors, 0);
      assert.equal((await returns.recoverAgentTaskConversationReturns({ organizationId: org.id })).scanned, 0);
    });
    await check("CR05 concurrent duplicate callbacks create exactly one message", async () => {
      const f = await fixture();
      const receipts = await Promise.all(Array.from({ length: 8 }, () => returns.appendAgentTaskConversationReturn(f.input)));
      assert.equal(receipts.filter(receipt => receipt?.created).length, 1);
      assert.equal(new Set(receipts.map(receipt => receipt?.messageId)).size, 1);
      assert.equal(await prisma.message.count({ where: { runId: f.run.id } }), 1);
    });
    await check("CR06 canonical failure summary wins over stale success output and callback text", async () => {
      const f = await fixture("FAILED", { executorResult: { output: "STALE_SUCCESS_DO_NOT_SHOW", runId: "old-run" } });
      const receipt = await returns.appendAgentTaskConversationReturn({ ...f.input, summary: "FORGED_CALLBACK_SUCCESS" });
      const message = await prisma.message.findUniqueOrThrow({ where: { id: receipt!.messageId } });
      assert.match(message.content, /persisted FAILED result/);
      assert.doesNotMatch(message.content, /STALE_SUCCESS|FORGED_CALLBACK/);
      assert.match(message.content, /执行失败/);
    });
    await check("CR07 blocked receipt does not suppress a later successful run", async () => {
      const f = await fixture("BLOCKED");
      const first = await returns.appendAgentTaskConversationReturn(f.input);
      const next = await prisma.agentRun.create({ data: {
        organizationId: org.id, agentId: agent.id, agentTaskId: f.task.id, userId: owner.id, goal: f.task.goal,
        status: "SUCCEEDED", finishedAt: new Date(), createdAt: new Date(f.run.createdAt.getTime() + 1000), outputSummary: "New successful execution",
      } });
      await prisma.agentTask.update({ where: { id: f.task.id }, data: { status: "SUCCEEDED" } });
      const input = { ...f.input, runId: next.id, outcome: "SUCCEEDED" as const };
      const second = await returns.appendAgentTaskConversationReturn(input);
      assert.equal(second?.created, true); assert.notEqual(first?.messageId, second?.messageId);
      assert.equal((await returns.appendAgentTaskConversationReturn(input))?.created, false);
      assert.equal(await returns.appendAgentTaskConversationReturn(f.input), null);
      assert.equal(await prisma.message.count({ where: { runId: { in: [f.run.id, next.id] } } }), 2);
    });
    await check("CR08 older callback with the same outcome cannot beat the latest run", async () => {
      const f = await fixture();
      const next = await prisma.agentRun.create({ data: {
        organizationId: org.id, agentId: agent.id, agentTaskId: f.task.id, userId: owner.id, goal: f.task.goal,
        status: "SUCCEEDED", finishedAt: new Date(), createdAt: new Date(f.run.createdAt.getTime() + 1000), outputSummary: "latest run only",
      } });
      assert.equal(await returns.appendAgentTaskConversationReturn(f.input), null);
      assert.equal((await returns.appendAgentTaskConversationReturn({ ...f.input, runId: next.id }))?.created, true);
      assert.equal(await prisma.message.count({ where: { runId: f.run.id } }), 0);
    });
    await check("CR09 cross-organization run and scope cannot publish a receipt", async () => {
      const foreign = await prisma.organization.create({ data: { code: `foreign-${tag}`, name: "Foreign receipt sentinel" } });
      try {
        const f = await fixture();
        const user = await prisma.user.create({ data: { organizationId: foreign.id, email: `foreign-${tag}@hermes.test`, name: "Foreign owner" } });
        const run = await prisma.agentRun.create({ data: { organizationId: foreign.id, userId: user.id, agentTaskId: f.task.id, goal: "Foreign run", status: "SUCCEEDED", finishedAt: new Date(), createdAt: new Date(f.run.createdAt.getTime() + 1000) } });
        assert.equal(await returns.appendAgentTaskConversationReturn({ ...f.input, runId: run.id }), null);
        assert.equal(await returns.appendAgentTaskConversationReturn({ ...f.input, organizationId: foreign.id }), null);
        const r = await returns.recoverAgentTaskConversationReturns({ organizationId: foreign.id });
        assert.equal(r.created, 0);
        assert.equal(await prisma.message.count({ where: { runId: run.id } }), 0);
        await prisma.agentTask.update({ where: { id: f.task.id }, data: { status: "CANCELLED" } });
      } finally { await prisma.organization.delete({ where: { id: foreign.id } }); }
    });
    await check("CR10 archived conversations and inactive owners are not revived", async () => {
      const f = await fixture();
      await prisma.conversation.update({ where: { id: conversation.id }, data: { archivedAt: new Date() } });
      try {
        assert.equal(await returns.appendAgentTaskConversationReturn(f.input), null);
        assert.equal((await returns.recoverAgentTaskConversationReturns({ organizationId: org.id })).created, 0);
      } finally { await prisma.conversation.update({ where: { id: conversation.id }, data: { archivedAt: null } }); }
      await prisma.user.update({ where: { id: owner.id }, data: { isActive: false } });
      try { assert.equal(await returns.appendAgentTaskConversationReturn(f.input), null); }
      finally { await prisma.user.update({ where: { id: owner.id }, data: { isActive: true } }); }
      assert.equal((await returns.appendAgentTaskConversationReturn(f.input))?.created, true);
    });
    await check("CR11 receipt transaction failure rolls back all writes and is retried", async () => {
      const f = await fixture();
      const original = prisma.$transaction;
      prisma.$transaction = ((callback: unknown, options: unknown) => {
        if (typeof callback !== "function") return Reflect.apply(original, prisma, [callback, options]);
        return Reflect.apply(original, prisma, [(tx: Prisma.TransactionClient) => callback(new Proxy(tx, { get(target, key) {
          if (key !== "agentTask") return Reflect.get(target, key);
          return new Proxy(target.agentTask, { get(model, method) {
            if (method !== "update") return Reflect.get(model, method);
            return (args: Prisma.AgentTaskUpdateArgs) => {
              if (args.where.id === f.task.id) throw new Error("injected receipt commit failure");
              return model.update(args);
            };
          } });
        } })), options]);
      }) as typeof original;
      try { await assert.rejects(returns.appendAgentTaskConversationReturn(f.input), /injected receipt commit failure/); }
      finally { prisma.$transaction = original; }
      assert.equal(await prisma.message.count({ where: { runId: f.run.id } }), 0);
      assert.equal((await prisma.agentRun.findUniqueOrThrow({ where: { id: f.run.id } })).outputMessageId, null);
      await returns.recoverAgentTaskConversationReturns({ organizationId: org.id });
      assert.equal(await prisma.message.count({ where: { runId: f.run.id } }), 1);
      await returns.recoverAgentTaskConversationReturns({ organizationId: org.id });
      assert.equal(await prisma.message.count({ where: { runId: f.run.id } }), 1);
    });
    await check("CR12 one bad receipt does not abort the recovery batch", async () => {
      const bad = await fixture(); const good = await fixture();
      const original = prisma.$transaction;
      prisma.$transaction = ((callback: unknown, options: unknown) => {
        if (typeof callback !== "function") return Reflect.apply(original, prisma, [callback, options]);
        return Reflect.apply(original, prisma, [(tx: Prisma.TransactionClient) => callback(new Proxy(tx, { get(target, key) {
          if (key !== "agentTask") return Reflect.get(target, key);
          return new Proxy(target.agentTask, { get(model, method) {
            if (method !== "update") return Reflect.get(model, method);
            return (args: Prisma.AgentTaskUpdateArgs) => {
              if (args.where.id === bad.task.id) throw new Error("injected per-item recovery failure");
              return model.update(args);
            };
          } });
        } })), options]);
      }) as typeof original;
      try {
        const r = await returns.recoverAgentTaskConversationReturns({ organizationId: org.id });
        assert.equal(r.errors, 1); assert.ok(r.created >= 1);
        assert.equal(await prisma.message.count({ where: { runId: bad.run.id } }), 0);
        assert.equal(await prisma.message.count({ where: { runId: good.run.id } }), 1);
      } finally { prisma.$transaction = original; }
      await returns.recoverAgentTaskConversationReturns({ organizationId: org.id });
      assert.equal(await prisma.message.count({ where: { runId: bad.run.id } }), 1);
    });
    await check("CR13 legacy marker repairs run linkage without a duplicate message", async () => {
      const f = await fixture();
      const receipt = await returns.appendAgentTaskConversationReturn(f.input);
      await prisma.agentTask.update({ where: { id: f.task.id }, data: { contextSnapshot: { ...(f.task.contextSnapshot as Prisma.JsonObject), kernConversationReturnReceipt: { messageId: receipt!.messageId } } } });
      await prisma.agentRun.update({ where: { id: f.run.id }, data: { outputMessageId: null } });
      const r = await returns.recoverAgentTaskConversationReturns({ organizationId: org.id });
      assert.ok(r.skipped >= 1);
      assert.equal(await prisma.message.count({ where: { runId: f.run.id } }), 1);
      assert.equal((await prisma.agentRun.findUniqueOrThrow({ where: { id: f.run.id } })).outputMessageId, receipt!.messageId);
    });
    await check("CR14 fresh Worker process catches a committed result, then restart is idempotent", async () => {
      const f = await fixture();
      for (let attempt = 0; attempt < 2; attempt++) {
        const child = spawnSync(process.execPath, ["--import", "tsx", process.argv[1], "--receipt-worker-tick", org.id], { env: process.env, encoding: "utf8", timeout: 30_000 });
        assert.equal(child.status, 0, child.stdout + child.stderr);
        assert.equal(await prisma.message.count({ where: { runId: f.run.id } }), 1);
      }
      assert.equal((await prisma.agentTask.findUniqueOrThrow({ where: { id: f.task.id } })).status, "SUCCEEDED");
    });
    await check("CR15 orphan retry exhaustion also returns a truthful failure", async () => {
      const f = await fixture("RUNNING", { executorState: { attempts: 2 }, executorLease: { token: `dead-${tag}`, owner: `missing-${tag}`, claimedAt: new Date(Date.now() - 120_000).toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString() } });
      const recovered = await recoverOrphanedTasks({ organizationId: org.id });
      assert.ok(recovered.failed.includes(f.task.id));
      resetRecoveryThrottleForTest();
      await executorLoopOnce({ organizationId: org.id });
      const message = await prisma.message.findFirstOrThrow({ where: { runId: f.run.id } });
      assert.match(message.content, /执行失败/); assert.match(message.content, /断开/);
      assert.equal(await prisma.message.count({ where: { runId: f.run.id } }), 1);
    });
    await check("CR16 invalid targets cannot starve a bounded valid batch", async () => {
      await returns.recoverAgentTaskConversationReturns({ organizationId: org.id, limit: 200 });
      for (let i = 0; i < 5; i++) await fixture("SUCCEEDED", { kernConversationReturn: { version: "kern-conversation-return/v1", conversationId: conversation.id, requestedByUserId: owner.id, agentCode: "wrong-agent" } });
      const f = await fixture();
      assert.deepEqual(await returns.recoverAgentTaskConversationReturns({ organizationId: org.id, limit: 0 }), { scanned: 0, created: 0, skipped: 0, errors: 0 });
      const r = await returns.recoverAgentTaskConversationReturns({ organizationId: org.id, limit: 1 });
      assert.equal(r.scanned, 1); assert.equal(r.created, 1);
      assert.equal(await prisma.message.count({ where: { runId: f.run.id } }), 1);
    });
    await check("CR17 full output must belong to the successful run and remains bounded", async () => {
      const f = await fixture();
      await prisma.agentTask.update({ where: { id: f.task.id }, data: { contextSnapshot: { ...(f.task.contextSnapshot as Prisma.JsonObject), executorResult: { runId: f.run.id, output: `详细结果${"x".repeat(13000)}` } } } });
      const receipt = await returns.appendAgentTaskConversationReturn(f.input);
      const message = await prisma.message.findUniqueOrThrow({ where: { id: receipt!.messageId } });
      assert.match(message.content, /详细结果/); assert.match(message.content, /输出较长/); assert.ok(message.content.length < 12500);
    });
    await check("CR18 waiting-human remains waiting rather than a success receipt", async () => {
      const f = await fixture("WAITING_HUMAN");
      await returns.recoverAgentTaskConversationReturns({ organizationId: org.id });
      const message = await prisma.message.findFirstOrThrow({ where: { runId: f.run.id } });
      assert.match(message.content, /需要你处理/); assert.doesNotMatch(message.content, /已完成/);
    });
    await check("CR19 archive racing after discovery prevents publication", async () => {
      const f = await fixture();
      const original = prisma.$transaction;
      prisma.$transaction = ((callback: unknown, options: unknown) => {
        if (typeof callback !== "function") return Reflect.apply(original, prisma, [callback, options]);
        return Reflect.apply(original, prisma, [(tx: Prisma.TransactionClient) => callback(new Proxy(tx, { get(target, key) {
          if (key !== "conversation") return Reflect.get(target, key);
          return new Proxy(target.conversation, { get(model, method) {
            if (method !== "updateMany") return Reflect.get(model, method);
            return async (args: Prisma.ConversationUpdateManyArgs) => {
              await prisma.conversation.update({ where: { id: conversation.id }, data: { archivedAt: new Date() } });
              return model.updateMany(args);
            };
          } });
        } })), options]);
      }) as typeof original;
      try { assert.equal(await returns.appendAgentTaskConversationReturn(f.input), null); }
      finally {
        prisma.$transaction = original;
        await prisma.conversation.update({ where: { id: conversation.id }, data: { archivedAt: null } });
      }
      assert.equal(await prisma.message.count({ where: { runId: f.run.id } }), 0);
    });
  } finally {
    const users = await prisma.user.findMany({ where: { organizationId: org.id }, select: { id: true } });
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: users.map(user => user.id) } } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
  console.log(`Receipt regression: ${passed} passed, ${failures.length} failed`);
  assert.deepEqual(failures, []);
}
const entry = process.argv.includes("--receipt-worker-tick")
  ? async () => {
      await assertTestDatabaseSafety(prisma);
      console.log(JSON.stringify(await executorLoopOnce({ organizationId: process.argv[process.argv.length - 1] })));
    }
  : main;
entry().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
