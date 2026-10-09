import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { createSession } from "../src/modules/identity/session";
import { initialMissionState, type MissionPlan } from "../src/modules/supervisor/plan";
import { MISSION_SCHEMA, toJson, type MissionSnapshot } from "../src/modules/supervisor/service";
const base = process.env.UI_BASE_URL!;
async function main() {
  assertTestDatabaseSafety();
  const tag = `kern-ux-${Date.now()}`;
  const org = await prisma.organization.create({ data: { code: tag, name: "Kern 对话体验验收" } });
  const user = await prisma.user.create({ data: { organizationId: org.id, name: "界面验收", email: `${tag}@test.local` } });
  const agent = await prisma.agent.create({ data: { organizationId: org.id, code: "hermes_pm", name: "Kern", roleKey: "hermes_pm", ownerId: user.id } });
  const conversation = await prisma.conversation.create({ data: { organizationId: org.id, ownerId: user.id, title: "便携咖啡机 · 执行过程验收" } });
  const plan: MissionPlan = { version: "kern-mission-plan/v1", playbook: "GENERIC", goal: "评估便携咖啡机的开发条件（界面验收演示）", budget: { maxTasks: 8, maxRevisionRounds: 0 }, humanGates: [], successCriteria: ["明确依据和风险"], nodes: [
    { key: "market", kind: "SPECIALIST", agentCode: "research_agent", taskClass: "ASSISTANT_SYNTHESIS", objective: "核对市场需求与竞争条件", dependsOn: [], critical: true },
    { key: "cost", kind: "SPECIALIST", agentCode: "cost_bom_agent", taskClass: "ASSISTANT_SYNTHESIS", objective: "测算单件成本与渠道利润", dependsOn: [], critical: true },
    { key: "qa", kind: "QA", agentCode: "hermes_pm", taskClass: "ASSISTANT_SYNTHESIS", objective: "复核证据与成本口径", dependsOn: ["market", "cost"], critical: true },
    { key: "synthesis", kind: "SYNTHESIS", agentCode: "hermes_pm", taskClass: "ASSISTANT_SYNTHESIS", objective: "形成建议与待确认事项", dependsOn: ["qa"], critical: true },
  ] };
  const state = initialMissionState(plan);
  state.nodes.market.status = "ACTIVE"; state.nodes.market.attempts = 1;
  state.nodes.cost.status = "ACTIVE"; state.nodes.cost.attempts = 1;
  const snapshot: MissionSnapshot = { schemaVersion: MISSION_SCHEMA, plan, state, conversationId: conversation.id, sourceRunId: null, requestedByUserId: user.id, log: [], outcome: null, demo: true };
  const mission = await prisma.agentTask.create({ data: { organizationId: org.id, agentId: agent.id, goal: plan.goal, status: "RUNNING", createdByUserId: user.id, contextSnapshot: toJson(snapshot) } });
  for (let index = 0; index < 8; index++) await prisma.message.create({ data: { conversationId: conversation.id, role: index % 2 ? "ASSISTANT" : "USER", content: `${index % 2 ? "已记录以下核对事项。" : "补充任务信息："}\n${"这段内容用于验证阅读历史和长输入布局。\n".repeat(5)}` } });
  await prisma.message.create({ data: { conversationId: conversation.id, role: "ASSISTANT", content: "这是界面验收演示，任务状态来自隔离测试库，不进行模型调用。", citations: [{ kind: "kern-mission", ref: mission.id }] } });
  const token = (await createSession(user.id)).token;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (fs.existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome") ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined), args: ["--no-sandbox", "--no-proxy-server"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: "hermes_session_token", value: token, url: base }]);
  const page = await context.newPage();
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const out = "outputs/kern-conversation-ux-20261009/ui"; fs.mkdirSync(out, { recursive: true });
  const shot = async (name: string) => {
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== "running" || animation.effect?.getComputedTiming().iterations === Infinity));
    await page.screenshot({ path: `${out}/${name}.png` });
  };
  try {
    await page.goto(`${base}/muse?c=${conversation.id}`);
    const flow = page.getByRole("region", { name: "执行工作流", exact: true }); await flow.waitFor();
    assert.equal(await flow.getAttribute("data-motion"), "running");
    await flow.getByRole("radio", { name: "步骤列表", exact: true }).click();
    const steps = flow.getByRole("list", { name: "执行步骤列表" });
    assert.equal(await steps.getByRole("button").count(), 2);
    await flow.getByRole("button", { name: /查看全部步骤/ }).click();
    assert.equal(await steps.getByRole("button").count(), 4);
    await steps.getByRole("button", { name: /^复核证据与成本口径/ }).click();
    const inspector = flow.getByRole("region", { name: "步骤详情：复核证据与成本口径", exact: true });
    await inspector.waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "步骤详情：复核证据与成本口径");
    await inspector.getByRole("button", { name: "关闭节点详情" }).click();
    assert.match(await page.evaluate(() => document.activeElement?.textContent ?? ""), /复核证据与成本口径/);
    await steps.getByRole("button", { name: /^复核证据与成本口径/ }).click();
    await flow.getByRole("radio", { name: "流程图", exact: true }).click();
    await inspector.getByRole("button", { name: "关闭节点详情" }).click();
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.nodeKey), "qa");
    await flow.getByRole("button", { name: "适应画布", exact: true }).click();
    console.log("PASS recorded parallel branches → full plan/list → node detail focus → return to selected node → canvas");

    const menu = page.getByLabel("更多工具", { exact: true });
    await menu.click(); await page.keyboard.press("Escape");
    assert.equal(await page.locator(".m-tool-menu").getAttribute("open"), null);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "更多工具");
    await menu.click(); await page.getByRole("button", { name: "凭证", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    assert.equal(await page.locator(".m-tool-menu").getAttribute("open"), null);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "更多工具");
    console.log("PASS compact toolbar retains tools; Escape/selection close menu and sheet restores focus");

    const input = page.getByRole("combobox", { name: "对 Kern 说", exact: true });
    const draft = "补充待确认条件，暂不发送。\n".repeat(18);
    await input.fill(draft);
    await page.waitForFunction(() => Number.parseFloat(document.querySelector<HTMLElement>(".m-main")!.style.getPropertyValue("--m-composer-height")) > 220);
    await page.locator(".m-scroll").evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.waitForFunction(() => {
      const dock = document.querySelector(".m-dock")!.getBoundingClientRect();
      const last = [...document.querySelectorAll(".m-lane .m-turn")].at(-1)!.getBoundingClientRect();
      return last.bottom <= dock.top - 16;
    });
    await page.reload(); await flow.waitFor(); assert.equal(await input.inputValue(), draft);
    await input.fill("");
    await page.waitForFunction(() => Number.parseFloat(document.querySelector<HTMLElement>(".m-main")!.style.getPropertyValue("--m-composer-height")) < 220);
    await page.locator(".m-scroll").evaluate(element => { element.scrollTop = element.scrollHeight; });
    await shot("conversation-desktop");
    console.log("PASS long draft reserves composer height; last reply remains visible; draft survives refresh");

    const pause = page.waitForResponse(r => r.url().endsWith(`/api/missions/${mission.id}/control`) && r.request().method() === "POST");
    await page.locator(".m-mission > .m-card-body > .m-card-actions").getByRole("button", { name: "暂停", exact: true }).click();
    assert.equal((await pause).status(), 200);
    const savedPause = (await prisma.agentTask.findUniqueOrThrow({ where: { id: mission.id } })).contextSnapshot as unknown as MissionSnapshot;
    assert.ok(savedPause.paused);
    assert.equal(await flow.getAttribute("data-motion"), "still");
    await page.reload(); await flow.waitFor(); assert.equal(await flow.getAttribute("data-motion"), "still");
    await page.locator(".m-mission > .m-card-body > .m-card-actions").getByRole("button", { name: "查看过程", exact: true }).click();
    const workspace = page.getByRole("dialog"); await workspace.waitFor();
    const paddings = await workspace.locator(".m-lanes > .m-lane").evaluateAll(elements => elements.map(element => Number.parseFloat(getComputedStyle(element).paddingBottom)));
    assert.ok(paddings.length > 0 && paddings.every(padding => padding < 30));
    await page.keyboard.press("Escape"); await workspace.waitFor({ state: "hidden" });
    console.log("PASS pause button → real control API → persisted snapshot → refresh keeps stopped motion; workspace cards keep compact spacing");

    let failStatus = true;
    // Hold recovery until the click, so automatic refresh cannot remove the retry target.
    let releaseRecovery!: () => void;
    const recoveryGate = new Promise<void>(resolve => { releaseRecovery = resolve; });
    await page.route(`**/api/missions/${mission.id}`, async route => {
      if (failStatus) return route.fulfill({ status: 503, body: '{}' });
      await recoveryGate;
      return route.continue();
    });
    await page.reload(); await page.getByRole("button", { name: "重新读取进展", exact: true }).waitFor();
    await shot("task-load-error");
    const count = await prisma.agentTask.count({ where: { organizationId: org.id } });
    failStatus = false; await page.getByRole("button", { name: "重新读取进展", exact: true }).click(); releaseRecovery(); await flow.waitFor();
    assert.equal(await prisma.agentTask.count({ where: { organizationId: org.id } }), count);
    await page.unroute(`**/api/missions/${mission.id}`);
    console.log("PASS injected status failure stays visible; retry reads real state without creating or restarting tasks");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload(); await flow.waitFor(); await steps.waitFor();
    assert.equal(await flow.getByRole("radio", { name: "步骤列表", exact: true }).getAttribute("aria-checked"), "true");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const heights = await flow.locator(".m-seg button, .m-flow-tools button, .m-flow-step-list button").evaluateAll(elements => elements.map(e => e.getBoundingClientRect().height));
    assert.ok(heights.every(height => height >= 44));
    await flow.scrollIntoViewIfNeeded(); await shot("conversation-mobile");
    await flow.getByRole("radio", { name: "流程图", exact: true }).click();
    await flow.getByRole("region", { name: "工作流画布，用方向键移动", exact: true }).waitFor();
    await shot("canvas-mobile");
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.ok(await flow.locator(".m-flow-node").evaluateAll(elements => elements.every(element => getComputedStyle(element).animationName === "none")));
    console.log("PASS mobile defaults to readable steps; canvas still available; 44px controls/no overflow; reduced motion respected");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize({ width: 1440, height: 1080 });
    await page.goto(`${base}/muse`);
    await page.getByRole("region", { name: "当前工作简报" }).waitFor();
    assert.equal(await page.locator(".muse").getAttribute("data-visual"), "advanced");
    assert.ok(await page.locator(".ka-distribution svg").getAttribute("aria-label"));
    await shot("advanced-home-desktop");
    await menu.click();
    await page.getByRole("group", { name: "Kern 外观", exact: true }).getByRole("button", { name: "深色", exact: true }).click();
    await page.reload(); await page.getByRole("region", { name: "当前工作简报" }).waitFor();
    await page.waitForFunction(() => document.querySelector(".muse")?.getAttribute("data-theme") === "dark");
    await shot("advanced-home-dark");
    await menu.click(); await page.getByRole("group", { name: "Kern 外观", exact: true }).getByRole("button", { name: "浅色", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await shot("advanced-home-mobile");
    console.log("PASS advanced skin mounted on real /muse, real-count chart, persisted dark appearance and mobile layout");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await prisma.kernMissionEvent.deleteMany({ where: { organizationId: org.id } });
    await prisma.auditEvent.deleteMany({ where: { actorId: user.id } });
    await prisma.agentTask.deleteMany({ where: { organizationId: org.id } });
    await prisma.message.deleteMany({ where: { conversationId: conversation.id } });
    await prisma.conversation.delete({ where: { id: conversation.id } });
    await prisma.agent.delete({ where: { id: agent.id } });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.$disconnect();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
