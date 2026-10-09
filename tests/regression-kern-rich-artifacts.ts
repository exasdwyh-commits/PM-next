/**
 * Kern V2 /muse rich reply + HTML artifact closure — through the REAL engine path:
 *   acceptKernMessage → executeAcceptedKernMessage (worker entry) → sendDepartmentAssistantMessage
 *   → executeKernConversationTurn → model gateway (fixture HTTP provider) → formatModelReply
 *   → persistReplyArtifacts (same transaction as the Message) → buildKernViewModel (read-model for /muse).
 *
 * The "model" is a local OpenAI-compatible server answering with the FIXED SAMPLES in
 * scripts/fixtures/kern-rich-samples.cjs — this proves the engineering chain, not model quality.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { createKernConversation } from "../src/modules/assistant-runtime/conversations";
import { acceptKernMessage } from "../src/modules/assistant-runtime/message-intake";
import { executeAcceptedKernMessage } from "../src/modules/assistant-runtime/message-worker";
import { DEFAULT_KERN_CONVERSATION_RUNTIME_CONFIG } from "../src/modules/assistant-runtime/conversation-config";
import { buildKernViewModel } from "../src/modules/muse/read-model";
import { getArtifactSummary, getArtifactVersion } from "../src/modules/artifacts/service";
import { artifactCitations, buildStandaloneDocument, PERSISTED_MARKER_RE } from "../src/modules/artifacts/protocol";
import { splitRichText } from "../src/modules/artifacts/rich-blocks";

const require = createRequire(import.meta.url);
const samples = require("../scripts/fixtures/kern-rich-samples.cjs") as {
  PROMPTS: Record<string, string>;
  pick: (text: string) => string | null;
  reply: (kind: string) => string | null;
};

type ChatRequest = { model: string; messages: { role: string; content: string }[] };

function lastUser(messages: ChatRequest["messages"]): string {
  const users = messages.filter((m) => m.role === "user");
  const content = users[users.length - 1]?.content ?? "";
  const m = /本轮用户消息：([\s\S]*)$/.exec(content);
  return m ? m[1] : content;
}

async function main() {
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID();
  const org = await prisma.organization.create({ data: { code: `RICH_${tag}`, name: "Rich artifacts" } });
  const otherOrg = await prisma.organization.create({ data: { code: `RICH2_${tag}`, name: "Other tenant" } });
  const user = await prisma.user.create({ data: { organizationId: org.id, name: "Owner", email: `${tag}@kern.test`, orgMemberships: { create: { organizationId: org.id, role: "ORG_ADMIN" } } } });
  const peer = await prisma.user.create({ data: { organizationId: org.id, name: "Peer", email: `peer-${tag}@kern.test`, orgMemberships: { create: { organizationId: org.id, role: "ORG_ADMIN" } } } });
  const stranger = await prisma.user.create({ data: { organizationId: otherOrg.id, name: "Stranger", email: `x-${tag}@kern.test`, orgMemberships: { create: { organizationId: otherOrg.id, role: "ORG_ADMIN" } } } });
  const session = { organizationId: org.id, userId: user.id, userName: user.name, userEmail: user.email };
  const peerSession = { organizationId: org.id, userId: peer.id, userName: peer.name, userEmail: peer.email };
  const strangerSession = { organizationId: otherOrg.id, userId: stranger.id, userName: stranger.name, userEmail: stranger.email };

  const requests: ChatRequest[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => { raw += d; });
    req.on("end", () => {
      const body = JSON.parse(raw) as ChatRequest;
      requests.push(body);
      const kind = samples.pick(lastUser(body.messages));
      const content = (kind && samples.reply(kind)) || "（固定样例服务）没有对应样例。";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
    });
  });
  const envKey = "MODEL_PROVIDER_RICH_FIXTURE_BASE_URL";
  const oldBase = process.env[envKey];
  const oldLegacy = process.env.ADVISOR_LLM_ENABLED;
  process.env.ADVISOR_LLM_ENABLED = "false";
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    process.env[envKey] = `http://127.0.0.1:${address.port}`;
    await prisma.modelProfileConfig.create({ data: { organizationId: org.id, key: "rich-fixture", displayName: "Fixed samples", provider: "rich-fixture", modelId: "rich-fixture-model", capabilities: ["TEXT"], locality: "LOCAL", enabled: true, qualityTier: "FAST", latencyTier: "FAST", costTier: "FREE" } });
    const config = { ...DEFAULT_KERN_CONVERSATION_RUNTIME_CONFIG, modelProfileKey: "rich-fixture" };

    const turn = async (conversationId: string, text: string) => {
      const accepted = await acceptKernMessage(session, conversationId, { content: text, clientMessageId: randomUUID() });
      assert.equal(await executeAcceptedKernMessage(accepted.runId), true, `worker executes: ${text.slice(0, 20)}`);
      const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: accepted.runId } });
      assert.equal(run.status, "SUCCEEDED");
      const message = await prisma.message.findUniqueOrThrow({ where: { id: run.outputMessageId! } });
      return { accepted, run, message };
    };
    const view = async (conversationId: string) => (await buildKernViewModel(session, { conversationId })).messages;

    // ── 1. Simple Q&A stays clean prose ─────────────────────────────────────────────
    const chat = await createKernConversation(session, { clientConversationId: randomUUID(), title: "V2 rich closure", runtimeConfig: config });
    const short = await turn(chat.id, samples.PROMPTS.short);
    assert.equal(artifactCitations((short.message.citations as unknown[]) ?? []).length, 0, "short answer has no artifact");
    assert.ok(!/```kern-ui|kern-artifact/.test(short.message.content), "short answer has no rich blocks");
    assert.equal(await prisma.kernArtifact.count({ where: { conversationId: chat.id } }), 0);
    {
      const block = (await view(chat.id)).find((m) => m.id === short.message.id)!.blocks[0];
      assert.equal(block.kind, "text");
      assert.ok(block.kind === "text" && !block.artifacts, "plain text block, no artifact list");
      assert.ok(block.kind === "text" && splitRichText(block.text).every((s) => s.t === "md"), "renders as plain Prose");
    }
    console.log("RA1: simple question → plain prose, no blocks, no artifact; read-model text block");

    // ── 2. Product plan comparison → rich blocks + plan-compare v1 ───────────────────
    const first = await turn(chat.id, samples.PROMPTS.productCompare);
    const c1 = artifactCitations(first.message.citations as unknown[]);
    assert.equal(c1.length, 1);
    assert.equal(c1[0].key, "plan-compare");
    assert.equal(c1[0].version, 1);
    assert.equal(c1[0].status, "READY");
    const artifactId = c1[0].ref;
    assert.ok(first.message.content.split("\n").some((line) => PERSISTED_MARKER_RE.test(line)), "persisted marker line in content");
    assert.ok(!/<kern-artifact|<html/i.test(first.message.content), "HTML never stored in Message.content");
    const kinds1 = splitRichText(first.message.content).map((s) => (s.t === "block" ? s.block.type : s.t));
    assert.ok(kinds1.includes("compare") && kinds1.includes("artifact") && kinds1.includes("unknown"), `rich segments: ${kinds1.join(",")}`);
    const art1 = await prisma.kernArtifact.findUniqueOrThrow({ where: { id: artifactId } });
    assert.equal(art1.currentVersion, 1);
    assert.equal(art1.organizationId, org.id);
    assert.equal(art1.ownerId, user.id);
    const v1row = await prisma.kernArtifactVersion.findUniqueOrThrow({ where: { artifactId_version: { artifactId, version: 1 } } });
    assert.equal(v1row.messageId, first.message.id);
    assert.equal(v1row.runId, first.run.id);
    assert.match(v1row.contentHash, /^[0-9a-f]{64}$/);
    console.log("RA2: comparison → compare/unknown blocks + plan-compare v1 (READY, message/run/hash linked, HTML outside Message)");

    // ── 3. Follow-up edit → same artifact v2; model saw the current artifact ─────────
    const editReqIndex = requests.length;
    const second = await turn(chat.id, samples.PROMPTS.productCompareEdit);
    const sys = requests.slice(editReqIndex).map((r) => r.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n")).join("\n");
    assert.match(sys, /kern-rich\/v1/, "single formal output contract injected");
    assert.match(sys, /key=plan-compare · 标题「产品方案对比」 · 当前 v1/, "model told the current artifact key/version");
    assert.ok(sys.includes("方案 B · 大客户私有化部署"), "model received the current v1 HTML");
    const history = requests.slice(editReqIndex).flatMap((r) => r.messages.filter((m) => m.role !== "system").map((m) => m.content)).join("\n");
    assert.ok(!/\[\[kern-artifact:/.test(history), "raw markers never leak into model history");
    assert.ok(/〔可视化成果「产品方案对比」key=plan-compare v1〕/.test(history), "history carries readable artifact placeholder");
    const c2 = artifactCitations(second.message.citations as unknown[]);
    assert.equal(c2.length, 1);
    assert.equal(c2[0].ref, artifactId, "same artifact, not a new one");
    assert.equal(c2[0].version, 2);
    assert.equal(await prisma.kernArtifact.count({ where: { conversationId: chat.id } }), 1, "no unrelated artifact created");
    assert.equal((await prisma.kernArtifact.findUniqueOrThrow({ where: { id: artifactId } })).currentVersion, 2);
    const v1 = await getArtifactVersion(session, artifactId, 1);
    const v2 = await getArtifactVersion(session, artifactId, 2);
    assert.ok(v1.html.includes("方案 B · 大客户私有化部署") && !v1.html.includes("方案 C"), "v1 still reviewable and unchanged");
    assert.ok(v2.html.includes("方案 C · 渠道代理分销") && v2.html.includes("风险（已突出）"), "v2 replaced option 2 and highlights risks");
    assert.notEqual(v1.contentHash, v2.contentHash);
    console.log("RA3: '突出风险，把第二个方案换掉' → plan-compare v2 (same id); v1 kept; model got key + current HTML");

    // ── 4. Truncated HTML → FAILED v3, prose kept, READY v2 untouched ───────────────
    const failed = await turn(chat.id, "[mock:artifact-fail:plan-compare] 再出一版");
    const c3 = artifactCitations(failed.message.citations as unknown[]);
    assert.equal(c3[0].ref, artifactId);
    assert.equal(c3[0].version, 3);
    assert.equal(c3[0].status, "FAILED");
    assert.match(c3[0].error ?? "", /没有完整返回/);
    assert.ok(failed.message.content.includes("已把第二个方案换成"), "prose before the broken tag is kept");
    const afterFail = await getArtifactSummary(session, artifactId);
    assert.equal(afterFail.currentVersion, 2, "FAILED never becomes current");
    assert.equal(afterFail.title, "产品方案对比");
    assert.equal((await getArtifactVersion(session, artifactId, 2)).status, "READY");
    console.log("RA4: truncated artifact → v3 FAILED with prose kept; current stays READY v2");

    // ── 5. Retry → READY v4; replaying the same request creates nothing ─────────────
    const retryText = `请重新生成可视化成果「产品方案对比」（key=plan-compare），输出完整 HTML。`;
    const retryClientId = randomUUID();
    const retry = await acceptKernMessage(session, chat.id, { content: retryText, clientMessageId: retryClientId });
    assert.equal(await executeAcceptedKernMessage(retry.runId), true);
    const replay = await acceptKernMessage(session, chat.id, { content: retryText, clientMessageId: retryClientId });
    assert.equal(replay.runId, retry.runId, "double click / refresh replays the same run");
    assert.equal(await executeAcceptedKernMessage(retry.runId), false, "a finished run is not executed again");
    const summary = await getArtifactSummary(session, artifactId);
    assert.deepEqual(summary.versions.map((v) => `${v.version}:${v.status}`), ["1:READY", "2:READY", "3:FAILED", "4:READY"]);
    assert.equal(summary.currentVersion, 4);
    console.log("RA5: retry → v4 READY; replayed request reuses the run, no duplicate version");

    // ── 6. Refresh / reopen: read-model restores rich blocks + artifact refs ─────────
    const restored = await view(chat.id);
    const byId = new Map(restored.map((m) => [m.id, m]));
    const r1 = byId.get(first.message.id)!.blocks[0];
    const r3 = byId.get(failed.message.id)!.blocks[0];
    assert.ok(r1.kind === "text" && r1.artifacts?.[0]?.version === 1 && r1.artifacts[0].ref === artifactId);
    assert.ok(r3.kind === "text" && r3.artifacts?.[0]?.status === "FAILED");
    assert.ok(!byId.get(first.message.id)!.blocks.some((b) => b.kind === "evidence"), "artifact citations are not shown as evidence");
    // This prompt is multi-expert (PAIR) → base mission planner also proposes a brief. The brief is
    // offered NEXT TO the rich answer; it must not replace it (V2 regression fixed in service.ts).
    const firstKinds = byId.get(first.message.id)!.blocks.map((b) => b.kind);
    assert.deepEqual(firstKinds.slice(0, 2), ["text", "brief"], `rich answer + brief offer: ${firstKinds.join(",")}`);
    assert.ok(r1.kind === "text" && r1.text.includes("方案 A（自建 SaaS 订阅）更稳妥") && /```kern-ui/.test(r1.text), "rich answer kept");
    const preview = (await buildKernViewModel(session, { conversationId: chat.id })).brief.conversations.find((c) => c.id === chat.id)?.preview ?? "";
    assert.ok(!/\[\[kern-artifact|```/.test(preview), "conversation preview hides markers/fences");
    console.log("RA6: read-model after reload keeps text+artifacts (v1, FAILED v3) — no extra persistence protocol needed");

    // ── 7. Owner-only scope ─────────────────────────────────────────────────────────
    await assert.rejects(getArtifactSummary(peerSession, artifactId), /not found/i, "same org, other user → 404");
    await assert.rejects(getArtifactVersion(peerSession, artifactId, 1), /not found/i);
    await assert.rejects(getArtifactVersion(strangerSession, artifactId, 2), /not found/i, "other org → 404");
    console.log("RA7: artifact reads are owner+organization scoped (others get 404)");

    // ── 8. Offline export is self-contained ─────────────────────────────────────────
    const doc = buildStandaloneDocument(v2.html, { artifactId, title: v2.title, version: 2, createdAt: v2.createdAt });
    assert.match(doc, /Content-Security-Policy/);
    assert.ok(!/(src|href)\s*=\s*["']https?:/i.test(doc), "no external resources");
    assert.ok(doc.includes("<style>") && doc.includes("方案 C · 渠道代理分销"), "styles and data inline");
    console.log("RA8: offline export inlines styles/data, carries CSP, no external URLs");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (oldBase === undefined) delete process.env[envKey]; else process.env[envKey] = oldBase;
    if (oldLegacy === undefined) delete process.env.ADVISOR_LLM_ENABLED; else process.env.ADVISOR_LLM_ENABLED = oldLegacy;
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: [user.id, peer.id, stranger.id] } } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.organization.delete({ where: { id: otherOrg.id } });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
