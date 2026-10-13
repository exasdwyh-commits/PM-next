/**
 * C7 辅助档位统一记账 DB 回归（Kern Supervisor CI 跑，npm run test:kern-aux-metered）。
 *
 * 目标：证明辅助模型位（summary 槽位）经 executePersistedModelGateway 落账——
 * 每次调用都写 ModelRun（含 usage、requestMeta.tier="aux" 标记），
 * 但不计入成本闸配额（KERN_LIMIT_MODEL_CALLS_PER_MONTH）；普通调用的配额语义不变。
 *
 * 场景：
 * - AUX1：调一次 summary 槽位 → 账本 1 行：tier="aux"、usage 非空、状态 SUCCEEDED。
 * - AUX2（配额正反面）：上限设为 2；连续 3 次 aux 调用不触发配额；
 *   再做 2 次普通调用 OK，第 3 次普通调用抛 UsageLimitError（429）。
 *
 * 假 provider：本地 OpenAI 兼容 HTTP 服务，固定返回一段文本 + usage。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { resolveAuxModelSlot, callAuxModel } from "../src/modules/model-gateway/aux-slots";
import { executePersistedModelGateway } from "../src/modules/model-gateway/runtime";
import { UsageLimitError } from "../src/modules/usage";
import type { ModelPolicy, ModelProfile } from "../src/modules/model-gateway/types";

async function main() {
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID();
  const org = await prisma.organization.create({ data: { name: "Aux metered", code: `AUXM_${tag}` } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, email: `auxm-${tag}@hermes.test`, name: "AUXM owner" },
  });
  void user;

  const requests: Array<{ model: string }> = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", () => {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      requests.push({ model: parsed.model as string });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        model: "aux-fixture-model",
        choices: [{ message: { role: "assistant", content: "这是假摘要：主题A已结论，数字42保留。" } }],
        usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const envBackup: Record<string, string | undefined> = {};
  const setEnv = (k: string, v: string) => { envBackup[k] = process.env[k]; process.env[k] = v; };
  setEnv("KERN_AUX_SUMMARY_MODEL_ID", "aux-fixture-model");
  setEnv("KERN_AUX_SUMMARY_BASE_URL", baseUrl);
  // 配额上限 2：下面 AUX2 用它验证正反两面。
  setEnv("KERN_LIMIT_MODEL_CALLS_PER_MONTH", "2");

  const slot = resolveAuxModelSlot("summary");
  assert.ok(slot, "summary 槽位应被解析出来");
  assert.equal(slot.baseUrl, baseUrl);

  try {
    // ── AUX1：一次 summary 调用 → 账本 1 行，tier="aux"，usage 非空 ──
    const text = await callAuxModel(slot, {
      system: "你是摘要器。",
      user: "把这段话压缩。",
      organizationId: org.id,
    });
    assert.match(text, /假摘要/);
    assert.equal(requests.length, 1, "假 provider 应收到 1 次请求");

    const rows = await prisma.modelRun.findMany({
      where: { organizationId: org.id },
      orderBy: { createdAt: "asc" },
    });
    assert.equal(rows.length, 1, "账本应有 1 行");
    const row = rows[0]!;
    assert.equal(row.status, "SUCCEEDED");
    assert.equal(row.policyKey, "aux-summary");
    const meta = row.requestMeta as Record<string, unknown>;
    assert.equal(meta.tier, "aux", "ModelRun 必须打 tier=aux 标记");
    assert.equal(meta.purpose, "summary");
    assert.equal(meta.source, "kern.aux");
    const usage = row.usageJson as unknown as Record<string, unknown> | null;
    assert.ok(usage && typeof usage === "object", "usage 必须落库");
    const totalTokens = (usage as Record<string, unknown>).totalTokens ?? (usage as Record<string, unknown>).total_tokens;
    assert.ok(typeof totalTokens === "number" && totalTokens > 0, "usage tokens 非空");
    console.log("▶ AUX1 落账 OK：1 行，tier=aux，usage 非空");

    // ── AUX2：配额正反面 ──
    // 3 次 aux 调用：上限 2 也不触发配额（aux 豁免）。
    for (let i = 0; i < 3; i++) {
      await callAuxModel(slot, { system: "s", user: `第${i}段`, organizationId: org.id });
    }
    const auxRows = await prisma.modelRun.count({ where: { organizationId: org.id } });
    assert.equal(auxRows, 4, "共 4 次 aux 调用，账本 4 行");
    console.log("▶ AUX2 正面 OK：3 次 aux 调用未触发配额（上限 2）");

    // 普通调用：2 次 OK，第 3 次抛 UsageLimitError。
    const normalProfile: ModelProfile = {
      id: "aux-metered-test-normal",
      provider: "openai-compatible",
      modelId: "normal-fixture-model",
      displayName: "test/normal",
      capabilities: ["TEXT"],
      locality: "CLOUD",
      health: "HEALTHY",
      enabled: true,
      qualityTier: "FAST",
      latencyTier: "FAST",
      costTier: "LOW",
    };
    const normalPolicy: ModelPolicy = {
      id: "aux-metered-test-normal-policy",
      version: "1",
      taskClass: "ASSISTANT_DIALOGUE",
      candidates: [{ profileId: normalProfile.id, priority: 1 }],
      requiredCapabilities: ["TEXT"],
      cloudAllowed: true,
    };
    const normalCall = () => executePersistedModelGateway({
      organizationId: org.id,
      policy: normalPolicy,
      profiles: [normalProfile],
      providerRuntime: {
        provider: "openai-compatible",
        baseUrl,
        apiKey: null,
        timeoutMs: 15_000,
        maxTokens: 64,
        temperature: 0,
        source: "MODEL_PROVIDER_ENV",
      },
      request: { taskClass: "ASSISTANT_DIALOGUE", messages: [{ role: "user", content: "hi" }] },
      requestMeta: { source: "kern.aux-metered-test" },
    });
    await normalCall();
    await normalCall();
    await assert.rejects(normalCall(), (e: unknown) => {
      assert.ok(e instanceof UsageLimitError, `应抛 UsageLimitError，实际 ${String(e)}`);
      assert.equal((e as UsageLimitError).usage.limit, 2);
      return true;
    });
    console.log("▶ AUX2 反面 OK：普通调用 2 次放行、第 3 次被配额拦下（429）");

    // 普通行的 requestMeta 不应被打上 tier 标记。
    const normalRows = await prisma.modelRun.findMany({
      where: { organizationId: org.id, policyKey: "aux-metered-test-normal-policy" },
    });
    assert.equal(normalRows.length, 2);
    for (const r of normalRows) {
      const m = r.requestMeta as Record<string, unknown>;
      assert.ok(!m || m.tier !== "aux", "普通调用行不得带 tier=aux 标记");
    }
    console.log("▶ 标记隔离 OK：普通行无 aux 标记");
  } finally {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    server.close();
  }
  console.log("ALL AUX-METERED DB CHECKS PASSED");
}

main().catch((e) => { console.error(e); process.exit(1); });
