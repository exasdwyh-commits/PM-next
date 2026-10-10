import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { PROJECT_WORKSPACE_TABS } from "../src/app/projects/[id]/project-workspace";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

test("Kern is the primary operating shell and management stays independent", () => {
  const root = read("src/app/page.tsx");
  const muse = read("src/app/muse/muse-client.tsx");
  const shell = read("src/components/app-shell.tsx");
  const manage = read("src/app/manage/page.tsx");

  assert.ok(root.includes('redirect("/muse")'), "root must enter the Kern operating route by default");
  assert.ok(muse.includes('fetch("/api/conversations"'), "Kern must create real conversations");
  assert.ok(
    muse.includes('/api/conversations/${conversationId}/messages'),
    "Kern must send work through the real assistant conversation API"
  );
  assert.ok(
    muse.includes('/api/proposals/${decision.id}/confirm'),
    "Kern check-ins must use the real proposal approval API"
  );
  assert.ok(shell.includes('label: "返回 Kern"'), "management must have an explicit route back to Kern");
  for (const label of ["管理总览", "产品管理", "项目管理", "市场机会", "公司知识", "自动化中心", "设置"]) {
    assert.ok(shell.includes(label), `missing management navigation label: ${label}`);
  }
  assert.ok(manage.includes("<WorkbenchClient"), "traditional management overview must remain available");
});

test("management conversations route back through Kern", () => {
  const home = read("src/app/workbench-client.tsx");
  assert.equal(home.includes("今天想让 Kern 做什么？"), false, "management must not restore a hero prompt surface");
  // KX-22 方案 B：去掉与 Muse 输入坞重复的输入条，页头只留一个「去和 Kern 说」入口
  assert.ok(home.includes("去和 Kern 说"));
  assert.ok(home.includes('href="/muse"'));
  assert.ok(home.includes("/muse?query="), "management handoff must enter the Kern operating shell");
  assert.ok(home.includes("需要你处理"));
  assert.ok(home.includes("最近 {workforceActivity.windowHours} 小时记录"), "historical activity must not claim current execution");
  assert.equal(stripComments(home).includes("Kern 正在工作 ·"), false);
  assert.ok(home.includes("第一次使用，三步就够了"), "empty org must have first-use onboarding");
});

test("product remains the primary business object", () => {
  const product = read("src/app/products/[id]/product-overview-client.tsx");
  const projects = read("src/app/projects/projects-client.tsx");
  assert.ok(product.includes("启动研发"));
  assert.ok(product.includes("继续推进"));
  assert.ok(product.includes("和 Kern 讨论"));
  assert.ok(product.includes("/muse?product="), "product discussion must open the Kern route with product context");
  assert.ok(product.includes('label: "AI 判断"'));
  assert.ok(product.includes('label: "产品方案"'));
  assert.ok(product.includes('label: "证据与风险"'));
  assert.ok(projects.includes("项目管理"));
  assert.ok(projects.includes("日常可从「产品」进入"));
});

test("project detail stays a focused product workspace", () => {
  const detail = read("src/app/projects/[id]/project-detail-client.tsx");
  assert.ok(detail.includes("PROJECT_WORKSPACE_TABS"), "workspace must render the shared tab definitions");
  // V2（bc49697）在 AI 研发与工作项之间新增「成本」页签，由 CostCalculatorModular 实际渲染。
  assert.ok(detail.includes("CostCalculatorModular"), "cost tab must render the cost calculator");
  assert.deepEqual(PROJECT_WORKSPACE_TABS, [
    ["overview", "概览"], ["rnd", "AI 研发"], ["cost", "成本"], ["tasks", "工作项"],
    ["evidence", "证据"], ["decisions", "决策"], ["records", "记录"],
  ]);
  assert.ok(detail.includes('onOpenDecisions={() => setActiveWorkspaceTab("decisions")}'));
  assert.ok(detail.includes('onOpenEvidence={() => setActiveWorkspaceTab("evidence")}'));
});

test("R&D UI exposes business stages rather than raw agent plumbing", () => {
  const rnd = read("src/components/product-rnd-panel.tsx");
  for (const stage of ["研发 Brief", "专业研究", "独立 QA", "管理报告", "负责人审查"]) {
    assert.ok(rnd.includes(stage), `missing R&D stage: ${stage}`);
  }
  assert.ok(rnd.includes("BLOCKED"));
  assert.ok(rnd.includes("WAITING_HUMAN"));
  // V2（bc49697）把管理报告区换成了按角色自适应的 ExecutiveReportRoleBased，
  // 不再直接内联 ExecutiveReportView；断言锁定「管理报告仍然真实渲染」而非具体组件名。
  assert.ok(rnd.includes("<ExecutiveReportRoleBased"));
});

