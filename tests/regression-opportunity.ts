/**
 * P1-02 回归：机会分析与市场验证
 *
 * 覆盖：
 * 1. 机会类型证据驱动，默认 PENDING 不猜测：
 *      price+salesVolume 已核实 FACT → FOLLOW_HIT_PRODUCT；clue.* 线索 → TREND_NEW_PRODUCT；无证据 → PENDING；
 * 2. 八要素交付，每要素事实/推断/假设三态分列；市场验证未取得保持【待验证】，不生成模型评分；
 * 3. 不凭空生成市场数字：无销量 FACT 时爆品判断与 priceBands 不编造销量；
 * 4. 集成：buildEvidenceInsight → synthesizeMarketResearch 产出的 opportunityAnalysis 类型判定正确。
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { synthesizeOpportunityAnalysis } from "../src/modules/research/opportunity-analysis";
import { buildEvidenceInsight, ResolvedFieldValue } from "../src/modules/research/evidence-claims";
import { synthesizeMarketResearch } from "../src/modules/research/market-research";
import { parseProjectRequirements } from "../src/modules/research/requirement-parser";
import { createProject } from "../src/modules/projects/service";
import { SessionContext } from "../src/modules/identity/session";
import { EvidenceNature, EvidenceVerifyStatus, ProjectMode } from "@prisma/client";

function claim(fieldKey: string, value: string, extra?: Partial<ResolvedFieldValue>): ResolvedFieldValue {
  return { fieldKey, fieldName: fieldKey, value, evidenceId: "e", source: "S", ...extra };
}

async function main() {
  await assertTestDatabaseSafety(prisma);

  const constraints = parseProjectRequirements("开发一款针对白领的条包饮品，主渠道抖音").constraints;

  // ============ 1. 机会类型：证据驱动，默认 PENDING ============
  const pending = synthesizeOpportunityAnalysis({ resolved: [], gaps: [] }, constraints);
  assert.equal(pending.type, "PENDING", "无任何证据→待定，不猜测可上市/有效性结论");
  const marketValEl = pending.elements.find((el) => el.key === "marketValidation")!;
  assert.ok(marketValEl.fact.length === 0, "无市场验证事实");
  assert.ok(marketValEl.inference.some((t) => t.includes("待验证") && t.includes("模型评分替代")), "未取得市场验证保持待验证，不以模型评分替代");
  console.log("✓ 无证据 → 机会类型 PENDING，市场验证【待验证】不生成模型评分");

  // price + salesVolume 已核实 FACT → FOLLOW_HIT_PRODUCT
  const follow = synthesizeOpportunityAnalysis(
    { resolved: [claim("price", "59.9"), claim("salesVolume", "月销5万+")], gaps: [] },
    constraints
  );
  assert.equal(follow.type, "FOLLOW_HIT_PRODUCT", "已核实价格+销量→爆品跟进");
  console.log("✓ 已核实价格+销量 → 爆品跟进 FOLLOW_HIT_PRODUCT");

  // 仅线索 → TREND_NEW_PRODUCT，且线索≠结论
  const trend = synthesizeOpportunityAnalysis(
    { resolved: [claim("clue.policy", "新规放开某成分使用")], gaps: [] },
    constraints
  );
  assert.equal(trend.type, "TREND_NEW_PRODUCT", "线索证据→趋势型新品");
  assert.equal(trend.basis.policy.length, 1, "政策线索归类到 basis.policy");
  console.log("✓ 线索证据 → 趋势型 TREND_NEW_PRODUCT，basis.policy 记录线索");

  // 有价格无销量：爆品判断不成立，销量不编造
  const noVolume = synthesizeOpportunityAnalysis({ resolved: [claim("price", "59.9")], gaps: [] }, constraints);
  assert.ok(noVolume.type !== "FOLLOW_HIT_PRODUCT", "缺销量→不判爆品跟进");
  const pricingEl = noVolume.elements.find((el) => el.key === "competitorPricing")!;
  assert.ok(pricingEl.inference.some((t) => t.includes("未取得已核实销量")), "缺销量明确标注待验证，不编造");
  console.log("✓ 缺销量 → 不判爆品，销量明确【待验证】不编造");

  // ============ 2. 八要素三态分列 ============
  const elementKeys = follow.elements.map((el) => el.key);
  assert.deepEqual(
    elementKeys,
    ["targetUserAndNeed", "channelFit", "competitorPricing", "evidenceDifferentiator", "marketValidation", "keyCounterEvidence", "dataGaps", "nextSteps"],
    "八要素齐全"
  );
  for (const el of follow.elements) {
    assert.ok(Array.isArray(el.fact) && Array.isArray(el.inference) && Array.isArray(el.assumption), `${el.key} 三态分列`);
  }
  console.log("✓ 八要素齐全，每要素事实/推断/假设三态分列");

  // ============ 3. business-baseline 常量存在且被后续服务端阻断引用（编译期验证） ============
  const { BUSINESS_BASELINE } = await import("../src/config/business-baseline");
  assert.equal(BUSINESS_BASELINE.priceRequired, true, "价格必填基线存在");
  assert.equal(BUSINESS_BASELINE.followHitRequiresSalesVolume, true, "爆品跟进需销量基线存在");
  console.log("✓ 业务基线常量生效（priceRequired / followHitRequiresSalesVolume）");

  // ============ 4. 集成：buildEvidenceInsight → synthesizeMarketResearch 产出机会分析 ============
  const org = await prisma.organization.upsert({
    where: { code: `P1OPP_${randomUUID().slice(0, 8)}` },
    update: {},
    create: { name: "回归机会机构", code: `P1OPP_${randomUUID().slice(0, 8)}` },
  });
  const owner = await prisma.user.upsert({
    where: { email: `opp_${randomUUID().slice(0, 8)}@hermes.test` },
    update: { organizationId: org.id },
    create: { organizationId: org.id, name: "机会测试", email: `opp_${randomUUID().slice(0, 8)}@hermes.test` },
  });
  const session: SessionContext = { userId: owner.id, organizationId: org.id, userName: owner.name, userEmail: owner.email };
  const project = await createProject(session, { title: "机会分析回归", target: "验证机会类型判定", mode: ProjectMode.NEW_PRODUCT });
  await prisma.project.update({ where: { id: project.id }, data: { isDemo: true } });

  // 已核实价格+销量 FACT 证据
  const ev = await prisma.evidence.create({
    data: {
      projectId: project.id,
      contentOrUri: "竞品X 抖音月销5万+，到手价59.9元/盒",
      source: "抖音商城录屏",
      hash: randomUUID(),
      nature: EvidenceNature.REAL,
      verifyStatus: EvidenceVerifyStatus.VERIFIED,
      verifiedByUserId: owner.id,
      verifiedAt: new Date(),
      claims: {
        create: [
          { fieldKey: "price", fieldName: "竞品价格", kind: "FACT", value: "59.9", currency: "CNY", unit: "盒", mechanism: "到手价", spec: "30条/盒" },
          { fieldKey: "salesVolume", fieldName: "竞品销量", kind: "FACT", value: "月销5万+" },
        ],
      },
    },
  });
  const insight = buildEvidenceInsight([
    { source: ev.source, verifyStatus: ev.verifyStatus, claims: (await prisma.evidenceClaim.findMany({ where: { evidenceId: ev.id } })) as any },
  ]);
  const report = synthesizeMarketResearch(project.id, "草本固体茶饮", constraints, [{ id: ev.id, content: ev.contentOrUri, source: ev.source }], insight.resolved);
  assert.equal(report.opportunityAnalysis.type, "FOLLOW_HIT_PRODUCT", "集成链路机会类型应为爆品跟进");
  assert.ok(report.opportunityAnalysis.elements.length === 8, "报告含八要素机会分析");
  console.log("✓ 集成：buildEvidenceInsight → synthesizeMarketResearch → opportunityAnalysis.type=FOLLOW_HIT_PRODUCT");

  console.log("\n✅ P1-02 机会分析与市场验证回归全部通过");
  return { orgId: org.id, userId: owner.id, projectId: project.id, evidenceId: ev.id };
}

main()
  .then(async (ctx) => {
    if (ctx) {
      await prisma.evidenceClaim.deleteMany({ where: { evidenceId: ctx.evidenceId } });
      await prisma.evidence.deleteMany({ where: { projectId: ctx.projectId } });
      await prisma.dataGap.deleteMany({ where: { projectId: ctx.projectId } });
      await prisma.auditEvent.deleteMany({ where: { actorId: ctx.userId } });
      await prisma.project.deleteMany({ where: { id: ctx.projectId } });
      await prisma.user.deleteMany({ where: { organizationId: ctx.orgId } });
      await prisma.organization.deleteMany({ where: { id: ctx.orgId } });
    }
  })
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());