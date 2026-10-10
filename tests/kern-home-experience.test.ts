import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { generateDailyBriefing } from "../src/modules/assistant-runtime/capabilities/daily-briefing";
import { buildActivePushMessage, generateActivePush } from "../src/modules/assistant-runtime/capabilities/active-push";
import { briefingDraft, briefingPercent, briefingRatio, isDailyBriefingSnapshot } from "../src/app/muse/briefing-summary";

const INPUT = { organizationId: "ux-test-org", userId: "ux-test-user" };
const project = (overrides: Record<string, unknown> = {}) => ({
  id: "ux-test-project", title: "真实记录中的项目标题", evidences: [], workItems: [], decisionPackets: [], ...overrides,
});
const database = (projects: ReturnType<typeof project>[]) => ({
  project: { findMany: async () => projects, findFirst: async () => projects[0] || null },
});
const read = (path: string) => fs.readFileSync(path, "utf8");

test("没有项目时不冒充示例项目、建议或低可信风险", async () => {
  const data = await generateDailyBriefing(INPUT, database([]));
  assert.equal(data.projectCount, 0);
  assert.equal(data.projectTitle, undefined);
  assert.equal(data.projectId, undefined);
  assert.equal(data.risks, 0);
  assert.equal(data.gaps, 0);
  assert.deepEqual(data.suggestions, []);
  assert.equal(isDailyBriefingSnapshot(data), true);
});

test("已存在但尚无证据和工作项的项目，不判成失败", async () => {
  const data = await generateDailyBriefing(INPUT, database([project()]));
  assert.equal(data.projectTitle, "真实记录中的项目标题");
  assert.equal(data.projectCount, 1);
  assert.equal(data.totalWork, 0);
  assert.equal(data.totalEvidence, 0);
  assert.equal(data.risks, 0);
  assert.equal(briefingRatio(data.doneWork, data.totalWork), "—");
  assert.equal(briefingPercent(data.doneWork, data.totalWork), "尚无记录");
  assert.ok(data.suggestions.every((text) => !/已调度|8元|80℃|预计今日|可进入/.test(text)));
});

test("组织聚合中的未核实证据准确计数，不被截成四条", async () => {
  const data = await generateDailyBriefing(INPUT, database([
    project({ evidences: [{ verifyStatus: "VERIFIED" }, ...Array.from({ length: 6 }, () => ({ verifyStatus: "UNVERIFIED" }))] }),
  ]));
  assert.equal(data.gaps, 6);
  assert.equal(data.totalEvidence, 7);
  assert.equal(data.verifiedCount, 1);
  assert.ok(data.suggestions.includes("核实 6 条尚未核实的证据"));
});

test("单项目查询保留 organizationId 隔离且项目不存在时保持空", async () => {
  let where: unknown;
  const data = await generateDailyBriefing({ ...INPUT, projectId: "missing-project" }, {
    project: { findFirst: async (args: { where: unknown }) => { where = args.where; return null; } },
  });
  assert.deepEqual(where, { id: "missing-project", organizationId: INPUT.organizationId });
  assert.equal(data.projectCount, 0);
  assert.equal(data.scopeLabel, "当前项目");
  assert.deepEqual(data.suggestions, []);
});

test("默认简报明确是最近五个项目的读取口径，不冒充组织全量", async () => {
  let query: Record<string, unknown> | undefined;
  const data = await generateDailyBriefing(INPUT, {
    project: { findMany: async (args: Record<string, unknown>) => { query = args; return [project(), project({ id: "second-project", title: "另一个项目" })]; } },
  });
  assert.equal(query?.take, 5);
  assert.deepEqual(query?.orderBy, { updatedAt: "desc" });
  assert.deepEqual(query?.where, { organizationId: INPUT.organizationId });
  assert.equal(data.projectCount, 2);
  assert.equal(data.projectTitle, "2 个项目概览");
  assert.equal(data.projectId, undefined);
  assert.ok(data.scopeLabel.includes("非组织全量"));
});

test("完成仅指已验收；未完成不被描述为正在执行", async () => {
  const data = await generateDailyBriefing(INPUT, database([project({
    workItems: [{ status: "ACCEPTED" }, { status: "TODO" }, { status: "SUBMITTED" }],
    decisionPackets: [{ status: "IN_REVIEW" }, { status: "APPROVED" }],
  })]));
  assert.equal(data.doneWork, 1);
  assert.equal(data.totalWork, 3);
  assert.equal(data.todos, 2);
  assert.equal(data.decisions, 1);
  assert.equal(data.workRate, 33);
  assert.ok(data.suggestions.includes("梳理 2 项未完成工作和负责人"));
});

