/**
 * KX-31b 连接器写操作审批 — 端到端（真实数据库 + 真实 worker 循环 + 假模型 + 本地 mock MCP 服务器）。
 *  AP1 模型调用写工具 → 被拦下 → 「需要你」出现审批卡（任务不阻塞，照常完成）
 *  AP2 审批卡不能用 answer 回答；普通 approve 参数校验
 *  AP3 允许一次 → 签发凭据 → 重做该步骤 → 同一调用执行且仅执行一次；凭据被核销
 *  AP4 不允许 → 不重做，外部系统收不到请求
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { AgentTaskStatus, OrgRole } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { bootstrapDefaultWorkforce } from "../src/modules/workforce/service";
import { executorLoopOnce, reconcileLoopOnce } from "../src/modules/supervisor/worker-runtime";
import {
  buildNewProductMissionPlan,
  controlKernMission,
  getKernMissionStatus,
  launchKernMission,
  listMissionEvents,
  parseMissionControl,
  setMissionModelInvokerForTest,
} from "../src/modules/supervisor";

async function drain(organizationId: string, rounds = 40) {
  for (let i = 0; i < rounds; i++) {
    const r = await executorLoopOnce({ organizationId, limit: 10 });
    await reconcileLoopOnce({ organizationId });
    if (r.acted === 0) {
      const queued = await prisma.agentTask.count({ where: { organizationId, status: AgentTaskStatus.QUEUED } });
      if (queued === 0) return;
    }
  }
}

const fence = (o: unknown) => "```kern-tool\n" + JSON.stringify(o) + "\n```";
const stub = (text: string) => ({ text, provenance: { provider: "stub", modelId: "stub-1", modelRunId: null } });

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Explicit test database required");
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID().slice(0, 8);

  // ---- mock MCP 服务器 ----
  const received: { name: string; args: unknown }[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const msg = JSON.parse(body) as { id?: number; method: string; params?: { name?: string; arguments?: unknown } };
      if (msg.id === undefined) return void res.writeHead(202).end();
      const reply = (result: unknown) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
      };
      if (msg.method === "initialize") return reply({ protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "crm" } });
      if (msg.method === "tools/call") {
        received.push({ name: msg.params!.name!, args: msg.params!.arguments });
        return reply({ content: [{ type: "text", text: "线索已创建：L-42" }] });
      }
      reply({ tools: [] });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const hostPort = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.KERN_CONNECTOR_ALLOW_HOSTS = hostPort;

  const WRITE_INPUT = { name: "测试线索", phone: "13800000000" };
  const seen: string[] = [];
  setMissionModelInvokerForTest(async ({ messages }) => {
    const all = messages.map((m) => m.content).join("\n");
    const key = /## 你的任务（([^）]+)）/.exec(all)?.[1] ?? "?";
    const last = messages[messages.length - 1].content;
    if (key === "qa") return stub(JSON.stringify({ verdict: "PASS", summary: "可以交付", issues: [] }));
    if (key === "synthesis") return stub("结论：推荐方向 A。");
    if (key === "compliance") return stub("compliance 的结论。\n合规判定：可做");
    if (key !== "market") return stub(`${key} 的结论。`);
    seen.push(all);
    const approved = /允许一次/.test(all);
    const denied = /不允许/.test(all);
    if (/## 工具结果/.test(last)) return stub(/线索已创建/.test(last) ? "market：已在 CRM 建线索 L-42。" : "market 的结论（CRM 建线索待用户确认）。");
    if (denied) return stub("market 的结论（用户未批准建线索）。");
    assert.ok(all.includes("mcp_crm_create_lead"), "连接器工具出现在工具说明里");
    return stub(fence({ tool: "mcp_crm_create_lead", input: approved ? WRITE_INPUT : WRITE_INPUT }));
  });

  const org = await prisma.organization.create({ data: { name: "Approval", code: `APV_${tag}` } });
  const owner = await prisma.user.create({ data: { organizationId: org.id, email: `apv-${tag}@hermes.test`, name: "Owner" } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: owner.id, role: OrgRole.ORG_ADMIN } });
  const session = { userId: owner.id, organizationId: org.id, userEmail: owner.email, userName: owner.name };
  await bootstrapDefaultWorkforce(session);
  await prisma.kernConnector.create({
    data: {
      organizationId: org.id,
      userId: owner.id,
      name: "CRM",
      slug: "crm",
      url: `http://${hostPort}/mcp`,
      tools: [{ name: "create_lead", title: "创建线索", description: "在 CRM 里新建销售线索", effect: "write", enabled: true, capability: "external.send", inputSchema: null }],
    },
  });
  const launch = async (n: string) =>
    (await launchKernMission(session, { plan: buildNewProductMissionPlan("我想开发一个新产品"), conversationId: null, sourceRunId: `${n}-${tag}` })).missionTaskId;

  try {
    console.log("▶ AP1 写调用被拦下 → 审批卡进入「需要你」，任务照常完成");
    const m1 = await launch("apv1");
    await drain(org.id);
    let st = await getKernMissionStatus(session, m1);
    assert.equal(st.outcome?.status, "COMPLETED");
    assert.equal(received.length, 0, "未批准前外部系统收不到请求");
    assert.equal(st.pendingAsks.length, 1);
    const card = st.pendingAsks[0];
    assert.equal(card.nodeKey, "market");
    assert.equal(card.approval?.connector, "CRM");
    assert.equal(card.approval?.title, "创建线索");
    assert.match(card.approval?.inputPreview ?? "", /测试线索/);
    assert.ok(st.attention.some((a) => a.askId === card.askId), "审批卡进入 attention");
    assert.ok(!JSON.stringify(st.pendingAsks).includes("sha256:"), "指纹不下发到前端");

    console.log("▶ AP2 参数校验：审批卡不能用 answer；approve 需要布尔 allow");
    assert.throws(() => parseMissionControl({ action: "approve", askId: "x" }), /Invalid/);
    assert.deepEqual(parseMissionControl({ action: "approve", askId: "x", allow: false }), { action: "approve", askId: "x", allow: false });
    await assert.rejects(controlKernMission(session, m1, { action: "answer", askId: card.askId, mode: "answer", text: "好" }), /approval request/);

    console.log("▶ AP3 允许一次 → 重做该步骤 → 同一调用执行一次，凭据核销");
    const r = await controlKernMission(session, m1, { action: "approve", askId: card.askId, allow: true });
    assert.equal(r.applied, "rerun");
    await drain(org.id);
    st = await getKernMissionStatus(session, m1);
    assert.equal(st.outcome?.status, "COMPLETED");
    assert.equal(st.pendingAsks.length, 0);
    assert.deepEqual(received, [{ name: "create_lead", args: WRITE_INPUT }], "外部系统只收到批准的那一次");
    const grants = await prisma.approvalGrant.findMany({ where: { organizationId: org.id } });
    assert.equal(grants.length, 1);
    assert.ok(grants[0].usedAt, "凭据已核销");
    assert.equal(grants[0].capability, "external.send");
    assert.ok(seen.some((p) => /允许一次「CRM · 创建线索」/.test(p)));
    const ev = await listMissionEvents(session, m1);
    assert.ok(ev.some((e) => e.type === "node.answered" && (e.payload as { decision?: string }).decision === "allow"));
    await assert.rejects(controlKernMission(session, m1, { action: "approve", askId: card.askId, allow: true }), /already answered/);

    console.log("▶ AP4 不允许 → 不重做，外部系统收不到请求");
    const m2 = await launch("apv2");
    await drain(org.id);
    st = await getKernMissionStatus(session, m2);
    const card2 = st.pendingAsks[0];
    assert.ok(card2?.approval);
    const before = received.length;
    const d = await controlKernMission(session, m2, { action: "approve", askId: card2.askId, allow: false });
    assert.equal(d.applied, "none");
    await drain(org.id);
    st = await getKernMissionStatus(session, m2);
    assert.equal(st.pendingAsks.length, 0);
    assert.equal(received.length, before);
    assert.equal(await prisma.approvalGrant.count({ where: { organizationId: org.id } }), 1, "拒绝不签发凭据");

    console.log("\n✅ Kern connector approval regression passed");
  } finally {
    setMissionModelInvokerForTest(null);
    server.close();
    const users = [owner.id];
    await prisma.approvalGrant.deleteMany({ where: { organizationId: org.id } });
    await prisma.kernMissionEvent.deleteMany({ where: { organizationId: org.id } });
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: users } } });
    await prisma.kernConnector.deleteMany({ where: { organizationId: org.id } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
