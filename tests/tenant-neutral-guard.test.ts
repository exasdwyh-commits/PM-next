/**
 * 行业中立守卫（Tenant Pack P2）：
 * src/ 下的产品代码不得写死任何租户行业词——这些词只能存在于 packs/<id>/。
 * 扫描词表 = 所有已登记 pack 的 剂型/宣称/成分 词 + 行业名 + 默认品类。
 * 例外：*.test.ts（测试夹具可用具体样例）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getTenantPack, listTenantPacks } from "../src/modules/tenant";

const EXTRA = ["健康食品", "保健", "营养", "膳食", "食品", "代餐", "蛋白粉", "燕窝", "海参"];

function words(): string[] {
  const set = new Set<string>(EXTRA);
  for (const id of listTenantPacks()) {
    const p = getTenantPack(id);
    [...p.lexicon.forms, ...p.lexicon.claims, ...p.lexicon.ingredients,
      p.tenant.company.industry, p.tenant.defaults.categoryName].forEach((w) => w && set.add(w));
  }
  return [...set];
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

test("src 产品代码不含租户行业词（只能放在 packs/）", () => {
  const W = words();
  const hits: string[] = [];
  for (const f of walk(path.join(process.cwd(), "src"))) {
    const lines = fs.readFileSync(f, "utf8").split(/\r?\n/);
    lines.forEach((l, i) => {
      const w = W.find((x) => l.includes(x));
      if (w) hits.push(`${path.relative(process.cwd(), f)}:${i + 1} 「${w}」`);
    });
  }
  assert.deepEqual(hits, [], `发现写死的行业词 ${hits.length} 处：\n${hits.join("\n")}`);
});
