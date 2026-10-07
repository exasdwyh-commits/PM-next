/**
 * Model call quota (deployment KERN_LIMIT_MODEL_CALLS_PER_MONTH) — DB regression.
 *
 * P0-D: 此前这个上限只在 mission 启动时被 assertMissionUsage 检查一次，
 * 但一次 mission 会产生十几次模型调用（planner → 专员 → QA → 综合 → 返工），
 * 每次都写一条 ModelRun。于是「299/300 启动一个 mission」会直接把上限冲破。
 * 闸门已移到实际花钱的那一刻（chargeModelCallInTx，与插入同事务 + 组织级 advisory lock）。
 *
 * 覆盖：
 *  - 并发扣减不能超发（advisory lock 的原子性）；
 *  - 一个 mission 内部连续花费会在中途被拒（P0-D 的原始缺口）；
 *  - 到上限后突发 40 并发全部诚实拒绝，不出现 P2028 池耗尽；
 *  - 未配置上限 = 不限（KX-37：产品内无套餐）；
 *  - 组织之间配额互不影响。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AgentTaskStatus, type Prisma } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { ModelExecutionBudgetError } from "../src/modules/model-gateway/runtime";
import { UsageLimitError, chargeModelCallInTx } from "../src/modules/usage";
import { finishAgentTask, startAgentTask } from "../src/modules/workforce/service";
import { executeAgentTask } from "../src/modules/worker/executor";
import {
  registerWorkerHandlers,
  resetWorkerHandlersForTest,
} from "../src/modules/worker/registry";

/** 在锁内插入一条 ModelRun —— 与生产路径 model-gateway/runtime.ts 同形。 */
function insertModelRun(tx: Prisma.TransactionClient, organizationId: string) {
  return () =>
    tx.modelRun.create({
      data: {
        organizationId,
        taskClass: "quota-regression",
        policyKey: "regression.policy",
        policyVersion: "v1",
        status: "RUNNING",
      },
    });
}

/** 读 executor 的重试计数；没有 executorState 视为 0（尚未失败过）。 */
function readAttempts(snapshot: unknown): number {
  const context = (snapshot ?? {}) as { executorState?: { attempts?: unknown } };
  const attempts = context.executorState?.attempts;
  return typeof attempts === "number" ? attempts : 0;
}

/**
 * 只接受「配额拒绝」和成功；其他错误（例如 P2028 池耗尽、锁超时）原样上报，
 * 这样测试失败会直接点名真实原因，而不是含糊的 ok !== 3。
 */
function describeUnexpected(results: PromiseSettledResult<unknown>[]): string[] {
  return results.flatMap((r) => {
    if (r.status !== "rejected" || r.reason instanceof UsageLimitError) return [];
    const error = r.reason as { constructor?: { name?: string }; code?: string; message?: string };
    const name = error?.constructor?.name ?? typeof r.reason;
    return [`${name}/${error?.code ?? "-"}: ${String(error?.message ?? r.reason).split("\n")[0]}`];
  });
}

function charge(organizationId: string) {
  return prisma.$transaction((tx) =>
    chargeModelCallInTx(tx, organizationId, insertModelRun(tx, organizationId))
  );
}

