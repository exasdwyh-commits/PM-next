/**
 * 窗口 B · 试运行：3 个代表性任务 × 3 次（真实 dev 栈 + 免费 Agnes Flash）
 * =====================================================================
 * 每个任务：第 1 次跑完 → 复核通过 → 保存为做法；第 2、3 次用同一目标再跑（自动套用做法）→ 复核通过。
 * 记录 KX-73 的 5 个指标与 KX-73 闸门（连续 3 次验收 → 可转定时）。
 *
 * 前置（同 kx-model-scenarios.ts）：npm run dev:models · npm run dev · npm run worker:supervised
 * 用法：npm run window-b -- [--runs=3] [--only=B-1,B-2] [--mission-timeout-min=25] [--base=URL]
 * 输出：outputs/windowb/<时间戳>/report.md + report.json（outputs/ 不入库）
 * 口令只从 DEV_LOGIN_PASSWORD / SEED_PASSWORD 或 .env 读取，不打印、不落盘。
 */
import fs from "node:fs";
import path from "node:path";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const BASE = arg("base", process.env.KX66_BASE ?? "http://127.0.0.1:3100").replace(/\/+$/, "");
const EMAIL = process.env.KERN_DEMO_EMAIL ?? "zhang_pm@hermes.test";
const RUNS = Number(arg("runs", "3"));
const ONLY = arg("only", "").split(",").map((s) => s.trim()).filter(Boolean);
const MISSION_TIMEOUT_MS = Number(arg("mission-timeout-min", "25")) * 60_000;
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT = arg("out", path.join("outputs", "windowb", STAMP));

const TASKS: { id: string; kind: string; goal: string; expect: string }[] = [
  {
    id: "B-1",
    kind: "调研类",
    goal: "调研 2026 年国内智能宠物饮水机市场：市场规模与趋势、主要竞品与价格带、渠道格局，以及相关法规与宣称合规边界，最后给出我们是否应该进入的建议。",
    expect: "一页结论：进 / 不进 + 三条理由 + 价格带表 + 合规红线",
  },
  {
    id: "B-2",
    kind: "内部办公类（方案评审）",
    goal: "评审以下方案，方案正文已全文附上。《「会议纪要自动生成行动项」功能方案 v0.9》——【背景】我们的 SaaS 协作产品面向 50–500 人的中小企业，现有项目管理、文档、IM 三个模块；月活 4.2 万，付费团队 860 个，客单价 ¥99/人/年。客户访谈中 37% 的受访团队提到「会后行动项靠人工整理、经常遗漏」。【功能设计】① 会议结束后，从上传的录音转写稿或粘贴的纪要文本中自动抽取行动项（负责人、截止日、依赖项）；② 一键同步到项目管理模块生成任务并指派；③ 每周例会自动汇总上周未完成行动项。【技术方案】语音转写调用第三方 ASR（¥0.3/分钟）；行动项抽取调用通用大模型 API，预计每场会议约 8k token、成本约 ¥0.04/场，不自训模型；抽取结果结构化后走现有任务 API 写入；预计 2 名工程师 6 周完成 MVP。【成本与定价】假设平均每场会议 30 分钟、30% 的会议使用录音转写（ASR 成本 ¥0.3/分钟 × 30 分钟 = ¥9/场）、其余 70% 直接粘贴文字纪要（只产生抽取成本）；行动项抽取每场约 8k token、约 ¥0.04/场。按每月 1.5 万场会议估算：转写 4500 场 × ¥9 = ¥4.05 万，抽取 1.5 万场 × ¥0.04 = ¥0.06 万，合计新增 API 成本约 ¥4.11 万/月（渠道佣金与现有云资源属平台级分摊，不计入单场边际成本）。计划并入现有「专业版」（¥159/人/年）不单独收费，期望拉动专业版转化率从 11% 提升到 15%。——请从产品定位与价值主张、技术方案与技术风险、成本与毛利三方面给出评审意见，最后给出是否立项的建议。",
    expect: "评审意见三段 + 立项建议 + 最大风险",
  },
  {
    id: "B-3",
    kind: "产品研发类（Product OS）",
    goal: "我想开发一款面向办公室的便携式咖啡冷萃机，请评估市场需求与竞品价格带、成本结构与毛利、合规要求，给出推荐的产品方向与验证计划。",
    expect: "推荐方向 + 验证计划 + 需要拍板的事",
  },
];

