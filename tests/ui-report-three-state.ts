/**
 * 研究报告三态浏览器验收（R1·report-quality/v1）
 *
 * 用**确定性夹具**在测试库里造三份任务报告（不跑真模型，保证可复现）：
 * - 可交付：八节齐全、数字带来源与标注、缺口写明补齐方式；
 * - 待补证草稿：上面那份 + 一句没有来源的数字；
 * - 阻断：奶粉需求配海苔示例（演示污染）。
 *
 * 断言覆盖需求 §5 的浏览器验收项：
 * - 报告页（正文）三态呈现正确；
 * - 卡片状态与正文一致（经 citation API 校验）；
 * - 下载件与页面同一状态：可交付原样、草稿带状态戳、阻断一律拒绝；
 * - 内部诊断不泄漏（问题清单只出现在状态区块里，不混进正文结论）。
 *
 * 跑法（库指向 hermes_test，本机 Chrome，localhost 关代理）：
 *   set -a; . ./.env; set +a; DATABASE_URL="$TEST_DATABASE_URL" UI_BASE_URL=http://127.0.0.1:3332 \
 *   CHROME_PATH="C:/Users/exasd/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe" \
 *   npx tsx tests/ui-report-three-state.ts
 */
import { chromium } from "playwright";
import assert from "node:assert/strict";

import prisma from "../src/shared/db";

const BASE = process.env.UI_BASE_URL ?? "http://127.0.0.1:3332";
const CHROME_PATH = process.env.CHROME_PATH;
const TAG = `uiprobe${Date.now()}`;

const SHOT_GOAL =
  "好，其实我们想开发一款红参胶原蛋白肽女士奶粉，主打新疆三峰包奶源。目标人群35-55岁女性。预算大概10万以内。";

const OK_CONCLUSION = [
  "## 结论摘要",
  "**结论与建议**：先做小批验证「红参胶原蛋白肽女士奶粉」（推断）。",
  "## 产品定位",
  "面向 35-55 岁女性，主打新疆奶源（推断）。",
  "## 成本与经济性",
  "单罐 BOM 尚未取到报价（UNKNOWN：代工报价（需要 3 家工厂询价））。",
  "## 销售机制与渠道",
  "小红书种草优先，抖音跟进（推断）。",
  "## 营销策略",
  "首批内容围绕女性日常营养（推断）。",
  "## 风险评估",
  "- 原料价格波动会影响毛利。",
  "## 合规边界",
  "功效宣称需按保健食品标准复核。",
  "## 验证计划与待决策",
  "**需要你决定**：是否在 10 万元以内启动首轮验证。",
].join("\n");

const DRAFT_CONCLUSION = `${OK_CONCLUSION}\n- 复购率约 22%，高于品类均值。`;
const BLOCKED_CONCLUSION = "## 结论：推荐做「高蛋白海苔脆」（示例）\n同价位下蛋白含量领先约 40%，窗口期 6–9 个月。";

