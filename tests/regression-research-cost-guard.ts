/**
 * Research fetch cost guard（`checkAndCharge`，/api/research/fetch 的准入）— DB regression.
 *
 * 覆盖 P0-D 遗留的一个洞：闸门走 Organization 行上的 `modelCallUsed < modelCallQuota`
 * 原子扣减，但代码只看事务开始时的读数、**不看 UPDATE 的命中行数**。并发时多个请求
 * 都会通过软预检，随后 WHERE 已经拦下的那些（命中 0 行）照样拿到 `allowed: true` ——
 * 上限被冲破、UsageLedger 被多记。
 *
 * 断言：
 *  - 配额只剩 1 时，8 个并发请求只放行 1 个，其余诚实拒绝（reason 指向上限）；
 *  - 被拒的请求不带预留号、不留 UsageLedger 行，也不再多占配额；
 *  - 组织之间互不影响（另一个组织照常放行）。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { checkAndCharge } from "../src/modules/model-gateway/cost-guard";

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Explicit test database required");
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID();
  const org = await prisma.organization.create({
    data: { name: "Research guard", code: "RG_" + tag, modelCallQuota: 1, modelCallUsed: 0 },
  });
  const otherOrg = await prisma.organization.create({
    data: { name: "Research guard isolation", code: "RGI_" + tag, modelCallQuota: 1, modelCallUsed: 0 },
  });
  try {
    console.log("▶ CG1 配额只剩 1 时，8 个并发只有 1 个能拿到准入");
    const burst = await Promise.all(
      Array.from({ length: 8 }, () =>
        checkAndCharge({ organizationId: org.id, taskClass: "research_fetch", estimatedTokens: 500 })
      )
    );
    const allowed = burst.filter((r) => r.allowed);
    assert.equal(
      allowed.length,
      1,
      "并发下最多放行到上限为止；多放行说明准入没有以 UPDATE 的命中行数为准（fail open）"
    );
    for (const refused of burst.filter((r) => !r.allowed)) {
      assert.equal(refused.reservationId, undefined, "被拒的请求不该带预留号");
      assert.match(String(refused.reason), /上限/, "拒绝理由必须说清是配额上限");
    }

    const after = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } });
    assert.equal(after.modelCallUsed, 1, "只应扣减一次");
    assert.equal(
      await prisma.usageLedger.count({ where: { organizationId: org.id, eventType: "research_call" } }),
      1,
      "被拒的请求不该留下 UsageLedger 行"
    );

    console.log("▶ CG2 已到上限后再来一笔：直接拒绝");
    const again = await checkAndCharge({ organizationId: org.id, taskClass: "research_fetch" });
    assert.equal(again.allowed, false);
    assert.equal(again.remaining, 0);

    console.log("▶ CG3 组织之间互不影响");
    const other = await checkAndCharge({ organizationId: otherOrg.id, taskClass: "research_fetch" });
    assert.equal(other.allowed, true, "另一个组织有自己的配额，不该被本组织拖住");
    assert.equal(other.remaining, 0);
  } finally {
    await prisma.usageLedger.deleteMany({ where: { organizationId: { in: [org.id, otherOrg.id] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [org.id, otherOrg.id] } } });
    await prisma.$disconnect();
  }
  console.log("Research cost guard passed: concurrency never oversells, refusals stay honest.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
