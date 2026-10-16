/**
 * 行业中立守卫（Tenant Pack P2）：
 * src/ 下的产品代码不得写死任何租户行业词——这些词只能存在于 packs/<id>/。
 * 扫描词表 = 所有已登记 pack 的 剂型/宣称/成分 词 + 行业名 + 默认品类 + 全部品类显示名。
 * 例外：*.test.ts（测试夹具可用具体样例）。
 *
 * ── 2026-10-12 强化（P2-T4）────────────────────────────────────────────
 * 本次只做「收紧」，不放松任何一条。四件事：
 *   1. 豁免必须带**到期日**，过期守卫自动失败 —— 豁免不再是永久许可，而是一次有期限的延期。
 *   2. 豁免**条数只减不增**（`EXEMPT_BASELINE`）—— 想新增一条，必须先删掉一条旧的。
 *   3. 新增 **pack 完整性断言**：品类键在 categoryContent 与 categories.classifications
 *      之间必须一一对应。缺失时 `categoryName()` 会静默退回键名（例如把 `health_food`
 *      显示给用户），这在换租户时是功能性回退，必须在测试期拦下，而不是等运行时兜底。
 *   4. 词表改为**从全部 pack 动态汇总**，不再依赖手写数组，避免「新 pack 加了词但没进词表」。
 *
 * ⚠️ 不要为了让本守卫转绿而放宽匹配或扩大整文件豁免。租户语义必须下沉到 pack；
 * 非租户语义只能使用下方带理由、到期日、精确声明与精确词集的限域白名单。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getTenantPack, listTenantPacks } from "../src/modules/tenant";

/**
 * 兜底词表：这些是「任何 pack 都该视为行业词」的通用品类词。
 * 注意：正常的行业词应当由 packs/<id>/domain/lexicon.json 与 categories.json 提供，
 * 这个数组只是防止「某个 pack 漏登记」时的安全网。新词优先补到 pack 里。
 */
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
    // ⚠️ classifications 的**键**也要进词表：分类键（health_food）本身不含中文，
    // 但它出现在 src/ 里同样意味着内核对租户分类的假设。见下方 pack 完整性断言。
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
 * 内含的示例数据（项目名、卖点标签、示例成本）若也改成分类键，
 * demo 就失去了演示价值——演示页要的就是具体、直观。
 *
 * ⚠️ 不要按目录前缀批量豁免（例如把整个 src/app 放进去），那等于给守卫开后门：
 * 新增的真实业务代码会静默通过。每条都要单独登记，且 why 必须 ≥20 字。
 *
 * ⚠️ `expires` 是**复核日期**，不是"失效日期"：到期后守卫会失败，逼你重新判断
 * 「这条豁免现在还成立吗」。删除豁免的正确方式是把内容下沉到 pack，不是续期。
 *
 * 反向断言见下方三条守卫：文件不存在 / why 过短 / 已不再命中行业词 / 条数超过基线
 * / 已过期，都会报红——即豁免只能被撤销，不能无声地扩大或永久化。
 */
const EXEMPT: Record<string, { why: string; expires: string }> = {
  "src/app/demo-beautified/page.tsx": {
    why: "演示页：内容是美化组件的示例数据（项目名、卖点标签），演示需要具体词才能看出效果。",
    expires: "2026-12-31",
  },
  "src/app/demo-beautified-advanced/page.tsx": {
    why: "演示页：进阶版美化示例数据，同上；其中品类色值已改读 categoryMeta，不属豁免理由。",
    expires: "2026-12-31",
  },
  "src/app/demo-cost-modular/page.tsx": {
    why: "演示页：成本模块的示例输入输出（品类名与费用清单），用于展示交互，非内核逻辑。",
    expires: "2026-12-31",
  },
  "src/app/demo-cost-rich/page.tsx": {
    why: "演示页：成本引擎示例数据，示例产品名与品类参数是演示内容，不参与任何计算分支。",
    expires: "2026-12-31",
  },
  "src/app/demo-daily-assistant/page.tsx": {
    why: "演示页：每日简报的示例建议文案，内容为写死的演示话术，非按品类计算的逻辑。",
    expires: "2026-12-31",
  },
  "src/app/demo-kern/page.tsx": {
    why: "演示页：内核能力展示用的固定示例报告（供应商比价、成本对比），纯演示数据。",
    expires: "2026-12-31",
  },
  "src/app/demo-kern-intelligent/page.tsx": {
    why: "演示页：智能内核示例的关键结论文本，演示用固定文案，非租户设定来源。",
    expires: "2026-12-31",
  },
};

