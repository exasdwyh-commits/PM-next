/** Local, reversible UI acceptance: a real model report and its conversational choice. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import prisma from "../src/shared/db";
import { LOCAL_TEST_EMAIL, LOCAL_TEST_ORG } from "../src/modules/identity/local-test-policy";
import { createKernConversation } from "../src/modules/assistant-runtime/conversations";
import { launchKernMission, getKernMissionStatus } from "../src/modules/supervisor/service";
import type { MissionPlan } from "../src/modules/supervisor/plan";

const dir = join(process.cwd(), "outputs/conclusion-choice-acceptance-2026-10-08");
async function main() {
  const database = (await prisma.$queryRaw<{ name: string }[]>`select current_database() as name`)[0].name;
  if (!database.endsWith("_dev")) throw new Error("Development database required");
  const user = await prisma.user.findUniqueOrThrow({ where: { email: LOCAL_TEST_EMAIL }, include: { organization: true } });
  if (user.organization.code !== LOCAL_TEST_ORG || user.isSystem || !user.isActive) throw new Error("Reserved workspace required");
  const session = { userId: user.id, organizationId: user.organizationId, userEmail: user.email, userName: user.name };
  await mkdir(dir, { recursive: true });
  if (process.argv[2] === "launch") {
    const existing = await readFile(join(dir, "mission.json"), "utf8").catch(() => null);
    if (existing) { console.log(existing); return; }
    const conversation = await createKernConversation(session, { title: "决策按钮验收：临时排版任务" });
    const goal = "生成一份用于决策按钮验收的临时报告：建议先维护功能，可选后续为这份测试制作附加排版样稿。仅测试，不涉及真实预算、发布、采购或其他外部操作。";
    await prisma.message.create({ data: { conversationId: conversation.id, role: "USER", content: goal } });
    const plan: MissionPlan = {
      version: "kern-mission-plan/v1", playbook: "GENERIC", goal,
      successCriteria: ["交付简短临时报告并列出可选后续"], budget: { maxTasks: 2, maxRevisionRounds: 0 }, humanGates: [],
      nodes: [{ key: "synthesis", kind: "SYNTHESIS", agentCode: "hermes_pm", taskClass: "ASSISTANT_SYNTHESIS", critical: true, dependsOn: [],
        objective: "不使用工具，输出三行短报告。结论：先维护功能。依据：可用性优先，这是测试设定。最后一行必须写：需要你决定的事：是否继续为这份临时测试制作附加排版样稿？这里只提出可选后续，不执行后续任务。不要增加预算或对外操作。" }],
    };
    const launched = await launchKernMission(session, { plan, conversationId: conversation.id, sourceRunId: null, idempotencyKey: "local-conclusion-choice-2026-10-08" });
    const info = { ...launched, conversationId: conversation.id, url: `http://127.0.0.1:3100/muse?c=${conversation.id}` };
    await writeFile(join(dir, "mission.json"), JSON.stringify(info, null, 2));
    console.log(JSON.stringify(info)); return;
  }
  const info = JSON.parse(await readFile(join(dir, "mission.json"), "utf8")) as { missionTaskId: string; conversationId: string };
  const status = await getKernMissionStatus(session, info.missionTaskId);
  const messages = await prisma.message.findMany({ where: { conversationId: info.conversationId }, orderBy: { createdAt: "asc" }, select: { id: true, role: true, content: true } });
  const result = { status: status.status, outcome: status.outcome, messages };
  await writeFile(join(dir, "acceptance.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Acceptance failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
