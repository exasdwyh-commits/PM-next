/**
 * KX-35 本机命令分级确认 — 真实数据库回归。
 *  DR1 只读命令照旧 QUEUED，执行端可直接领取
 *  DR2 危险命令入队即 422，不留任务
 *  DR3 需确认命令 → WAITING_HUMAN，执行端列表里看不到、强行 claim 409；「需要你」出现确认卡
 *  DR4 允许一次 → 单次 ApprovalGrant → QUEUED；并发满时领取失败，凭据原样保留（不作废）；
 *      放开后 claim 核验并消耗（usedByRunId = 真实 run）；重复确认 409
 *  DR5 动作被篡改（指纹不符）→ claim 拒绝，运行撤销，任务退回待确认，重新确认也被拒
 *  DR6 不允许 → CANCELLED，不会被领取
 *  DR7 他人不能确认（404）；agent.delegate 同样需要确认
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AgentTaskStatus, OrgRole, Prisma } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { bootstrapDefaultWorkforce } from "../src/modules/workforce/service";
import {
  claimDesktopRuntimeTask,
  confirmDesktopTask,
  enqueueDesktopTask,
  listDesktopRuntimeTasks,
} from "../src/modules/desktop-runtime";
import { DESKTOP_AGENT_CODE } from "../src/modules/desktop-runtime/contracts";
import { ApprovalService, createPrismaApprovalGrantStore } from "../src/modules/governance/approval-service";
import { loadAttentionForUser } from "../src/modules/muse/read-model";

async function rejects(p: Promise<unknown>, status: number, label: string) {
  try {
    await p;
  } catch (error) {
    const s = (error as { status?: number; statusCode?: number }).status ?? (error as { statusCode?: number }).statusCode;
    assert.equal(s, status, `${label}：期望 ${status}，实际 ${s}（${(error as Error).message}）`);
    return (error as Error).message;
  }
  assert.fail(`${label}：应当被拒绝`);
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Explicit test database required");
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID().slice(0, 8);
  const approvals = new ApprovalService(createPrismaApprovalGrantStore(), "kx35-regression-secret-0123456789abcdef");
  const deps = { approvals };

  const org = await prisma.organization.create({ data: { name: "DesktopConfirm", code: `DCF_${tag}` } });
  const mk = async (n: string) => {
    const u = await prisma.user.create({ data: { organizationId: org.id, email: `dcf-${n}-${tag}@hermes.test`, name: n } });
    await prisma.organizationMember.create({ data: { organizationId: org.id, userId: u.id, role: OrgRole.ORG_ADMIN } });
    return { userId: u.id, organizationId: org.id, userEmail: u.email, userName: u.name };
  };
  const owner = await mk("owner");
  const other = await mk("other");
  await bootstrapDefaultWorkforce(owner);
  const device = `dev-${tag}`;
  const status = async (id: string) => (await prisma.agentTask.findUniqueOrThrow({ where: { id } })).status;

  try {
    console.log("▶ DR1 只读命令照旧排队并可直接领取");
    const r1 = await enqueueDesktopTask(owner, { instruction: "执行命令 git status" });
    assert.equal(r1.confirmation, null);
    assert.equal(r1.task.status, AgentTaskStatus.QUEUED);
    const c1 = await claimDesktopRuntimeTask(owner, { taskId: r1.task.id, deviceId: device }, deps);
    assert.equal(c1.resumed, false);

    console.log("▶ DR2 危险命令服务端 422，不留任务");
    const before = await prisma.agentTask.count({ where: { organizationId: org.id } });
    const msg = await rejects(enqueueDesktopTask(owner, { instruction: "执行命令 sudo rm -rf /tmp/x" }), 422, "危险命令");
    assert.match(msg, /^危险命令已拒绝执行/);
    assert.equal(await prisma.agentTask.count({ where: { organizationId: org.id } }), before);

    console.log("▶ DR3 需确认命令停在 WAITING_HUMAN，执行端拿不到");
    const r3 = await enqueueDesktopTask(owner, { instruction: "执行命令 npm install", conversationId: null });
    assert.ok(r3.confirmation);
    assert.equal(r3.task.status, AgentTaskStatus.WAITING_HUMAN);
    const listed = await listDesktopRuntimeTasks(owner, { deviceId: device, limit: 10 });
    assert.ok(!listed.some((t) => t.taskId === r3.task.id), "待确认任务不应出现在执行端列表");
    await rejects(claimDesktopRuntimeTask(owner, { taskId: r3.task.id, deviceId: device }, deps), 409, "未确认强行领取");
    const attention = await loadAttentionForUser(owner);
    const card = attention.needsYou.find((i) => i.id === `desktop:${r3.task.id}`);
    assert.ok(card?.confirm, "「需要你」应出现确认卡");
    assert.equal(card!.level, "INTERRUPT");
    assert.match(card!.confirm!.detail, /npm install/);

    console.log("▶ DR7a 他人不能确认");
    await rejects(confirmDesktopTask(other, { taskId: r3.task.id, decision: "ALLOW" }, deps), 404, "他人确认");

    console.log("▶ DR4 允许一次 → 领取时核验并消耗凭据");
    const ok = await confirmDesktopTask(owner, { taskId: r3.task.id, decision: "ALLOW" }, deps);
    assert.ok(ok.grantId);
    assert.equal(await status(r3.task.id), AgentTaskStatus.QUEUED);
    await rejects(confirmDesktopTask(owner, { taskId: r3.task.id, decision: "ALLOW" }, deps), 409, "重复确认");
    // DR1 的任务仍占着 Desktop Operator 的并发名额 → 领取失败，但凭据必须原样保留
    await rejects(claimDesktopRuntimeTask(owner, { taskId: r3.task.id, deviceId: device }, deps), 409, "并发已满");
    assert.equal((await prisma.approvalGrant.findUniqueOrThrow({ where: { id: ok.grantId! } })).usedAt, null, "启动失败不应作废凭据");
    assert.equal(await status(r3.task.id), AgentTaskStatus.QUEUED);
    await prisma.agent.updateMany({ where: { organizationId: org.id, code: DESKTOP_AGENT_CODE }, data: { maxConcurrentTasks: 10 } });
    const c3 = await claimDesktopRuntimeTask(owner, { taskId: r3.task.id, deviceId: device }, deps);
    assert.equal(c3.resumed, false);
    const grant = await prisma.approvalGrant.findUniqueOrThrow({ where: { id: ok.grantId! } });
    assert.ok(grant.usedAt, "凭据应被核销");
    assert.equal(grant.usedByRunId, c3.runId, "凭据核销记录真实 run");
    assert.equal(grant.capability, "shell.exec");
    assert.equal(grant.taskRef, `desktop:${r3.task.id}`);

    console.log("▶ DR5 批准后动作被篡改 → 领取被拒");
    const r5 = await enqueueDesktopTask(owner, { instruction: "执行命令 npm run build" });
    await confirmDesktopTask(owner, { taskId: r5.task.id, decision: "ALLOW" }, deps);
    const snap = (await prisma.agentTask.findUniqueOrThrow({ where: { id: r5.task.id } })).contextSnapshot as Record<string, unknown>;
    await prisma.agentTask.update({
      where: { id: r5.task.id },
      data: { contextSnapshot: { ...snap, desktopAction: { tool: "shell.run", command: "npm publish" } } as Prisma.InputJsonValue },
    });
    await rejects(claimDesktopRuntimeTask(owner, { taskId: r5.task.id, deviceId: device }, deps), 409, "篡改后领取");
    assert.equal(await status(r5.task.id), AgentTaskStatus.WAITING_HUMAN, "被拒的领取应撤销并退回待确认");
    assert.equal(
      await prisma.agentRun.count({ where: { agentTaskId: r5.task.id, status: "RUNNING" } }),
      0,
      "不应留下运行中的 run"
    );
    await rejects(confirmDesktopTask(owner, { taskId: r5.task.id, decision: "ALLOW" }, deps), 409, "篡改后重新确认");

    console.log("▶ DR6 不允许 → CANCELLED");
    const r6 = await enqueueDesktopTask(owner, { instruction: "执行命令 git push" });
    const no = await confirmDesktopTask(owner, { taskId: r6.task.id, decision: "DENY" }, deps);
    assert.equal(no.status, AgentTaskStatus.CANCELLED);
    await rejects(claimDesktopRuntimeTask(owner, { taskId: r6.task.id, deviceId: device }, deps), 409, "已拒绝后领取");
    const after = await loadAttentionForUser(owner);
    assert.ok(!after.needsYou.some((i) => i.id === `desktop:${r6.task.id}`), "已处理的不再出现在「需要你」");

    console.log("▶ DR7b agent.delegate 同样需要确认");
    const r7 = await enqueueDesktopTask(owner, { instruction: "用本机 Codex 帮我整理一下项目的 README" });
    assert.equal(r7.action.tool, "agent.delegate");
    assert.equal(r7.task.status, AgentTaskStatus.WAITING_HUMAN);

    console.log("✅ KX-35 本机命令分级确认回归全部通过（DR1–DR7）");
  } finally {
    // 与其它 DB 回归一致：清理凭据与审计，组织与任务留在隔离测试库（有外键，不强删）。
    await prisma.approvalGrant.deleteMany({ where: { organizationId: org.id } }).catch(() => undefined);
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: [owner.userId, other.userId] } } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
