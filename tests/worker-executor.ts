/**
 * Digital Employee Executor + 统一 Worker 回归。
 *
 * 覆盖评审要求的三件事：
 * 1. 五个 specialist **全部**有合法 executor strategy（只做 research/scientific
 *    两个不可能让五路任务全部自动终结）；
 * 2. 没有真实数据的任务必须「诚实 BLOCKED + 精确 missingInputs + DataGap 落库」，
 *    而不是让模型编一个看起来专业的数字；
 * 3. 关掉浏览器后链路仍能推进：ResearchRun 自主发布 → 专家任务自动终结 →
 *    QA 自动排队 → （QA 独立完成后）报告落盘，且报告的 unknowns 明确列出缺什么。
 *
 * 另外覆盖 executorLease 的崩溃恢复与 fencing（旧 owner 不能删新 owner 的租约）
 * 和 Worker 单实例文件锁。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AgentTaskStatus,
  OrgRole,
  ResearchRunStatus,
  Role,
} from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import {
  bootstrapDefaultWorkforce,
  finishAgentTask,
  startAgentTask,
} from "../src/modules/workforce/service";
import { startProductRndProgram } from "../src/modules/product-rnd";
import {
  EXECUTOR_STRATEGIES,
  executeAgentTask,
  executorStrategyCodes,
} from "../src/modules/worker/executor";
import {
  claimAgentTaskForExecution,
  hasLiveExecutorLease,
  releaseAgentTaskClaim,
} from "../src/modules/worker/claim";
import {
  executorLoopOnce,
  reconcileLoopOnce,
  researchLoopOnce,
} from "../src/modules/worker/loops";
import { resolveWorkerSession } from "../src/modules/worker/identity";
import { acquireWorkerLock, releaseWorkerLock } from "../src/modules/worker";
import { enqueueKernSpecialistDispatch } from "../src/modules/assistant-runtime/specialist-dispatch";
import { appendAgentTaskConversationReturn } from "../src/modules/workforce/conversation-return";

const SPECIALIST_CODES = [
  "research_agent",
  "scientific_evidence_agent",
  "formulation_agent",
  "compliance_agent",
  "cost_bom_agent",
];

async function main() {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error("Explicit test database required");
  }
  await assertTestDatabaseSafety(prisma);

  const tag = randomUUID();
  const lockDir = path.join(os.tmpdir(), `pm-worker-lock-${tag}`);
  process.env.PM_WORKER_LOCK_DIR = lockDir;

  const org = await prisma.organization.create({
    data: { name: "Digital Employee Executor Test", code: "WEX_" + tag },
  });
  const owner = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: `wex-${tag}@hermes.test`,
      name: "Worker Executor Owner",
    },
  });
  await prisma.organizationMember.create({
    data: { organizationId: org.id, userId: owner.id, role: OrgRole.ORG_ADMIN },
  });
  const session = {
    userId: owner.id,
    organizationId: org.id,
    userEmail: owner.email,
    userName: owner.name,
  };

  try {
    console.log("▶ W1 策略表完整性：五个 specialist 必须全部有 executor strategy");
    for (const code of SPECIALIST_CODES) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(EXECUTOR_STRATEGIES, code),
        `${code} must have an executor strategy`
      );
    }
    assert.ok(
      executorStrategyCodes().includes("tech_architect_agent"),
      "Tech Architect must have a real worker executor contract before AUTO is considered"
    );
    // QA 刻意不在表里：独立性要求「执行者不得自证」，Worker 不得代跑 QA。
    assert.equal(
      executorStrategyCodes().includes("qa_verifier"),
      false,
      "qa_verifier must NOT be executed by the worker (independence)"
    );
    console.log(`✅ 策略表完整：${executorStrategyCodes().join(", ")}`);

    await bootstrapDefaultWorkforce(session);

    console.log("▶ W1b Kern AUTO 回传：幂等排队 + safe-off + 回原会话");
    const conversation = await prisma.conversation.create({
      data: {
        organizationId: org.id,
        ownerId: owner.id,
        kind: "ADVISOR",
        title: "Kern specialist return test",
      },
    });
    const sourceRun = await prisma.agentRun.create({
      data: {
        organizationId: org.id,
        conversationId: conversation.id,
        userId: owner.id,
        goal: "Kern source conversation run",
      },
    });
    const fakeReady = {
      version: "kern-dispatch-readiness/v1" as const,
      eligible: true,
      state: "EXECUTOR_READY" as const,
      executor: "WORKER" as const,
      agentCode: "tech_architect_agent",
      taskClass: "CODING" as const,
      reason: "test-only ready contract",
    };
    const dispatchArgs = {
      session,
      conversationId: conversation.id,
      sourceRunId: sourceRun.id,
      goal: "审查当前 API 架构并给出测试策略；不要执行任何代码修改。",
      readiness: fakeReady,
    };
    const [firstDispatch, secondDispatch] = await Promise.all([
      enqueueKernSpecialistDispatch(dispatchArgs),
      enqueueKernSpecialistDispatch(dispatchArgs),
    ]);
    assert.ok(firstDispatch);
    assert.ok(secondDispatch);
    const dispatch = firstDispatch.created ? firstDispatch : secondDispatch;
    const replay = firstDispatch.created ? secondDispatch : firstDispatch;
    assert.equal(
      Number(firstDispatch.created) + Number(secondDispatch.created),
      1,
      "concurrent replay must create exactly one AgentTask"
    );
    assert.equal(dispatch.status, AgentTaskStatus.QUEUED);
    assert.equal(replay.created, false);
    assert.equal(replay.taskId, dispatch.taskId);
    assert.equal(
      await prisma.agentTask.count({
        where: { organizationId: org.id, triggerRef: dispatch.triggerRef },
      }),
      1,
      "same source run must not create duplicate specialist tasks"
    );

    const techOutcome = await executeAgentTask(session, dispatch.taskId);
    assert.equal(techOutcome.executed, true);
    assert.equal(techOutcome.outcome, "BLOCKED");

    const blockedTech = await prisma.agentTask.findUniqueOrThrow({
      where: { id: dispatch.taskId },
      include: { runs: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    assert.equal(blockedTech.status, AgentTaskStatus.BLOCKED);
    assert.match(blockedTech.runs[0]?.outputSummary ?? "", /Tech Architect 未执行/);

    const returnedMessages = await prisma.message.findMany({
      where: { conversationId: conversation.id, role: "ASSISTANT" },
      orderBy: { createdAt: "asc" },
    });
    assert.equal(returnedMessages.length, 1);
    assert.match(returnedMessages[0].content, /Kern 顾问团回执/);
    assert.match(returnedMessages[0].content, /Tech Architect 未执行/);

    const repeatedReturn = await appendAgentTaskConversationReturn({
      organizationId: org.id,
      taskId: dispatch.taskId,
      runId: blockedTech.runs[0].id,
      outcome: "BLOCKED",
      summary: blockedTech.runs[0].outputSummary ?? "blocked",
    });
    assert.equal(repeatedReturn?.created, false);
    assert.equal(
      await prisma.message.count({
        where: { conversationId: conversation.id, role: "ASSISTANT" },
      }),
      1,
      "conversation return must be idempotent"
    );
    console.log("✅ Kern specialist 排队幂等；无模型诚实 BLOCKED；回执只回写一次");

    console.log("▶ W1c Generic Agent Executor：Kern 派发的 product_agent 走通用契约；非 Kern 任务不被 Worker 代跑");
    const productAgent = await prisma.agent.findFirstOrThrow({
      where: { organizationId: org.id, code: "product_agent" },
      select: { id: true },
    });
    const plainProductTask = await prisma.agentTask.create({
      data: {
        organizationId: org.id,
        agentId: productAgent.id,
        goal: "非 Kern 派发的 product_agent 任务（应保持人工/编排语义）",
        status: AgentTaskStatus.QUEUED,
        contextSnapshot: { schemaVersion: "some-other-flow/v1" },
      },
    });
    const plainSkip = await executeAgentTask(session, plainProductTask.id);
    assert.equal(plainSkip.executed, false);
    assert.equal(plainSkip.skippedReason, "no-strategy");

    const productSourceRun = await prisma.agentRun.create({
      data: {
        organizationId: org.id,
        conversationId: conversation.id,
        userId: owner.id,
        goal: "Kern source run for product agent",
      },
    });
    const productDispatch = await enqueueKernSpecialistDispatch({
      session,
      conversationId: conversation.id,
      sourceRunId: productSourceRun.id,
      goal: "帮我梳理这个新品的价值主张和定位选项。",
      readiness: {
        ...fakeReady,
        agentCode: "product_agent",
        taskClass: "PRODUCT_ANALYSIS" as const,
      },
    });
    assert.ok(productDispatch?.created);
    const loopResult = await executorLoopOnce({ organizationId: org.id, limit: 5 });
    assert.ok(
      (loopResult.notes ?? []).some((note) => note.startsWith("product_agent:BLOCKED")),
      "worker loop must pick up the Kern-dispatched product_agent task: " +
        JSON.stringify(loopResult)
    );
    const plainAfterLoop = await prisma.agentTask.findUniqueOrThrow({
      where: { id: plainProductTask.id },
    });
    assert.equal(plainAfterLoop.status, AgentTaskStatus.QUEUED, "non-Kern task must stay queued");
    const productTask = await prisma.agentTask.findUniqueOrThrow({
      where: { id: productDispatch!.taskId },
      include: { runs: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    assert.equal(productTask.status, AgentTaskStatus.BLOCKED);
    assert.match(productTask.runs[0]?.outputSummary ?? "", /Product Agent 未执行/);
    const productReturn = await prisma.message.findFirst({
      where: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: { contains: "Product Agent 未执行" },
      },
    });
    assert.ok(productReturn, "generic executor BLOCKED receipt must return to the Kern conversation");
    await prisma.agentTask.update({
      where: { id: plainProductTask.id },
      data: { status: AgentTaskStatus.CANCELLED },
    });
    console.log("✅ 通用执行器按契约 scope 执行；无模型诚实 BLOCKED 并回到原会话");

    const project = await prisma.project.create({
      data: {
        organizationId: org.id,
        title: "数字员工执行器测试项目",
        target: "验证五个 specialist 在无人工干预下自动终结",
        constraints: "none",
        ownerId: owner.id,
      },
    });
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: owner.id, role: Role.OWNER },
    });

    const program = await startProductRndProgram(session, {
      projectId: project.id,
      brief: "自动执行测试：验证 Worker 在无人值守下推进 Product R&D。",
    });
    const parentTaskId = program.parentTask.id;

    console.log("▶ W2 researchLoop：关掉浏览器后 ResearchRun 自主推进到 PUBLISHED");
    const researchResult = await researchLoopOnce({ organizationId: org.id });
    assert.ok(
      researchResult.acted >= 1,
      `research loop must advance the run: ${JSON.stringify(researchResult)}`
    );
    const publishedRun = await prisma.researchRun.findUnique({
      where: { id: program.researchRun.id },
      select: { status: true },
    });
    assert.equal(publishedRun?.status, ResearchRunStatus.PUBLISHED);
    console.log("✅ ResearchRun 自主发布");

    console.log("▶ W3 executorLoop：五路专家任务全部自动终结（含诚实 BLOCKED）");
    const executorResult = await executorLoopOnce({
      organizationId: org.id,
      limit: 10,
    });
    assert.equal(executorResult.errors, 0, JSON.stringify(executorResult.notes));
    const childTasks = await prisma.agentTask.findMany({
      where: { parentTaskId, agent: { code: { in: SPECIALIST_CODES } } },
      include: {
        agent: { select: { code: true } },
        runs: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    assert.equal(childTasks.length, 5);
    const byCode = new Map(childTasks.map((task) => [task.agent.code, task]));

    const stillRunning = childTasks.filter(
      (task) =>
        task.status === AgentTaskStatus.QUEUED ||
        task.status === AgentTaskStatus.RUNNING
    );
    assert.equal(
      stillRunning.length,
      0,
      "no specialist may be left QUEUED/RUNNING after executor loop"
    );

    assert.equal(byCode.get("research_agent")?.status, AgentTaskStatus.SUCCEEDED);
    for (const code of [
      "scientific_evidence_agent",
      "formulation_agent",
      "compliance_agent",
      "cost_bom_agent",
    ]) {
      assert.equal(
        byCode.get(code)?.status,
        AgentTaskStatus.BLOCKED,
        `${code} must be honestly BLOCKED without real data`
      );
    }
    for (const task of childTasks) {
      const summary = task.runs[0]?.outputSummary ?? "";
      assert.ok(
        summary.length > 0,
        `${task.agent.code} must produce an AgentRun outputSummary`
      );
    }
    console.log(
      `✅ 五路自动终结：${childTasks
        .map((task) => `${task.agent.code}=${task.status}`)
        .join(" ")}`
    );

    console.log("▶ W4 诚实缺省：无数据任务必须落 DataGap，且不产出任何编造数字");
    const gaps = await prisma.dataGap.findMany({
      where: { projectId: project.id },
      select: { fieldKey: true, description: true },
    });
    const gapKeys = new Set(gaps.map((gap) => gap.fieldKey));
    for (const expected of [
      "formulation_constraints",
      "cost_basis",
      "scientific_evidence",
      "regulatory_basis",
    ]) {
      assert.ok(gapKeys.has(expected), `missing DataGap: ${expected}`);
    }
    const costResult = await prisma.agentTask.findUnique({
      where: { id: byCode.get("cost_bom_agent")!.id },
      select: { contextSnapshot: true },
    });
    const costSnapshot = costResult?.contextSnapshot as unknown as Record<
      string,
      unknown
    >;
    const costExecutorResult = costSnapshot?.executorResult as Record<
      string,
      unknown
    >;
    assert.equal(costExecutorResult?.kind, "HONEST_BLOCKED");
    assert.ok(
      Array.isArray(costExecutorResult?.missingInputs) &&
        (costExecutorResult.missingInputs as unknown[]).length >= 3,
      "honest default must enumerate precise missing inputs"
    );
    console.log(
      `✅ DataGap ${gaps.length} 条，cost 任务产出 HONEST_BLOCKED 且无编造数字`
    );

    console.log("▶ W5 幂等：对已终结任务再跑一轮 executorLoop 不得重复执行");
    const secondRun = await executorLoopOnce({
      organizationId: org.id,
      limit: 10,
    });
    assert.equal(secondRun.acted, 0, JSON.stringify(secondRun.notes));
    const childCountAfter = await prisma.agentTask.count({
      where: { parentTaskId, agent: { code: { in: SPECIALIST_CODES } } },
    });
    assert.equal(childCountAfter, 5);
    console.log("✅ 重复执行被拒（第二 acted=0，任务数不变）");

    console.log("▶ W6 reconcileLoop：清掉 QA 与其 claim 后，Worker 能把它补排回来");
    await prisma.agentDelegation.deleteMany({
      where: { childTask: { parentTaskId, agent: { code: "qa_verifier" } } },
    });
    await prisma.agentTask.deleteMany({
      where: { parentTaskId, agent: { code: "qa_verifier" } },
    });
    await prisma.$executeRaw`
      UPDATE "AgentTask"
         SET "contextSnapshot" = COALESCE("contextSnapshot", '{}'::jsonb) - 'qaClaim'
       WHERE id = ${parentTaskId}
    `;
    const reconcileResult = await reconcileLoopOnce({ organizationId: org.id });
    assert.equal(reconcileResult.errors, 0, JSON.stringify(reconcileResult.notes));
    const qaTasks = await prisma.agentTask.findMany({
      where: { parentTaskId, agent: { code: "qa_verifier" } },
      include: { runs: true },
    });
    assert.equal(qaTasks.length, 1, "reconcile loop must queue exactly one QA");
    assert.equal(qaTasks[0].status, AgentTaskStatus.QUEUED);
    console.log(`✅ QA 自动排队：${qaTasks[0].id}`);

    console.log("▶ W7 executorLease：崩溃恢复 + fencing（旧 owner 不能删新租约）");
    const leaseTask = await prisma.agentTask.create({
      data: {
        organizationId: org.id,
        agentId: childTasks[0].agentId,
        // 刻意不挂到 Product R&D parent 上：这是一个纯租约回归用的合成任务，
        // 挂上去会让它成为「活跃 child」，阻塞报告合成。
        parentTaskId: null,
        goal: "executorLease 回归（合成任务）",
        status: AgentTaskStatus.QUEUED,
      },
    });
    const firstToken = await claimAgentTaskForExecution(leaseTask.id, org.id);
    assert.ok(firstToken, "fresh task must be claimable");
    assert.equal(
      await claimAgentTaskForExecution(leaseTask.id, org.id),
      null,
      "live lease must block a second claim"
    );
    // 崩溃：租约过期后必须可被重抢
    await prisma.$executeRaw`
      UPDATE "AgentTask"
         SET "contextSnapshot" = jsonb_set(
               COALESCE("contextSnapshot", '{}'::jsonb),
               '{executorLease}',
               ${JSON.stringify({
                 token: "stale-token",
                 claimedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
                 expiresAt: new Date(Date.now() - 20 * 60_000).toISOString(),
               })}::jsonb,
               true
             )
       WHERE id = ${leaseTask.id}
    `;
    const recoveredToken = await claimAgentTaskForExecution(leaseTask.id, org.id);
    assert.ok(recoveredToken, "expired lease must be re-claimable");
    assert.notEqual(recoveredToken, "stale-token");
    // fencing：旧 owner 的 release 不能删掉新 owner 的租约
    await releaseAgentTaskClaim(leaseTask.id, org.id, "stale-token");
    assert.equal(
      await hasLiveExecutorLease(leaseTask.id),
      true,
      "stale release must not clear the new owner lease"
    );
    await releaseAgentTaskClaim(leaseTask.id, org.id, recoveredToken);
    assert.equal(await hasLiveExecutorLease(leaseTask.id), false);
    console.log("✅ 过期可重抢 / 活跃不可抢 / 旧 token release 无效");

    console.log("▶ W8 单实例锁：已有活跃 Worker 时第二个进程必须拒绝启动");
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(
      path.join(lockDir, "lock.json"),
      JSON.stringify({
        workerId: "other-worker",
        pid: 1, // init 必然存活，模拟「另一个 Worker 正在跑」
        startedAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
      }),
      "utf8"
    );
    assert.equal(
      acquireWorkerLock("test-worker"),
      null,
      "must refuse to start when another worker holds a live lock"
    );
    // 陈旧锁（pid 不存在）必须可接管
    writeFileSync(
      path.join(lockDir, "lock.json"),
      JSON.stringify({
        workerId: "dead-worker",
        pid: 999_999,
        startedAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
      }),
      "utf8"
    );
    const takeover = acquireWorkerLock("test-worker");
    assert.ok(takeover, "stale lock (dead pid) must be takeable");
    releaseWorkerLock(takeover.workerId);
    console.log("✅ 活跃锁拒绝 / 陈旧锁接管");

    console.log("▶ W9 报告落盘：QA 独立完成后报告生成，unknowns 列清缺口");
    const qaTask = qaTasks[0];
    const qaStarted = await startAgentTask(session, qaTask.id);
    await finishAgentTask(session, qaTask.id, {
      runId: qaStarted.run.id,
      outcome: "SUCCEEDED",
      resultSummary: "独立 QA 完成（测试用独立身份执行，非 Worker）。",
    });
    const reportArtifact = await prisma.artifact.findFirst({
      where: {
        workItemId: program.workItem.id,
        type: "PRODUCT_RND_EXECUTIVE_REPORT",
      },
      orderBy: { contentVersion: "desc" },
    });
    assert.ok(reportArtifact, "executive report must be synthesized");
    const report = JSON.parse(reportArtifact.content) as {
      verificationStatus: string;
      unknowns: string[];
      risks: string[];
      sourceRefs: unknown[];
      advisoryNotes: Array<{ agentCode: string; summary: string | null }>;
    };
    assert.equal(report.verificationStatus, "READY_FOR_HUMAN_REVIEW");
    assert.ok(
      report.unknowns.some((item) => item.includes("配方")),
      "report must list the formulation gap"
    );
    assert.ok(
      report.unknowns.some((item) => item.includes("成本")),
      "report must list the cost gap"
    );
    assert.ok(
      report.advisoryNotes.some(
        (note) => note.agentCode === "research_agent" && note.summary
      ),
      "report must carry the research agent summary"
    );
    // 诚实守卫：本场景一条 Evidence 都没有绑定，报告不得呈现为「0 个未闭合项」的
    // 健康报告——必须显式登记「结论不可追溯」缺口，并给出对应风险。
    assert.equal(report.sourceRefs.length, 0, "本场景应零证据绑定");
    assert.ok(
      report.unknowns.some((item) => item.includes("未绑定任何结构化证据")),
      "零证据绑定时必须登记为未闭合项，不得显示成健康报告"
    );
    assert.ok(
      report.risks.length >= 1,
      "零证据绑定必须产生至少一条风险"
    );
    console.log(
      `✅ 报告落盘：unknowns=${report.unknowns.length} 项（含零证据守卫），risks=${report.risks.length}，verificationStatus=${report.verificationStatus}`
    );

    console.log("\n✅ Digital Employee Executor + Worker regression passed");
  } finally {
    const orgUsers = await prisma.user
      .findMany({ where: { organizationId: org.id }, select: { id: true } })
      .catch(() => [] as Array<{ id: string }>);
    const orgUserIds = orgUsers.map((row) => row.id);
    rmSync(lockDir, { recursive: true, force: true });
    await prisma.businessEvent
      .deleteMany({ where: { organizationId: org.id } })
      .catch(() => {});
    await prisma.workSubmission
      .deleteMany({ where: { workItem: { project: { organizationId: org.id } } } })
      .catch(() => {});
    await prisma.auditEvent
      .deleteMany({ where: { actorId: { in: orgUserIds } } })
      .catch(() => {});
    await prisma.researchRun
      .deleteMany({ where: { createdById: { in: orgUserIds } } })
      .catch(() => {});
    await prisma.agentRun
      .deleteMany({ where: { organizationId: org.id } })
      .catch(() => {});
    await prisma.analysisRun
      .deleteMany({ where: { organizationId: org.id } })
      .catch(() => {});
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => {});
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