/**
 * 非租户语义的限域白名单：只允许指定文件中指定声明里的指定词。
 * 若同一行新增其他行业词，主扫描仍会报错；声明移动、词消失或到期也会由下方反向断言报错。
 */
const NON_TENANT_LINE_ALLOWLIST: Record<string, Array<{
  lineIncludes: string;
  words: readonly string[];
  why: string;
  expires: string;
}>> = {
  "src/modules/assistant-runtime/product-goal.ts": [{
    lineIncludes: "const DEVELOPMENT = /",
    words: ["保健", "食品"],
    why: "通用产品研发意图匹配器：这些词与饮料、设备、软件、应用并列，只识别产品目标，不表达当前租户品类。",
    expires: "2026-12-31",
  }],
};

function isAllowedNonTenantUsage(rel: string, line: string, word: string): boolean {
  return NON_TENANT_LINE_ALLOWLIST[rel]?.some(
    (entry) => line.includes(entry.lineIncludes) && entry.words.includes(word),
  ) ?? false;
}

/**
 * 豁免条数基线：**只减不增**。
 * 新增一条豁免 = 新增一笔技术债，必须先清偿一笔旧的。
 * 清空豁免的唯一正当路径是把内容下沉到 pack（见 R7 demo 隔离路线）。
 */
const EXEMPT_BASELINE = 7;
const NON_TENANT_ALLOWLISTED_WORD_BASELINE = 2;

test("src 产品代码不含租户行业词（只能放在 packs/，豁免清单除外）", () => {
  const W = words();
  const hits: string[] = [];
  const exempted = new Map<string, number>();
  for (const f of walk(path.join(process.cwd(), "src"))) {
    const rel = path.relative(process.cwd(), f).split(path.sep).join("/");
    const lines = fs.readFileSync(f, "utf8").split(/\r?\n/);
    lines.forEach((l, i) => {
      const matchingWords = W.filter((x) => l.includes(x));
      if (!matchingWords.length) return;
      if (Object.hasOwn(EXEMPT, rel)) {
        exempted.set(rel, (exempted.get(rel) ?? 0) + 1);
        return;
      }
      const w = matchingWords.find((word) => !isAllowedNonTenantUsage(rel, l, word));
      if (w) hits.push(`${rel}:${i + 1} 「${w}」`);
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

test("豁免清单无腐化：每条都真实存在、理由充分、且仍含行业词", () => {
  const W = words();
  const stale: string[] = [];
  const noLongerHit: string[] = [];
  for (const [rel, entry] of Object.entries(EXEMPT)) {
    const abs = path.join(process.cwd(), rel);
    if (!fs.existsSync(abs)) { stale.push(`${rel} —— 文件已不存在`); continue; }
    if (entry.why.trim().length < 20) {
      stale.push(`${rel} —— why 不足 20 字，无法作为豁免依据`);
      continue;
    }
    const hit = fs.readFileSync(abs, "utf8").split(/\r?\n/).some((l) => W.find((x) => l.includes(x)));
    if (!hit) noLongerHit.push(`${rel} —— 已不再含行业词，应移出豁免清单`);
  }
  for (const [rel, entries] of Object.entries(NON_TENANT_LINE_ALLOWLIST)) {
    const abs = path.join(process.cwd(), rel);
    if (!fs.existsSync(abs)) { stale.push(`${rel} —— 文件已不存在`); continue; }
    const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
    for (const entry of entries) {
      if (entry.why.trim().length < 20) {
        stale.push(`${rel} [${entry.lineIncludes}] —— why 不足 20 字，无法作为白名单依据`);
        continue;
      }
      const matchingLines = lines.filter((line) => line.includes(entry.lineIncludes));
      if (matchingLines.length !== 1) {
        stale.push(`${rel} [${entry.lineIncludes}] —— 应精确命中 1 行，实际 ${matchingLines.length} 行`);
        continue;
      }
      const missingWords = entry.words.filter((word) => !W.includes(word) || !matchingLines[0].includes(word));
      if (missingWords.length) {
        noLongerHit.push(`${rel} [${entry.lineIncludes}] —— 词已不再命中，应移出白名单：${missingWords.join("、")}`);
      }
    }
  }
  assert.deepEqual(stale, [], `豁免清单失效：\n  ${stale.join("\n  ")}`);
  assert.deepEqual(
    noLongerHit,
    [],
    `豁免清单里有条目已不再命中（腐化，请移除）：\n  ${noLongerHit.join("\n  ")}`,
  );
});

test("豁免与限域白名单必须带到期日，且已过期时直接失败", () => {
  const problems: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const [rel, entry] of Object.entries(EXEMPT)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.expires)) {
      problems.push(`${rel} —— expires 不是 YYYY-MM-DD：${entry.expires}`);
      continue;
    }
    if (entry.expires < today) {
      problems.push(`${rel} —— 豁免已于 ${entry.expires} 到期（今天 ${today}），请复核后处理`);
    }
  }
  for (const [rel, entries] of Object.entries(NON_TENANT_LINE_ALLOWLIST)) {
    for (const entry of entries) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.expires)) {
        problems.push(`${rel} [${entry.lineIncludes}] —— expires 不是 YYYY-MM-DD：${entry.expires}`);
        continue;
      }
      if (entry.expires < today) {
        problems.push(`${rel} [${entry.lineIncludes}] —— 白名单已于 ${entry.expires} 到期（今天 ${today}），请复核后处理`);
      }
    }
  }
  assert.deepEqual(
    problems,
    [],
    `豁免/白名单到期检查未通过：\n  ${problems.join("\n  ")}\n` +
      `正确做法：重新判断命中是否仍属非租户语义；租户语义下沉到 pack，非租户语义重证后更新。`,
  );
});

