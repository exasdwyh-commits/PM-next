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
    // 品类显示名也是租户行业词，且是「换租户必改」的那一类，必须进词表。
    // 2026-10-09：此前漏了 classifications，导致「化妆品」完全不在词表内 ——
    // 实测 src/ 下有 81 处「化妆品」从未被捕获（分布在 40 个文件）。
    // ⚠️ `Object.values(...)` 必须用 `...` 展开：写成数组字面量里的一个元素会得到
    // (string | string[])[], 运行时把**整个数组对象**塞进 Set，词表看似补了实则没补。
    // 用 `?? {}` 容错：新 pack 尚未补该字段时不应让守卫崩掉（此时只少一类词，不误报）。
    [...p.lexicon.forms, ...p.lexicon.claims, ...p.lexicon.ingredients,
      p.tenant.company.industry, p.tenant.defaults.categoryName,
      ...Object.values(p.categories.classifications ?? {})].forEach((w) => w && set.add(w));
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

/**
 * 豁免清单：**显式登记**，不是默认不扫。
 *
 * 每条都要回答同一个问题——「这行字是内核的租户假设，还是演示内容？」
 * 只有后者才该豁免。前者必须下沉到 pack。
 *
 * 当前豁免的全部是 demo 页面：它们的存在目的就是**演示某个品类长什么样**，
 * 内含的示例数据（项目名「多酚软糖项目」、卖点标签、示例成本）若也改成
 * 分类键，demo 就失去了演示价值——演示页要的就是具体、直观。
 *
 * ⚠️ 不要按目录前缀批量豁免（例如把整个 src/app 放进去），那等于给守卫开后门：
 * 新增的真实业务代码会静默通过。每条都要单独登记，且 must 附 ≥20 字论证。
 *
 * 反向断言见下方「豁免清单无腐化」：文件不存在、why 过短、或已不再命中行业词，
 * 都会让守卫报红——即豁免只能被撤销，不能无声地扩大。
 */
const EXEMPT: Record<string, string> = {
  "src/app/demo-beautified/page.tsx":
    "演示页：内容是美化组件的示例数据（项目名、卖点标签），演示需要具体词才能看出效果。",
  "src/app/demo-beautified-advanced/page.tsx":
    "演示页：进阶版美化示例数据，同上；其中品类色值已改读 categoryMeta，不属豁免理由。",
  "src/app/demo-cost-modular/page.tsx":
    "演示页：成本模块的示例输入输出（品类名与费用清单），用于展示交互，非内核逻辑。",
  "src/app/demo-cost-rich/page.tsx":
    "演示页：成本引擎示例数据，示例产品名与品类参数是演示内容，不参与任何计算分支。",
  "src/app/demo-daily-assistant/page.tsx":
    "演示页：每日简报的示例建议文案，内容为写死的演示话术，非按品类计算的逻辑。",
  "src/app/demo-kern/page.tsx":
    "演示页：内核能力展示用的固定示例报告（供应商比价、成本对比），纯演示数据。",
  "src/app/demo-kern-intelligent/page.tsx":
    "演示页：智能内核示例的关键结论文本，演示用固定文案，非租户设定来源。",
};

test("src 产品代码不含租户行业词（只能放在 packs/，豁免清单除外）", () => {
  const W = words();
  const hits: string[] = [];
  const exempted = new Map<string, number>();
  for (const f of walk(path.join(process.cwd(), "src"))) {
    const rel = path.relative(process.cwd(), f).split(path.sep).join("/");
    const lines = fs.readFileSync(f, "utf8").split(/\r?\n/);
    lines.forEach((l, i) => {
      const w = W.find((x) => l.includes(x));
      if (!w) return;
      if (Object.hasOwn(EXEMPT, rel)) {
        exempted.set(rel, (exempted.get(rel) ?? 0) + 1);
        return;
      }
      hits.push(`${rel}:${i + 1} 「${w}」`);
    });
  }
  const ex = [...exempted.entries()].map(([f, n]) => `  ${f}（${n} 行）`).join("\n");
  assert.deepEqual(
    hits,
    [],
    `发现写死的行业词 ${hits.length} 处：\n${hits.join("\n")}` +
      (exempted.size ? `\n\n已豁免 ${exempted.size} 个文件：\n${ex}` : ""),
  );
});

test("豁免清单无腐化：每条都真实存在且仍含行业词", () => {
  const W = words();
  const stale: string[] = [];
  const noLongerHit: string[] = [];
  for (const [rel, why] of Object.entries(EXEMPT)) {
    const abs = path.join(process.cwd(), rel);
    if (!fs.existsSync(abs)) { stale.push(`${rel} —— 文件已不存在`); continue; }
    if (why.trim().length < 20) {
      stale.push(`${rel} —— why 不足 20 字，无法作为豁免依据`);
      continue;
    }
    const hit = fs.readFileSync(abs, "utf8").split(/\r?\n/).some((l) => W.find((x) => l.includes(x)));
    if (!hit) noLongerHit.push(`${rel} —— 已不再含行业词，应移出豁免清单`);
  }
  assert.deepEqual(stale, [], `豁免清单失效：\n  ${stale.join("\n  ")}`);
  assert.deepEqual(
    noLongerHit,
    [],
    `豁免清单里有条目已不再命中（腐化，请移除）：\n  ${noLongerHit.join("\n  ")}`,
  );
});
