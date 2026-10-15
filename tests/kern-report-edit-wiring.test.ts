/**
 * 编辑步骤的生产接线回归（R1·report-quality/v1）
 * ==============================================
 * 单元测验证明「模块有界」，这份证明「它真的接在生成链上」：
 * 用真实任务链（launchKernMission → executorLoopOnce）跑一遍新产品研究报告，
 * 综合结论节点定稿时应当走一次有界编辑——
 *   - 编辑后更好：采用编辑结果（节点产出变成补齐后的正文）；
 *   - 编辑结果畸形：保留原稿，任务照常完成，不兜底成「已核实」。
 *
 * 造数统一走测试库（assertTestDatabaseSafety 三层校验），跑完清理组织。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import { OrgRole } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { bootstrapDefaultWorkforce } from "../src/modules/workforce/service";
import { beatWorker, markWorkerStopped } from "../src/modules/worker/heartbeat";
import { executorLoopOnce, reconcileLoopOnce } from "../src/modules/supervisor/worker-runtime";
import { setMissionModelInvokerForTest } from "../src/modules/supervisor/generic-executor";
import { buildNewProductMissionPlan } from "../src/modules/supervisor/plan";
import { getKernMissionStatus, launchKernMission } from "../src/modules/supervisor/service";

const NL = String.fromCharCode(10);
const lines = (...xs: string[]) => xs.join(NL);

const SHOT_GOAL =
  "好，其实我们想开发一款红参胶原蛋白肽女士奶粉，主打新疆三峰包奶源。目标人群35-55岁女性。预算大概10万以内。";

/** 八节不全：会被判为待补证草稿，才有自动补齐的余地。 */
const DRAFT_CONCLUSION = lines(
  "## 结论摘要",
  "**结论与建议**：先做小批验证「红参胶原蛋白肽女士奶粉」（推断）。",
  "## 产品定位",
  "面向 35-55 岁女性，主打新疆奶源（推断）。",
);

/** 编辑应当补齐到的样子：八节齐全、预算与人群覆盖、缺口带补齐方式。 */
const FIXED_CONCLUSION = lines(
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
);

const EDIT_SYSTEM_MARK = "你是研究报告编辑";
/** 只出现在补齐后的正文里，用来分辨「采用」还是「保留原稿」。 */
const FIXED_MARK = "验证计划与待决策";
const ORIGINAL_MARK = "## 产品定位";

