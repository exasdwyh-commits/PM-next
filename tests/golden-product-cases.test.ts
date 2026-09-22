import assert from "node:assert/strict";
import test from "node:test";

import { parseProjectRequirements } from "../src/modules/research/requirement-parser";
import { generateChallengeReport } from "../src/modules/advisor/challenge";
import type { ScientificEvidenceInput } from "../src/modules/research/scientific-evidence";

test("Golden Case · AKG 半年套餐：结构化真实需求并把减龄高客单识别为关键风险", () => {
  const parsed = parseProjectRequirements(
    "面向35岁以上人群，主做私域和会销，1999元半年套餐，赠甲基化年龄检测，希望挑战减龄1-3年，无效退款。"
  );

  assert.equal(parsed.constraints.minAge, 35);
  assert.equal(parsed.constraints.maxAge, null);
  assert.equal(parsed.constraints.targetAudience, "35岁以上人群");
  assert.equal(parsed.constraints.targetPrice, 1999);
  assert.equal(parsed.constraints.targetDurationMonths, 6);
  assert.deepEqual(parsed.constraints.targetChannels, ["私域/社群电商渠道"]);
  assert.ok(parsed.constraints.requestedClaims.includes("减龄"));
  assert.ok(parsed.constraints.requestedClaims.includes("甲基化年龄"));
  assert.equal(parsed.constraints.forbiddenClaims.length, 0);

  const akg: ScientificEvidenceInput = {
    ingredient: "Ca-AKG",
    aliases: ["AKG", "α-酮戊二酸"],
    claim: "支持健康老龄化相关代谢研究",
    evidenceLevel: "B",
    humanRCTCount: 1,
    sampleSizeTotal: 120,
    doseRange: "1 g/day",
    mechanism: "代谢与表观遗传相关机制仍需成品验证",
    applicablePopulation: "成年人",
    marketingSay: "支持健康老龄化研究方向",
    marketingNever: "减龄、逆龄、年轻3年",
    confidence: 70,
    lastReviewed: "2026-09-22",
    status: "CONFIRMED",
    sourceType: "RAW_MATERIAL_STUDY",
    researchSubjects: "HUMAN",
  };

  const report = generateChallengeReport({
    productName: "AKG 钙半年套餐",
    proposedClaim: "挑战减龄1-3年，无效退款",
    targetPrice: 1999,
    targetDuration: "6个月",
    ingredients: [akg],
    competitorCount: 1,
  });

  assert.equal(report.overallRisk, "CRITICAL");
  assert.equal(report.recommendation, "KILL");
  assert.ok(report.reviewTriggers.some((reason) => reason.includes("高定价")));
  assert.ok(report.topFailureReasons.some((reason) => reason.includes("营销红线")));
  assert.ok(report.vetoData.some((item) => item.includes("甲基化年龄")));
});

test("Golden Case · 骆驼奶+AOS：多档套餐/成本/中老年渠道被正确解析，缺证据必须暂停", () => {
  const parsed = parseProjectRequirements(
    "面向中老年，主做私域+会销，骆驼奶蛋白粉+AOS，售价299元12盒，499元24盒，总成本不超过18元，禁止添加蔗糖。"
  );

  assert.equal(parsed.constraints.targetAudience, "中老年及银发族");
  assert.equal(parsed.constraints.targetPrice, 299);
  assert.equal(parsed.constraints.maxCostLimit, 18);
  assert.deepEqual(
    parsed.constraints.priceOffers.map((offer) => [offer.price, offer.quantity, offer.unit]),
    [
      [299, 12, "盒"],
      [499, 24, "盒"],
    ]
  );
  assert.deepEqual(parsed.constraints.targetChannels, ["私域/社群电商渠道"]);
  assert.ok(parsed.constraints.forbiddenIngredients.includes("蔗糖"));

  const report = generateChallengeReport({
    productName: "骆驼奶+AOS",
    proposedClaim: "支持老年人肠道健康与饮用舒适度",
    targetPrice: 499,
    ingredients: [],
    competitorCount: 0,
  });

  assert.equal(report.evidenceScope.matched, 0);
  assert.equal(report.recommendation, "PAUSE");
  assert.ok(report.topFailureReasons[0].includes("未匹配到任何原料证据卡"));
  assert.ok(report.evidenceScope.note.includes("无依据"));
});

test("Golden Case · AKK 后生元：禁止宣称不能反向污染为卖点，营销红线必须被挑战", () => {
  const parsed = parseProjectRequirements(
    "快手直播电商，售价200-300元，主打AKK后生元，禁止宣称减肥，不使用活菌益生菌。"
  );

  assert.equal(parsed.constraints.minRetailPrice, 200);
  assert.equal(parsed.constraints.maxRetailPrice, 300);
  assert.deepEqual(parsed.constraints.targetChannels, ["公域短视频/直播电商"]);
  assert.ok(parsed.constraints.forbiddenClaims.includes("减肥"));
  assert.ok(!parsed.constraints.requestedClaims.includes("减肥"));
  assert.ok(parsed.constraints.forbiddenIngredients.includes("益生菌"));

  const akk: ScientificEvidenceInput = {
    ingredient: "AKK 后生元",
    aliases: ["Akkermansia", "AKK"],
    claim: "支持肠道屏障与代谢健康研究方向",
    evidenceLevel: "B",
    humanRCTCount: 1,
    sampleSizeTotal: 80,
    doseRange: "按原料规格与成品方案确认",
    mechanism: "肠道屏障与代谢相关机制",
    applicablePopulation: "成年人",
    marketingSay: "支持肠道健康",
    marketingNever: "减肥、瘦身、燃脂",
    confidence: 75,
    lastReviewed: "2026-09-22",
    status: "CONFIRMED",
    sourceType: "RAW_MATERIAL_STUDY",
    researchSubjects: "HUMAN",
  };

  const report = generateChallengeReport({
    productName: "AKK 后生元",
    proposedClaim: "瘦子菌帮助减肥",
    targetPrice: 299,
    ingredients: [akk],
    competitorCount: 2,
  });

  assert.equal(report.overallRisk, "HIGH");
  assert.notEqual(report.recommendation, "PROCEED");
  assert.ok(report.topFailureReasons.some((reason) => reason.includes("营销红线")));
  assert.ok(report.reviewTriggers.some((reason) => reason.includes("强功效词")));
});
