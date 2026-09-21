/**
 * P1-01 回归：统一证据结构与缺口 (EvidenceClaim + DataGap)
 *
 * 覆盖：
 * 1. normalizeEvidenceClaim：价格类 FACT 缺单位/机制被拒绝，杜绝单盒价与组合装价混算；
 * 2. 证据录入断言持久化（service 层与 prisma 级联 create）+ 未核实不阻断事实；
 * 3. pickResolvedClaims：仅已核实 FACT 入选；INFERENCE/ASSUMPTION 一律不作事实；冲突并列 + 选用理由；
 * 4. computeEvidenceGaps：缺失关键业务字段保持 OPEN 缺口，不自动补成事实，不凭空生成市场数字。
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import {
  normalizeEvidenceClaim,
  EvidenceClaimInput,
  pickResolvedClaims,
  computeEvidenceGaps,
} from "../src/modules/research/evidence-claims";
import { EvidenceNature, EvidenceVerifyStatus, ProjectMode } from "@prisma/client";
import { createProject } from "../src/modules/projects/service";
import { SessionContext } from "../src/modules/identity/session";

async function main() {
  await assertTestDatabaseSafety(prisma);

  // ============ 1. 断言规范化：价格必须带单位与机制 ============
  const baseClaim: EvidenceClaimInput = {
    fieldKey: "price",
    fieldName: "竞品价格",
    kind: "FACT",
    value: "59.9",
    unit: "盒",
    mechanism: "到手价",
    applicableProduct: "某竞品茶粉",
    applicableChannel: "抖音",
  };
  assert.ok(normalizeEvidenceClaim(baseClaim, 0), "合法价格断言应通过规范化");

  const noUnit = { ...baseClaim, unit: undefined };
  assert.throws(() => normalizeEvidenceClaim(noUnit, 0), /计价单位/);

  const noMechanism = { ...baseClaim, mechanism: undefined };
  assert.throws(() => normalizeEvidenceClaim(noMechanism, 0), /计价机制/);

  assert.throws(
    () => normalizeEvidenceClaim({ fieldKey: "salesVolume", fieldName: "销量", kind: "FACT", value: "" }, 0),
    /缺少取值/
  );
  assert.throws(
    () => normalizeEvidenceClaim({ fieldKey: "x", fieldName: "x", kind: "BOGUS" as any, value: "1" }, 0),
    /取值类型非法/
  );
  console.log("✓ 断言规范化：价格类 FACT 缺单位/机制被拒绝，非法 kind/value 被拒绝");

  // ============ 2. 录入断言持久化 + 缺口 ============
  const org = await prisma.organization.upsert({
    where: { code: `P1EVID_${randomUUID().slice(0, 8)}` },
    update: {},
    create: { name: "回归证据机构", code: `P1EVID_${randomUUID().slice(0, 8)}` },
  });
  const owner = await prisma.user.upsert({
    where: { email: `evid_${randomUUID().slice(0, 8)}@hermes.test` },
    update: { organizationId: org.id },
    create: { organizationId: org.id, name: "证据测试", email: `evid_${randomUUID().slice(0, 8)}@hermes.test` },
  });
  const session: SessionContext = { userId: owner.id, organizationId: org.id, userName: owner.name, userEmail: owner.email };

  const project = await createProject(session, {
    title: "证据结构回归",
    target: "验证统一证据结构",
    mode: ProjectMode.NEW_PRODUCT,
  });
  await prisma.project.update({ where: { id: project.id }, data: { isDemo: true } });
  const projectId = project.id;

  // 录入一条证据并附带断言：一条 VERIFIED FACT 价格 + 一条 INFERENCE + 一条 ASSUMPTION
  const ev1 = await prisma.evidence.create({
    data: {
      projectId,
      contentOrUri: "竞品A 抖音到手价 59.9 元/盒（30条）",
      source: "抖音商城录屏",
      hash: randomUUID(),
      nature: EvidenceNature.REAL,
      verifyStatus: EvidenceVerifyStatus.VERIFIED,
      verifiedByUserId: owner.id,
      verifiedAt: new Date(),
      productRef: "竞品A",
      channel: "抖音",
      claims: {
        create: [
          { fieldKey: "price", fieldName: "竞品价格", kind: "FACT", value: "59.9", currency: "CNY", unit: "盒", mechanism: "到手价", spec: "30条/盒", applicableProduct: "竞品A", applicableChannel: "抖音" },
          { fieldKey: "salesVolume", fieldName: "竞品销量", kind: "INFERENCE", value: "预估月销过万", applicableProduct: "竞品A" },
          { fieldKey: "targetAudience", fieldName: "目标人群", kind: "ASSUMPTION", value: "25-35岁女性" },
        ],
      },
    },
  });

  const rows = await prisma.evidenceClaim.findMany({ where: { evidenceId: ev1.id } });
  assert.equal(rows.length, 3, "应持久化 3 条断言");
  assert.equal(rows.filter((r) => r.kind === "FACT").length, 1);

  // 未核实证据 + 冲突来源断言：不应进入事实，且不静默覆盖
  const ev2 = await prisma.evidence.create({
    data: {
      projectId,
      contentOrUri: "竞品B 组合装价 169 元/6盒",
      source: "拼多多页面",
      hash: randomUUID(),
      nature: EvidenceNature.REAL,
      verifyStatus: EvidenceVerifyStatus.UNVERIFIED,
      claims: {
        create: [
          { fieldKey: "price", fieldName: "竞品价格", kind: "FACT", value: "28.2", currency: "CNY", unit: "盒", mechanism: "组合装价", spec: "6盒/组", applicableProduct: "竞品B", applicableChannel: "拼多多", conflictGroup: "竞品B价格", selectionReason: null },
        ],
      },
    },
  });

  // 3. pickResolvedClaims：仅 VERIFIED FACT 入选
  const rawClaims = [
    ...(await prisma.evidenceClaim.findMany({ where: { evidenceId: ev1.id } })),
    ...(await prisma.evidenceClaim.findMany({ where: { evidenceId: ev2.id } })),
  ];
  const [ef1, ef2] = await Promise.all([
    prisma.evidence.findUnique({ where: { id: ev1.id } }),
    prisma.evidence.findUnique({ where: { id: ev2.id } }),
  ]);
  const claimRows = rawClaims.map((c) => {
    const ev = c.evidenceId === ev1.id ? ef1! : ef2!;
    return { ...c, evidence: { source: ev.source, verifyStatus: ev.verifyStatus } };
  });
  const { selected, conflicts } = pickResolvedClaims(claimRows);
  // 仅 ev1 的 price FACT 是 VERIFIED FACT；ev2 的 price 未核实、salesVolume 是 INFERENCE、targetAudience 是 ASSUMPTION
  assert.equal(selected.length, 1, "仅已核实 FACT 入选");
  assert.equal(selected[0].fieldKey, "price");
  assert.equal(selected[0].value, "59.9");
  assert.equal(conflicts.length, 0, "不同来源未核实断言不构成已核实冲突");
  console.log("✓ pickResolvedClaims：仅已核实 FACT 入选，INFERENCE/ASSUMPTION/未核实一律不作事实");

  // 4. computeEvidenceGaps：已覆盖 price，其余关键字段缺失应记为缺口
  const gaps = computeEvidenceGaps(selected.map((s) => s.fieldKey));
  const gapKeys = gaps.map((g) => g.fieldKey);
  assert.ok(!gapKeys.includes("price"), "price 已被 FACT 覆盖，不应为缺口");
  for (const key of ["salesVolume", "netWeight", "dosageForm", "targetAudience", "channel"]) {
    assert.ok(gapKeys.includes(key), `关键字段 ${key} 缺失应记为缺口`);
  }
  console.log(`✓ computeEvidenceGaps：已覆盖价格不为缺口，${gapKeys.join("/")} 记录为缺口（保持 UNKNOWN 不补成事实）`);

  // 5. DataGap 持久化（模拟 evidence-gaps 路由 upsert）
  for (const g of gaps) {
    await prisma.dataGap.upsert({
      where: { projectId_fieldKey: { projectId, fieldKey: g.fieldKey } },
      create: { projectId, fieldKey: g.fieldKey, fieldName: g.fieldName, description: g.description, status: "OPEN" },
      update: {},
    });
  }
  const persistedGaps = await prisma.dataGap.count({ where: { projectId, status: "OPEN" } });
  assert.ok(persistedGaps >= 5, `DataGap 应持久化缺口，实际 ${persistedGaps}`);
  console.log(`✓ DataGap 持久化：projectId 下 OPEN 缺口 ${persistedGaps} 条`);

  console.log("\n✅ P1-01 统一证据结构回归全部通过");
  return { orgId: org.id, userId: owner.id, projectId, evidenceIds: [ev1.id, ev2.id] };
}

main()
  .then(async (ctx) => {
    if (ctx) {
      await prisma.evidenceClaim.deleteMany({ where: { evidenceId: { in: ctx.evidenceIds } } });
      await prisma.auditEvent.deleteMany({ where: { actorId: ctx.userId } });
      await prisma.evidence.deleteMany({ where: { projectId: ctx.projectId } });
      await prisma.dataGap.deleteMany({ where: { projectId: ctx.projectId } });
      await prisma.project.deleteMany({ where: { id: ctx.projectId } });
      await prisma.user.deleteMany({ where: { organizationId: ctx.orgId } });
      await prisma.organization.deleteMany({ where: { id: ctx.orgId } });
    }
  })
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());