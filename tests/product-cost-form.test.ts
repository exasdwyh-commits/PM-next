import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCostInput } from "../src/app/products/[id]/cost-form";
import { calcCost } from "../src/modules/cost-engine";
import { CHANNEL_PRESETS } from "../src/modules/cost-engine/presets";

const form = {
  materialCost: "10", packagingCost: "2", manufacturingCost: "3", certificationCost: "1",
  monthlyFixed: "0", retailPrice: "100", channel: "XINXUAN", invoiceType: "达人开票", expressType: "STANDARD",
  commissionRate: "", platformFeeRate: "", marketingRate: "", marketReferencePrice: "", targetMarginRate: "",
};

test("blank optional rates persist the defaults used by the displayed calculation", () => {
  const input = buildCostInput(form);
  assert.equal(input.commissionRate, CHANNEL_PRESETS.XINXUAN.commissionRate);
  assert.equal(input.platformFeeRate, CHANNEL_PRESETS.XINXUAN.platformFeeRate);
  assert.equal(input.marketingRate, CHANNEL_PRESETS.XINXUAN.marketingRate);
  assert.deepEqual(calcCost(JSON.parse(JSON.stringify(input))), calcCost(input));
});

test("explicit zero rates and zero costs remain valid inputs", () => {
  const input = buildCostInput({ ...form, materialCost: "0", commissionRate: "0" });
  assert.equal(input.materialCost, 0);
  assert.equal(input.monthlyFixed, 0);
  assert.equal(input.commissionRate, 0);
});

for (const [key, value] of [
  ["materialCost", " "], ["retailPrice", "0"], ["materialCost", "-1"], ["commissionRate", "-1"],
  ["commissionRate", "101"], ["targetMarginRate", "100"], ["marketReferencePrice", "0"],
  ["monthlyFixed", "Infinity"], ["marketingRate", "bad"], ["channel", "UNKNOWN"],
] as const) {
  test(`rejects invalid ${key}=${value} before calculation or saving`, () => {
    assert.throws(() => buildCostInput({ ...form, [key]: value }));
  });
}
