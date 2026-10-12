/**
 * C2 对话工具循环 DB 回归（Kern Supervisor CI 跑，npm run test:kern-conversation-loop）。
 *
 * 目标：证明对话侧每次模型调用都真实经过 executePersistedModelGateway——
 * 不换测试缝、不绕网关，本地起一个 OpenAI 兼容的假 provider，
 * 断言 ModelRun 账本里每个模型调用都有持久化记录（agentRunId 关联正确、
 * requestMeta 标注 kern.conversation、状态全部落盘为 SUCCEEDED）。
 *
 * 场景：
 * - DB1：先查知识 → 再算数 → 作答（3 次模型调用 → 账本 3 行）
 * - DB2：先抓网页 → 作答（web_fetch 工具提供方注入；2 次模型调用 → 账本 2 行）
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { runConversationToolLoop } from "../src/modules/assistant-runtime/conversation-tool-loop";
import type { ModelPolicy, ModelProfile } from "../src/modules/model-gateway/types";

async function main() {
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID();
  const org = await prisma.organization.create({ data: { name: "Convo tool loop", code: `CTL_${tag}` } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, email: `ctl-${tag}@hermes.test`, name: "CTL owner" },
  });
  const run = await prisma.agentRun.create({
    data: { organizationId: org.id, userId: user.id, goal: "CTL", status: "RUNNING" },
  });
  const session = { organizationId: org.id, userId: user.id, userEmail: user.email, userName: user.name };

  // 本地假 provider：按请求计数 + 请求体脚本化返回（与 regression-model-cancellation 同模式）。
  const requests: { model: string; tools?: unknown[] }[] = [];
  let script: Array<(body: Record<string, unknown>) => Record<string, unknown>> = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", () => {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      const messages = parsed.messages as Array<{ role: string; content?: string }>;
      requests.push({ model: parsed.model as string, tools: parsed.tools as unknown[] | undefined });
      const handler = script[Math.min(requests.length - 1, script.length - 1)];
      assert.ok(handler, `unexpected model request #${requests.length}`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(handler(parsed)));
      void messages;
    });
  });
  const envKey = "MODEL_PROVIDER_CONV_LOOP_FIXTURE_BASE_URL";
  const oldBase = process.env[envKey];
  const msg = (content: string, extra: Record<string, unknown> = {}) => ({
    model: "conv-loop-fixture-model",
    choices: [{ message: { role: "assistant", content, ...extra } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });
  const toolCall = (id: string, name: string, args: unknown) =>
    msg("", { tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });

  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    process.env[envKey] = `http://127.0.0.1:${address.port}`;

    const profiles: ModelProfile[] = [
      {
        id: `${tag}-p`, provider: "conv-loop-fixture", modelId: "conv-loop-fixture-model",
        displayName: "conv-loop-fixture", enabled: true,
        capabilities: ["TEXT", "TOOLS"], locality: "LOCAL", health: "HEALTHY",
        qualityTier: "FAST", latencyTier: "FAST", costTier: "FREE",
      },
    ];
    const policy: ModelPolicy = {
      id: tag, version: "1", taskClass: "QUICK_RESEARCH",
      candidates: [{ profileId: profiles[0].id, priority: 0 }],
      requiredCapabilities: ["TEXT"], cloudAllowed: false,
      failurePolicy: { failureThreshold: 1, cooldownMs: 60_000 },
    };
    const base = {
      session,
      agentRunId: run.id,
      policy,
      profiles,
      taskClass: "QUICK_RESEARCH" as const,
      metadata: { conversationId: "conv-db1", intent: "KNOWLEDGE_SEARCH" },
    };

    console.log("▶ DB1 先查知识 → 再算数 → 作答（原生协议，账本 3 行）");
    script = [
      (body) => {
        // 第一次请求必须带原生 tools（含 knowledge_search/calculate，不含 ask_user）
        const toolNames = ((body.tools ?? []) as Array<{ function: { name: string } }>).map((t) => t.function.name).sort();
        // 测试环境未配网页检索/爬取提供方：只有 knowledge_search / calculate / web_fetch / desktop_status
        assert.deepEqual(toolNames, ["calculate", "desktop_status", "knowledge_search", "web_fetch"].sort());
        assert.ok(!toolNames.includes("ask_user"));
        return toolCall("db1-1", "knowledge_search", { query: "竞品价格" });
      },
      () => toolCall("db1-2", "calculate", { expression: "(299-99)/299*100" }),
      () => msg("结论：竞品 299 元，自研成本 99 元，毛利率约 66.89%（来源：知识库 + 计算）"),
    ];
    const out1 = await runConversationToolLoop({
      ...base,
      messages: [
        { role: "system", content: "你是 Kern。" },
        { role: "user", content: "这款产品定价多少合理？" },
      ],
      toolContextOverrides: {
        searchKnowledge: async () => [{ title: "竞品表", snippet: "竞品 299 元", ref: `db1-${tag}` }],
      },
    });
    assert.equal(out1.incomplete, undefined);
    assert.match(out1.text, /66\.89/);
    assert.deepEqual(out1.toolCalls.map((c) => c.tool), ["knowledge_search", "calculate"]);
    assert.equal(out1.modelCalls, 3);
    assert.equal(requests.length, 3);
    const ledger1 = await prisma.modelRun.findMany({ where: { organizationId: org.id, agentRunId: run.id }, orderBy: { createdAt: "asc" } });
    assert.equal(ledger1.length, 3, "3 次模型调用必须全部在账本里（持久化网关记账证据）");
    assert.ok(ledger1.every((r) => r.status === "SUCCEEDED"));
    assert.ok(ledger1.every((r) => (r.requestMeta as Record<string, unknown>)?.source === "kern.conversation"));
    assert.ok(ledger1.every((r) => (r.requestMeta as Record<string, unknown>)?.intent === "KNOWLEDGE_SEARCH"));

    console.log("▶ DB2 先抓网页 → 作答（web_fetch 注入，账本累计 5 行）");
    // requests 是跨场景的累计计数器：DB1 已消费 3 次；DB2 重新脚本化必须从 0 开始，
    // 否则 handler 索引直接命中最后一条脚本，第一次模型调用就拿到终答文本、工具一次没调。
    requests.length = 0;
    script = [
      () => toolCall("db2-1", "web_fetch", { url: "https://example.com/pricing" }),
      () => msg("结论：官网售价 129 元（来源：网页）"),
    ];
    const out2 = await runConversationToolLoop({
      ...base,
      metadata: { conversationId: "conv-db2", intent: "QUICK_RESEARCH" },
      messages: [
        { role: "system", content: "你是 Kern。" },
        { role: "user", content: "官网现在卖多少钱？" },
      ],
      toolContextOverrides: {
        webFetch: async (url) => {
          assert.equal(url, "https://example.com/pricing");
          return { url, title: "价格页", text: "售价 129 元", truncated: false };
        },
      },
    });
    assert.equal(out2.incomplete, undefined);
    assert.match(out2.text, /129 元/);
    assert.deepEqual(out2.toolCalls.map((c) => c.tool), ["web_fetch"]);
    assert.deepEqual(out2.citations.map((c) => c.ref), ["https://example.com/pricing"]);
    const ledger2 = await prisma.modelRun.count({ where: { organizationId: org.id, agentRunId: run.id } });
    assert.equal(ledger2, 5, "DB1 的 3 次 + DB2 的 2 次，全部持久化记账");

    console.log("PASS: conversation tool loop billed through persisted gateway ledger (3 + 2 model calls)");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (oldBase === undefined) delete process.env[envKey];
    else process.env[envKey] = oldBase;
    await prisma.modelRun.deleteMany({ where: { organizationId: org.id } });
    await prisma.agentRun.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
