/**
 * 租户切换有效性守卫（计划书 §4 P3-1 / P3-2）。
 *
 * 为什么需要这个守卫，而不只是中立守卫：
 * 中立守卫是**词表黑名单**，只能证明「已知行业词不在 src/」。它**证明不了**内核真的
 * 行业中立——行业假设完全可以不带任何行业词而**结构性地**写死在代码里。
 * 建第二个 pack 是唯一能证伪这件事的手段，本守卫把该结论固化为常驻断言。
 *
 * 它守住的不变量：
 *   1. 至少两个 pack，且第二个不是第一个的换皮（分类键无交集）；
 *   2. 两个 pack 的关键字段**可观测地不同**（逐项列举，不允许「多数相同」蒙混）；
 *   3. 每个 pack 的品类外观/内容字段**齐全**（缺字段会让渲染出 undefined）；
 *   4. 兜底键由 pack 声明（src/ 里不得写死某个租户的分类键）。
 *
 * 新增第三个 pack 时：把 PAIRS 补一条即可。若新 pack 与已有 pack 共享分类键
 * （同行业不同公司），本守卫的「零交集」断言会报红——那时应改用
 * `SHARED_DOMAIN_PAIRS` 登记该行业，并断言字段确实不同。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getTenantPack,
  listTenantPacks,
  categoryKeys,
  categoryMeta,
  categoryContent,
  defaultCategoryKey,
} from "../src/modules/tenant";

/** 需要证明「切换后确实不同」的 pack 对。 */
const PAIRS: [string, string][] = [["health-food", "pet-food"]];

/** 同行业（分类键有交集）的 pack 对，在此登记以便区别对待。 */
const SHARED_DOMAIN_PAIRS: [string, string][] = [];

test("P3-1：至少两个 pack，且第二个不是换皮", () => {
  const ids = listTenantPacks();
  assert.ok(ids.length >= 2, `至少需要 2 个 pack，实际 ${ids.length} 个：${ids.join(", ")}`);

  for (const [a, b] of PAIRS) {
    const ka = categoryKeysFor(a);
    const kb = categoryKeysFor(b);
    const overlap = ka.filter((k) => kb.includes(k));
    assert.deepEqual(
      overlap,
      [],
      `pack「${a}」与「${b}」的分类键有交集 ${overlap.join(",")} —— ` +
        `这说明是同一行业的两个 pack，无法证明内核对不同行业中立。` +
        `若确属同行业，请登记到 SHARED_DOMAIN_PAIRS。`,
    );
  }
});

test("P3-2：切换 pack 后关键输出可观测地不同", () => {
  for (const [a, b] of PAIRS) {
    const pa = getTenantPack(a);
    const pb = getTenantPack(b);
    const diffs: string[] = [];
    const same: string[] = [];

    const probes: [string, unknown, unknown][] = [
      ["公司名", pa.tenant.company.name, pb.tenant.company.name],
      ["行业", pa.tenant.company.industry, pb.tenant.company.industry],
      ["默认品类", pa.tenant.defaults.categoryName, pb.tenant.defaults.categoryName],
      ["首个剂型", pa.lexicon.forms[0], pb.lexicon.forms[0]],
      ["首个宣称", pa.lexicon.claims[0], pb.lexicon.claims[0]],
      ["首个成分", pa.lexicon.ingredients[0], pb.lexicon.ingredients[0]],
      ["默认毛利率", pa.categories.targetMargin["默认"], pb.categories.targetMargin["默认"]],
      ["法规路径", pa.regulatory.identityPathItem, pb.regulatory.identityPathItem],
      ["高价风险文案", pa.claims.messages.highPriceRisk, pb.claims.messages.highPriceRisk],
      ["产品名占位符", pa.tenant.ui.productNamePlaceholder, pb.tenant.ui.productNamePlaceholder],
      ["兜底分类键", defaultKeyOf(pa), defaultKeyOf(pb)],
    ];
    for (const [name, va, vb] of probes) {
      if (JSON.stringify(va) === JSON.stringify(vb)) same.push(name);
      else diffs.push(name);
    }

    assert.equal(
      same.length,
      0,
      `pack「${a}」与「${b}」以下字段完全相同，说明这部分没有真正租户化：${same.join(", ")}`,
    );
    assert.ok(
      diffs.length >= 10,
      `pack「${a}」与「${b}」仅 ${diffs.length} 项不同，切换有效性存疑。逐项：${diffs.join(", ")}`,
    );
  }
});

