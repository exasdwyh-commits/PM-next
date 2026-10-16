/**
 * T2 · 新建产品人工确认闭环验证（隔离测试库）
 *
 * 运行：tsx scripts/run-test.ts tests/t2-intake-confirm-loop.ts
 * HTTP 场景：先以测试库启动实例，再设 T2_BASE_URL=http://127.0.0.1:<port>；
 * 未设置时 HTTP 场景标记为「未验证」，service 场景照常执行。
 *
 * 覆盖：
 *   S1 字段不齐 → 返回缺项，不建提议、不建业务记录（service）
 *   S2 字段齐全 → PENDING_CONFIRMATION 提议，产品/版本/项目均未写入（service）
 *   S3 全委托模式 → 仍停在待确认，服务端门禁不被绕过（service）
 *   S4 经现有确认入口批准 → 建产品 + 初始版本 + 项目，返回回执并记审计（HTTP）
 *   S5 重复确认 → 回放原结果，不重复创建（HTTP）
 *   S6 同会话重复输入相同五项 → 命中原提议，显示已执行，不再提示批准（service）
 *   S7 非本组织用户确认 → 拒绝，无业务写入（HTTP）
 */
import assert from "node:assert/strict";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { handleProductWriteCapability } from "../src/modules/assistant-runtime/capabilities/product-write";
import { applyExplicitChatProposal } from "../src/modules/assistant-runtime/proposal-executor";
import { requiresChatUserConfirmation } from "../src/modules/assistant-runtime/autonomy";
import { listProposals } from "../src/modules/advisor/proposals";
import { createSession } from "../src/modules/identity/session";
import type { SessionContext } from "../src/modules/identity/session";
import { OrgRole } from "@prisma/client";

const BASE_URL = process.env.T2_BASE_URL || "";
const TAG = `t2${Date.now()}`;
const results: { id: string; scene: string; result: string; evidence: string }[] = [];
const cleanupOrgIds: string[] = [];
const cleanupUserIds: string[] = [];

function record(id: string, scene: string, result: string, evidence: string) {
  results.push({ id, scene, result, evidence });
  const mark = result === "PASS" ? "✔" : result === "未验证" ? "○" : "✖";
  console.log(`  ${mark} [${id}] ${scene} — ${evidence}`);
}

async function makeOrg(tag: string) {
  const org = await prisma.organization.create({
    data: { name: `org-${tag}`, code: `code-${tag}` },
  });
  const user = await prisma.user.create({
    data: { organizationId: org.id, email: `${tag}@test.local`, name: `u-${tag}` },
  });
  await prisma.organizationMember.create({
    data: { organizationId: org.id, userId: user.id, role: OrgRole.ORG_ADMIN },
  });
  return {
    org,
    user,
    session: {
      userId: user.id,
      organizationId: org.id,
      userEmail: user.email,
      userName: user.name,
    } as SessionContext,
  };
}

async function makeConversation(session: SessionContext, tag: string) {
  return prisma.conversation.create({
    data: { organizationId: session.organizationId, ownerId: session.userId, title: `conv-${tag}` },
  });
}

async function say(conversationId: string, content: string) {
  await prisma.message.create({ data: { conversationId, role: "USER", content } });
}

/** 走一遍对话链路：能力处理器 + 对话自动执行入口（后者对 CREATE_PRODUCT 必须不落库）。 */
async function runIntake(session: SessionContext, conversationId: string, text: string) {
  const result = await handleProductWriteCapability(session, "NEW_PRODUCT_INTAKE", {
    conversationId,
    productId: null,
    text,
    capabilityKeys: null,
  });
  const applied = result
    ? await applyExplicitChatProposal(session, {
        intent: "NEW_PRODUCT_INTAKE",
        runId: "t2-local",
        result,
      })
    : null;
  return applied ?? result!;
}

