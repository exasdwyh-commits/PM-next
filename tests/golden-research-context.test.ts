import assert from "node:assert/strict";
import test from "node:test";

import {
  REQUIREMENT_CONTEXT_VERSION,
  buildRequirementContext,
  readFrozenRequirementContext,
} from "../src/modules/research/requirement-context";
import { parseProjectRequirements } from "../src/modules/research/requirement-parser";

test("Golden Research Context · 从 Product/Version 聚合真实需求且去重", () => {
  const ctx = buildRequirementContext({
    question: "评估这个半年套餐是否值得推进",
    projectTarget: "做一个35岁以上抗衰套餐",
    projectConstraints: null,
    product: {
      name: "AKG 钙半年套餐",
      coreIdea: "做一个35岁以上抗衰套餐",
      targetAudience: "35岁以上人群",
      coreSellingPoints: "AKG + 甲基化年龄检测，挑战减龄1-3年",
      targetChannels: "私域、会销",
      priceExpectation: "1999元半年套餐",
      formSpec: "每日3g",
      forbiddenItems: null,
    },
    versionSpecs: {
      coreIdea: "做一个35岁以上抗衰套餐",
      priceExpectation: "1999元半年套餐",
    },
  });

  assert.equal(ctx.version, REQUIREMENT_CONTEXT_VERSION);
  assert.equal(ctx.productName, "AKG 钙半年套餐");
  assert.equal(ctx.requirementText.match(/做一个35岁以上抗衰套餐/g)?.length, 1);

  const parsed = parseProjectRequirements(ctx.requirementText);
  assert.equal(parsed.constraints.minAge, 35);
  assert.equal(parsed.constraints.targetPrice, 1999);
  assert.equal(parsed.constraints.targetDurationMonths, 6);
  assert.deepEqual(parsed.constraints.targetChannels, ["私域/社群电商渠道"]);
  assert.ok(parsed.constraints.requestedClaims.includes("减龄"));
});

test("Golden Research Context · 冻结快照可恢复，非法/旧快照安全回退", () => {
  const ctx = buildRequirementContext({
    question: "验证快照",
    product: { name: "测试产品", priceExpectation: "299元" },
  });
  const json = JSON.stringify({ inputRevision: 3, requirementContext: ctx });

  assert.deepEqual(readFrozenRequirementContext(json), ctx);
  assert.equal(readFrozenRequirementContext("{broken"), null);
  assert.equal(
    readFrozenRequirementContext(
      JSON.stringify({
        requirementContext: {
          version: "requirement-context/v1",
          productName: "旧产品",
          requirementText: "售价99元",
        },
      })
    ),
    null
  );
});