test("P3-3：每个 pack 的品类内容字段齐全（缺字段会渲染出 undefined）", () => {
  for (const id of listTenantPacks()) {
    const keys = categoryKeysFor(id);
    assert.ok(keys.length > 0, `pack「${id}」没有任何品类键`);
    const fb = defaultCategoryKeyFor(id);

    for (const k of keys) {
      const c = categoryContentFor(id, k);
      for (const f of [
        "icon", "color", "gradient", "shadow",
        "selling", "price", "costSummary", "costBreakdown", "costNotes", "formula",
        "complianceShortName", "salesPitch",
      ] as const) {
        const v = (c as unknown as Record<string, unknown>)[f];
        assert.ok(
          v !== undefined && v !== null && String(v).trim() !== "",
          `pack「${id}」品类「${k}」缺字段 ${f} —— 渲染会出现 undefined`,
        );
      }
      for (const t of ["short", "summary", "requirements"] as const) {
        assert.ok(
          c.compliance?.[t],
          `pack「${id}」品类「${k}」缺 compliance.${t}`,
        );
      }
      assert.ok(Array.isArray(c.tints) === false && c.tints?.ui, `pack「${id}」品类「${k}」缺 tints.ui`);
      assert.ok(c.tools?.length > 0, `pack「${id}」品类「${k}」的 tools 为空`);
    }

    // 兜底键必须是本 pack 自己的键，不能是别的租户的
    assert.ok(
      keys.includes(fb),
      `pack「${id}」的 defaultKey="${fb}" 不在该 pack 的品类键 ${keys.join(",")} 内 —— ` +
        `换租户后会去读一个不存在的键`,
    );
  }
});

test("P3-4：兜底分类键来自 pack，且属于该 pack 自己的品类键", () => {
  const active = resolveActive();
  try {
    // ⚠️ 必须**逐个 pack 主动切换**去验证，不能只验当前激活的那个。
    // 实测教训：把兜底键写死成 "health_food" 后，当前 pack 恰好是 health-food
    // （两者巧合相等）→ 断言通过；而切到 pet-food 才暴露——
    // 更隐蔽的是下游 `contentOf` 的兜底链（`all[fb] || all[第一个键]`）会把错误
    // **救回来**，让缺陷全程不炸。只验一个 pack 等于没验。
    for (const id of listTenantPacks()) {
      process.env.NEXT_PUBLIC_KERN_TENANT_PACK = id;
      const keys = categoryKeys();
      const declared = defaultKeyOf(getTenantPack(id));

      assert.ok(
        typeof declared === "string" && declared.length > 0,
        `pack「${id}」未声明 defaultKey —— 兜底键只能来自 pack，不得写死在 src/` +
          `（曾经的缺陷：category-meta.ts 写死 DEFAULT_CATEGORY = "health_food"）`,
      );

      // ① 函数实际返回的兜底键，必须等于该 pack 声明的值。
      //    写死某个租户的键时，只有在**别的** pack 下才会不等 —— 故必须逐 pack 切换。
      assert.equal(
        defaultCategoryKey(),
        declared,
        `pack「${id}」下defaultCategoryKey() 未返回本 pack 声明的 defaultKey="${declared}" —— ` +
          `兜底键很可能被写死在 src/ 里（该租户恰好与写死值相同时本用例抓不到，` +
          `所以必须逐 pack 切换来验）`,
      );

      // ② 兜底键必须属于本 pack 自己的品类键，否则换租户后会去读一个不存在的键
      assert.ok(
        keys.includes(declared),
        `pack「${id}」的 defaultKey="${declared}" 不在该 pack 的品类键 ${keys.join(",")} 内`,
      );

      // ③ 兜底行为：未知键必须落到 defaultKey，且拿到该品类的显示名
      const m = categoryMeta("__no_such_category__");
      assert.equal(m.key, declared, `pack「${id}」下未知品类键未落到 defaultKey="${declared}"`);
      assert.notEqual(m.name, "__no_such_category__", `pack「${id}」下未知键的显示名未回退`);
    }
  } finally {
    // 还原环境，避免影响同一进程内的其他用例
    if (active === "health-food") delete process.env.NEXT_PUBLIC_KERN_TENANT_PACK;
    else process.env.NEXT_PUBLIC_KERN_TENANT_PACK = active;
  }
});

// ── 在指定 pack 视角下取值的辅助（这些函数刻意不走模块级缓存，便于逐 pack 断言）──
/** 兜底键在 category-content 顶层（不在 categories 里）。 */
function defaultKeyOf(pack: ReturnType<typeof getTenantPack>): string | undefined {
  const v = (pack.categoryContent as Record<string, unknown> | undefined)?.defaultKey;
  return typeof v === "string" ? v : undefined;
}
function categoryKeysFor(id: string): string[] {
  return id === resolveActive()
    ? categoryKeys()
    : Object.keys(packContent(id));
}
function categoryContentFor(id: string, key: string) {
  return id === resolveActive() ? categoryContent(key) : packContent(id)[key];
}
function defaultCategoryKeyFor(id: string): string {
  const declared = (getTenantPack(id).categoryContent as Record<string, unknown>).defaultKey;
  if (typeof declared === "string") return declared;
  return categoryKeysFor(id)[0] ?? "";
}
function packContent(id: string): Record<string, ReturnType<typeof categoryContent>> {
  const raw = (getTenantPack(id).categoryContent ?? {}) as Record<string, unknown>;
  const out: Record<string, ReturnType<typeof categoryContent>> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith("_")) continue;
    if (v && typeof v === "object") out[k] = v as ReturnType<typeof categoryContent>;
  }
  return out;
}
function resolveActive(): string {
  return (process.env.NEXT_PUBLIC_KERN_TENANT_PACK ?? "").trim() || "health-food";
}