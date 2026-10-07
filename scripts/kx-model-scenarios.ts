/**
 * KX-66 L2 / L3 · 模型场景测试（示例场景 + 真实模型）
 * ====================================================
 * 对正在运行的 dev 服务器（默认 http://127.0.0.1:3100）按固定场景发真实请求，
 * 结束后从开发库读取本轮 ModelRun / 任务事件，输出报告：
 *   outputs/kx66/<时间戳>/report.json、report.md（/outputs/ 已被 .gitignore 忽略）
 *
 * 前置：
 *   1. npm run dev:models            # 默认 free：只用免费的 Agnes Flash
 *   2. npm run dev                   # dev 服务器 :3100
 *   3. npm run worker:supervised     # 任务类场景需要 Worker
 *
 * 用法：
 *   npm run test:model-scenarios                                  # 全部场景
 *   npm run test:model-scenarios -- --only=chat,mission           # 指定场景
 *   npm run test:model-scenarios -- --allow-providers=agnes,mimo  # 允许的 provider（默认只允许 agnes）
 *   其他参数：--base=URL  --out=DIR  --mission-timeout-min=20
 *
 * 退出码：0 全部通过；1 有场景失败；2 出现了不在允许清单里的 provider（可能产生了付费调用）。
 * 口令只从 DEV_LOGIN_PASSWORD / SEED_PASSWORD 或本机 .env 读取，不打印、不落盘。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import prisma from "../src/shared/db";

type Json = Record<string, unknown>;
type Check = { name: string; ok: boolean; detail?: string };
type ScenarioResult = {
  id: string;
  title: string;
  ok: boolean;
  skipped?: string;
  durationMs: number;
  checks: Check[];
  facts: Json;
};

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const BASE = arg("base", process.env.KX66_BASE ?? "http://127.0.0.1:3100").replace(/\/+$/, "");
const EMAIL = process.env.KERN_DEMO_EMAIL ?? "zhang_pm@hermes.test";
const ONLY = arg("only", "").split(",").map((s) => s.trim()).filter(Boolean);
const ALLOWED = arg("allow-providers", "agnes").split(",").map((s) => s.trim()).filter(Boolean);
const MISSION_TIMEOUT_MS = Number(arg("mission-timeout-min", "20")) * 60_000;
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT = arg("out", path.join("outputs", "kx66", STAMP));

function password(): string {
  if (process.env.DEV_LOGIN_PASSWORD) return process.env.DEV_LOGIN_PASSWORD;
  if (process.env.SEED_PASSWORD) return process.env.SEED_PASSWORD;
  try {
    const line = fs
      .readFileSync(path.join(process.cwd(), ".env"), "utf8")
      .split(/\r?\n/)
      .find((l) => /^SEED_PASSWORD=/.test(l));
    if (line) return line.slice("SEED_PASSWORD=".length).trim().replace(/^["']|["']$/g, "");
  } catch {
    /* 没有 .env 时走下面的报错 */
  }
  throw new Error("缺少登录口令：请设置 DEV_LOGIN_PASSWORD 或 SEED_PASSWORD");
}

const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ok2xx = (status: number) => status >= 200 && status < 300;
/** conversation-engine 在没用上模型输出时会加这几种抬头；出现即说明这一轮是确定性回落，不算模型场景通过。 */
const FALLBACK_HEADER = /^（(模型调用失败|本轮未接入语言模型|模型策略已配置但暂无启用)/;