async function runMissionOnce(mode: "adopt" | "reject") {
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID();
  const org = await prisma.organization.create({ data: { code: `EDITW_${tag}`, name: "Report edit wiring" } });
  const owner = await prisma.user.create({
    data: { organizationId: org.id, email: `${tag}@kern.test`, name: "Owner" },
  });
  await prisma.organizationMember.create({
    data: { organizationId: org.id, userId: owner.id, role: OrgRole.ORG_ADMIN },
  });
  const session = {
    organizationId: org.id,
    userId: owner.id,
    userEmail: owner.email,
    userName: owner.name,
  };
  let editCalls = 0;
  let modelCalls = 0;
  try {
    await bootstrapDefaultWorkforce(session);
    await beatWorker({ organizationId: org.id, loops: ["executor"], startedAt: new Date() }, true);
    setMissionModelInvokerForTest(async ({ agentCode, messages }) => {
      modelCalls++;
      const system = messages.find((message) => message.role === "system")?.content ?? "";
      if (system.includes(EDIT_SYSTEM_MARK)) {
        editCalls++;
        return { text: mode === "adopt" ? FIXED_CONCLUSION : "改好了。", provenance: { stub: true } };
      }
      // QA 必须给出可解析的判定，否则综合节点会被跳过（SYNTHESIS_SKIPPED）。
      if (agentCode === "qa_verifier") {
        return { text: '{"verdict":"PASS","issues":[],"summary":"抽查通过"}', provenance: { stub: true } };
      }
      return { text: agentCode === "hermes_pm" ? DRAFT_CONCLUSION : "专家结论（推断）", provenance: { stub: true } };
    });
    const chat = await prisma.conversation.create({
      data: { organizationId: org.id, ownerId: owner.id, title: `edit wiring ${mode}` },
    });
    const mission = await launchKernMission(session, {
      plan: buildNewProductMissionPlan(SHOT_GOAL),
      conversationId: chat.id,
      sourceRunId: randomUUID(),
    });
    for (let i = 0; i < 20; i++) {
      await executorLoopOnce({ organizationId: org.id, limit: 4 });
      await reconcileLoopOnce({ organizationId: org.id });
      if ((await getKernMissionStatus(session, mission.missionTaskId)).outcome) break;
    }
    const synth = await prisma.agentTask.findFirst({
      where: { organizationId: org.id, agent: { code: "hermes_pm" } },
      orderBy: { createdAt: "desc" },
      select: { contextSnapshot: true },
    });
    const snap = synth?.contextSnapshot as { executorResult?: { output?: unknown } } | null;
    if (process.env.DEBUG_WIRING === "1") {
      const st = await getKernMissionStatus(session, mission.missionTaskId);
      console.log(`[debug] 结局=${JSON.stringify(st.outcome)} 节点=${st.nodes.map((n) => `${n.key}/${n.kind}/${n.status}`).join(" ")}`);
      console.log(`[debug] 综合产出=${String((synth?.contextSnapshot as { executorResult?: { output?: unknown } } | null)?.executorResult?.output ?? "").slice(0, 120)}`);
      console.log(`[debug] 模型调用=${modelCalls} 编辑调用=${editCalls}`);
    }
    const finalStatus = await getKernMissionStatus(session, mission.missionTaskId);
    return {
      editCalls,
      outcomeStatus: finalStatus.outcome?.status ?? null,
      output: typeof snap?.executorResult?.output === "string" ? snap.executorResult.output : "",
    };
  } finally {
    setMissionModelInvokerForTest(null);
    await markWorkerStopped();
    const actors = await prisma.user.findMany({ where: { organizationId: org.id }, select: { id: true } });
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: actors.map((user) => user.id) } } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
}
test("接线守卫：执行器在综合结论定稿处调用有界编辑，且只对新产品研究报告生效", () => {
  const src = fs.readFileSync(new URL("../src/modules/supervisor/generic-executor.ts", import.meta.url), "utf8");
  assert.match(src, /autoFixMissionReport/, "执行器必须调用有界编辑");
  assert.ok(
    src.indexOf('node.kind === "SYNTHESIS"') < src.lastIndexOf("autoFixMissionReport"),
    "编辑必须限定在综合结论节点，不能改写专家节点的原始产出（比较对象是调用点，不是文件顶部的导入）",
  );
  assert.match(src, /playbook === "NEW_PRODUCT"/, "不得把新产品八节契约套用到其他剧本");
});

test("编辑后更好：真实任务链里采用补齐后的正文（生产调用接线）", async () => {
  const { editCalls, outcomeStatus, output } = await runMissionOnce("adopt");
  assert.equal(editCalls, 1, `有界编辑应当恰好调用一次模型，实际 ${editCalls} 次`);
  assert.equal(outcomeStatus, "COMPLETED", "采用补齐正文后任务应当正常完成");
  assert.ok(output.includes(FIXED_MARK), `综合结论应采用补齐后的正文，实际产出：${output.slice(0, 200)}`);
});

test("编辑结果畸形：保留原稿，任务照常完成，不兜底成已核实", async () => {
  const { editCalls, outcomeStatus, output } = await runMissionOnce("reject");
  assert.equal(editCalls, 1, `畸形分支也应当恰好尝试一次编辑，实际 ${editCalls} 次`);
  assert.equal(outcomeStatus, "COMPLETED", "畸形编辑结果也应当保留原稿并正常完成");
  assert.ok(!output.includes(FIXED_MARK), "畸形编辑结果不能被采用");
  assert.ok(output.includes(ORIGINAL_MARK), `应保留原稿，实际产出：${output.slice(0, 200)}`);
  assert.doesNotMatch(output, /已核实/, "任何情况下都不能把没修好的内容写成已核实");
});

test.after(async () => {
  await prisma.$disconnect();
});

