import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { buildAttachmentPrompt, indexAttachmentForSearch, ATTACHMENT_PROMPT_MAX_CHARS } from "../src/modules/assistant-runtime/attachments";
import { acceptKernMessage } from "../src/modules/assistant-runtime/message-intake";
import { probeKnowledgeDrift, syncDriftedKnowledgeSources } from "../src/modules/knowledge/auto-sync";
import { syncKnowledgeSource } from "../src/modules/knowledge/sync";

async function main() {
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kern-attachment-boundaries-"));
  const org = await prisma.organization.create({ data: { code: `ATT_${tag}`, name: "Attachment boundaries" } });
  const foreignOrg = await prisma.organization.create({ data: { code: `OTHER_ATT_${tag}`, name: "Other attachment tenant" } });
  try {
    const user = await prisma.user.create({ data: { organizationId: org.id, name: "Fixture", email: `${tag}@kern.test` } });
    const session = { organizationId: org.id, userId: user.id, userName: user.name, userEmail: user.email };
    const chat = await prisma.conversation.create({ data: { organizationId: org.id, ownerId: user.id, title: "Boundaries" } });
    const otherChat = await prisma.conversation.create({ data: { organizationId: org.id, ownerId: user.id, title: "Other chat" } });
    const upload = (conversationId: string, filename: string, text: string, extra: Record<string, unknown> = {}) => prisma.conversationAttachment.create({ data: {
      conversationId, organizationId: org.id, uploadedById: user.id,
      originalFilename: filename, byteSize: text.length, hash: tag, fileKey: `${randomUUID()}.txt`,
      extractedText: text, parseStatus: "READY", parsedKind: "text", ...extra,
    } });

    const indexed = await upload(chat.id, "index.txt", "UNIQUE_INDEX_MARKER", { indexForSearch: true });
    await indexAttachmentForSearch(indexed.id);
    const source = await prisma.knowledgeSource.findFirstOrThrow({ where: { organizationId: org.id, kind: "CONVERSATION_UPLOAD" } });
    await prisma.knowledgeSource.update({ where: { id: source.id }, data: { rootPath: directory } });
    assert.equal((await probeKnowledgeDrift({ ...source, rootPath: directory })).changed, false);
    const auto = await syncDriftedKnowledgeSources({ organizationId: org.id });
    assert.equal(auto.scanned, 0);
    assert.equal(auto.acted, 0);
    await assert.rejects(syncKnowledgeSource(session, source.id), /不能执行目录/);
    assert.equal(await prisma.knowledgeDocument.count({ where: { sourceId: source.id, deletedAt: null } }), 1);
    assert.equal(await prisma.knowledgeSyncRun.count({ where: { sourceId: source.id } }), 0);
    assert.equal(await prisma.knowledgeChunk.count({ where: { document: { sourceId: source.id, deletedAt: null }, content: { contains: "UNIQUE_INDEX_MARKER" } } }), 1);
    const vault = await prisma.knowledgeSource.create({ data: { organizationId: org.id, kind: "LOCAL_DIR", name: "Directory fixture", rootPath: directory } });
    const markdown = path.join(directory, "fixture.md");
    fs.writeFileSync(markdown, "# Original\nDirectory content");
    assert.equal((await syncKnowledgeSource(session, vault.id)).created, 1);
    fs.writeFileSync(markdown, "# Updated\nChanged content");
    assert.equal((await syncKnowledgeSource(session, vault.id)).updated, 1);
    fs.unlinkSync(markdown);
    assert.equal((await syncKnowledgeSource(session, vault.id)).deleted, 1);
    console.log("AB1: attachment indexes survive automatic/manual sync; directory incremental sync remains intact");

    // Message IDs deliberately disagree with worker ordering at an equal timestamp.
    const aId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const bId = "00000000-0000-4000-8000-000000000001";
    const timestamp = new Date("2026-01-01T00:00:00Z");
    const aRunId = "10000000-0000-4000-8000-000000000000";
    const bRunId = "20000000-0000-4000-8000-000000000000";
    for (const [messageId, runId, marker] of [[aId, aRunId, "EARLIER_MATERIAL"], [bId, bRunId, "FUTURE_MATERIAL"]]) {
      await prisma.agentRun.create({ data: { id: runId, organizationId: org.id, userId: user.id, conversationId: chat.id, goal: marker, inputMessageId: messageId, clientMessageId: randomUUID(), createdAt: timestamp } });
      await prisma.message.create({ data: { id: messageId, conversationId: chat.id, runId, role: "USER", content: marker, createdAt: timestamp } });
      await upload(chat.id, `${marker}.txt`, marker, { messageId, createdAt: new Date("2025-01-01T00:00:00Z") });
    }
    const legacy = await prisma.message.create({ data: { conversationId: chat.id, role: "USER", content: "Legacy", createdAt: new Date("2025-01-01T00:00:00Z") } });
    await upload(chat.id, "legacy.txt", "LEGACY_MATERIAL", { messageId: legacy.id });
    await upload(otherChat.id, "other.txt", "OTHER_CHAT_SECRET", { messageId: aId });
    await upload(chat.id, "other-org.txt", "OTHER_ORG_SECRET", { messageId: aId, organizationId: foreignOrg.id });
    const aPrompt = await buildAttachmentPrompt(chat.id, org.id, aId);
    assert.ok(aPrompt.prompt.includes("EARLIER_MATERIAL"));
    assert.ok(aPrompt.prompt.includes("LEGACY_MATERIAL"));
    assert.ok(!aPrompt.prompt.includes("FUTURE_MATERIAL"), "message UUID ordering must not admit a future worker run");
    assert.ok(!aPrompt.prompt.includes("OTHER_CHAT_SECRET"));
    assert.ok(!aPrompt.prompt.includes("OTHER_ORG_SECRET"));
    const bPrompt = await buildAttachmentPrompt(chat.id, org.id, bId);
    assert.ok(bPrompt.prompt.includes("EARLIER_MATERIAL"), "later worker run must retain prior equal-timestamp material");
    assert.ok(bPrompt.prompt.includes("FUTURE_MATERIAL"));
    assert.equal((await buildAttachmentPrompt(chat.id, foreignOrg.id, bId)).prompt, "");
    console.log("AB2: attachment history follows worker run order, including equal timestamps, and tenant/chat boundaries hold");

    const budgetChat = await prisma.conversation.create({ data: { organizationId: org.id, ownerId: user.id, title: "Budget" } });
    const message = await prisma.message.create({ data: { conversationId: budgetChat.id, role: "USER", content: "Budget" } });
    for (let i = 0; i < 8; i++) await upload(budgetChat.id, `budget-${i}.txt`, String.fromCharCode(65 + i).repeat(80_000), { messageId: message.id });
    const budget = await buildAttachmentPrompt(budgetChat.id, org.id, message.id);
    assert.equal(budget.counts.readable, 8);
    assert.ok(budget.prompt.length <= ATTACHMENT_PROMPT_MAX_CHARS);
    assert.equal((budget.prompt.match(/[A-H]{100,}/g) ?? []).reduce((sum, text) => sum + text.length, 0), 60_000);
    for (let i = 0; i < 8; i++) assert.ok(budget.prompt.includes(String.fromCharCode(65 + i).repeat(100)), `material ${i} retains text`);
    assert.match(budget.prompt, /不得当作全文/);
    await prisma.conversationAttachment.deleteMany({ where: { conversationId: budgetChat.id } });
    await upload(budgetChat.id, "short.txt", "Z".repeat(100), { messageId: message.id });
    await upload(budgetChat.id, "long.txt", "Y".repeat(80_000), { messageId: message.id });
    await upload(budgetChat.id, "unreadable.mp4", "", { messageId: message.id, extractedText: null, parseStatus: "UNSUPPORTED", parseNote: "画面内容未读取" });
    const mixed = await buildAttachmentPrompt(budgetChat.id, org.id, message.id);
    assert.ok(mixed.prompt.includes("Z".repeat(100)));
    assert.equal((mixed.prompt.match(/Y{100,}/g) ?? []).reduce((sum, text) => sum + text.length, 0), 59_900);
    assert.match(mixed.prompt, /画面内容未读取/);
    assert.equal(mixed.counts.unsupported, 1);
    await prisma.conversationAttachment.deleteMany({ where: { conversationId: budgetChat.id } });
    await upload(budgetChat.id, "single.txt", "X".repeat(80_000), { messageId: message.id });
    const single = await buildAttachmentPrompt(budgetChat.id, org.id, message.id);
    assert.equal((single.prompt.match(/X{100,}/g) ?? []).reduce((sum, text) => sum + text.length, 0), 60_000);
    await prisma.conversationAttachment.updateMany({ where: { conversationId: budgetChat.id }, data: { originalFilename: "N".repeat(100_000), parseNote: "P".repeat(100_000), extractedMeta: { durationSec: "D".repeat(100_000) } } });
    assert.ok((await buildAttachmentPrompt(budgetChat.id, org.id, message.id)).prompt.length <= ATTACHMENT_PROMPT_MAX_CHARS);
    console.log(`AB3: eight-file/shared, short/long, unreadable, single-file and metadata budgets hold (eight-file prompt=${budget.prompt.length})`);

    const pending = await upload(chat.id, "pending.txt", "Pending");
    const crossChat = await upload(otherChat.id, "cross.txt", "Cross chat");
    const crossOrg = await upload(chat.id, "cross-org.txt", "Cross org", { organizationId: foreignOrg.id });
    const beforeMessages = await prisma.message.count({ where: { conversationId: chat.id } });
    const beforeRuns = await prisma.agentRun.count({ where: { conversationId: chat.id } });
    for (const ids of [[randomUUID()], [crossChat.id], [crossOrg.id], [indexed.id, randomUUID()], [pending.id, randomUUID()]]) {
      await assert.rejects(acceptKernMessage(session, chat.id, { content: "Must roll back", clientMessageId: randomUUID(), attachmentIds: ids }), /附件/);
      assert.equal(await prisma.message.count({ where: { conversationId: chat.id } }), beforeMessages);
      assert.equal(await prisma.agentRun.count({ where: { conversationId: chat.id } }), beforeRuns);
      assert.equal((await prisma.conversationAttachment.findUniqueOrThrow({ where: { id: pending.id } })).messageId, null);
      assert.equal((await prisma.conversationAttachment.findUniqueOrThrow({ where: { id: indexed.id } })).messageId, null);
    }
    // A soft-deleted, unchanged document must be restored rather than skipped by hash.
    await prisma.knowledgeDocument.updateMany({ where: { sourceId: source.id }, data: { deletedAt: new Date() } });
    await prisma.conversationAttachment.update({ where: { id: indexed.id }, data: { indexedAt: null } });
    await Promise.all([indexAttachmentForSearch(indexed.id), indexAttachmentForSearch(indexed.id)]);
    assert.equal(await prisma.knowledgeDocument.count({ where: { sourceId: source.id, deletedAt: null } }), 1);
    assert.equal(await prisma.knowledgeChunk.count({ where: { document: { sourceId: source.id } } }), 1);
    assert.ok((await prisma.conversationAttachment.findUniqueOrThrow({ where: { id: indexed.id } })).indexedAt);
    console.log("AB5: unchanged soft-deleted index restoration and concurrent retry are atomic and idempotent");
    const clientMessageId = randomUUID();
    const input = { content: "Bind valid", clientMessageId, attachmentIds: [pending.id, pending.id] };
    const accepted = await acceptKernMessage(session, chat.id, input);
    assert.equal(accepted.replayed, false);
    const replay = await acceptKernMessage(session, chat.id, { ...input, attachmentIds: [pending.id] });
    assert.equal(replay.runId, accepted.runId);
    assert.equal(replay.replayed, true);
    await assert.rejects(acceptKernMessage(session, chat.id, { content: input.content, clientMessageId, attachmentIds: [] }), /另一|附件/);
    await assert.rejects(acceptKernMessage(session, chat.id, { ...input, attachmentIds: [indexed.id] }), /另一|附件/);
    await assert.rejects(acceptKernMessage(session, chat.id, { ...input, clientMessageId: randomUUID() }), /附件/);
    assert.equal(await prisma.message.count({ where: { conversationId: chat.id } }), beforeMessages + 1);
    assert.equal(await prisma.agentRun.count({ where: { conversationId: chat.id } }), beforeRuns + 1);
    console.log("AB4: invalid/cross-chat/cross-tenant/used attachments roll back atomically; deduped replays remain idempotent");
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.organization.delete({ where: { id: foreignOrg.id } });
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