test("豁免与限域白名单条数只减不增：不得超过基线", () => {
  const n = Object.keys(EXEMPT).length;
  assert.ok(
    n <= EXEMPT_BASELINE,
    `豁免条数 ${n} 超过基线 ${EXEMPT_BASELINE}。` +
      `新增豁免等于新增技术债：请先下沉并移除一条旧的，再新增。`,
  );
  const allowlistedWordN = Object.values(NON_TENANT_LINE_ALLOWLIST).reduce(
    (sum, entries) => sum + entries.reduce((entrySum, entry) => entrySum + entry.words.length, 0),
    0,
  );
  assert.ok(
    allowlistedWordN <= NON_TENANT_ALLOWLISTED_WORD_BASELINE,
    `限域白名单词数 ${allowlistedWordN} 超过基线 ${NON_TENANT_ALLOWLISTED_WORD_BASELINE}。` +
      `新增前必须证明命中属于非租户语义，并先移除一个旧白名单词。`,
  );
});

test("每个 pack 的品类键在 categoryContent 与 classifications 之间一一对应", () => {
  const problems: string[] = [];
  for (const id of listTenantPacks()) {
    const p = getTenantPack(id);
    const contentKeys = Object.keys(p.categoryContent ?? {}).filter((k) => !k.startsWith("_") && k !== "defaultKey");
    const nameKeys = Object.keys(p.categories.classifications ?? {});
    const missingName = contentKeys.filter((k) => !nameKeys.includes(k));
    const orphanName = nameKeys.filter((k) => !contentKeys.includes(k));
    if (missingName.length) {
      problems.push(
        `${id}: categoryContent 有键但 categories.classifications 缺显示名 —— ${missingName.join(", ")}` +
          `（会导致 UI 显示英文键名，属功能回退）`,
      );
    }
    if (orphanName.length) {
      problems.push(
        `${id}: categories.classifications 有显示名但没有对应 categoryContent —— ${orphanName.join(", ")}` +
          `（该品类没有图标/配色，渲染时会落到兜底品类）`,
      );
    }
    const def = (p.categoryContent as Record<string, unknown> | undefined)?.defaultKey;
    if (typeof def !== "string" || !contentKeys.includes(def)) {
      problems.push(`${id}: defaultKey 未声明或不在 categoryContent 中 —— ${String(def)}`);
    }
  }
  assert.deepEqual(
    problems,
    [],
    `租户包品类定义不完整：\n  ${problems.join("\n  ")}\n` +
      `修法：补 packs/<id>/domain/categories.json 的 classifications，或补 category-content.json。` +
      `不要在代码里加兜底。`,
  );
});