test("executive report keeps the decision dock beside the evidence and stays honest about unknowns", () => {
  const report = read("src/components/executive-report.tsx");
  // KX-22 方案 C：横幅 + 四格统计取消；主区依据表 + 风险 / UNKNOWN，右侧常驻「需要你决定」面板
  for (const label of ["当前结论", "kx-rp-dock", "需要你决定", "最大风险", "还不能下结论"]) {
    assert.ok(report.includes(label), `missing executive report contract: ${label}`);
  }
  assert.ok(report.includes("去补证据"));
  assert.ok(report.includes("去做决策"));
  assert.ok(report.includes("UNKNOWN"));
  assert.ok(report.includes("不会由 AI 自动批准"));
});


test("Kern status and runtime permissions remain honest", () => {
  const readModel = read("src/modules/muse/read-model.ts");
  const sheets = read("src/app/muse/components/sheets.tsx");

  assert.ok(
    readModel.includes("latestRun === AgentRunStatus.RUNNING"),
    "conversation working state must require a real RUNNING AgentRun"
  );
  assert.ok(
    !readModel.includes('String(latest.role) === "USER"\n        ? "working"'),
    "a user message alone must never imply Kern is executing"
  );
  assert.ok(
    readModel.includes("capabilities: []"),
    "runtime capabilities must stay empty until the backend really reports them"
  );
  assert.ok(
    !sheets.includes('role="switch"'),
    "permission UI must not expose fake local-only authorization switches"
  );
  assert.ok(
    sheets.includes("尚未接入服务端"),
    "permission sheet must explain that fine-grained authorization is not wired yet"
  );
});

test("Kern primary route stays conversation-first while management remains available", () => {
  const client = read("src/app/muse/muse-client.tsx");
  const shell = read("src/app/muse/components/shell.tsx");

  // Home = attention brief (needs-you only when real items exist) + conversation starters.
  // Still conversation-first: no Today dashboard ids, starters always present.
  assert.ok(client.includes("<Blank seeds={brief.suggestions} attention={brief.attention}"));
  assert.equal(client.includes("kern-today-important"), false, "chat home must not become a Today dashboard");
  assert.equal(client.includes("kern-today-needs-you"), false, "chat home must not lead with an approval queue");
  assert.ok(shell.includes("最近对话"));
  assert.ok(shell.includes("新对话"));
  // KX-20 方案 B：工作台入口移到顶部上下文栏的区域切换
  assert.ok(client.includes('<a href="/manage">工作台</a>'));
  assert.equal(shell.includes("进度 UNKNOWN"), false, "conversation rail must not expose project-management noise");
});


test("knowledge sample banner does not expose internal environment variables", () => {
  const source = read("src/shared/content-mode.ts");
  const match = source.match(/KNOWLEDGE_SAMPLE_MODE_BANNER\s*=\s*"([^"]+)"/);
  assert.ok(match, "knowledge sample banner constant must remain explicit");
  assert.equal(
    match![1].includes("HERMES_KNOWLEDGE_SAMPLE_MODE"),
    false,
    "user-facing banner must not tell ordinary users to edit an environment variable"
  );
});

