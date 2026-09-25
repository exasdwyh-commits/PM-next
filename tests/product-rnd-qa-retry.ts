/**
 * QA crash-safe lease + retry attempt 回归。
 *
 * 背景（评审发现的两处边界，2026-09-25）：
 * 1. v1 的 qaClaim 只是裸 "claimed" 占位，没有 token/expiresAt。进程在「抢占成功、
 *    创建 QA 前」崩溃时 catch 不执行，claim 永久残留，之后 queue 永远 Conflict。
 *    → v2 改为带 expiresAt 的 lease，过期可重抢。
 * 2. queueProductRndQa 曾对任何已有 qa_verifier 直接 return existing，而 advance
 *    的 BLOCKED_BY_QA 分支写着 "human review or QA retry is required" —— 实际上
 *    没有任何 retry 路径：QA FAILED 后永远拿回失败的那个。
 *    → 现在只有「当前有效 attempt」可复用；FAILED/BLOCKED/CANCELLED 允许排队
 *      attempt N+1，报告合成/advance 一律取最新 attempt。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AgentTaskStatus, OrgRole, Role } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import {
  bootstrapDefaultWorkforce,
  finishAgentTask,
  startAgentTask,
} from "../src/modules/workforce/service";
import {
  advanceProductRndProgram,
  queueProductRndQa,
  startProductRndProgram,
} from "../src/modules/product-rnd";
import { runResearchRunTasks } from "../src/modules/research/research-run";

async function main() {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error("Explicit test database required");
  }
  await assertTestDatabaseSafety(prisma);

  const tag = randomUUID();
  const org = await prisma.organization.create({
    data: { name: "Product R&D QA Retry Test", code: "PRDR_" + tag },
  });
  const owner = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: `prdr-${tag}@hermes.test`,
      name: "QA Retry Owner",
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
    await bootstrapDefaultWorkforce(session);

    const project = await prisma.project.create({
      data: {
        organizationId: org.id,
        title: "QA retry 与 crash lease 测试项目",
        target: "验证 QA FAILED 后可 retry、崩溃 lease 可恢复",
        constraints: "none",
        ownerId: owner.id,
      },
    });
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: owner.id, role: Role.OWNER },
    });

    const program = await startProductRndProgram(session, {
      projectId: project.id,
      brief: "QA retry 语义测试：FAILED 后允许 attempt N+1。",
    });
    const parentTaskId = program.parentTask.id;

    console.log("▶ QA-R1 完成五个专家任务 + ResearchRun");
    for (const item of program.specialistTasks) {
      const started = await startAgentTask(session, item.task.id);
      if (item.code === "research_agent") {
        await runResearchRunTasks(program.researchRun.id);
      }
      await finishAgentTask(session, item.task.id, {
        runId: started.run.id,
        outcome: "SUCCEEDED",
        resultSummary: `${item.label}已完成。`,
      });
    }

    console.log("▶ QA-R2 清掉自动排队的 QA，模拟「claim 后进程崩溃」：写一个已过期的 lease 占位");
    await prisma.agentDelegation.deleteMany({
      where: {
        childTask: { parentTaskId, agent: { code: "qa_verifier" } },
      },
    });
    await prisma.agentTask.deleteMany({
      where: { parentTaskId, agent: { code: "qa_verifier" } },
    });
    const expiredClaim = JSON.stringify({
      token: randomUUID(),
      claimedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      expiresAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    });
    await prisma.$executeRaw`
      UPDATE "AgentTask"
         SET "contextSnapshot" = jsonb_set(
               COALESCE("contextSnapshot", '{}'::jsonb),
               '{qaClaim}',
               ${expiredClaim}::jsonb,
               true
             )
       WHERE id = ${parentTaskId}
    `;

    console.log("▶ QA-R3 过期 lease 必须可重抢：queue 成功创建 attempt 1");
    const attempt1 = await queueProductRndQa(session, { parentTaskId });
    assert.equal(attempt1.created, true, "expired lease must be re-claimable");
    const qaCountAfterCrash = await prisma.agentTask.count({
      where: { parentTaskId, agent: { code: "qa_verifier" } },
    });
    assert.equal(qaCountAfterCrash, 1);
    console.log(`✅ 过期 lease 重抢成功，qa_verifier=${qaCountAfterCrash}`);

    console.log("▶ QA-R4 attempt 1 置为 FAILED，queue 必须创建 attempt 2（retry 语义）");
    const attempt1Start = await startAgentTask(session, attempt1.task.id);
    await finishAgentTask(session, attempt1.task.id, {
      runId: attempt1Start.run.id,
      outcome: "FAILED",
      reason: "QA attempt 1 deliberately failed (regression)",
      resultSummary: "attempt 1 failed on purpose",
    });
    const attempt2 = await queueProductRndQa(session, { parentTaskId });
    assert.equal(attempt2.created, true, "FAILED attempt must allow a retry");
    assert.notEqual(attempt2.task.id, attempt1.task.id);
    const qaTasks = await prisma.agentTask.findMany({
      where: { parentTaskId, agent: { code: "qa_verifier" } },
      orderBy: { createdAt: "asc" },
    });
    assert.equal(qaTasks.length, 2, "retry must create a second attempt");
    assert.equal(qaTasks[1].id, attempt2.task.id);
    console.log(`✅ retry 创建 attempt 2：${attempt2.task.id}`);

    console.log("▶ QA-R5 attempt 2 活跃时再 queue：复用 attempt 2，不新增");
    const attempt2Start = await startAgentTask(session, attempt2.task.id);
    const reuse = await queueProductRndQa(session, { parentTaskId });
    assert.equal(reuse.created, false);
    assert.equal(reuse.task.id, attempt2.task.id);
    assert.equal(
      await prisma.agentTask.count({
        where: { parentTaskId, agent: { code: "qa_verifier" } },
      }),
      2
    );
    console.log("✅ 活跃 attempt 复用，未新增任务");

    console.log("▶ QA-R6 advance 必须认最新 attempt（WAITING_QA 而非 BLOCKED_BY_QA）");
    const advanced = await advanceProductRndProgram(session, parentTaskId);
    assert.equal(advanced.phase, "WAITING_QA");
    assert.equal(
      advanced.qaTaskId,
      attempt2.task.id,
      "advance must track the latest attempt, not the failed one"
    );
    console.log(`✅ advance → WAITING_QA (attempt 2: ${advanced.qaTaskId})`);

    console.log("▶ QA-R7 attempt 2 SUCCEEDED 后 queue：仍复用，不产生 attempt 3");
    await finishAgentTask(session, attempt2.task.id, {
      runId: attempt2Start.run.id,
      outcome: "SUCCEEDED",
      resultSummary: "attempt 2 passed",
    });
    const reuseAfterSuccess = await queueProductRndQa(session, { parentTaskId });
    assert.equal(reuseAfterSuccess.created, false);
    assert.equal(reuseAfterSuccess.task.id, attempt2.task.id);
    assert.equal(
      await prisma.agentTask.count({
        where: { parentTaskId, agent: { code: "qa_verifier" } },
      }),
      2
    );
    console.log("✅ 成功的 attempt 不被重试覆盖");

    console.log("▶ QA-R8 finishAgentTask 自动 advance：报告应已合成，且基于最新 attempt");
    // 生产行为：Product R&D child 终结时 workforce service 自动触发
    // advanceProductRndProgram → QA SUCCEEDED 会直接 REPORT_READY 并关闭 parent。
    const parentAfter = await prisma.agentTask.findUnique({
      where: { id: parentTaskId },
      select: { status: true },
    });
    assert.equal(parentAfter?.status, AgentTaskStatus.SUCCEEDED);
    const reportArtifact = await prisma.artifact.findFirst({
      where: {
        workItemId: program.workItem.id,
        type: "PRODUCT_RND_EXECUTIVE_REPORT",
      },
      orderBy: { contentVersion: "desc" },
    });
    assert.ok(reportArtifact, "executive report must be synthesized");
    const report = JSON.parse(reportArtifact.content) as {
      verificationStatus?: string;
    };
    assert.equal(report.verificationStatus, "READY_FOR_HUMAN_REVIEW");
    const blockedTasks = await prisma.agentTask.findMany({
      where: {
        parentTaskId,
        agent: { code: "qa_verifier" },
        status: AgentTaskStatus.FAILED,
      },
    });
    assert.equal(blockedTasks.length, 1, "failed attempt 1 must remain for audit");
    console.log(
      `✅ 报告已合成（verificationStatus=READY_FOR_HUMAN_REVIEW），失败的 attempt 1 保留审计（${blockedTasks[0].id}）`
    );

    console.log("\n✅ Product R&D QA crash-lease + retry attempt regression passed");
  } finally {
    const orgUsers = await prisma.user
      .findMany({ where: { organizationId: org.id }, select: { id: true } })
      .catch(() => [] as Array<{ id: string }>);
    const orgUserIds = orgUsers.map((row) => row.id);
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