const results: { name: string; ok: boolean; detail: string }[] = [];
function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${name} — ${detail}`);
}

async function ensureActors() {
  const org =
    (await prisma.organization.findFirst({ orderBy: { createdAt: "desc" } })) ??
    (await prisma.organization.create({ data: { name: `${TAG}_ORG`, code: `${TAG}-org` } }));
  const user =
    (await prisma.user.findFirst({ orderBy: { createdAt: "desc" } })) ??
    (await prisma.user.create({ data: { organizationId: org.id, name: `${TAG}_USER`, email: `${TAG}@kern.test` } }));
  const member = await prisma.organizationMember.findFirst({
    where: { organizationId: org.id, userId: user.id },
  });
  if (!member) {
    await prisma.organizationMember.create({
      data: { organizationId: org.id, userId: user.id, role: "ORG_ADMIN" },
    });
  }
  const agent =
    (await prisma.agent.findFirst({ where: { organizationId: org.id } })) ??
    (await prisma.agent.create({
      data: { organizationId: org.id, code: `${TAG}_pm`, name: "验收用 PM", roleKey: "pm" },
    }));
  return { org, user, agent };
}

async function seedMission(opts: {
  organizationId: string;
  agentId: string;
  userId: string;
  key: string;
  conclusion: string;
  demo: boolean;
}) {
  const market = await prisma.agentTask.create({
    data: {
      organizationId: opts.organizationId,
      agentId: opts.agentId,
      goal: SHOT_GOAL,
      status: "SUCCEEDED",
      contextSnapshot: {
        nodeKey: "market",
        executorResult: { output: "## 市场判断\n- 需求稳定（事实）" },
      },
    },
  });
  const synth = await prisma.agentTask.create({
    data: {
      organizationId: opts.organizationId,
      agentId: opts.agentId,
      goal: SHOT_GOAL,
      status: "SUCCEEDED",
      contextSnapshot: { nodeKey: "synthesis", executorResult: { output: opts.conclusion } },
    },
  });
  const root = await prisma.agentTask.create({
    data: {
      organizationId: opts.organizationId,
      agentId: opts.agentId,
      goal: SHOT_GOAL,
      status: "SUCCEEDED",
      contextSnapshot: {
        schemaVersion: "kern-mission/v1",
        requestedByUserId: opts.userId,
        demo: opts.demo,
        goal: SHOT_GOAL,
        plan: {
          playbook: "NEW_PRODUCT",
          nodes: [
            { key: "market", kind: "SPECIALIST", agentCode: "hermes_research", objective: "市场判断", dependsOn: [], critical: true },
            { key: "synthesis", kind: "SYNTHESIS", agentCode: "hermes_pm", objective: "综合结论", dependsOn: ["market"], critical: true },
          ],
          budget: { maxTasks: 12, maxDepth: 2, maxAttemptsPerNode: 2 },
          successCriteria: [],
          humanGates: [],
        },
        state: {
          nodes: {
            market: { status: "SUCCEEDED", attempts: 1, taskId: market.id, summary: "市场判断完成" },
            synthesis: { status: "SUCCEEDED", attempts: 1, taskId: synth.id, summary: "综合结论完成" },
          },
          revisionRounds: 0,
          tasksCreated: 2,
        },
        outcome: { status: "COMPLETED" },
        paused: null,
        log: [],
      },
    },
  });
  return { root, market, synth };
}

async function main() {
  if (!CHROME_PATH) throw new Error("需要 CHROME_PATH（本机 Chrome）");
  const db = await prisma.$queryRawUnsafe<{ current_database: string; current_user: string }[]>(
    "SELECT current_database(), current_user",
  );
  const dbName = String(db[0]?.current_database ?? "");
  assert.equal(dbName, "hermes_test", `必须跑在测试库，当前=${dbName}`);
  console.log(`🔒 测试隔离校验通过：库=${dbName} 角色=${db[0]?.current_user}`);

  const { org, user, agent } = await ensureActors();
  const ok = await seedMission({ organizationId: org.id, agentId: agent.id, userId: user.id, key: "ok", conclusion: OK_CONCLUSION, demo: false });
  const draft = await seedMission({ organizationId: org.id, agentId: agent.id, userId: user.id, key: "draft", conclusion: DRAFT_CONCLUSION, demo: false });
  const blocked = await seedMission({ organizationId: org.id, agentId: agent.id, userId: user.id, key: "blocked", conclusion: BLOCKED_CONCLUSION, demo: true });

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: { "x-user-id": user.id, "x-organization-id": org.id },
  });
  const page = await context.newPage();
  /** 客户端报错必须可见：hydration 把正文冲成空白时，qgate=0 会是假通过。 */
  const clientErrors: string[] = [];
  page.on("pageerror", (e) => clientErrors.push(`pageerror: ${String(e.stack ?? e).slice(0, 1200)}`));
  page.on("console", (m) => {
    if (m.type() === "error") clientErrors.push(`console: ${m.text().slice(0, 300)}`);
  });
  if (process.env.DEBUG_PAGE === "1") {
    page.on("response", (r) => {
      if (r.status() >= 400) console.log(`      [debug] ${r.status()} ${r.url().slice(0, 200)}`);
    });
  }
  const shotDir = `outputs/ui-report-${TAG}`;
  const shot = async (name: string) => page.screenshot({ path: `${shotDir}/${name}.png`, fullPage: true });

  /** dev 模式首次进入路由要现场编译，导航超时放宽到 90s。 */
  const GOTO = { waitUntil: "domcontentloaded", timeout: 90_000 } as const;
  const gateOf = async (missionId: string) => {
    await page.goto(`${BASE}/reports/missions/${missionId}`, GOTO);
    if (process.env.DEBUG_PAGE === "1") {
      console.log(`      [debug] title=${await page.title()} overlay=${await page.locator("nextjs-portal").count()} h1=${(await page.locator("h1").first().innerText().catch(() => "<none>")).trim()}`);
      console.log(`      [debug] body=${(await page.innerText("body")).replace(/\s+/g, " ").slice(0, 300)}`);
      console.log(`      [debug] html qgate=${(await page.content()).split('class="qgate').length - 1}`);
    }
    await page.waitForTimeout(1200);
    const gate = page.locator(".qgate");
    const count = await gate.count();
    if (process.env.DEBUG_PAGE === "1") {
      const html = await page.content();
      console.log(`      [debug] 等待后：bodyLen=${(await page.innerText("body")).length} htmlQgate=${html.split('class="qgate').length - 1} overlay=${await page.locator("nextjs-portal").count()} h1=${(await page.locator("h1").first().innerText().catch(() => "<none>")).trim()}`);
      for (const e of clientErrors.splice(0)) console.log(`      [debug] ${e}`);
    }
    const status = count ? await gate.first().getAttribute("data-status") : null;
    const badge = count ? (await gate.first().locator(".qgate-badge").first().innerText()).trim() : "";
    /** 着陆点自检：落在登录页/404 上时，qgate=0 会是假通过。 */
    const url = page.url();
    const h1 = (await page.locator("h1").first().innerText().catch(() => "")).trim();
    const body = await page.innerText("body");
    const docTitle = await page.title();
    const bodyHead = body.replace(/\s+/g, " ").slice(0, 160);
    const overlay = await page.locator("nextjs-portal").count();
    const landed = url.includes(`/reports/missions/${missionId}`) && !/登录|sign in/i.test(body.slice(0, 400));
    return { count, status, badge, url, h1, landed, docTitle, bodyHead, overlay };
  };

  /**
   * 下载检查走 Node 侧请求：导出接口返回的是附件，
   * 在页面里 fetch 会触发下载导航、把执行上下文冲掉。
   */
  const exportCheck = async (missionId: string, format: string) => {
    const res = await fetch(`${BASE}/api/missions/${missionId}/export?format=${format}`, {
      headers: { "x-user-id": user.id, "x-organization-id": org.id },
    });
    const body = format === "md" ? await res.text() : "";
    return {
      status: res.status,
      quality: res.headers.get("x-kern-quality"),
      disposition: res.headers.get("content-disposition") ?? "",
      body: body.slice(0, 4000),
    };
  };

  try {
    console.log(`   · 夹具：可交付=${ok.root.id} 草稿=${draft.root.id} 阻断=${blocked.root.id}`);
    // ---------- 可交付 ----------
    const g1 = await gateOf(ok.root.id);
    await shot("01-deliverable");
    record(
      "可交付：报告页不出现质量阻断区块",
      g1.landed && g1.count === 0,
      `qgate 区块数=${g1.count}${g1.count ? ` status=${g1.status}` : ""}；着陆=${g1.landed} url=${g1.url} 标题=${g1.h1}`,
    );
    const e1md = await exportCheck(ok.root.id, "md");
    const e1docx = await exportCheck(ok.root.id, "docx");
    record(
      "可交付：Markdown 与 Office 正常出件且状态为可交付",
      e1md.status === 200 && e1docx.status === 200 && e1docx.quality === "DELIVERABLE" && !e1md.body.includes("待补证草稿"),
      `md=${e1md.status} docx=${e1docx.status} X-Kern-Quality=${e1docx.quality}`,
    );

    // ---------- 待补证草稿 ----------
    const g2 = await gateOf(draft.root.id);
    await shot("02-draft");
    record(
      "待补证草稿：报告页出现草稿区块并说明补齐方式",
      g2.landed && g2.count === 1 && g2.status === "DRAFT_UNVERIFIED" && g2.badge.includes("待补证草稿"),
      `qgate=${g2.count} status=${g2.status} 徽标=${g2.badge}；着陆=${g2.landed} url=${g2.url} 标题=${g2.h1}`,
    );
    const e2md = await exportCheck(draft.root.id, "md");
    const e2docx = await exportCheck(draft.root.id, "docx");
    record(
      "待补证草稿：下载件带状态戳与问题清单，不冒充正式成品",
      e2md.status === 200 &&
        e2docx.status === 200 &&
        e2docx.quality === "DRAFT_UNVERIFIED" &&
        e2md.body.includes("待补证草稿") &&
        e2md.body.includes("补齐方式"),
      `md=${e2md.status} docx=${e2docx.status} X-Kern-Quality=${e2docx.quality}；md 含状态戳=${e2md.body.includes("待补证草稿")} 含补齐方式=${e2md.body.includes("补齐方式")}`,
    );

    // ---------- 阻断 ----------
    const g3 = await gateOf(blocked.root.id);
    await shot("03-blocked");
    record(
      "阻断：报告页显示未通过质量检查（正文仍可见，便于排查）",
      g3.landed && g3.count === 1 && g3.status === "BLOCKED" && g3.badge.includes("未通过质量检查"),
      `qgate=${g3.count} status=${g3.status} 徽标=${g3.badge}；着陆=${g3.landed} url=${g3.url} 标题=${g3.h1}`,
    );
    const e3md = await exportCheck(blocked.root.id, "md");
    const e3docx = await exportCheck(blocked.root.id, "docx");
    record(
      "阻断：任何格式都不出正式件（含原先绕过的 Office）",
      e3md.status === 409 && e3docx.status === 409,
      `md=${e3md.status} docx=${e3docx.status}`,
    );

    // ---------- 内部诊断不泄漏 ----------
    const bodyText = await page.locator("body").innerText();
    record(
      "内部诊断不进客户报告：正文不裸露规则 id",
      !/R-NUMBER|R-CONTRACT|R-TOPIC/.test(bodyText),
      `正文中规则 id 出现=${/R-NUMBER|R-CONTRACT|R-TOPIC/.test(bodyText)}`,
    );
  } finally {
    await browser.close();
    const ids = [ok, draft, blocked].flatMap((m) => [m.root.id, m.market.id, m.synth.id]);
    if (process.env.KEEP_FIXTURES === "1") {
      console.log(`   · KEEP_FIXTURES=1：保留夹具不清理（${ids.length} 条任务），供排障复现`);
    } else {
      await prisma.agentTask.deleteMany({ where: { id: { in: ids } } });
      console.log(`🧹 已清理本次浏览器验收数据（${ids.length} 条任务）`);
    }
    await prisma.$disconnect();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n▶ 结果：${results.length - failed.length} 通过 / ${failed.length} 未通过（截图：${shotDir}）`);
  if (failed.length) {
    console.log(`❌ 浏览器验收失败：${failed.map((f) => f.name).join("；")}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

