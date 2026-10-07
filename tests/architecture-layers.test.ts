/**
 * KX-70 分层依赖守卫（架构契约）。
 *
 * 规则见 tests/helpers/architecture-layers.ts 头部注释。
 * 这里的断言是「只许变好」：
 *   AL1 每个 src 单元都归了层（新模块必须先在 UNIT_LAYERS 里落户）；
 *   AL2 越界 import 不得出现基线之外的新条目；
 *   AL3 app 层直连数据库的文件不得新增；
 *   AL4 基线里已经不存在的条目必须清掉（保持基线真实，还一条记一条）；
 *   AL5 空壳模块不得复活；
 *   AL6 变异验证：守卫确实能变红。
 *   AL8 基线每条须带论证 why（论证例外表）：非空、非占位符，重写基线时旧论证自动保留。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  LAYER_NAMES,
  ROOT,
  UNIT_LAYERS,
  moduleEdges,
  readBaseline,
  scan,
  stronglyConnectedComponents,
  unitOf,
  violationKey,
} from "./helpers/architecture-layers";

const result = scan();
const baseline = readBaseline();
const HOW_TO_REFRESH = "还掉违规后运行 `npm run arch:baseline` 重写基线，并在提交信息里写明。";

test("AL1：每个 src 单元都已归层；layer 表里没有指向不存在模块的条目", () => {
  assert.deepEqual(result.unknownUnits, [], `新单元先在 UNIT_LAYERS 里归层：${result.unknownUnits.join(", ")}`);
  const stale = Object.keys(UNIT_LAYERS).filter((u) => {
    if (!u.startsWith("modules/")) return false;
    return !fs.existsSync(path.join(ROOT, "src", u));
  });
  assert.deepEqual(stale, [], `UNIT_LAYERS 里有已删除的模块：${stale.join(", ")}`);
});

test("AL2：跨层向上的 import 只许减少、不许新增", () => {
  const allowed = new Set(baseline.layerViolations.map((e) => e.key));
  const added = result.violations.filter((v) => !allowed.has(violationKey(v)));
  assert.deepEqual(
    added.map((v) => `${violationKey(v)}（${LAYER_NAMES[UNIT_LAYERS[v.from]]} → ${LAYER_NAMES[UNIT_LAYERS[v.to]]}）`),
    [],
    "出现基线之外的越界依赖。上层可以依赖下层，反过来不行；需要下层通知上层时走事件（business-events）或注册表。"
  );
});

test("AL3：页面 / 接口直连数据库的文件不得新增", () => {
  const allowed = new Set(baseline.appDbFiles.map((e) => e.key));
  const added = result.appDbFiles.filter((f) => !allowed.has(f));
  assert.deepEqual(added, [], "app 层新文件不要直接 import @/shared/db，改走模块服务。");
});

test("AL4：基线必须真实（已不存在的条目要清掉）", () => {
  const current = new Set(result.violations.map(violationKey));
  const staleViolations = baseline.layerViolations.map((e) => e.key).filter((k) => !current.has(k));
  const currentDb = new Set(result.appDbFiles);
  const staleDb = baseline.appDbFiles.map((e) => e.key).filter((f) => !currentDb.has(f));
  assert.deepEqual(
    { staleViolations, staleDb },
    { staleViolations: [], staleDb: [] },
    `基线里有已经修好的条目。${HOW_TO_REFRESH}`
  );
});

test("AL5：已删除的空壳模块不得复活", () => {
  const removed = ["jarvis", "intelligence", "economics", "supply", "rules", "billing"];
  const alive = removed.filter((m) => fs.existsSync(path.join(ROOT, "src", "modules", m)));
  assert.deepEqual(alive, [], "这些目录在 KX-70 已删除；新能力放到已有层里，不要再建只有约定的空模块。");
});

test("AL6：变异验证：守卫确实能变红", () => {
  assert.equal(unitOf("src/modules/worker/executor.ts"), "modules/worker");
  assert.equal(unitOf("src/app/api/health/route.ts"), "app/api");
  assert.equal(unitOf("src/app/muse/page.tsx"), "app/pages");
  assert.equal(unitOf("prisma/schema.prisma"), null);
  // 人为构造一条「L5 引 L1」的边，SCC 与层级判断都应识别
  const edges = new Map<string, Set<string>>([
    ["modules/identity", new Set(["app/pages"])],
    ["app/pages", new Set(["modules/identity"])],
  ]);
  assert.deepEqual(stronglyConnectedComponents(edges), [["app/pages", "modules/identity"]]);
  assert.ok(UNIT_LAYERS["modules/identity"] > UNIT_LAYERS["app/pages"]);
});

test("AL8：基线每条须带论证 why —— 例外不带理由就是空头基线", () => {
  const PLACEHOLDER = /TODO|TBD|FIXME|XXX|待补|待定|暂无|以后再说|以后补/i;
  const bad: string[] = [];
  const check = (entries: Array<{ key: string; why: string }>, kind: string) => {
    for (const e of entries) {
      const why = (e?.why ?? "").trim();
      if (why.length < 20) bad.push(`${kind} ${e?.key}: 论证缺失或过短（${why.length} 字，需 ≥20 字说清现状与消除路径）`);
      else if (PLACEHOLDER.test(why)) bad.push(`${kind} ${e?.key}: 论证是占位符，不是理由`);
    }
  };
  check(baseline.layerViolations, "越界");
  check(baseline.appDbFiles, "直连db");
  assert.deepEqual(
    bad,
    [],
    `基线有 ${bad.length} 条无有效论证。补上每条的 why（现状 + 消除路径/长期接受的理由）再跑 arch:baseline：\n  ${bad.join("\n  ")}`
  );
});

test("AL7：报告（不断言）：当前越界条数与最大模块环", () => {
  const largest = stronglyConnectedComponents(moduleEdges(result.runtimeEdges))[0] ?? [];
  const largestAll = stronglyConnectedComponents(moduleEdges(result.edges))[0] ?? [];
  console.log(
    `  越界 import ${result.violations.length} 条（基线 ${baseline.layerViolations.length}）；` +
      `app 直连 db ${result.appDbFiles.length} 个文件（基线 ${baseline.appDbFiles.length}）；` +
      `最大模块环（运行时）${largest.length} 个：${largest.map((x) => x.replace(/^modules\//, "")).join(", ")}；含类型导入 ${largestAll.length} 个`
  );
});
