/**
 * KX-62 产出库 — 数据库回归（真实测试库）。
 *  LB-DB1 只列本人发起、已成功的任务；进行中 / 失败的不列
 *  LB-DB2 同组织的其他成员看不到我的产出；其他组织也看不到
 *  LB-DB3 搜索按任务目标过滤（不区分大小写）
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AgentTaskStatus, OrgRole } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { bootstrapDefaultWorkforce } from "../src/modules/workforce/service";
import { listLibrary } from "../src/modules/supervisor";
import { MISSION_SCHEMA } from "../src/modules/supervisor/service";

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Explicit test database required");
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID().slice(0, 8);

  const org = await prisma.organization.create({ data: { name: "Library", code: `LIB_${tag}` } });
  const other = await prisma.organization.create({ data: { name: "Library2", code: `LIB2_${tag}` } });
  const mk = async (organizationId: string, name: string) => {
    const u = await prisma.user.create({ data: { organizationId, email: `lib-${name}-${tag}@hermes.test`, name } });
    await prisma.organizationMember.create({ data: { organizationId, userId: u.id, role: OrgRole.ORG_ADMIN } });
    return { userId: u.id, organizationId, userEmail: u.email, userName: u.name };
  };
  const me = await mk(org.id, "me");
  const peer = await mk(org.id, "peer");
  const outsider = await mk(other.id, "out");
  try {
    await bootstrapDefaultWorkforce(me);
    await bootstrapDefaultWorkforce(outsider);
    const agent = await prisma.agent.findFirstOrThrow({ where: { organizationId: org.id } });
    const agent2 = await prisma.agent.findFirstOrThrow({ where: { organizationId: other.id } });
    const root = (organizationId: string, agentId: string, userId: string, goal: string, status: AgentTaskStatus) =>
      prisma.agentTask.create({
        data: { organizationId, agentId, goal, status, contextSnapshot: { schemaVersion: MISSION_SCHEMA, requestedByUserId: userId } },
      });
    const done = await root(org.id, agent.id, me.userId, "分析 Protein 零食新品机会", AgentTaskStatus.SUCCEEDED);
    await root(org.id, agent.id, me.userId, "还在跑的任务", AgentTaskStatus.RUNNING);
    await root(org.id, agent.id, me.userId, "失败的任务", AgentTaskStatus.FAILED);
    const peerDone = await root(org.id, agent.id, peer.userId, "同事的任务", AgentTaskStatus.SUCCEEDED);
    await root(other.id, agent2.id, outsider.userId, "别家的任务", AgentTaskStatus.SUCCEEDED);
    // 非任务快照（普通 AgentTask）不应出现
    await prisma.agentTask.create({ data: { organizationId: org.id, agentId: agent.id, goal: "普通任务", status: AgentTaskStatus.SUCCEEDED, contextSnapshot: { requestedByUserId: me.userId } } });

    const mine = await listLibrary(me);
    assert.deepEqual(mine.map((i) => i.missionTaskId), [done.id], "LB-DB1 只列本人已成功的任务");
    assert.equal(mine[0].downloads.length, 5);
    console.log("✓ LB-DB1");

    const peers = await listLibrary(peer);
    assert.deepEqual(peers.map((i) => i.missionTaskId), [peerDone.id], "LB-DB2 同组织同事只看到自己的");
    assert.equal((await listLibrary(outsider)).some((i) => i.missionTaskId === done.id), false, "LB-DB2 其他组织看不到");
    console.log("✓ LB-DB2");

    assert.equal((await listLibrary(me, { q: "protein" })).length, 1, "LB-DB3 不区分大小写命中");
    assert.equal((await listLibrary(me, { q: "不存在的词" })).length, 0, "LB-DB3 未命中为空");
    console.log("✓ LB-DB3");

    console.log("\n✅ Kern library regression passed");
  } finally {
    await prisma.agentTask.deleteMany({ where: { organizationId: { in: [org.id, other.id] } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