test("记忆偏好只影响当前建议，不污染后续请求或给空项目造建议", async () => {
  const one = await generateDailyBriefing({ ...INPUT, memories: [{ kind: "CORRECTION", content: "先核实来源" }] }, database([project()]));
  const two = await generateDailyBriefing(INPUT, database([project()]));
  assert.ok(one.suggestions.some((text) => text.includes("先核实来源")));
  assert.ok(two.suggestions.every((text) => !text.includes("先核实来源")));
  const empty = await generateDailyBriefing({ ...INPUT, memories: [{ kind: "PREFERENCE", content: "低预算" }] }, database([]));
  assert.deepEqual(empty.suggestions, []);
});

test("数据库读取失败向上报告，不能降级为成功的假简报", async () => {
  await assert.rejects(generateDailyBriefing(INPUT, {
    project: { findMany: async () => { throw new Error("database unavailable"); } },
  }), /database unavailable/);
});

test("比值呈现明确区分零分母与真实零进度", () => {
  assert.equal(briefingRatio(0, 0), "—");
  assert.equal(briefingPercent(0, 0), "尚无记录");
  assert.equal(briefingRatio(0, 5), "0/5");
  assert.equal(briefingPercent(0, 5), "0%");
  assert.equal(briefingPercent(3, 4), "75%");
});

test("合法的项目简报可以被读取", async () => {
  const data = await generateDailyBriefing(INPUT, database([project()]));
  assert.equal(isDailyBriefingSnapshot(JSON.parse(JSON.stringify(data))), true);
});

for (const [key, value] of [
  ["todos", -1], ["totalEvidence", "10"], ["projectCount", Number.NaN],
  ["workRate", Number.POSITIVE_INFINITY], ["evidenceRate", 101], ["generatedAt", "not-a-date"],
  ["suggestions", [42]], ["projectTitle", ""], ["scopeLabel", null],
] as const) {
  test(`异常简报字段 ${key} 不会被当作真实统计`, async () => {
    const data = await generateDailyBriefing(INPUT, database([project()]));
    assert.equal(isDailyBriefingSnapshot({ ...data, [key]: value }), false);
  });
}

test("不能验收或核实比总数更多的记录", async () => {
  const data = await generateDailyBriefing(INPUT, database([project()]));
  assert.equal(isDailyBriefingSnapshot({ ...data, doneWork: 1, totalWork: 0 }), false);
  assert.equal(isDailyBriefingSnapshot({ ...data, verifiedCount: 2, totalEvidence: 1 }), false);
});

test("空项目口径不能夹带非零统计", async () => {
  const data = await generateDailyBriefing(INPUT, database([]));
  assert.equal(isDailyBriefingSnapshot({ ...data, todos: 3 }), false);
});

test("建议交接生成可审查草稿，不伪造已执行回执", async () => {
  const data = await generateDailyBriefing(INPUT, database([project()]));
  const draft = briefingDraft(data, "补充证据");
  assert.ok(draft.includes(data.projectTitle!));
  assert.ok(draft.includes("补充证据"));
  assert.ok(draft.includes("缺失信息和下一步计划"));
  assert.equal(/已执行|已调度/.test(draft), false);
});

test("首页先显示入口，再显示折叠简报，并直接接入 prefill", () => {
  const client = read("src/app/muse/muse-client.tsx");
  assert.ok(client.indexOf("<Blank seeds=") < client.indexOf("<DailyBriefing onAction="));
  assert.ok(client.includes("<DailyBriefing onAction={prefill}"));
  assert.ok(client.includes("onSeed={prefill}"));
  assert.ok(client.includes("if (text.trim()) updateDraft(current ?"));
  assert.ok(client.includes("runtimeConnected={runtime.connected}"));
});

test("简报请求有取消与重试，不再有 mock fallback 或无人接收的事件", () => {
  const source = read("src/app/muse/components/daily-briefing.tsx");
  assert.ok(source.includes("new AbortController()"));
  assert.ok(source.includes("controller.abort()"));
  assert.ok(source.includes("controller.signal.aborted"));
  assert.ok(source.includes('cache: "no-store"'));
  assert.ok(source.includes("setRetry"));
  assert.equal(/fallback mock|kern-daily-action|console\.log|多酚软糖|todos: 3/.test(source), false);
});