function password(): string {
  if (process.env.DEV_LOGIN_PASSWORD) return process.env.DEV_LOGIN_PASSWORD;
  if (process.env.SEED_PASSWORD) return process.env.SEED_PASSWORD;
  const line = fs.readFileSync(path.join(process.cwd(), ".env"), "utf8").split(/\r?\n/).find((l) => /^SEED_PASSWORD=/.test(l));
  if (line) return line.slice("SEED_PASSWORD=".length).trim().replace(/^["']|["']$/g, "");
  throw new Error("缺少登录口令：请设置 DEV_LOGIN_PASSWORD 或 SEED_PASSWORD");
}

let cookie = "";
async function apiJson(method: string, url: string, body?: unknown, timeoutMs = 300_000) {
  const res = await fetch(BASE + url, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: res.status, json: obj(await res.json().catch(() => ({}))) };
}
async function login() {
  const res = await fetch(BASE + "/api/auth/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: password() }) });
  if (!res.ok) throw new Error(`登录失败：HTTP ${res.status}`);
  cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

type RunRecord = {
  task: string;
  run: number;
  convId: string;
  missionId: string | null;
  briefStage: string;
  usedPlaybook: string | null;
  outcome: string;
  minutes: number;
  metrics: Json | null;
  automation: Json | null;
  contractAccepted: boolean | null;
  failedNodes: string[];
  note: string;
};

async function runOnce(task: (typeof TASKS)[number], run: number): Promise<RunRecord> {
  const rec: RunRecord = { task: task.id, run, convId: "", missionId: null, briefStage: "", usedPlaybook: null, outcome: "", minutes: 0, metrics: null, automation: null, contractAccepted: null, failedNodes: [], note: "" };
  const conv = await apiJson("POST", "/api/conversations", { title: `${task.id} 第 ${run} 次`, productId: null });
  rec.convId = str(conv.json.id) || str(obj(conv.json.conversation).id);
  if (!rec.convId) { rec.note = `创建会话失败 HTTP ${conv.status}`; return rec; }
  await apiJson("POST", `/api/conversations/${rec.convId}/messages`, { content: task.goal });
  const list = await apiJson("GET", `/api/conversations/${rec.convId}/messages`);
  const msgs = arr(list.json.items ?? list.json.messages ?? list.json);
  const briefMsg = [...msgs].reverse().map(obj).find((m) => arr(m.citations).some((c) => str(obj(c).kind) === "kern-brief"));
  if (!briefMsg) { rec.note = "没有生成任务简报（被当成单轮问答）"; return rec; }
  const briefUrl = `/api/missions/brief/${str(briefMsg.id)}`;
  const brief = await apiJson("GET", briefUrl);
  const b = obj(brief.json.brief ?? brief.json);
  rec.briefStage = str(b.stage);
  rec.usedPlaybook = str(obj(b.playbookRef).name) || null;
  if (b.stage === "CLARIFY") await apiJson("POST", briefUrl, { action: "skip-questions" });
  const launched = await apiJson("POST", briefUrl, { action: "launch" });
  rec.missionId = str(launched.json.missionTaskId) || str(obj(launched.json.brief).missionTaskId) || null;
  if (!rec.missionId) { rec.note = `启动失败 HTTP ${launched.status} ${JSON.stringify(launched.json).slice(0, 200)}`; return rec; }
  const t0 = Date.now();
  let state: Json = {};
  while (Date.now() - t0 < MISSION_TIMEOUT_MS) {
    const s = await apiJson("GET", `/api/missions/${rec.missionId}`);
    state = obj(s.json.item ?? s.json.mission ?? s.json);
    if (state.outcome) break;
    await sleep(15_000);
  }
  rec.minutes = +((Date.now() - t0) / 60_000).toFixed(1);
  rec.outcome = str(obj(state.outcome).status) || "TIMEOUT";
  rec.failedNodes = arr(state.nodes).map(obj).filter((n) => /FAILED|BLOCKED/.test(str(n.status))).map((n) => str(n.key));
  if (rec.outcome === "COMPLETED") {
    // 复核：这里按「自动项由系统判定、人工项全部通过」验收；自动项失败会打回并重做一次。
    let review = await apiJson("POST", `/api/missions/${rec.missionId}/control`, { action: "review", verdicts: [] });
    if (review.json.accepted === false) {
      rec.note += `第一次复核未通过（${JSON.stringify(review.json.rejected)}），重做后再复核；`;
      const t1 = Date.now();
      while (Date.now() - t1 < MISSION_TIMEOUT_MS) {
        const s = await apiJson("GET", `/api/missions/${rec.missionId}`);
        state = obj(s.json.item ?? s.json.mission ?? s.json);
        if (state.outcome) break;
        await sleep(15_000);
      }
      if (str(obj(state.outcome).status) === "COMPLETED") review = await apiJson("POST", `/api/missions/${rec.missionId}/control`, { action: "review", verdicts: [] });
    }
    rec.contractAccepted = review.json.accepted === true ? true : review.json.accepted === false ? false : null;
    // 已套用既有做法时不再重复保存：否则每轮都会新建同名 playbook，acceptedStreak 被拆散，闸门永远差 1 次。
    if (run === 1 && rec.contractAccepted && !rec.usedPlaybook) {
      const pb = await apiJson("POST", "/api/playbooks", { missionTaskId: rec.missionId, name: `${task.id} ${task.kind}` });
      rec.note += pb.status < 300 ? "已保存为做法；" : `保存做法失败 HTTP ${pb.status}；`;
    }
  }
  const fin = await apiJson("GET", `/api/missions/${rec.missionId}`);
  const st = obj(fin.json.item ?? fin.json.mission ?? fin.json);
  rec.metrics = st.metrics ? obj(st.metrics) : null;
  rec.automation = st.automation ? obj(st.automation) : null;
  if (!rec.usedPlaybook && st.savedPlaybook) rec.usedPlaybook = str(obj(st.savedPlaybook).name) || null;
  return rec;
}

function fmtMs(ms: unknown): string {
  if (typeof ms !== "number") return "—";
  return ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${(ms / 60_000).toFixed(1)}min`;
}
function line(r: RunRecord): string {
  const m = r.metrics;
  if (!m) return `${r.outcome || "未启动"}${r.note ? `（${r.note}）` : ""}`;
  const cost = obj(m.cost);
  return [
    m.completed ? "完成" : "未完成",
    m.accepted === true ? "验收通过" : m.accepted === false ? "验收未过" : "未复核",
    `介入 ${m.humanInterventions}`,
    `返工 ${m.reworkRounds}`,
    `耗时 ${fmtMs(m.timeToResultMs)}`,
    `模型 ${cost.modelCalls} 次${typeof cost.tokens === "number" ? ` / ${cost.tokens} tok` : ""}`,
    r.usedPlaybook ? `套用做法` : "",
  ].filter(Boolean).join("，");
}

async function main() {
  await login();
  fs.mkdirSync(OUT, { recursive: true });
  const tasks = TASKS.filter((t) => !ONLY.length || ONLY.includes(t.id));
  const results: RunRecord[] = [];
  // 三个任务并行、每个任务内串行（第 2 次要用第 1 次保存的做法）
  await Promise.all(tasks.map(async (t) => {
    for (let i = 1; i <= RUNS; i++) {
      const started = new Date().toISOString();
      let rec: RunRecord;
      try { rec = await runOnce(t, i); } catch (e) {
        rec = { task: t.id, run: i, convId: "", missionId: null, briefStage: "", usedPlaybook: null, outcome: "ERROR", minutes: 0, metrics: null, automation: null, contractAccepted: null, failedNodes: [], note: e instanceof Error ? e.message : String(e) };
      }
      results.push(rec);
      console.log(`[${started}] ${t.id} #${i} → ${rec.outcome} ${line(rec)}`);
      fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ base: BASE, runs: RUNS, results }, null, 2));
    }
  }));
  results.sort((a, b) => a.task.localeCompare(b.task) || a.run - b.run);
  const rows = tasks.map((t) => {
    const rs = results.filter((r) => r.task === t.id);
    const last = rs[rs.length - 1];
    const auto = last?.automation ? (last.automation.allowed ? "✅ 可转定时" : `✗ ${str(last.automation.reason)}（${last.automation.streak}/${last.automation.required}）`) : "—";
    return `| ${t.id} ${t.kind} | ${t.goal} | ${t.expect} | ${rs.map((r) => line(r)).join(" | ")} | ${auto} |`;
  });
  const md = [
    `# 窗口 B 试运行报告（${STAMP}）`,
    "",
    `dev 服务器 ${BASE}，账号 ${EMAIL}，模型策略：free（仅 Agnes Flash）。每个任务 ${RUNS} 次；第 1 次通过后保存为做法，其后自动套用。`,
    "",
    "| 任务 | 目标 | 期望结果 | 第 1 次 | 第 2 次 | 第 3 次 | 自动化闸门 |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
    "## 逐次明细",
    "",
    "| 任务 | 次 | 结果 | 分钟 | 简报阶段 | 做法 | 失败节点 | 备注 | 任务 id |",
    "|---|---|---|---|---|---|---|---|---|",
    ...results.map((r) => `| ${r.task} | ${r.run} | ${r.outcome} | ${r.minutes} | ${r.briefStage || "—"} | ${r.usedPlaybook ?? "—"} | ${r.failedNodes.join(" ") || "—"} | ${r.note || "—"} | ${r.missionId ?? "—"} |`),
    "",
  ].join("\n");
  fs.writeFileSync(path.join(OUT, "report.md"), md);
  console.log(`\n报告：${path.join(OUT, "report.md")}`);
  const bad = results.filter((r) => r.outcome !== "COMPLETED" || r.contractAccepted !== true);
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