test("management empty states explain why and what to do next", () => {
  const files = [
    "src/app/consultation/consultation-client.tsx",
    "src/app/dashboard/dashboard-client.tsx",
    "src/app/organization/page.tsx",
    "src/app/products/[id]/product-overview-client.tsx",
    "src/app/products/[id]/revision-panel.tsx",
    "src/app/projects/[id]/project-detail-client.tsx",
    "src/app/settings/recent-audit-list.tsx",
    "src/app/settings/page.tsx",
    "src/app/trace/trace-client.tsx",
    "src/app/war-room/war-room-client.tsx",
    "src/app/workbench-client.tsx",
    "src/app/workforce/workforce-client.tsx",
  ];
  const combined = files.map(read).join("\n");

  for (const terse of [
    "<Empty>暂无反馈。</Empty>",
    "<Empty>暂无项目</Empty>",
    "<Empty>暂无工作项</Empty>",
    "<Empty>暂无决策包</Empty>",
    "<Empty>暂无参与项目</Empty>",
    "<Empty>暂无审计记录。</Empty>",
    "<Empty>暂无工作任务。</Empty>",
    "<Empty>暂无证据资料</Empty>",
    "<Empty>暂无审计事件。</Empty>",
    "<Empty>暂无反馈处置记录。</Empty>",
    "<Empty>目前没有高价值市场信号。</Empty>",
    "<Empty>暂无最近完成事项。</Empty>",
  ]) {
    assert.equal(combined.includes(terse), false, "terse empty state returned: " + terse);
  }

  for (const guidance of [
    "先选择项目并提交一条反馈",
    "先从「产品」启动研发或创建项目",
    "进入具体项目的「工作项」页安排第一项工作",
    "由负责人在项目「决策」页起草并提交",
    "点击「录入依据证据」登记来源并完成核实",
    // KX-22 方案 B：「值得看的市场机会」已移出工作台首页（入口保留在左侧「市场机会」导航），对应空态随之移除
    "需要你决策或补充信息时会在这里出现",
  ]) {
    assert.ok(combined.includes(guidance), "missing actionable empty-state guidance: " + guidance);
  }
});


test("visible product terminology is Kern / 产品 / 项目 / 工作项", () => {
  const visibleFiles = [
    "src/components/app-shell.tsx",
    "src/app/layout.tsx",
    "src/app/login/page.tsx",
    "src/app/login/login-client.tsx",
    "src/app/error.tsx",
    "src/app/not-found.tsx",
    "src/app/advisor/advisor-client.tsx",
    "src/app/workforce/workforce-client.tsx",
    "src/components/automation-trace.tsx",
    "src/components/challenge-report-card.tsx",
    "src/components/desktop-activity.tsx",
    "src/components/product-rnd-panel.tsx",
    "src/modules/workforce/service.ts",
    "src/modules/workforce/activity-brief.ts",
  ];
  for (const file of visibleFiles) {
    const source = stripComments(read(file));
    assert.equal(
      /\b(?:HERMES|Hermes)\b/.test(source),
      false,
      file + " still exposes the legacy Hermes brand"
    );
  }

  const shell = read("src/components/app-shell.tsx");
  const login = read("src/app/login/login-client.tsx");
  const workforce = read("src/modules/workforce/service.ts");
  const projects = read("src/app/projects/projects-client.tsx");
  const detail = stripComments(read("src/app/projects/[id]/project-detail-client.tsx"));
  const launch = stripComments(read("src/app/products/[id]/launch-tab.tsx"));

  assert.ok(shell.includes(">Kern<") && login.includes(">Kern<"), "global visible brand must be Kern");
  assert.ok(workforce.includes('code: "hermes_pm"'), "stable internal workforce code must remain compatible");
  assert.ok(workforce.includes('name: "Kern PM"'), "default visible PM agent must be Kern PM");

  assert.ok(projects.includes("<h1>项目管理</h1>"), "Project entity must be called 项目");
  assert.equal(projects.includes("执行工作区"), false, "Project entity must not be renamed as 执行工作区");
  assert.ok(detail.includes("PROJECT_WORKSPACE_TABS") && PROJECT_WORKSPACE_TABS.some(([key, label]) => key === "tasks" && label === "工作项"), "WorkItem tab must use 工作项");
  assert.ok(detail.includes("安排新工作项") && detail.includes("前置依赖工作项"), "WorkItem actions must use 工作项");
  assert.equal(detail.includes("修订任务说明"), false, "feedback-created WorkItem must not be called 修订任务");
  assert.equal(detail.includes("门槛"), false, "generic Gate label must use 门禁");
  assert.equal(launch.includes("门槛"), false, "launch Gate label must use 门禁");
});


test("Kern preserves the original Muse visual system while changing product logic", () => {
  const css = read("src/app/muse/muse.css");
  // Kern Design Foundation：唯一令牌源在 theme/kern-design.css（亮 / 暗两套），
  // muse 层只做 --m-* → --k-* 映射，不再自带字面色值（否则会出现两套真相）。
  assert.ok(css.includes("--m-surface:     var(--k-surface);"), "muse tokens must map to the single Kern token source");
  const tokens = read("src/app/theme/kern-design.css");
  assert.match(tokens, /--k-surface:\s*[^;]+;/, "kern-design.css defines the light surface");
  assert.match(tokens, /prefers-color-scheme:\s*dark|data-theme="dark"|\.dark\b/, "kern-design.css defines a dark theme");
  assert.ok(
    css.includes("radial-gradient(880px 520px"),
    "the original Muse canvas atmosphere must remain intact"
  );
  const cardRule = css.match(/\.m-card \{[^}]+\}/)?.[0] || "";
  const dockRule = css.match(/\.m-dock-inner \{[^}]+\}/)?.[0] || "";
  assert.ok(cardRule.includes("backdrop-filter"), "restore original Muse card material");
  assert.ok(dockRule.includes("backdrop-filter"), "restore original Muse composer material");
  assert.ok(css.includes("--m-grad:"), "preserve the original single accent gradient");
  assert.equal(css.includes("Kern Visual Intelligence"), false, "feature-specific graph CSS must not fork the Muse visual system");
});

