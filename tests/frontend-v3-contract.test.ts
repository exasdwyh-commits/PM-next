import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("Muse is the primary operating shell and management stays independent", () => {
  const root = read("src/app/page.tsx");
  const muse = read("src/app/muse/muse-client.tsx");
  const shell = read("src/components/app-shell.tsx");
  const manage = read("src/app/manage/page.tsx");

  assert.ok(root.includes('redirect("/muse")'), "root must enter Muse by default");
  assert.ok(muse.includes('fetch("/api/conversations"'), "Muse must create real conversations");
  assert.ok(
    muse.includes('/api/conversations/\\${conversationId}/messages'),
    "Muse must send work through the real assistant conversation API"
  );
  assert.ok(
    muse.includes('/api/proposals/\\${decision.id}/confirm'),
    "Muse check-ins must use the real proposal approval API"
  );
  assert.ok(shell.includes('label: "返回 Muse"'), "management must have an explicit route back to Muse");
  for (const label of ["管理总览", "产品管理", "项目管理", "市场机会", "公司知识", "自动化中心", "设置"]) {
    assert.ok(shell.includes(label), `missing management navigation label: ${label}`);
  }
  assert.ok(manage.includes("<WorkbenchClient"), "traditional management overview must remain available");
});

test("management conversations route back through Muse", () => {
  const home = read("src/app/workbench-client.tsx");
  assert.ok(home.includes("今天想让 Hermes 做什么？"));
  assert.ok(home.includes("/muse?query="), "management commands must enter the Muse operating shell");
  assert.ok(home.includes("需要你处理"));
  assert.ok(home.includes("Hermes 正在工作"));
  assert.ok(home.includes("第一次使用，三步就够了"), "empty org must have first-use onboarding");
});

test("product remains the primary business object", () => {
  const product = read("src/app/products/[id]/product-overview-client.tsx");
  const projects = read("src/app/projects/projects-client.tsx");
  assert.ok(product.includes("启动研发"));
  assert.ok(product.includes("继续推进"));
  assert.ok(product.includes("和 AI 助理讨论"));
  assert.ok(product.includes("/muse?product="), "product discussion must open Muse with product context");
  assert.ok(product.includes('label: "AI 判断"'));
  assert.ok(product.includes('label: "产品方案"'));
  assert.ok(product.includes('label: "证据与风险"'));
  assert.ok(projects.includes("执行工作区"));
  assert.ok(projects.includes("日常请从「产品」进入"));
});

test("project detail stays a focused product workspace", () => {
  const detail = read("src/app/projects/[id]/project-detail-client.tsx");
  for (const tab of ["概览", "AI 研发", "任务", "证据", "决策", "记录"]) {
    assert.ok(detail.includes(`["${tab === "概览" ? "overview" : tab === "AI 研发" ? "rnd" : tab === "任务" ? "tasks" : tab === "证据" ? "evidence" : tab === "决策" ? "decisions" : "records"}", "${tab}"]`));
  }
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
  assert.ok(rnd.includes("<ExecutiveReportView"));
});

test("executive report remains decision-first and honest about unknowns", () => {
  const report = read("src/components/executive-report.tsx");
  for (const label of ["负责人现在最需要知道", "未闭合项", "显式风险", "需负责人决策", "还不能下结论"]) {
    assert.ok(report.includes(label), `missing executive report contract: ${label}`);
  }
  assert.ok(report.includes("去补证据"));
  assert.ok(report.includes("去做决策"));
  assert.ok(report.includes("UNKNOWN"));
  assert.ok(report.includes("不会由 AI 自动批准"));
});
