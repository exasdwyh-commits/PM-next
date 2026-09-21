/**
 * 成本与供应 · 六层引擎接线验证（无 DB 依赖，纯函数）
 *
 * 验证目标：产品详情「成本与供应」页签的 CostCalculator 调用的是同一份确定性引擎
 * （calcCost + applyDefaults）。本测试直接驱动该引擎，证明：
 *   1. 数字是真实算出来的（六层之和 = 总成本，税费链内部自洽），不是硬编码；
 *   2. 缺默认字段时 applyDefaults 正确补默认值（运费预设等）；
 *   3. 供货价区间与毛利率合理（>0）。
 *
 * 运行：tsx tests/cost-calculator.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { calcCost, applyDefaults } from "../src/modules/cost-engine";
import type { CostInput } from "../src/modules/cost-engine/types";

const SAMPLE: CostInput = {
  materialCost: 8.05,
  packagingCost: 1.2,
  manufacturingCost: 1.5,
  certificationCost: 0.3,
  platformFeeRate: 2,
  commissionRate: 40,
  marketingRate: 8,
  monthlyFixed: 5000,
  retailPrice: 69,
  channel: "XINXUAN",
  invoiceType: "达人开票",
  marketReferencePrice: 89,
  pricingStrategy: "MARKET_FOLLOW",
};

test("成本引擎：单件总成本（L1–L5）等于各层之和，且金额自洽", () => {
  const r = calcCost(applyDefaults(SAMPLE));

  // L1–L5 之和应等于单件总成本 totalCost（不含 L6 月固定）
  const layerSum =
    r.layer1Material + r.layer2Packaging + r.layer3Manufacturing + r.layer4Freight + r.layer5Channel;
  assert.ok(Math.abs(layerSum - r.totalCost) < 0.05, `六层之和(${layerSum}) 应≈ 总成本(${r.totalCost})`);

  // 税费链内部自洽：净利润 = 不含税销售额 - 可扣除费用 - 所得税
  // totalDeductibleExpense 含 [12] 口径；廉洁校验用公式恒等
  const recomputedNet = r.settlementSalesExclVat - r.totalDeductibleExpense - r.payableIncomeTax;
  assert.ok(
    Math.abs(recomputedNet - r.netProfit) < 0.05,
    `净利润(${r.netProfit}) 应≈ 不含税销售额-可扣除费用-所得税(${recomputedNet})`
  );

  // 应交增值税 = 销项 - 可抵扣进项
  const recomputedVat = r.outputVat - r.totalDeductibleInputVat;
  assert.ok(
    Math.abs(recomputedVat - r.payableVat) < 0.05,
    `应交增值税(${r.payableVat}) 应≈ 销项-进项(${recomputedVat})`
  );

  assert.ok(r.totalCost > 0, "总成本应为正");
  assert.ok(r.netProfit > 0, "净利率为正时净利润应为正（样例定价合理）");
  assert.ok(r.supplyPriceFloor > 0 && r.supplyPriceSuggested > 0, "供货价区间应为正");
  assert.ok(r.breakevenUnits > 0, "盈亏平衡量应为正");
  assert.ok(Array.isArray(r.alerts), "alerts 应为数组");
});

test("applyDefaults：未传快递时按渠道/默认补运费，不抛错", () => {
  const applied = applyDefaults({ ...SAMPLE });
  // XINXUAN + 默认 STANDARD 快递 → 非冷链运费默认 4
  assert.equal(applied.freightBase, 4, "STANDARD 默认运费应为 4");
  assert.equal(applied.goodsVatRate, 13, "货物增值税率默认 13%");
  assert.equal(applied.lossRate, 3, "损耗率默认 3%");
  assert.equal(applied.channel, "XINXUAN");
});

test("自检告警：毛利率为负时给出 ERROR 级告警", () => {
  const bad: CostInput = {
    ...SAMPLE,
    retailPrice: 1, // 远低于成本，必然亏本
    marketReferencePrice: 1,
  };
  const r = calcCost(applyDefaults(bad));
  assert.ok(r.totalCost > 1, "成本高估下总成本远高于零售价");
  assert.ok(r.alerts.some((a) => a.severity === "ERROR"), "亏本场景应触发 ERROR 级自检告警");
});

test("口径锁定：L6 月固定成本不计入单件总成本", () => {
  const r = calcCost(applyDefaults({ ...SAMPLE, monthlyFixed: 5000 }));

  // L6 = 月固定成本原值（不是单件分摊）
  assert.equal(r.layer6Allocation, 5000, "L6 应为月固定成本原值");

  // 单件总成本 = BOM(L1–L4) + 渠道(L5)，不含 L6
  assert.ok(
    Math.abs(r.totalCost - (r.totalBomCost + r.totalChannelCost)) < 0.05,
    `单件总成本(${r.totalCost}) 应 = BOM(${r.totalBomCost}) + 渠道(${r.totalChannelCost})`
  );
  assert.ok(r.totalCost < 5000, "月固定成本 5000 显然未计入单件成本");

  // BOM 成本 = L1+L2+L3+L4（不含 L5 渠道、不含 L6）
  const bom = r.layer1Material + r.layer2Packaging + r.layer3Manufacturing + r.layer4Freight;
  assert.ok(Math.abs(bom - r.totalBomCost) < 0.05, `BOM 成本应为 L1–L4 之和(${bom})`);
});