test("Executive Report exposes the decision sequence and folds raw detail", () => {
  const report = stripComments(read("src/components/executive-report.tsx"));
  // KX-22 方案 C 顺序：结论 → 关键依据 → 最大风险 → UNKNOWN → 附录（折叠）→ 需要你决定 → 下一步
  const order = ["当前结论：", "关键依据", "最大风险", "还不能下结论", "报告溯源", "需要你决定", "下一步"].map((label) => {
    const at = report.indexOf(label);
    assert.ok(at >= 0, "missing executive report label: " + label);
    return at;
  });
  assert.deepEqual([...order].sort((a, b) => a - b), order, "executive report sections must keep the fixed order");
  assert.ok(report.includes("<details") && report.includes("专业数字员工意见"));
});

test("desktop execution reads as Kern using the Mac, with runtime details secondary", () => {
  const presence = stripComments(read("src/modules/desktop-runtime/presence.ts"));
  const desktop = stripComments(read("src/components/desktop-activity.tsx"));
  assert.ok(desktop.includes("Kern 正在用你的电脑"));
  assert.ok(desktop.includes("开发环境连接方式"));
  assert.ok(desktop.includes("npm run desktop"));
  assert.equal((desktop.match(/开发环境连接方式/g) || []).length, 2, "developer command must appear only in two secondary help disclosures");
  assert.equal(presence.includes("npm run desktop"), false, "primary presence hint must not lead with implementation commands");
  assert.equal(desktop.includes("Hermes Desktop"), false, "visible desktop UI must not expose the old runtime product name");
});


test("Kern primary shell behaves like a real conversation surface", () => {
  const client = read("src/app/muse/muse-client.tsx");
  const shell = read("src/app/muse/components/shell.tsx");
  const turn = read("src/app/muse/components/turn.tsx");

  assert.ok(client.includes("Kern 正在处理这条消息…"));
  assert.ok(client.includes("等待后台执行器启动"), "accepted messages explain missing worker rather than pretending to run");
  assert.ok(client.includes("scrollToLatest"), "new conversation turns should stay visible");
  assert.ok(shell.includes('m-brand-mark" aria-hidden>K<'), "visible Kern brand mark must be K");
  assert.ok(turn.includes('by?.mark ?? "K"'), "assistant fallback avatar must be Kern, not Muse");
  const readModel = read("src/modules/muse/read-model.ts");
  assert.ok(readModel.includes('agent.code === "hermes_pm" ? "e-hermes" : agent.id'));
  assert.ok(readModel.includes('mark: "K"'), "Kern fallback employee mark must be K");
  assert.equal(client.includes("Kern 正在执行这条消息"), false, "request-in-flight UI must not fake backend execution");
});

test("conversation rail supports rename and archive on real owned conversations", () => {
  const client = read("src/app/muse/muse-client.tsx");
  const shell = read("src/app/muse/components/shell.tsx");
  const api = read("src/app/api/conversations/[id]/route.ts");
  const service = read("src/modules/assistant-runtime/conversations.ts");

  assert.ok(shell.includes("onRename"), "rail must expose a rename affordance");
  assert.ok(shell.includes("onArchive"), "rail must expose an archive affordance");
  assert.ok(
    client.includes("/api/conversations/${conversation.id}`"),
    "rail actions must call the real conversation PATCH endpoint"
  );
  assert.ok(client.includes("router.refresh()"), "rail actions must refresh server model after mutation");
  assert.ok(api.includes("getServerSession"), "PATCH endpoint must authenticate");
  assert.ok(
    service.includes("requireOwnedKernConversation"),
    "service layer must enforce owner-only semantics"
  );
  assert.ok(
    service.includes('throw new NotFoundError("Conversation not found")'),
    "cross-owner access must stay NotFound (no existence leak)"
  );
});
