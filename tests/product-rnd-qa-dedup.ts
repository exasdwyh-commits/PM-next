/**
 * 并发去重回归：同一 Product R&D parent 下永远只能有一个 qa_verifier 任务。
 *
 * 背景（真实 Bug）：advanceProductRndProgram 中「读取 childTasks → 发现没有
 * QA → 排队」是 check-then-act。两个并发 reconcile（用户点 RECONCILE 的同时，
 * 最后一个专家任务完成触发了自动 advance）会同时看到没有 QA，各自创建一个
 * qa_verifier；下游 synthesize 用 find() 只取第一个，第二个被静默丢弃。
 *
 * 修复：queueProductRndQa 用 jsonb CAS 原子抢占槽位（见 orchestrator.ts）。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { OrgRole, Role } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import {
  bootstrapDefaultWorkforce,
  finishAgentTask,
  startAgentTask,
} from "../src/modules/workforce/service";
import {
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
    data: { name: "Product R&D QA Dedup Test", code: "PRDQ_" + tag },
  });
  const owner = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: `prdq-${tag}@hermes.test`,
      name: "QA Dedup Owner",
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
        title: "QA 并发去重测试项目",
        target: "验证并发 reconcile 不会产生两个 QA 任务",
        constraints: "none",
        ownerId: owner.id,
      },
    });
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: owner.id, role: Role.OWNER },
    });

    const program = await startProductRndProgram(session, {
      projectId: project.id,
      brief: "并发去重测试：同一 parent 只允许一个独立 QA。",
    });
    const parentTaskId = program.parentTask.id;

    console.log("▶ QA-D1 完成五个专家任务");
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

    console.log("▶ QA-D2 清掉自动排队的 QA，制造「尚无 QA」的竞态窗口");
    await prisma.agentDelegation.deleteMany({
      where: {
        childTask: { parentTaskId, agent: { code: "qa_verifier" } },
      },
    });
    await prisma.agentTask.deleteMany({
      where: { parentTaskId, agent: { code: "qa_verifier" } },
    });
    await prisma.$executeRaw`
      UPDATE "AgentTask"
         SET "contextSnapshot" = COALESCE("contextSnapshot", '{}'::jsonb) - 'qaClaim'
       WHERE id = ${parentTaskId}
    `;
    assert.equal(
      await prisma.agentTask.count({
        where: { parentTaskId, agent: { code: "qa_verifier" } },
      }),
      0
    );

    console.log("▶ QA-D3 并发排队 QA：必须只产生一个 qa_verifier");
    const results = await Promise.allSettled([
      queueProductRndQa(session, { parentTaskId }),
      queueProductRndQa(session, { parentTaskId }),
      queueProductRndQa(session, { parentTaskId }),
    ]);
    const qaCount = await prisma.agentTask.count({
      where: { parentTaskId, agent: { code: "qa_verifier" } },
    });
    assert.equal(
      qaCount,
      1,
      `concurrent QA queue must create exactly one task, got ${qaCount}`
    );
    const created = results.filter(
      (r) => r.status === "fulfilled" && r.value.created === true
    ).length;
    console.log(
      `✅ 并发 3 次排队 → qa_verifier=${qaCount}，created=true 的请求数=${created}`
    );

    console.log("▶ QA-D4 幂等：串行再排队一次不应新增");
    const again = await queueProductRndQa(session, { parentTaskId });
    assert.equal(again.created, false);
    assert.equal(
      await prisma.agentTask.count({
        where: { parentTaskId, agent: { code: "qa_verifier" } },
      }),
      1
    );
    console.log("✅ 串行重复排队返回 created=false，未新增任务");

    console.log("\n✅ Product R&D QA concurrency dedup regression passed");
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
