/**
 * advisor/challenge — 单元测试
 *
 * 验证点：
 *   1. 完整挑战报告结构（所有必填字段存在）
 *   2. 证据等级过低时生成失败原因
 *   3. 营销红线触碰时生成失败原因
 *   4. 甲基化宣称触发特定否决数据与实验
 *   5. 置信度 < 50 时推荐单原料 MVP
 *   6. 从 frontmatter 解析证据卡
 *
 * Run: node --import tsx --test src/modules/advisor/challenge.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateChallengeReport, matchRelevantIngredients, parseIngredientFrontmatter } from "./challenge";
import type { ScientificEvidenceInput } from "../research/scientific-evidence";

// ── 测试工具 ──────────────────────────────────────────

function makeIngredient(overrides: Partial<ScientificEvidenceInput> = {}): ScientificEvidenceInput {
  return {
    ingredient: "AKG",
    claim: "支持健康老龄化",
    evidenceLevel: "B",
    humanRCTCount: 2,
    sampleSizeTotal: 110,
    doseRange: "1-3 g/day",
    mechanism: "mTOR / AMPK",
    marketingSay: "支持健康老龄化",
    marketingNever: "逆龄/延寿",
    confidence: 72,
    lastReviewed: "2026-09-19",
    status: "CONFIRMED",
    ...overrides,
  };
}

// ── 挑战报告生成 ─────────────────────────────────────

describe("generateChallengeReport", () => {
  it("完整报告包含所有必填字段", () => {
    const report = generateChallengeReport({
      productName: "AKG 半年套餐",
      proposedClaim: "支持健康老龄化",
      ingredients: [makeIngredient()],
    });

    assert.ok(report.productName);
    assert.ok(report.generatedAt);
    assert.ok(Array.isArray(report.reviewTriggers));
    assert.ok(Array.isArray(report.topFailureReasons));
    assert.ok(Array.isArray(report.unvalidatedAssumptions));
    assert.ok(Array.isArray(report.vetoData));
    assert.ok(Array.isArray(report.cheapestExperiments));
    assert.ok(report.recommendedMVP);
    assert.ok(report.overallRisk);
    assert.ok(report.recommendation);
  });

  it("证据等级 C/D 时生成失败原因", () => {
    const report = generateChallengeReport({
      productName: "AKK 代谢套餐",
      proposedClaim: "改善代谢",
      ingredients: [makeIngredient({ ingredient: "AKK", evidenceLevel: "C", confidence: 40 })],
    });

    assert.ok(report.topFailureReasons.some((r) => r.includes("AKK(C)")));
    assert.ok(report.recommendation !== "PROCEED");
  });

  it("营销红线触碰时生成失败原因", () => {
    const report = generateChallengeReport({
      productName: "AKG 逆龄套餐",
      proposedClaim: "半年逆龄5岁",
      ingredients: [makeIngredient({ marketingNever: "逆龄/年轻5岁" })],
    });

    assert.ok(report.topFailureReasons.some((r) => r.includes("触碰营销红线")));
  });

  it("甲基化宣称触发特定否决数据", () => {
    const report = generateChallengeReport({
      productName: "AKG 甲基化套餐",
      proposedClaim: "改善甲基化年龄",
      ingredients: [makeIngredient()],
    });

    assert.ok(report.vetoData.some((v) => v.includes("若后续") && v.includes("甲基化年龄无变化")));
    assert.ok(report.cheapestExperiments.some((e) => e.includes("甲基化时钟平台对比")));
  });

  it("置信度 < 50 时推荐单原料小规格 MVP", () => {
    const report = generateChallengeReport({
      productName: "AKK 减肥套餐",
      proposedClaim: "改善代谢",
      targetDuration: "6个月",
      ingredients: [makeIngredient({ ingredient: "AKK", confidence: 35 })],
    });

    assert.ok(report.recommendedMVP.includes("AKK"));
    assert.ok(report.recommendedMVP.includes("30 天量"));
  });

  it("高定价 + 强宣称 = CRITICAL + KILL", () => {
    const report = generateChallengeReport({
      productName: "AKG 逆龄套餐",
      proposedClaim: "逆龄抗衰老",
      targetPrice: 2999,
      ingredients: [makeIngredient({ evidenceLevel: "D", confidence: 20 })],
    });

    assert.equal(report.overallRisk, "CRITICAL");
    assert.equal(report.recommendation, "KILL");
  });

  it("没有匹配科学证据时必须暂停，而不是 PROCEED", () => {
    const report = generateChallengeReport({
      productName: "未知原料产品",
      proposedClaim: "支持日常状态",
      ingredients: [],
    });

    assert.equal(report.recommendation, "PAUSE");
    assert.equal(report.overallRisk, "MEDIUM");
    assert.ok(report.topFailureReasons[0].includes("未匹配到任何原料证据卡"));
  });

  it("营销红线按字面匹配，不执行元字符正则", () => {
    const report = generateChallengeReport({
      productName: "安全产品",
      proposedClaim: "支持日常状态",
      ingredients: [makeIngredient({ marketingNever: "A[BC]" })],
    });

    assert.equal(report.topFailureReasons.some((r) => r.includes("触碰营销红线")), false);
  });
});

// ── Frontmatter 解析 ─────────────────────────────────

describe("parseIngredientFrontmatter", () => {
  it("从 Obsidian frontmatter 解析完整证据卡", () => {
    const result = parseIngredientFrontmatter(
      {
        ingredient: "AKG",
        claim: "支持健康老龄化",
        evidence_level: "B",
        human_rct: "2",
        sample_size: "110",
        dose: "1-3 g/day",
        mechanism: "mTOR",
        marketing_say: "支持健康老龄化",
        marketing_never: "逆龄",
        confidence: "72",
        last_reviewed: "2026-09-19",
        status: "CONFIRMED",
      },
      "AKG.md"
    );

    assert.ok(result);
    assert.equal(result.ingredient, "AKG");
    assert.equal(result.humanRCTCount, 2);
    assert.equal(result.confidence, 72);
  });

  it("缺少必填字段时返回 null", () => {
    assert.equal(parseIngredientFrontmatter({ ingredient: "AKG" }, "AKG.md"), null);
    assert.equal(parseIngredientFrontmatter({ claim: "宣称" }, "AKG.md"), null);
  });

  it("解析可选 aliases 字段（中英文分隔符兼容）", () => {
    const result = parseIngredientFrontmatter(
      {
        ingredient: "AKG",
        claim: "支持健康老龄化",
        evidence_level: "B",
        aliases: "α-酮戊二酸， Alpha-ketoglutarate、Ca-AKG",
        marketing_say: "支持健康老龄化",
        marketing_never: "逆龄",
      },
      "AKG.md"
    );
    assert.ok(result);
    assert.deepEqual(result.aliases, ["α-酮戊二酸", "Alpha-ketoglutarate", "Ca-AKG"]);
  });

  it("无 aliases 时为 null", () => {
    const result = parseIngredientFrontmatter(
      {
        ingredient: "AKG",
        claim: "支持健康老龄化",
        evidence_level: "B",
        marketing_say: "支持健康老龄化",
        marketing_never: "逆龄",
      },
      "AKG.md"
    );
    assert.ok(result);
    assert.equal(result.aliases, null);
  });

  it("非法数字或证据等级不会进入挑战决策", () => {
    assert.equal(
      parseIngredientFrontmatter(
        {
          ingredient: "AKG",
          claim: "支持健康老龄化",
          evidence_level: "X",
          marketing_say: "支持健康老龄化",
          marketing_never: "逆龄",
        },
        "AKG.md"
      ),
      null
    );
    assert.equal(
      parseIngredientFrontmatter(
        {
          ingredient: "AKG",
          claim: "支持健康老龄化",
          evidence_level: "B",
          human_rct: "not-a-number",
          marketing_say: "支持健康老龄化",
          marketing_never: "逆龄",
        },
        "AKG.md"
      ),
      null
    );
  });
});

// ── 原料相关性匹配 ─────────────────────────

describe("matchRelevantIngredients", () => {
  const ingredients = [
    makeIngredient({ ingredient: "AKG", aliases: ["α-酮戊二酸", "Ca-AKG"] }),
    makeIngredient({ ingredient: "HMB", aliases: null }),
    makeIngredient({ ingredient: "骆驼奶", aliases: ["骆驼乳"] }),
  ];

  it("按主名匹配（ASCII 词边界）", () => {
    const matched = matchRelevantIngredients(ingredients, "AKG 逆龄套餐 半年年轻5岁");
    assert.equal(matched.length, 1);
    assert.equal(matched[0].ingredient, "AKG");
  });

  it("按别名匹配（中文子串）", () => {
    const matched = matchRelevantIngredients(ingredients, "含 α-酮戊二酸的胶囊");
    assert.equal(matched.length, 1);
    assert.equal(matched[0].ingredient, "AKG");
  });

  it("CJK 名称按子串匹配", () => {
    const matched = matchRelevantIngredients(ingredients, "骆驼奶粉固体饮料");
    assert.equal(matched.length, 1);
    assert.equal(matched[0].ingredient, "骆驼奶");
  });

  it("ASCII 词边界：前缀重叠不误伤", () => {
    // 「MARKII」包含「AK」但不该命中「HMB」；构造一个含别的 ASCII 词边界场景
    const matched = matchRelevantIngredients(ingredients, "HMBX 复合蛋白粉");
    assert.equal(matched.length, 0);
  });

  it("规格字段拼接文本可命中多个原料", () => {
    const matched = matchRelevantIngredients(
      ingredients,
      "中老年肌肉健康套餐 核心卖点：HMB + 骆驼奶"
    );
    assert.equal(matched.length, 2);
  });

  it("无匹配返回空数组", () => {
    assert.equal(matchRelevantIngredients(ingredients, "益生菌固体饮料").length, 0);
  });
});