async function httpConfirm(token: string, proposalId: string, idemKey: string) {
  const res = await fetch(`${BASE_URL}/api/proposals/${proposalId}/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "Idempotency-Key": idemKey,
    },
    body: JSON.stringify({ reason: "T2 闭环验收确认" }),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

async function main() {
  await assertTestDatabaseSafety();
  console.log(`\n▶ T2 新建产品人工确认闭环（tag=${TAG}，HTTP=${BASE_URL || "未启用"}）\n`);

  const ownerA = await makeOrg(`${TAG}a`);
  const other = await makeOrg(`${TAG}b`);
  cleanupOrgIds.push(ownerA.org.id, other.org.id);
  cleanupUserIds.push(ownerA.user.id, other.user.id);
  const convA = await makeConversation(ownerA.session, `${TAG}a`);

  const FIVE = {
    name: `T2 验证产品 ${TAG}`,
    idea: "面向办公室人群的低糖气泡茶",
    audience: "25-35 岁办公室人群",
    points: "低糖、便携、开盖即饮",
    channels: "天猫、抖音",
  };

  // ---------- S1 字段不齐（service） ----------
  await say(convA.id, `名称：${FIVE.name}`);
  await say(convA.id, `一句话想法：${FIVE.idea}`);
  const s1 = await runIntake(ownerA.session, convA.id, "先把这个产品立上");
  const s1ProposalCount = await prisma.actionProposal.count({ where: { conversationId: convA.id } });
  const s1ProductCount = await prisma.product.count({ where: { organizationId: ownerA.org.id } });
  assert.match(s1.text, /入库还缺/, "S1 应返回缺项提示");
  assert.equal(s1.proposal ?? null, null, "S1 不应产出提议");
  assert.equal(s1ProposalCount, 0, "S1 不应写入 ActionProposal");
  assert.equal(s1ProductCount, 0, "S1 不应写入 Product");
  record("S1", "字段不齐返回缺项，不建提议/业务记录（service）", "PASS", `缺项提示命中；proposal=${s1ProposalCount} product=${s1ProductCount}`);

  // ---------- S2 字段齐全（service） ----------
  await say(convA.id, `目标人群：${FIVE.audience}`);
  await say(convA.id, `核心卖点：${FIVE.points}`);
  await say(convA.id, `渠道：${FIVE.channels}`);
  const s2 = await runIntake(ownerA.session, convA.id, "信息齐了，建产品");
  const proposalA = s2.proposal;
  assert.ok(proposalA, "S2 应产出提议");
  assert.equal(proposalA!.actionType, "CREATE_PRODUCT");
  const dbProposalA = await prisma.actionProposal.findUniqueOrThrow({ where: { id: proposalA!.proposalId } });
  assert.equal(dbProposalA.status, "PENDING_CONFIRMATION", "S2 提议应停在待确认");
  assert.equal(dbProposalA.organizationId, ownerA.org.id);
  const s2Products = await prisma.product.count({ where: { organizationId: ownerA.org.id } });
  const s2Projects = await prisma.project.count({ where: { organizationId: ownerA.org.id } });
  assert.equal(s2Products, 0, "S2 不应创建 Product");
  assert.equal(s2Projects, 0, "S2 不应创建 Project");
  // 待确认卡的数据源：确认前必须能在会话的 PENDING_CONFIRMATION 列表里查到（卡片由它渲染）
  const pendingBefore = await listProposals(ownerA.session, {
    conversationId: convA.id,
    status: "PENDING_CONFIRMATION",
  });
  assert.ok(
    pendingBefore.some((p) => p.id === dbProposalA.id),
    "S2 待确认提议应出现在会话待确认列表（提议卡数据源）"
  );
  record(
    "S2",
    "字段齐全 → 待确认提议，产品/版本/项目未写入（service）",
    "PASS",
    `proposal=${dbProposalA.id} status=${dbProposalA.status}；product=${s2Products} project=${s2Projects}；待确认列表含该提议(${(pendingBefore[0] as any)?.actionLabel ?? "n/a"})；自动执行入口未消费 result.proposal`
  );

  // ---------- S3 全委托模式（service） ----------
  const convB = await makeConversation(ownerA.session, `${TAG}full`);
  await prisma.conversation.update({
    where: { id: convB.id },
    data: {
      runtimeConfig: {
        version: "kern-conversation-config/v1",
        modelProfileKey: null,
        advisorCodes: null,
        skillKeys: null,
        capabilityKeys: null,
        capabilityPackIds: null,
        delegationMode: "full",
      },
    },
  });
  await say(convB.id, `名称：T2 全委托产品 ${TAG}`);
  await say(convB.id, `一句话想法：${FIVE.idea}`);
  await say(convB.id, `目标人群：${FIVE.audience}`);
  await say(convB.id, `核心卖点：${FIVE.points}`);
  await say(convB.id, `渠道：${FIVE.channels}`);
  const s3 = await runIntake(ownerA.session, convB.id, "全委托，直接建");
  const dbProposalB = await prisma.actionProposal.findUniqueOrThrow({ where: { id: s3.proposal!.proposalId } });
  const s3Products = await prisma.product.count({ where: { organizationId: ownerA.org.id } });
  assert.equal(dbProposalB.status, "PENDING_CONFIRMATION", "S3 全委托下仍应待确认");
  assert.equal(s3Products, 0, "S3 全委托下不应创建产品");
  assert.equal(requiresChatUserConfirmation("CREATE_PRODUCT"), true, "服务端门禁与授权档位无关");
  record(
    "S3",
    "全委托模式仍停在待确认，不绕过服务端门禁（service）",
    "PASS",
    `conversation.runtimeConfig.delegationMode=full；proposal=${dbProposalB.id} status=${dbProposalB.status}；product 总数=${s3Products}`
  );

  // ---------- S4 / S5 / S7（HTTP：现有确认入口） ----------
  if (!BASE_URL) {
    record("S4", "经现有确认入口批准 → 建产品/版本/项目 + 回执 + 审计（HTTP）", "未验证", "未设置 T2_BASE_URL");
    record("S5", "重复确认回放原结果，不重复创建（HTTP）", "未验证", "未设置 T2_BASE_URL");
    record("S7", "非本组织用户确认被拒绝，无业务写入（HTTP）", "未验证", "未设置 T2_BASE_URL");
  } else {
    const { token } = await createSession(ownerA.user.id, 1);
    const idem = `t2:${TAG}:approve`;

    // S4
    const c1 = await httpConfirm(token, dbProposalA.id, idem);
    assert.equal(c1.status, 200, `S4 confirm 应返回 200，实际 ${c1.status}`);
    const applied = await prisma.actionProposal.findUniqueOrThrow({ where: { id: dbProposalA.id } });
    assert.equal(applied.status, "APPLIED", "S4 提议应变为 APPLIED");
    const product = await prisma.product.findFirst({
      where: { organizationId: ownerA.org.id, name: FIVE.name },
    });
    assert.ok(product, "S4 应创建 Product");
    const versions = await prisma.productVersion.count({ where: { productId: product!.id } });
    const projects = await prisma.project.count({ where: { productId: product!.id } });
    assert.ok(versions >= 1, "S4 应创建初始版本");
    assert.ok(projects >= 1, "S4 应创建对应项目");
    const audits = await prisma.auditEvent.findMany({
      where: { OR: [{ objectId: dbProposalA.id }, { objectId: product!.id }] },
      orderBy: { timestamp: "desc" },
      select: { action: true, objectType: true, objectId: true },
    });
    console.log("  · AUDIT:", JSON.stringify(audits));
    const audit = audits.find((a) => a.action === "ACTION_PROPOSAL_APPLIED") ?? null;
    assert.ok(audit, "S4 应记录 ACTION_PROPOSAL_APPLIED 审计");
    const pendingAfter = await listProposals(ownerA.session, {
      conversationId: convA.id,
      status: "PENDING_CONFIRMATION",
    });
    assert.ok(
      !pendingAfter.some((p) => p.id === dbProposalA.id),
      "S4 批准后不应再出现在待确认列表（卡片应消失）"
    );
    record(
      "S4",
      "经现有确认入口批准 → 建产品/版本/项目 + 回执 + 审计（HTTP）",
      "PASS",
      `POST /api/proposals/${dbProposalA.id}/confirm → 200 receipt=${JSON.stringify(c1.json).slice(0, 100)}；product=${product!.id} versions=${versions} projects=${projects}；审计 ${audit!.action}/${audit!.objectType}；待确认列表已移除该提议`
    );

    // S5
    const productsAfterFirst = await prisma.product.count({ where: { organizationId: ownerA.org.id } });
    const c2 = await httpConfirm(token, dbProposalA.id, idem);
    const c3 = await httpConfirm(token, dbProposalA.id, `t2:${TAG}:approve-2`);
    const productsAfterRepeats = await prisma.product.count({ where: { organizationId: ownerA.org.id } });
    assert.equal(c2.status, 200, "S5 同键重放应 200");
    assert.equal(c2.json.idempotent, true, "S5 同键重放应标记 idempotent");
    assert.equal(c3.status, 200, "S5 换键重复确认应 200（回放）");
    assert.equal(productsAfterRepeats, productsAfterFirst, "S5 重复确认不应新增产品");
    record(
      "S5",
      "重复确认回放原结果，不重复创建（HTTP）",
      "PASS",
      `同键 idempotent=${c2.json.idempotent}；换键 status=${c3.status}；product 数 ${productsAfterFirst} → ${productsAfterRepeats}`
    );

    // S7
    const { token: outsiderToken } = await createSession(other.user.id, 1);
    const c4 = await httpConfirm(outsiderToken, dbProposalB.id, `t2:${TAG}:outsider`);
    const productsAfterOutsider = await prisma.product.count({ where: { organizationId: ownerA.org.id } });
    const outsiderProposal = await prisma.actionProposal.findUniqueOrThrow({ where: { id: dbProposalB.id } });
    // 既有行为：行锁查询按 organizationId 过滤，跨组织提议对该用户不可见 → NotFound(404)，
    // 未落到 assertProposalMutationAuthorized(403)。两者都表示拒绝，这里只要求 4xx 且无写入。
    assert.ok(c4.status === 403 || c4.status === 404, `S7 非本组织用户应被拒绝（403/404），实际 ${c4.status}`);
    assert.equal(outsiderProposal.status, "PENDING_CONFIRMATION", "S7 提议应仍待确认");
    assert.equal(productsAfterOutsider, productsAfterFirst, "S7 不应产生业务写入");
    record(
      "S7",
      "非本组织用户确认被拒绝，无业务写入（HTTP）",
      "PASS",
      `${c4.status} ${JSON.stringify(c4.json).slice(0, 100)}；proposal 仍为 ${outsiderProposal.status}；product 数=${productsAfterOutsider}`
    );
  }

  // ---------- S6 同会话重复输入（service） ----------
  await say(convA.id, `名称：${FIVE.name}`);
  await say(convA.id, `一句话想法：${FIVE.idea}`);
  await say(convA.id, `目标人群：${FIVE.audience}`);
  await say(convA.id, `核心卖点：${FIVE.points}`);
  await say(convA.id, `渠道：${FIVE.channels}`);
  const s6 = await runIntake(ownerA.session, convA.id, "再建一次同样的");
  const productsAfterS6 = await prisma.product.count({ where: { organizationId: ownerA.org.id } });
  assert.equal(s6.proposal!.proposalId, dbProposalA.id, "S6 应命中原提议（幂等键）");
  assert.match(s6.text, /已执行/, "S6 应显示已执行");
  assert.match(s6.text, /本次未重复创建/, "S6 应说明未重复创建");
  assert.doesNotMatch(s6.text, /等待你批准写入/, "S6 不应再提示批准");
  assert.equal(productsAfterS6, 1, "S6 不应重复创建产品");
  record(
    "S6",
    "同会话重复输入相同五项 → 命中原提议，显示已执行（service）",
    "PASS",
    `命中 proposal=${s6.proposal!.proposalId}（= S4 同一条）；文案含「已执行／本次未重复创建」，不含「等待你批准写入」；product 数=${productsAfterS6}`
  );

  // ---------- 汇总 ----------
  console.log("\n▶ 汇总");
  for (const r of results) console.log(`  ${r.id} ${r.result} — ${r.scene}`);
  const failed = results.filter((r) => r.result !== "PASS");
  console.log(`\n▶ 结果：${results.length - failed.length} 通过 / ${failed.length} 未通过或未验证\n`);
}

async function cleanup() {
  const steps: Array<[string, () => Promise<unknown>]> = [
    [
      "auditEvent",
      () =>
        prisma.auditEvent.deleteMany({
          where: { OR: [{ actorId: { in: cleanupUserIds } }, { objectId: { in: cleanupUserIds } }] },
        }),
    ],
    ["organization", () => prisma.organization.deleteMany({ where: { id: { in: cleanupOrgIds } } })],
    [
      "idempotencyRecord",
      () => prisma.idempotencyRecord.deleteMany({ where: { key: { startsWith: `proposal.apply:t2:${TAG}` } } }),
    ],
  ];
  for (const [name, run] of steps) {
    try {
      await run();
    } catch (error) {
      console.error(`⚠ 清理步骤 ${name} 失败：`, (error as Error)?.message ?? String(error));
    }
  }
  console.log(`🧹 已清理 tag=${TAG} 的验收数据`);
}

main()
  .catch((error) => {
    console.error("\n❌ T2 闭环验证失败：", error?.message ?? String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
