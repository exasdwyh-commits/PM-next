import assert from "node:assert/strict";
import test from "node:test";
import {
  findDuplicateMemory,
  memorySimilarity,
  normalizeMemoryContent,
  toMemoryProvenance,
  MEMORY_DUPE_THRESHOLD,
} from "../src/modules/memory";

// C7 第一阶段：source=null 语义去重 + provenance 数据层。
// 去重判定是纯函数（findDuplicateMemory），rememberForUser 在事务内以同一
// 函数决定「原地更新还是新建」，这里以纯函数模拟两次「记住」的落库结果。

const d = (s: number) => new Date(2026, 9, 1, 0, 0, s);
type Row = { id: string; kind: string; content: string; createdAt: Date };

/** 模拟 rememberForUser 的 source=null 分支：命中重复 → 原地更新，否则追加。 */
function simulateRemember(rows: Row[], kind: string, content: string): Row[] {
  const dupe = findDuplicateMemory(rows, kind, content);
  if (dupe) {
    return rows.map((r) => (r.id === dupe.id ? { ...r, content } : r));
  }
  return [...rows, { id: `m${rows.length + 1}`, kind, content, createdAt: d(rows.length + 1) }];
}

test("C7 去重：同义重复『记住』两次只剩一条，且内容刷新为最新说法", () => {
  let rows: Row[] = [];
  rows = simulateRemember(rows, "PREFERENCE", "我们只做跨境电商");
  rows = simulateRemember(rows, "PREFERENCE", "我们只做跨境电商。");
  assert.equal(rows.length, 1, "标点差异不该产生第二条");
  rows = simulateRemember(rows, "PREFERENCE", "我们只做跨境电商 ");
  assert.equal(rows.length, 1);
  // 轻微复述（尾巴上多一个语气词，相似度 0.875 过阈值）仍判重，并以新内容覆盖
  rows = simulateRemember(rows, "PREFERENCE", "我们只做跨境电商啊");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].content, "我们只做跨境电商啊");
  // 空格差异（数字与单位之间）同样判重
  let rows2: Row[] = [];
  rows2 = simulateRemember(rows2, "PREFERENCE", "预算上限 5 万，超了先问我");
  rows2 = simulateRemember(rows2, "PREFERENCE", "预算上限5万，超了先问我");
  assert.equal(rows2.length, 1);
});

test("C7 去重：数字不同必须保留两条（数字守卫优先于文本相似度）", () => {
  // 这两条的 token 相似度是 1（数字不进 CJK bigram），全靠数字守卫拦住
  assert.equal(memorySimilarity("预算上限 5 万", "预算上限 8 万"), 1);
  let rows: Row[] = [];
  rows = simulateRemember(rows, "PREFERENCE", "预算上限 5 万");
  rows = simulateRemember(rows, "PREFERENCE", "预算上限 8 万");
  assert.equal(rows.length, 2, "5 万和 8 万是两条不同的事实");
  rows = simulateRemember(rows, "FACT", "交期 3 天");
  rows = simulateRemember(rows, "FACT", "交期 5 天");
  assert.equal(rows.length, 4);
});

test("C7 去重：实质不同不误杀（反义、不同 kind、新增约束）", () => {
  let rows: Row[] = [];
  rows = simulateRemember(rows, "PREFERENCE", "报告都用英文");
  rows = simulateRemember(rows, "PREFERENCE", "报告都用中文");
  assert.equal(rows.length, 2, "一字之差的反义绝不能合并");
  rows = simulateRemember(rows, "FACT", "报告都用英文");
  assert.equal(rows.length, 3, "kind 不同不跨类去重");
  // 归一化与阈值的基本盘
  assert.equal(normalizeMemoryContent("  我们只做跨境电商。 "), "我们只做跨境电商");
  assert.equal(memorySimilarity("我们只做跨境电商", "我们只做跨境电商"), 1);
  assert.ok(memorySimilarity("报告都用英文", "报告都用中文") < MEMORY_DUPE_THRESHOLD);
});

test("C7 provenance：返回字段与 KernMemory schema 一一对应，不编造覆盖链", () => {
  const created = d(1);
  const updated = d(2);
  const row = {
    id: "m1",
    organizationId: "org1",
    userId: "u1",
    kind: "PREFERENCE" as const,
    content: "我们只做跨境电商",
    source: null,
    pinned: false,
    topics: ["跨境", "电商"],
    useCount: 2,
    lastUsedAt: updated,
    createdAt: created,
    updatedAt: updated,
    forgottenAt: null,
  };
  const p = toMemoryProvenance(row);
  // schema 字段全数到齐（减去派生标记后不多不少）
  const derived = ["sourceKeyed", "editedInPlace", "forgotten"];
  const schemaFields = Object.keys(p).filter((k) => !derived.includes(k)).sort();
  assert.deepEqual(schemaFields, [
    "content",
    "createdAt",
    "forgottenAt",
    "id",
    "kind",
    "lastUsedAt",
    "organizationId",
    "pinned",
    "source",
    "topics",
    "updatedAt",
    "useCount",
    "userId",
  ]);
  // schema 里没有的东西不许出现：没有 sourceKey、没有覆盖链字段
  assert.ok(!("sourceKey" in p));
  assert.ok(!("supersedes" in p) && !("supersededBy" in p));
  // 派生标记与真实字段一致
  assert.equal(p.sourceKeyed, false);
  assert.equal(p.editedInPlace, true, "updatedAt 晚于 createdAt = 原地更新过");
  assert.equal(p.forgotten, false);

  const p2 = toMemoryProvenance({ ...row, source: "mission:abc", updatedAt: created, forgottenAt: updated });
  assert.equal(p2.sourceKeyed, true);
  assert.equal(p2.editedInPlace, false);
  assert.equal(p2.forgotten, true, "已遗忘的记忆也要能查到 provenance");
});