let cookie = "";
async function api(method: string, url: string, body?: unknown, timeoutMs = 300_000) {
  const res = await fetch(BASE + url, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res;
}
async function apiJson(method: string, url: string, body?: unknown, timeoutMs?: number) {
  const res = await api(method, url, body, timeoutMs);
  const json = obj(await res.json().catch(() => ({})));
  return { status: res.status, json };
}

async function login() {
  const res = await fetch(BASE + "/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: password() }),
  });
  if (!res.ok) throw new Error(`登录失败：HTTP ${res.status}`);
  cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

async function say(text: string) {
  const conv = await apiJson("POST", "/api/conversations", { title: text.slice(0, 60), productId: null });
  const convId = str(conv.json.id) || str(obj(conv.json.conversation).id);
  if (!convId) throw new Error(`创建会话失败：HTTP ${conv.status}`);
  const t0 = Date.now();
  const m = await apiJson("POST", `/api/conversations/${convId}/messages`, { content: text });
  const msg = obj(m.json.message);
  return {
    convId,
    status: m.status,
    ms: Date.now() - t0,
    content: str(msg.content),
    citations: arr(msg.citations).map((c) => str(obj(c).kind)).filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// 场景
// ---------------------------------------------------------------------------

class SkipError extends Error {}

type Ctx = { missionId?: string };
type Scenario = { id: string; title: string; run: (ctx: Ctx, checks: Check[], facts: Json) => Promise<void> };

const SCENARIOS: Scenario[] = [
  {
    id: "chat",
    title: "普通对话",
    async run(_ctx, checks, facts) {
      const r = await say("用三句话说说你能帮我做什么。");
      Object.assign(facts, { status: r.status, ms: r.ms, chars: r.content.length, preview: r.content.slice(0, 160) });
      checks.push({ name: "HTTP 2xx", ok: ok2xx(r.status), detail: String(r.status) });
      checks.push({ name: "回复非空", ok: r.content.trim().length > 0 });
      checks.push({ name: "回复来自模型（不是确定性回落）", ok: !FALLBACK_HEADER.test(r.content.trim()), detail: r.content.slice(0, 40) });
      checks.push({ name: "没有把工具调用原文当回复", ok: !/<tool_call>|```kern-tool/.test(r.content) });
    },
  },
  {
    id: "chat-knowledge",
    title: "对话中引用知识库",
    async run(_ctx, checks, facts) {
      const r = await say("知识库里有哪些关于原料的资料？挑三条简单说说。");
      Object.assign(facts, { status: r.status, ms: r.ms, citations: r.citations, preview: r.content.slice(0, 160) });
      checks.push({ name: "HTTP 2xx", ok: ok2xx(r.status), detail: String(r.status) });
      checks.push({ name: "回复非空", ok: r.content.trim().length > 0 });
      checks.push({ name: "回复来自模型（不是确定性回落）", ok: !FALLBACK_HEADER.test(r.content.trim()), detail: r.content.slice(0, 40) });
      checks.push({ name: "没有把工具调用原文当回复", ok: !/<tool_call>|```kern-tool/.test(r.content) });
    },
  },
  {
    id: "mission",
    title: "完整任务：简报 → 启动 → 执行 → 结果",
    async run(ctx, checks, facts) {
      // 触发条件见 supervisor/plan.ts decideMissionLaunch：「推出新品」命中 NEW_PRODUCT 剧本。
      const r = await say("请启动一个任务：评估我们推出新品「面向年轻白领的助眠饮品」的可行性，覆盖市场机会、成本测算、合规风险和上市建议。");
      checks.push({ name: "发起消息 HTTP 2xx", ok: ok2xx(r.status), detail: String(r.status) });
      checks.push({ name: "回复来自模型（不是确定性回落）", ok: !FALLBACK_HEADER.test(r.content.trim()), detail: r.content.slice(0, 40) });
      const list = await apiJson("GET", `/api/conversations/${r.convId}/messages`);
      const msgs = arr(list.json.messages ?? list.json.items);
      const briefMsg = [...msgs].reverse().map(obj).find((m) => arr(m.citations).some((c) => str(obj(c).kind) === "kern-brief"));
      checks.push({ name: "生成任务简报", ok: !!briefMsg });
      if (!briefMsg) return;
      const briefUrl = `/api/missions/brief/${str(briefMsg.id)}`;
      const brief = await apiJson("GET", briefUrl);
      const b = obj(brief.json.brief ?? brief.json);
      facts.briefStage = str(b.stage);
      if (b.stage === "CLARIFY") await apiJson("POST", briefUrl, { action: "skip-questions" });
      const launched = await apiJson("POST", briefUrl, { action: "launch" });
      const missionId = str(launched.json.missionTaskId) || str(obj(launched.json.brief).missionTaskId);
      checks.push({ name: "任务已启动", ok: !!missionId, detail: `HTTP ${launched.status}` });
      if (!missionId) return;
      ctx.missionId = missionId;
      facts.missionId = missionId;

      const t0 = Date.now();
      let state: Json = {};
      while (Date.now() - t0 < MISSION_TIMEOUT_MS) {
        const s = await apiJson("GET", `/api/missions/${missionId}`);
        state = obj(s.json.item ?? s.json.mission ?? s.json);
        if (state.outcome) break;
        await sleep(15_000);
      }
      const nodes = arr(state.nodes).map(obj).map((n) => ({ key: str(n.key), status: str(n.status) }));
      const outcome = str(obj(state.outcome).status);
      Object.assign(facts, { status: str(state.status), outcome, minutes: +((Date.now() - t0) / 60_000).toFixed(1), nodes, stateKeys: Object.keys(state) });
      checks.push({ name: `在 ${MISSION_TIMEOUT_MS / 60_000} 分钟内结束`, ok: !!state.outcome });
      checks.push({ name: "结果为完成", ok: /^(COMPLETED|SUCCEEDED|DONE)$/i.test(outcome), detail: outcome || "无" });
      const failed = nodes.filter((n) => /FAILED|BLOCKED/.test(n.status));
      checks.push({ name: "没有失败 / 阻断的节点", ok: failed.length === 0, detail: failed.map((n) => `${n.key}:${n.status}`).join(" ") });

      const events = await prisma.kernMissionEvent.groupBy({ by: ["type"], where: { missionTaskId: missionId }, _count: { _all: true } });
      facts.events = Object.fromEntries(events.map((e) => [e.type, e._count._all]));
      const eventRows = await prisma.kernMissionEvent.findMany({ where: { missionTaskId: missionId }, select: { payload: true } });
      const leaked = eventRows.filter((e) => /<tool_call>|<function=/.test(JSON.stringify(e.payload ?? ""))).length;
      checks.push({ name: "节点结论里没有残留工具调用原文", ok: leaked === 0, detail: leaked ? `${leaked} 条事件含 <tool_call>` : undefined });
    },
  },
  {
    id: "export",
    title: "任务报告导出 Word / Excel / PPT 并核对 SHA-256",
    async run(ctx, checks, facts) {
      if (!ctx.missionId) throw new SkipError("依赖 mission 场景产生的任务");
      for (const format of ["docx", "xlsx", "pptx"]) {
        const res = await api("GET", `/api/missions/${ctx.missionId}/export?format=${format}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const header = res.headers.get("x-kern-sha256") ?? "";
        const actual = crypto.createHash("sha256").update(buf).digest("hex");
        facts[format] = { status: res.status, bytes: buf.length };
        checks.push({ name: `${format} HTTP 200`, ok: res.status === 200, detail: String(res.status) });
        checks.push({ name: `${format} SHA-256 一致`, ok: !!header && header.replace(/^sha256:/, "") === actual });
      }
    },
  },
];


// ---------------------------------------------------------------------------
// 模型调用统计
// ---------------------------------------------------------------------------

function pct(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function modelStats(organizationId: string, since: Date) {
  const runs = await prisma.modelRun.findMany({
    where: { organizationId, createdAt: { gte: since } },
    select: { taskClass: true, provider: true, modelId: true, status: true, attempts: true, durationMs: true, errorReason: true },
  });
  const groups = new Map<string, { taskClass: string; provider: string; modelId: string; ok: number; failed: number; running: number; ms: number[] }>();
  let fallbacks = 0;
  let rateLimited = 0;
  let rateLimitRetries = 0;
  const failures: { taskClass: string; provider: string; reason: string }[] = [];
  const providersSeen = new Set<string>();
  for (const r of runs) {
    const attempts = arr(r.attempts).map(obj);
    for (const a of attempts) if (str(a.provider)) providersSeen.add(str(a.provider));
    for (const a of attempts) {
      if (a.failureKind === "RATE_LIMIT" || /HTTP 429/.test(str(a.error))) rateLimited++;
      if (typeof a.retryDelayMs === "number") rateLimitRetries++;
    }
    if (r.provider) providersSeen.add(r.provider);
    if (new Set(attempts.map((a) => str(a.profileId))).size > 1) fallbacks++;
    const key = [r.taskClass, r.provider ?? "-", r.modelId ?? "-"].join("|");
    const g = groups.get(key) ?? { taskClass: String(r.taskClass), provider: r.provider ?? "-", modelId: r.modelId ?? "-", ok: 0, failed: 0, running: 0, ms: [] };
    if (r.status === "SUCCEEDED") g.ok++;
    else if (r.status === "FAILED") g.failed++;
    else g.running++;
    if (typeof r.durationMs === "number") g.ms.push(r.durationMs);
    groups.set(key, g);
    if (r.status === "FAILED") failures.push({ taskClass: String(r.taskClass), provider: r.provider ?? "-", reason: String(r.errorReason ?? "").slice(0, 200) });
  }
  const staleRunning = await prisma.modelRun.count({
    where: { organizationId, status: "RUNNING", createdAt: { lt: new Date(Date.now() - 60 * 60_000) } },
  });
  return {
    total: runs.length,
    fallbacks,
    rateLimited,
    rateLimitRetries,
    groups: [...groups.values()].map(({ ms, ...g }) => ({ ...g, p50Ms: pct(ms, 50), p95Ms: pct(ms, 95) })),
    failures,
    providersSeen: [...providersSeen],
    disallowedProviders: [...providersSeen].filter((p) => !ALLOWED.includes(p)),
    staleRunning,
  };
}

// ---------------------------------------------------------------------------

function toMarkdown(report: Json): string {
  const results = report.results as ScenarioResult[];
  const stats = report.modelStats as Awaited<ReturnType<typeof modelStats>>;
  const lines = [
    `# KX-66 模型场景测试报告`,
    ``,
    `- 时间：${String(report.startedAt)}　服务：${BASE}　允许的 provider：${ALLOWED.join(", ")}`,
    `- 结论：${report.ok ? "通过" : "未通过"}`,
    ``,
    `## 场景`,
    ``,
    `| 场景 | 结果 | 耗时 | 未通过的检查 |`,
    `|---|---|---|---|`,
    ...results.map((r) => {
      const bad = r.checks.filter((c) => !c.ok).map((c) => (c.detail ? `${c.name}（${c.detail}）` : c.name));
      return `| ${r.id} ${r.title} | ${r.skipped ? "跳过" : r.ok ? "通过" : "失败"} | ${(r.durationMs / 1000).toFixed(0)}s | ${r.skipped ?? (bad.join("；") || "—")} |`;
    }),
    ``,
    `## 模型调用（本轮 ${stats.total} 次，换模型 fallback ${stats.fallbacks} 次，遇到 429 ${stats.rateLimited} 次，其中等待后重试 ${stats.rateLimitRetries} 次）`,
    ``,
    `| 任务类型 | provider | 模型 | 成功 | 失败 | 未结束 | p50 | p95 |`,
    `|---|---|---|---|---|---|---|---|`,
    ...stats.groups.map((g) => `| ${g.taskClass} | ${g.provider} | ${g.modelId} | ${g.ok} | ${g.failed} | ${g.running} | ${g.p50Ms ?? "-"}ms | ${g.p95Ms ?? "-"}ms |`),
    ``,
    `- 出现的 provider：${stats.providersSeen.join(", ") || "无"}；不在允许清单里的：${stats.disallowedProviders.join(", ") || "无"}`,
    `- 超过 1 小时仍为 RUNNING 的历史 ModelRun：${stats.staleRunning}`,
    ...(stats.failures.length ? [``, `## 失败明细`, ``, ...stats.failures.map((f) => `- ${f.taskClass} / ${f.provider}：${f.reason}`)] : []),
    ``,
  ];
  return lines.join("\n");
}

async function main() {
  const db = ((await prisma.$queryRawUnsafe(`select current_database() as d`)) as { d: string }[])[0].d;
  if (!/_dev$/.test(db)) throw new Error(`只允许对开发库运行，当前库：${db}`);
  const user = await prisma.user.findFirstOrThrow({ where: { email: EMAIL }, select: { organizationId: true } });

  const startedAt = new Date();
  await login();
  console.log(`已登录 ${BASE}；允许的 provider：${ALLOWED.join(", ")}`);

  const ctx: Ctx = {};
  const results: ScenarioResult[] = [];
  for (const s of SCENARIOS) {
    if (ONLY.length && !ONLY.includes(s.id)) continue;
    const checks: Check[] = [];
    const facts: Json = {};
    const t0 = Date.now();
    let skipped: string | undefined;
    try {
      await s.run(ctx, checks, facts);
    } catch (e) {
      if (e instanceof SkipError) skipped = e.message;
      else checks.push({ name: "场景未抛异常", ok: false, detail: e instanceof Error ? e.message.slice(0, 300) : String(e) });
    }
    const ok = !skipped && checks.length > 0 && checks.every((c) => c.ok);
    results.push({ id: s.id, title: s.title, ok, skipped, durationMs: Date.now() - t0, checks, facts });
    console.log(`${skipped ? "⏭" : ok ? "✔" : "✖"} ${s.id} ${s.title}${skipped ? `（跳过：${skipped}）` : ""}`);
    for (const c of checks.filter((x) => !x.ok)) console.log(`    ✖ ${c.name}${c.detail ? `：${c.detail}` : ""}`);
  }

  const stats = await modelStats(user.organizationId, startedAt);
  const scenariosOk = results.every((r) => r.ok || r.skipped);
  const report = { startedAt: startedAt.toISOString(), base: BASE, allowedProviders: ALLOWED, ok: scenariosOk && stats.disallowedProviders.length === 0, results, modelStats: stats };

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(path.join(OUT, "report.md"), toMarkdown(report));
  console.log(
    `模型调用 ${stats.total} 次，fallback ${stats.fallbacks} 次，429 ${stats.rateLimited} 次（重试 ${stats.rateLimitRetries} 次），provider：${stats.providersSeen.join(", ") || "无"}`
  );
  console.log(`报告：${path.join(OUT, "report.md")}`);

  if (stats.disallowedProviders.length) {
    console.error(`出现不在允许清单里的 provider：${stats.disallowedProviders.join(", ")}（可能产生了付费调用）`);
    process.exitCode = 2;
  } else if (!scenariosOk) {
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