test("更多工具保留全部入口，并在 Escape 与点击外部时收起", () => {
  const source = read("src/app/muse/components/conversation-tools.tsx");
  for (const kind of ["memory", "vault", "connectors", "schedules", "trail"]) assert.ok(source.includes(`kind: "${kind}"`));
  assert.ok(source.includes('event.key !== "Escape"'));
  assert.ok(source.includes('document.addEventListener("pointerdown"'));
  assert.ok(source.includes('querySelector("summary")?.focus()'));
  assert.equal(source.includes('role="menu"'), false);
  assert.ok(source.includes("onCopy"));
  assert.ok(read("src/app/muse/muse-client.tsx").includes("onCopy={conversation && messages.length > 0"));
});

test("输入区按真实高度预留空间，视角与目标模板保留按钮语义", () => {
  const shell = read("src/app/muse/components/shell.tsx");
  assert.ok(shell.includes("new ResizeObserver(measure)"));
  assert.ok(shell.includes('setProperty("--m-dock-space"'));
  assert.ok(shell.includes("!modelReady"));
  const role = read("src/app/muse/components/kern-role-bar.tsx");
  assert.ok(role.includes("aria-pressed={role === view.role}"));
  assert.ok(role.includes('source === "memory" ? "记忆偏好"'));
  const kit = read("src/components/kx/index.tsx");
  assert.ok(kit.includes('className="kx-bento" role="group"'));
  assert.equal(kit.includes('role="listitem"'), false);
});

test("首次使用同时检查产品和独立项目；告警仍位于开始入口前", () => {
  const source = read("src/app/workbench-client.tsx");
  assert.ok(source.includes("overview.portfolio.productCount === 0 && overview.portfolio.projectCount === 0"));
  assert.ok(source.indexOf('className="kx-wb-setup-notice"') < source.indexOf('className="hermes-onboarding kx-wb-start"'));
  assert.ok(source.includes("showWarnings = !isFirstUse && warnItems.length > 0"));
  assert.ok(source.includes("showNeeds = !isFirstUse || ranked.total > 0"));
  assert.ok(source.includes("showCompleted = overview.recentlyCompleted.count > 0"));
  assert.ok(source.includes("最近 {workforceActivity.windowHours} 小时记录"));
});


test("空简报的主动推送文案不拼入 undefined、风险或假建议", async () => {
  const data = await generateDailyBriefing(INPUT, database([]));
  const message = buildActivePushMessage(data);
  assert.ok(message.title.includes("尚未创建项目"));
  assert.ok(message.body.includes("尚未创建项目"));
  assert.equal(/undefined|证据可信度|0\/0/.test(message.body + message.title), false);
  assert.equal(message.level, "info");
});

test("有项目但没有新增建议时，通知文案明确结束而不是凭空生成推进建议", async () => {
  const data = await generateDailyBriefing(INPUT, database([project({
    evidences: [{ verifyStatus: "VERIFIED" }], workItems: [{ status: "ACCEPTED" }],
  })]));
  assert.deepEqual(data.suggestions, []);
  const message = buildActivePushMessage(data, "ux-test-project");
  assert.ok(message.body.includes("已核实证据 1/1"));
  assert.ok(message.body.includes("本次没有新增建议"));
  assert.equal(message.link, "/projects/ux-test-project");
  assert.equal(/undefined|可信度|已调度/.test(message.body), false);
});

test("主动推送的个性化不会给空项目添出 undefined 建议", async () => {
  const data = await generateActivePush(INPUT, database([]), [{ kind: "PREFERENCE", content: "偏好保健食品" }]);
  assert.deepEqual(data.briefing.suggestions, []);
  assert.equal(data.briefing.projectTitle, undefined);
  assert.ok(data.pushResults.every((result) => !result.detail?.includes("undefined")));
});


test("降级读取的零计数不宣称没有产品、首次使用或要求创建第一个产品", () => {
  const source = read("src/app/workbench-client.tsx");
  assert.ok(source.includes("hasKnownEmptyWorkspace = isFirstUse && !overview.degraded"));
  assert.ok(source.includes('hasKnownEmptyWorkspace ? "尚未创建产品" : "信息暂未完整更新"'));
  assert.ok(source.includes('hasKnownEmptyWorkspace ? "第一次使用，三步就够了" : "从一个清晰的目标继续"'));
  assert.ok(source.includes("hasKnownEmptyWorkspace ? FIRST_PRODUCT_DRAFT : CONTINUE_PRODUCT_DRAFT"));
  assert.ok(source.includes("请先确认目标与已有项目"));
});
