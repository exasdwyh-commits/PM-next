/**
 * 租户配置包回归锁：
 * 1. 默认 pack = health-food，且它是标准参考模版；
 * 2. health-food 的值与抽离前写死的值逐项一致（行为零变化）；
 * 3. 所有已登记 pack 结构完整。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getTenantPack, listTenantPacks, resolveTenantPackId } from "../src/modules/tenant";
import { CATEGORY_TARGET_MARGIN } from "../src/modules/cost-engine/presets";

test("默认 pack 是 health-food 参考模版", () => {
  assert.equal(resolveTenantPackId(), "health-food");
  assert.equal(getTenantPack().tenant.isReferenceTemplate, true);
});

test("health-food 与抽离前写死值一致", () => {
  const p = getTenantPack("health-food");
  assert.deepEqual(p.categories.targetMargin, {
    保健品: 35, 保健食品: 35, 食品: 25, 功能性食品: 30, 营养食品: 30, 礼盒: 40, 默认: 30,
  });
  assert.deepEqual(CATEGORY_TARGET_MARGIN, p.categories.targetMargin);
  assert.equal(p.lexicon.forms.length, 11);
  assert.equal(p.lexicon.claims.length, 16);
  assert.deepEqual(p.lexicon.ingredients, ["功能性菌株", "益生菌", "西药成分", "人工色素", "防腐剂", "蔗糖", "阿斯巴甜"]);
  assert.equal(p.tenant.defaults.categoryName, "健康食品");
  assert.equal(p.tenant.product.description, "食品新品研发打样门与可信决策系统");
});

test("所有 pack 结构完整", () => {
  for (const id of listTenantPacks()) {
    const p = getTenantPack(id);
    assert.equal(p.tenant.id, id);
    assert.ok(p.tenant.company.name && p.tenant.defaults.categoryName);
    assert.ok(p.lexicon.forms.length && p.lexicon.claims.length);
    assert.ok(Object.keys(p.categories.targetMargin).includes("默认"));
  }
});

test("未知 pack 报错", () => {
  assert.throws(() => getTenantPack("nope"), /未知的租户配置包/);
});