/** 按依赖顺序清掉本次创建的数据；顺序写死，避免边跑边撞外键。 */
async function cleanup(orgId: string, otherOrgId: string, userId: string) {
  const orgIds = { in: [orgId, otherOrgId] };
  await prisma.agentTask.deleteMany({ where: { organizationId: orgIds } });
  await prisma.agentRun.deleteMany({ where: { organizationId: orgIds } });
  await prisma.agent.deleteMany({ where: { organizationId: orgIds } });
  await prisma.modelRun.deleteMany({ where: { organizationId: orgIds } });
  // AuditEvent 只按 actorId 关联（没有 organizationId），必须先于 User。
  await prisma.auditEvent.deleteMany({ where: { actorId: userId } });
  await prisma.user.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.deleteMany({ where: { id: orgIds } });
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Explicit test database required");
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID();
  const org = await prisma.organization.create({ data: { name: "Model call quota", code: "MCQ_" + tag } });
  const otherOrg = await prisma.organization.create({ data: { name: "Quota isolation", code: "ISO_" + tag } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, email: `mcq-${tag}@hermes.test`, name: "MCQ" },
  });
  const session = {
    organizationId: org.id,
    userId: user.id,
    userEmail: user.email,
    userName: user.name,
  };

  process.env.KERN_LIMIT_MODEL_CALLS_PER_MONTH = "5";
  const limit = 5;
  assert.ok(limit > 4);

  try {
    console.log(`▶ MCQ1 fill to limit-3 (${limit - 3})`);
    for (let i = 0; i < limit - 3; i++) {
      await charge(org.id);
    }
    assert.equal(await prisma.modelRun.count({ where: { organizationId: org.id } }), limit - 3);

    console.log("▶ MCQ2 six concurrent charges → exactly 3 succeed, never overshoot");
    const concurrent = await Promise.allSettled(
      Array.from({ length: 6 }, () => charge(org.id))
    );
    assert.deepEqual(
      describeUnexpected(concurrent),
      [],
      "concurrent charges may only succeed or be refused for quota"
    );
    assert.equal(
      concurrent.filter((r) => r.status === "fulfilled").length,
      3,
      "advisory lock must serialize concurrent charges; overselling means the gate is not atomic"
    );
    assert.equal(
      concurrent.filter((r) => r.status === "rejected" && r.reason instanceof UsageLimitError).length,
      3
    );
    assert.equal(await prisma.modelRun.count({ where: { organizationId: org.id } }), limit);

    console.log("▶ MCQ3 a single mission keeps spending past the limit → refused mid-mission");
    // mission 启动那一刻还剩最后一次调用额度。改动前：启动时检查通过，内部十几次调用全部放行。
    const missionSpending = await Promise.allSettled(
      Array.from({ length: 8 }, () => charge(org.id))
    );
    assert.deepEqual(
      describeUnexpected(missionSpending),
      [],
      "mid-mission refusal must be an honest quota refusal"
    );
    assert.equal(
      missionSpending.filter((r) => r.status === "fulfilled").length,
      0,
      "the gate must hold inside one mission; if any call passes here the launch-time-only check regressed"
    );
    assert.equal(await prisma.modelRun.count({ where: { organizationId: org.id } }), limit);

    console.log("▶ MCQ4 40-writer burst at the limit refuses honestly (no pool exhaustion)");
    const burst = await Promise.allSettled(
      Array.from({ length: 40 }, () => charge(org.id))
    );
    assert.deepEqual(
      describeUnexpected(burst),
      [],
      "a burst at the limit must refuse with UsageLimitError, never fail to start"
    );
    assert.equal(burst.filter((r) => r.status === "fulfilled").length, 0);
    assert.equal(await prisma.modelRun.count({ where: { organizationId: org.id } }), limit);

    console.log("▶ MCQ5 organization isolation: the other org has its own budget");
    assert.ok(await charge(otherOrg.id), "another organization must not be blocked by ours");
    await assert.rejects(charge(org.id), UsageLimitError);

    console.log("▶ MCQ6 no limit configured → unlimited (KX-37: no plans in product)");
    delete process.env.KERN_LIMIT_MODEL_CALLS_PER_MONTH;
    for (let i = 0; i < 10; i++) {
      assert.ok(await charge(org.id), "unset limit must not refuse calls");
    }

    console.log("▶ MCQ7 配额拒绝必须落成诚实 BLOCKED，且不消耗重试额度");
    const probeAgent = await prisma.agent.create({
      data: {
        organizationId: org.id,
        code: "quota_probe_agent",
        name: "Quota probe",
        roleKey: "PM",
        // OWNER_ONLY 且无 owner 时 assertCanInvokeAgent 会按「不可见即不存在」拒绝；
        // 这里用 ORGANIZATION 让测试账号可见，聚焦被测的配额分支。
        accessMode: "ORGANIZATION",
      },
    });
    const quotaReceipts: string[] = [];
    registerWorkerHandlers({
      strategies: {
        // 与生产同形：策略里调模型 → 网关 → chargeModelCallInTx 抛 UsageLimitError。
        // 这里直接抛，把被测对象收敛到 executor 的处置逻辑本身。
        quota_probe_agent: async () => {
          throw new UsageLimitError(
            "本月模型调用已达上限 5 次。这是本部署设置的安全上限，需要调整请联系管理员",
            { metric: "modelCalls", used: 5, limit: 5 }
          );
        },
      },
      lifecycle: {
        startAgentTask,
        finishAgentTask,
        appendConversationReturn: async (input: { outcome: string; summary: string }) => {
          quotaReceipts.push(`${input.outcome}: ${input.summary}`);
          return undefined;
        },
      },
    });

    const quotaTask = await prisma.agentTask.create({
      data: {
        organizationId: org.id,
        agentId: probeAgent.id,
        goal: "probe: quota refusal must be BLOCKED",
      },
    });
    const quotaResult = await executeAgentTask(session, quotaTask.id);
    const quotaAfter = await prisma.agentTask.findUniqueOrThrow({ where: { id: quotaTask.id } });

    assert.equal(quotaResult.executed, true, "quota refusal is a terminal outcome, not a skip");
    assert.equal(
      quotaResult.outcome,
      "BLOCKED",
      "executorLoop 按 outcome 记账；报成 skip 会让预算耗尽显示为 acted=0/errors=0"
    );
    assert.equal(quotaResult.skippedReason, undefined, "must not be reported as a skip");
    assert.equal(
      quotaAfter.status,
      AgentTaskStatus.BLOCKED,
      "配额耗尽是确定性拒绝：必须诚实 BLOCKED，不能留在 QUEUED 假装要重试"
    );
    assert.equal(
      readAttempts(quotaAfter.contextSnapshot),
      0,
      "配额拒绝不得消耗重试额度——配额不会在退避窗口内恢复"
    );
    assert.ok(
      String(quotaAfter.blockedReason ?? "").includes("上限") ||
        String(quotaAfter.blockedReason ?? "").length > 0,
      "blockedReason must carry the real reason"
    );

    assert.equal(quotaReceipts.length, 1, "预算耗尽必须把回执带回发起对话，否则等于隐瞒");
    assert.match(quotaReceipts[0], /^BLOCKED: /, "receipt must be recorded as BLOCKED");
    assert.ok(quotaReceipts[0].includes("上限"), "receipt must carry the real quota reason");

    console.log("▶ MCQ9 任务模型预算拒绝同样 BLOCKED，不自动重试");
    registerWorkerHandlers({
      strategies: { quota_probe_agent: async () => { throw new ModelExecutionBudgetError("任务模型执行耗时已达预算（timeout）"); } },
      lifecycle: { startAgentTask, finishAgentTask, appendConversationReturn: async () => undefined },
    });
    const budgetTask = await prisma.agentTask.create({ data: { organizationId: org.id, agentId: probeAgent.id, goal: "probe: exhausted task budget" } });
    const budgetResult = await executeAgentTask(session, budgetTask.id);
    const budgetAfter = await prisma.agentTask.findUniqueOrThrow({ where: { id: budgetTask.id } });
    assert.equal(budgetResult.outcome, "BLOCKED");
    assert.equal(budgetAfter.status, "BLOCKED");
    assert.equal(readAttempts(budgetAfter.contextSnapshot), 0);
    assert.match(budgetAfter.blockedReason ?? "", /耗时已达预算/);

    console.log("▶ MCQ8 对照：普通异常仍走重试，证明上面的 BLOCKED 是被区分出来的");
    const retryTask = await prisma.agentTask.create({
      data: {
        organizationId: org.id,
        agentId: probeAgent.id,
        goal: "probe: transient failure must retry",
      },
    });
    registerWorkerHandlers({
      strategies: {
        quota_probe_agent: async () => {
          throw new Error("upstream 503: transient");
        },
      },
      lifecycle: { startAgentTask, finishAgentTask, appendConversationReturn: async () => undefined },
    });
    const retryResult = await executeAgentTask(session, retryTask.id);
    const retryAfter = await prisma.agentTask.findUniqueOrThrow({ where: { id: retryTask.id } });

    assert.equal(retryResult.outcome, "FAILED", "transient failure ends as FAILED, then retries");
    assert.notEqual(
      retryResult.outcome,
      "BLOCKED",
      "transient failure must not be mislabelled as a quota refusal"
    );
    assert.equal(retryAfter.status, AgentTaskStatus.QUEUED, "transient failure must be retried");
    assert.equal(readAttempts(retryAfter.contextSnapshot), 1, "transient failure consumes one attempt");

    console.log("\n✅ Kern model call quota regression passed");
  } finally {
    resetWorkerHandlersForTest();
    await cleanup(org.id, otherOrg.id, user.id);
    delete process.env.KERN_LIMIT_MODEL_CALLS_PER_MONTH;
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
