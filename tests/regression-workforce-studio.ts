import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { getWorkforceStudio } from "../src/modules/workforce/studio";

async function main() {
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID();
  const org = await prisma.organization.create({ data: { code: `STUDIO_${tag}`, name: "Studio fixture" } });
  const foreignOrg = await prisma.organization.create({ data: { code: `STUDIO_FOREIGN_${tag}`, name: "Foreign fixture" } });
  try {
    const member = await prisma.user.create({ data: { organizationId: org.id, name: "Member", email: `member-${tag}@kern.test` } });
    const other = await prisma.user.create({ data: { organizationId: org.id, name: "Other", email: `other-${tag}@kern.test`, orgMemberships: { create: { organizationId: org.id, role: "ORG_ADMIN" } } } });
    const foreign = await prisma.user.create({ data: { organizationId: foreignOrg.id, name: "Foreign", email: `foreign-${tag}@kern.test` } });
    const session = { organizationId: org.id, userId: member.id, userName: member.name, userEmail: member.email };
    const shared = await prisma.agent.create({ data: { organizationId: org.id, code: "shared", name: "Shared", roleKey: "PRODUCT_LEAD", accessMode: "ORGANIZATION", instructions: "SECRET_PROMPT" } });
    const owned = await prisma.agent.create({ data: { organizationId: org.id, code: "owned", name: "Owned", roleKey: "PRODUCT", ownerId: member.id } });
    const privateAgent = await prisma.agent.create({ data: { organizationId: org.id, code: "private", name: "SECRET_PRIVATE_AGENT", roleKey: "PRODUCT", ownerId: other.id } });
    const foreignAgent = await prisma.agent.create({ data: { organizationId: foreignOrg.id, code: "foreign", name: "SECRET_FOREIGN_AGENT", roleKey: "PRODUCT", accessMode: "ORGANIZATION" } });
    const parent = await prisma.agentTask.create({ data: { organizationId: org.id, agentId: shared.id, createdByUserId: member.id, goal: "Visible parent", contextSnapshot: { secret: "SECRET_CONTEXT" }, status: "WAITING_HUMAN" } });
    const child = await prisma.agentTask.create({ data: { organizationId: org.id, agentId: owned.id, createdByUserId: member.id, parentTaskId: parent.id, goal: "Visible child", status: "SUCCEEDED" } });
    const privateTask = await prisma.agentTask.create({ data: { organizationId: org.id, agentId: shared.id, createdByUserId: other.id, goal: "SECRET_OTHER_TASK" } });
    await prisma.agentTask.create({ data: { organizationId: org.id, agentId: privateAgent.id, createdByUserId: member.id, goal: "SECRET_PRIVATE_TASK" } });
    await prisma.agentTask.create({ data: { organizationId: foreignOrg.id, agentId: foreignAgent.id, createdByUserId: foreign.id, goal: "SECRET_FOREIGN_TASK" } });
    const conversation = await prisma.conversation.create({ data: { organizationId: org.id, ownerId: member.id, title: "Visible conversation" } });
    await prisma.agentRun.create({ data: { organizationId: org.id, userId: member.id, agentId: owned.id, agentTaskId: child.id, conversationId: conversation.id, goal: "Visible child", status: "SUCCEEDED", outputSummary: "Visible result" } });
    // A later run by someone else on a visible task must not override or disclose their summary.
    await prisma.agentRun.create({ data: { organizationId: org.id, userId: other.id, agentId: owned.id, agentTaskId: child.id, goal: "Other run", status: "SUCCEEDED", outputSummary: "SECRET_OTHER_RUN", createdAt: new Date(Date.now() + 1000) } });
    await prisma.agentDelegation.create({ data: { organizationId: org.id, fromAgentId: shared.id, toAgentId: owned.id, parentTaskId: parent.id, childTaskId: child.id, reason: "Visible handoff", status: "COMPLETED" } });
    const incoming = await prisma.agentTask.create({ data: { organizationId: org.id, agentId: owned.id, createdByUserId: member.id, goal: "Visible incoming" } });
    await prisma.agentDelegation.create({ data: { organizationId: org.id, fromAgentId: shared.id, toAgentId: owned.id, parentTaskId: privateTask.id, childTaskId: incoming.id, reason: "SECRET_PARENT_HANDOFF" } });

    const snapshot = await getWorkforceStudio(session);
    assert.deepEqual(new Set(snapshot.agents.map(agent => agent.id)), new Set([shared.id, owned.id]));
    assert.equal(snapshot.tasks.length, 3);
    assert.equal(snapshot.handoffs.length, 1);
    assert.equal(snapshot.tasks.find(task => task.id === child.id)?.summary, "Visible result");
    assert.equal(snapshot.tasks.find(task => task.id === child.id)?.conversationHref, `/muse?c=${conversation.id}`);
    assert.ok(!JSON.stringify(snapshot).includes("SECRET_"), "No private tasks, runs, handoffs, foreign data, prompts or contexts may be serialized");
    console.log("WS1: organization, employee, task, run and parent-handoff visibility hold; DTO omits prompt/context data");

    const admin = await getWorkforceStudio({ ...session, userId: other.id });
    assert.ok(admin.agents.some(agent => agent.id === privateAgent.id));
    assert.ok(admin.tasks.some(task => task.id === privateTask.id));
    assert.ok(!JSON.stringify(admin).includes("SECRET_FOREIGN"));
    assert.equal(admin.tasks.find(task => task.id === child.id)?.conversationHref, null, "An admin cannot open another owner's conversation");
    console.log("WS2: administrator reads remain organization-scoped and preserve conversation ownership");

    const empty = await getWorkforceStudio({ organizationId: foreignOrg.id, userId: foreign.id, userName: foreign.name, userEmail: foreign.email });
    assert.equal(empty.handoffs.length, 0);
    assert.equal(empty.tasks.length, 1);
    assert.equal(empty.agents.length, 1);
    assert.ok(!JSON.stringify(empty).includes("Visible result"));
    console.log("WS3: empty handoff collections remain empty; no synthesized demo records");
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.organization.delete({ where: { id: foreignOrg.id } });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
