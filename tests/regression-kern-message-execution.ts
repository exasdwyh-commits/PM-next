import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { createKernConversation, getKernConversation } from "../src/modules/assistant-runtime/conversations";
import { acceptKernMessage, listKernMessageExecutions } from "../src/modules/assistant-runtime/message-intake";
import { executeAcceptedKernMessage, recoverKernMessageExecutions } from "../src/modules/assistant-runtime/message-worker";
import { DEFAULT_KERN_CONVERSATION_RUNTIME_CONFIG } from "../src/modules/assistant-runtime/conversation-config";
import { cancelInteractiveRun } from "../src/modules/advisor/runs";
import { getWorkerHealth } from "../src/modules/worker/heartbeat";

async function bounded<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Message regression timed out")), 10_000); })]); }
  finally { clearTimeout(timer!); }
}
async function main() {
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID();
  const org = await prisma.organization.create({ data: { code: `MSG_${tag}`, name: "Message execution" } });
  const user = await prisma.user.create({ data: { organizationId: org.id, name: "Owner", email: `${tag}@kern.test`, orgMemberships: { create: { organizationId: org.id, role: "ORG_ADMIN" } } } });
  const other = await prisma.user.create({ data: { organizationId: org.id, name: "Other", email: `other-${tag}@kern.test` } });
  const session = { organizationId: org.id, userId: user.id, userName: user.name, userEmail: user.email };
  const requests: { model: string; messages: { role: string; content: string }[] }[] = [];
  let release!: () => void;
  let entered!: () => void;
  let waiting = new Promise<void>(resolve => { entered = resolve; });
  const server = createServer((req, res) => {
    let raw = ""; req.on("data", data => { raw += data; });
    req.on("end", () => {
      requests.push(JSON.parse(raw));
      release = () => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ choices: [{ message: { content: "Fixture response" } }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } })); };
      entered();
    });
  });
  const envKey = "MODEL_PROVIDER_MESSAGE_FIXTURE_BASE_URL";
  const oldBase = process.env[envKey]; const oldLegacy = process.env.ADVISOR_LLM_ENABLED;
  process.env.ADVISOR_LLM_ENABLED = "false";
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); assert.ok(address && typeof address !== "string");
    process.env[envKey] = `http://127.0.0.1:${address.port}`;
    await prisma.modelProfileConfig.create({ data: { organizationId: org.id, key: "message-fixture", displayName: "Fixture", provider: "message-fixture", modelId: "message-model", capabilities: ["TEXT"], locality: "LOCAL", enabled: true, qualityTier: "FAST", latencyTier: "FAST", costTier: "FREE" } });
    const clientConversationId = randomUUID();
    const config = { ...DEFAULT_KERN_CONVERSATION_RUNTIME_CONFIG, modelProfileKey: "message-fixture" };
    const chats = await Promise.all(Array.from({ length: 5 }, () => createKernConversation(session, { clientConversationId, title: "Receipt", runtimeConfig: config })));
    assert.ok(chats.every(chat => chat.id === clientConversationId));
    await assert.rejects(createKernConversation({ ...session, userId: other.id }, { clientConversationId }), /not found/i);
    const chat = chats[0]; const clientMessageId = randomUUID();
    const text = "查一下公司知识库的渠道政策 FIRST_RECEIPT";
    const accepted = await Promise.all(Array.from({ length: 12 }, () => acceptKernMessage(session, chat.id, { content: text, clientMessageId })));
    assert.equal(new Set(accepted.map(a => a.runId)).size, 1);
    assert.equal(accepted.filter(a => !a.replayed).length, 1);
    assert.equal(await prisma.message.count({ where: { conversationId: chat.id, role: "USER" } }), 1);
    await assert.rejects(acceptKernMessage(session, chat.id, { content: "different", clientMessageId }), /另一条/);
    await assert.rejects(acceptKernMessage({ ...session, userId: other.id }, chat.id, { content: text, clientMessageId }), /not found/i);
    await assert.rejects(acceptKernMessage(session, chat.id, { content: text, clientMessageId: null }), /标识/);
    assert.equal(requests.length, 0, "acceptance must not call a model");
    console.log("ME1: concurrent acceptance and conversation creation are idempotent; conflict and owner checks hold");

    const second = await acceptKernMessage(session, chat.id, { content: "查一下公司知识库的渠道政策 FUTURE_MESSAGE", clientMessageId: randomUUID() });
    assert.equal(await executeAcceptedKernMessage(second.runId), false, "later message cannot overtake queued predecessor");
    await prisma.conversation.update({ where: { id: chat.id }, data: { runtimeConfig: DEFAULT_KERN_CONVERSATION_RUNTIME_CONFIG as any } });
    const firstWork = executeAcceptedKernMessage(accepted[0].runId);
    await bounded(waiting);
    assert.equal(await executeAcceptedKernMessage(accepted[0].runId), false, "another worker cannot claim running request");
    assert.equal(await executeAcceptedKernMessage(second.runId), false);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].model, "message-model", "accepted selection stays fixed when conversation config changes");
    assert.ok(!JSON.stringify(requests[0].messages).includes("FUTURE_MESSAGE"), "future queued messages must not enter predecessor context");
    assert.equal(requests[0].messages.filter(m => m.role === "user" && m.content.includes("FIRST_RECEIPT")).length, 1, "accepted user input must not be duplicated in model history");
    assert.equal((await getKernConversation(session, chat.id)).messages.filter(m => m.role === "ASSISTANT").length, 0);
    const receipt = await acceptKernMessage(session, chat.id, { content: text, clientMessageId });
    assert.equal(receipt.runId, accepted[0].runId); assert.equal(receipt.execution.status, "RUNNING");
    release(); await bounded(firstWork);
    const firstDone = await prisma.agentRun.findUniqueOrThrow({ where: { id: accepted[0].runId } });
    assert.equal(firstDone.status, "SUCCEEDED"); assert.equal(firstDone.executionToken, null);
    assert.ok((await getKernConversation(session, chat.id)).messages.some(m => m.id === firstDone.outputMessageId));
    console.log("ME2: one worker claims once; accepted config, ordered context and refresh receipt remain stable");

    waiting = new Promise<void>(resolve => { entered = resolve; });
    const secondWork = executeAcceptedKernMessage(second.runId); await bounded(waiting);
    assert.ok(JSON.stringify(requests[1].messages).includes("FIRST_RECEIPT"), "next message receives prior history");
    await prisma.agentRun.update({ where: { id: second.runId }, data: { leaseOwner: `dead-${tag}`, startedAt: new Date(Date.now() - 120_000) } });
    await recoverKernMessageExecutions(org.id);
    const interrupted = await prisma.agentRun.findUniqueOrThrow({ where: { id: second.runId } });
    assert.equal(interrupted.status, "FAILED"); assert.match(interrupted.errorReason!, /不会自动重复/);
    const warning = await prisma.message.findUniqueOrThrow({ where: { id: interrupted.outputMessageId! } });
    release(); await bounded(secondWork);
    assert.equal(await executeAcceptedKernMessage(second.runId), false);
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: warning.id } })).content, warning.content, "revoked worker must not overwrite recovery output");
    assert.equal(requests.length, 2, "recovery cannot replay provider or tool calls");
    assert.equal(await prisma.modelRun.count({ where: { organizationId: org.id, status: "RUNNING" } }), 0);
    console.log("ME3: interrupted work closes honestly without silent replay or stale output commits");

    const cancelChat = await createKernConversation(session, { title: "Cancel receipt", runtimeConfig: config });
    const cancelledReceipt = await acceptKernMessage(session, cancelChat.id, { content: text, clientMessageId: randomUUID() });
    waiting = new Promise<void>(resolve => { entered = resolve; });
    const cancelledWork = executeAcceptedKernMessage(cancelledReceipt.runId); await bounded(waiting);
    await cancelInteractiveRun({ session, runId: cancelledReceipt.runId });
    await bounded(cancelledWork);
    assert.equal((await prisma.agentRun.findUniqueOrThrow({ where: { id: cancelledReceipt.runId } })).status, "CANCELLED");
    assert.equal(await executeAcceptedKernMessage(cancelledReceipt.runId), false);
    assert.equal((await getKernConversation(session, cancelChat.id)).messages.filter(m => m.role === "ASSISTANT").length, 0);
    await assert.rejects(cancelInteractiveRun({ session, runId: firstDone.id }), /终态/);
    assert.equal((await prisma.agentRun.findUniqueOrThrow({ where: { id: firstDone.id } })).status, "SUCCEEDED");
    console.log("ME5: running message cancellation aborts actual HTTP, prevents output and replay; completed receipt stays terminal");

    await prisma.agentRun.createMany({ data: Array.from({ length: 205 }, (_, i) => ({ organizationId: org.id, userId: user.id, conversationId: chat.id, clientMessageId: `old-${tag}-${i}`, goal: "Old", status: "SUCCEEDED" as const, createdAt: new Date(Date.now() + i + 1000) })) });
    const olderPending = await acceptKernMessage(session, chat.id, { content: "pending receipt", clientMessageId: randomUUID() });
    assert.ok((await listKernMessageExecutions(session, chat.id)).executions.some(run => run.runId === olderPending.runId), "pending run remains visible beyond recent 200 receipts");
    const fixtureBeat = await prisma.pmWorkerHeartbeat.create({ data: { workerId: `scope-${tag}`, host: "fixture", pid: 1, loops: ["conversation"], organizationId: "different-org", scopeKnown: true, startedAt: new Date(), heartbeatAt: new Date() } });
    const before = await getWorkerHealth(new Date(), { organizationId: org.id, loop: "conversation" });
    await prisma.pmWorkerHeartbeat.update({ where: { workerId: fixtureBeat.workerId }, data: { organizationId: org.id } });
    const own = await getWorkerHealth(new Date(), { organizationId: org.id, loop: "conversation" });
    assert.equal(own.running, before.running + 1);
    await prisma.pmWorkerHeartbeat.update({ where: { workerId: fixtureBeat.workerId }, data: { scopeKnown: false } });
    assert.equal((await getWorkerHealth(new Date(), { organizationId: org.id, loop: "conversation" })).running, before.running);
    await prisma.pmWorkerHeartbeat.delete({ where: { workerId: fixtureBeat.workerId } });
    console.log("ME4: long conversations retain pending receipts; worker readiness respects known organization and loop scope");
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    if (oldBase === undefined) delete process.env[envKey]; else process.env[envKey] = oldBase;
    if (oldLegacy === undefined) delete process.env.ADVISOR_LLM_ENABLED; else process.env.ADVISOR_LLM_ENABLED = oldLegacy;
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: [user.id, other.id] } } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
