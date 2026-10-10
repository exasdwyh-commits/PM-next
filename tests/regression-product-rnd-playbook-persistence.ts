/**
 * R2 回归：Playbook 确认后的产品落库必须真实、幂等、失败可感知。
 *
 * 背景（现象级需求）：
 * - 「对话里说的新品，最后没有真的入库」——playbook 此前在 $transaction 外裸
 *   create 且失败只剩 console.error，对外不可感知；
 * - 「二次确认不要产生重复产品」——此前每次执行都重新 create，没有幂等键。
 *
 * 本回归的证据链：
 * R2-1 首次执行 → CREATED，product 行真实存在且可按 identityCode / id 查询；
 * R2-2 同参数重复执行 → REUSED，同 id，全库同名产品仍只有一条（无重复产品）；
 * R2-3 落库条件不成立（项目不存在）→ FAILED，错误文本可感知，不静默、不创建产品；
 * R2-4 IdempotencyRecord 记录了幂等键（重放的物理凭据）。
 *
 * 运行方式与 product-rnd-fusion 相同：DB-backed 回归，经 scripts/run-test.ts 在 CI 执行。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { OrgRole, Role } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Explicit test database required");
  await assertTestDatabaseSafety(prisma);

  const { ensurePlaybookProduct } = await import("../src/modules/product-rnd/playbook");

  const tag = randomUUID();
  const org = await prisma.organization.create({
    data: { name: "Playbook Persistence Test", code: "PLB_" + tag },
  });
  const owner = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: `plb-${tag}@hermes.test`,
      name: "Playbook Persistence Owner",
    },
  });
  await prisma.organizationMember.create({
    data: { organizationId: org.id, userId: owner.id, role: OrgRole.ORG_ADMIN },
  });
  const project = await prisma.project.create({
    data: {
      organizationId: org.id,
      title: "睡前晚安饮",
      target: "评估市场、法规与成本是否值得打样",
      constraints: "不把模型意见当事实",
      ownerId: owner.id,
    },
  });
  await prisma.projectMember.create({
    data: { projectId: project.id, userId: owner.id, role: Role.OWNER },
  });

  const baseInput = {
    organizationId: org.id,
    userId: owner.id,
    projectId: project.id,
    missionId: `playbook-mission-${tag}`,
    productIdea: "睡前晚安饮（R2 幂等性样品）",
  } as const;

  try {
    console.log("▶ PLB-1 首次确认：产品真实落库且可查询");
    const first = await ensurePlaybookProduct({ ...baseInput });
    assert.deepEqual({ status: first.status, error: first.error }, { status: "CREATED", error: undefined });
    assert.ok(first.productId, "首次创建必须回传 productId");

    const fetched = await prisma.product.findUnique({ where: { id: first.productId! } });
    assert.ok(fetched, "productId 必须可查询到真实产品行");
    assert.equal(fetched.organizationId, org.id);
    assert.ok(fetched.identityCode.length > 0, "identityCode 必填非空");
    assert.equal(fetched.sourceKind, "AI_EXTRACTED");
    const byCode = await prisma.product.findFirst({
      where: { organizationId: org.id, identityCode: fetched.identityCode },
    });
    assert.equal(byCode?.id, first.productId, "按 组织+identityCode 也必须唯一可查询");
    console.log(`   落库证据: productId=${first.productId} identityCode=${fetched.identityCode}`);

    const projectLink = await prisma.project.findMany({
      where: { productId: first.productId! },
      select: { id: true },
    });
    assert.deepEqual(projectLink.map((p) => p.id), [project.id], "产品必须挂回发起它的项目");

    console.log("▶ PLB-2 同参数二次确认：不产生重复产品（CREATED→REUSED）");
    const second = await ensurePlaybookProduct({ ...baseInput });
    assert.equal(second.status, "REUSED", `二次确认应走幂等重放，实际 ${second.status}`);
    assert.equal(second.productId, first.productId, "幂等重放必须返还原 productId");
    const countAfterReplay = await prisma.product.count({
      where: { organizationId: org.id, name: { startsWith: "睡前晚安饮（R2 幂等性样品）" } },
    });
    assert.equal(countAfterReplay, 1, `二次确认后店内同名产品应仍为 1，实际 ${countAfterReplay}`);

    console.log("▶ PLB-3a 不同构想各自建品：幂等键互不串扰");
    const other = await ensurePlaybookProduct({ ...baseInput, productIdea: "运动后电解质水（R2 对照样品）" });
    assert.equal(other.status, "CREATED");
    assert.notEqual(other.productId, first.productId);

    console.log("▶ PLB-3b 真实入库路径同码对抗：唯一约束与换码重试都在工作（工程证伪）");
    const { createDevelopmentProduct } = await import("../src/modules/products/service");
    const session = { userId: owner.id, organizationId: org.id, userEmail: owner.email, userName: owner.name };
    const ingest = {
      name: "查重样品产品",
      coreIdea: "同码查重样品（验证唯一约束）",
      targetAudience: "测试回归人群",
      coreSellingPoints: "稳定可查",
      targetChannels: "回归渠道",
    } as const;
    // 入库走组织对+名称生成 identityCode，同名两次必撞同码 → 依靠 service 的换码重试补建。
    // 两次必须建成且码不同，证明 (organizationId, identityCode) 唯一约束+重试通道真实在守。
    const ingestedA = await createDevelopmentProduct(session, { ...ingest });
    const ingestedB = await createDevelopmentProduct(session, { ...ingest });
    assert.notEqual(
      ingestedA.product.identityCode,
      ingestedB.product.identityCode,
      "两次真实入库必须落出不同的 identityCode",
    );
    // playbook 路径同码对抗：换构想=换幂等键，即使 identityCode 前缀相同也能靠换码重试 CREATED。
    const playbookDup = await ensurePlaybookProduct({ ...baseInput, productIdea: "查重样品产品" });
    assert.equal(playbookDup.status, "CREATED", `撞码应自动换码建成，实际 ${playbookDup.status} (${playbookDup.error})`);
    assert.ok(playbookDup.productId, "必须回传真实 productId");
    const replayDup = await ensurePlaybookProduct({ ...baseInput, productIdea: "查重样品产品" });
    assert.equal(replayDup.status, "REUSED");
    assert.equal(replayDup.productId, playbookDup.productId);
    const dupCount = await prisma.product.count({ where: { organizationId: org.id, name: "查重样品产品" } });
    assert.equal(dupCount, 3, "同组织同名应按幂等键各成一行（重放不新增）");

    console.log("▶ PLB-4 落库前提不成立：失败可感知、不静默、不留半产品");
    const failing = await ensurePlaybookProduct({
      ...baseInput,
      productIdea: "必败样品（项目不存在）",
      projectId: "proj_missing_for_r2_regression",
    });
    assert.equal(failing.status, "FAILED", `项目缺失时应如实报 FAILED，实际 ${failing.status}`);
    assert.ok(typeof failing.error === "string" && failing.error.length > 0, "FAILED 必须带可感知错误文本");
    assert.equal(failing.productId, undefined, "FAILED 不得回传不存在的 productId");
    const leaked = await prisma.product.count({
      where: { organizationId: org.id, name: { startsWith: "必败样品" } },
    });
    assert.equal(leaked, 0, `失败路径不得留下半拉产品，实际 ${leaked}`);

    console.log("▶ PLB-5 幂等记录实物凭据");
    const idemKeyPrefix = `product-rnd-playbook:${org.id}:create-product:`;
    const records = await prisma.idempotencyRecord.findMany({
      where: { key: { startsWith: idemKeyPrefix } },
    });
    assert.equal(records.length, 2, `两次 CREATED 各留一条幂等记录，实际 ${records.length}`);
    for (const rec of records) {
      assert.equal(rec.commandScope, "product-rnd-playbook.create-product");
      assert.equal(rec.actorId, owner.id);
      assert.ok(rec.requestHash.length === 64, "requestHash 为 sha256 摘要");
    }
  } finally {
    await prisma.idempotencyRecord.deleteMany({
      where: { key: { startsWith: `product-rnd-playbook:${org.id}:create-product:` } },
    });
    // PLB-3b 走真实入库渠道写下审计行（actorId FK 阻组织级联删），先清审计再删组织。
    await prisma.auditEvent.deleteMany({ where: { actorId: owner.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.$disconnect();
  }

  console.log("✔ playback persistence regression passed");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
