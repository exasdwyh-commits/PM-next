/**
 * KX-72 任务契约：纯函数单测。
 * 生成 → 自动检查 → 按条复核 → 打回反馈 / 全部通过；契约 Markdown 交接格式。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNewProductMissionPlan, initialMissionState } from "@/modules/supervisor/plan";
import {
  applyContractReview,
  buildTaskContract,
  checkTaskContract,
  contractAccepted,
  contractMarkdown,
  reviewFeedback,
  AUTO_CRITERIA,
} from "@/modules/supervisor/contract";

const plan = buildNewProductMissionPlan("做一款智能宠物喂食器\n\n已确认的约束：\n- 主要卖给谁：城市年轻白领");

test("生成契约：结果 / 输入 / 产出 / 完成标准（自动 + 人工）/ 审批门 / 能力", () => {
  const c = buildTaskContract({
    plan,
    answers: [{ question: "主要卖给谁", answer: "城市年轻白领" }],
    playbookName: "新品评估",
    capabilities: ["知识库检索", "网页检索", "知识库检索"],
  });
  assert.equal(c.version, "kern-task-contract/v1");
  assert.equal(c.expectedResult, "做一款智能宠物喂食器");
  assert.deepEqual(c.inputs, ["主要卖给谁：城市年轻白领", "套用做法「新品评估」"]);
  assert.ok(c.deliverables[0].startsWith("综合结论（"));
  assert.equal(c.frequency.kind, "once");
  const auto = c.acceptance.filter((a) => a.check === "auto");
  const human = c.acceptance.filter((a) => a.check === "human");
  assert.equal(auto.length, 4, "关键步骤 / QA / 分节 / 事实标注");
  assert.equal(human.length, plan.successCriteria.length);
  assert.ok(c.acceptance.every((a) => a.status === "PENDING"));
  assert.ok(c.approvalGates.length > 0 && c.approvalGates.every((g) => !/^[A-Z_]+$/.test(g)), "审批门用中文标签，不是 id");
  assert.deepEqual(c.capabilities, ["知识库检索", "网页检索"], "能力去重");
  assert.equal(buildTaskContract({ plan, cron: "0 9 * * 1" }).frequency.kind, "recurring");
});

test("自动检查：全部成功 + 分节齐全 → PASS；缺分节 / QA 未过 → FAIL 并带证据", () => {
  const c = buildTaskContract({ plan });
  const state = initialMissionState(plan);
  for (const n of plan.nodes) state.nodes[n.key] = { ...state.nodes[n.key], status: "SUCCEEDED" };
  const qa = plan.nodes.find((n) => n.kind === "QA")!;
  state.nodes[qa.key].qa = { verdict: "PASS", issues: [] };
  const good = "推荐做「A」\n## 结论与建议\n…\n## 关键依据\n- 事实：…\n## 待验证与下一步\n## 主要风险\n## 需要你决定的事";
  const ok = checkTaskContract(c, plan, state, good);
  assert.ok(ok.acceptance.filter((a) => a.check === "auto").every((a) => a.status === "PASS"), JSON.stringify(ok.acceptance));
  assert.ok(ok.acceptance.filter((a) => a.check === "human").every((a) => a.status === "PENDING"), "人工项不动");

  const badState = JSON.parse(JSON.stringify(state)) as typeof state;
  badState.nodes[qa.key].qa = { verdict: "REVISE", issues: [{ target: null, problem: "数据过期" }] };
  const bad = checkTaskContract(c, plan, badState, "## 结论与建议\n只有一节");
  const by = (id: string) => bad.acceptance.find((a) => a.id === id)!;
  assert.equal(by(AUTO_CRITERIA.QA_PASS.id).status, "FAIL");
  assert.match(by(AUTO_CRITERIA.QA_PASS.id).note ?? "", /REVISE/);
  assert.equal(by(AUTO_CRITERIA.SECTIONS.id).status, "FAIL");
  assert.match(by(AUTO_CRITERIA.SECTIONS.id).note ?? "", /关键依据/);
  assert.equal(by(AUTO_CRITERIA.EVIDENCE_TAGS.id).status, "FAIL");
  assert.equal(by(AUTO_CRITERIA.CRITICAL_DONE.id).status, "PASS");
});

test("按条复核：未提到的人工项默认通过；打回项生成重跑反馈；全通过则契约成立", () => {
  const c = buildTaskContract({ plan });
  const humanIds = c.acceptance.filter((a) => a.check === "human").map((a) => a.id);
  const r1 = applyContractReview(c, [{ id: humanIds[0], pass: false, note: "没有给出价格区间" }], { userId: "u1", at: "2026-09-29T00:00:00Z" });
  assert.equal(r1.rejected.length, 1, "只有被打回的那条算 FAIL；未检查的自动项保持 PENDING");
  assert.ok(!contractAccepted(r1.contract));
  assert.equal(r1.contract.reviews.length, 1);
  assert.equal(r1.contract.reviews[0].round, 1);
  const fb = reviewFeedback(r1.rejected);
  assert.match(fb, /1\. .*没有给出价格区间/);

  // 自动项先 PASS，再全部通过。
  const checked = { ...c, acceptance: c.acceptance.map((a) => (a.check === "auto" ? { ...a, status: "PASS" as const } : a)) };
  const r2 = applyContractReview(checked, [], { userId: "u1", at: "2026-09-29T00:00:01Z" });
  assert.equal(r2.rejected.length, 0);
  assert.ok(contractAccepted(r2.contract));
  // 自动 FAIL 的项用户不能标成通过。
  const failedAuto = { ...c, acceptance: c.acceptance.map((a) => (a.id === AUTO_CRITERIA.SECTIONS.id ? { ...a, status: "FAIL" as const } : a)) };
  const r3 = applyContractReview(failedAuto, [{ id: AUTO_CRITERIA.SECTIONS.id, pass: true }], { userId: "u1", at: "2026-09-29T00:00:02Z" });
  assert.equal(r3.contract.acceptance.find((a) => a.id === AUTO_CRITERIA.SECTIONS.id)!.status, "FAIL");
});

test("交接格式：Markdown 含全部栏目与勾选状态", () => {
  const c = buildTaskContract({ plan, capabilities: ["网页检索"] });
  const md = contractMarkdown({ ...c, acceptance: c.acceptance.map((a, i) => ({ ...a, status: i === 0 ? "PASS" : i === 1 ? "FAIL" : "PENDING" })) });
  for (const h of ["## 任务契约", "**要的结果**", "**输入**", "**产出**", "**完成标准**", "**约束**", "**需要先问你的事**", "**会用到的能力**"]) assert.ok(md.includes(h), h);
  assert.ok(md.includes("- [x] ") && md.includes("- [!] ") && md.includes("- [ ] "));
  assert.ok(md.includes("- 网页检索"));
});
