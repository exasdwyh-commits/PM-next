import assert from "node:assert/strict";
import { test } from "node:test";
import { LIBRARY_FORMATS, libraryItem, normalizeLibraryQuery } from "../src/modules/supervisor/library";

test("LB1：产出条目——标题取目标首句，五种下载格式都指向仅发起人可用的导出接口", () => {
  const it = libraryItem({
    id: "abc-123",
    goal: "  分析高蛋白零食的新品机会。\n要求：给出三条建议 ",
    createdAt: new Date("2026-09-28T01:00:00Z"),
    updatedAt: new Date("2026-09-28T02:00:00Z"),
  });
  assert.equal(it.missionTaskId, "abc-123");
  assert.ok(it.title.length > 0 && !it.title.includes("\n"));
  assert.equal(it.finishedAt, "2026-09-28T02:00:00.000Z");
  assert.deepEqual(it.downloads.map((d) => d.format), ["md", "pdf", "docx", "xlsx", "pptx"]);
  assert.equal(it.downloads[2].href, "/api/missions/abc-123/export?format=docx");
  assert.equal(LIBRARY_FORMATS.length, 5);
});

test("LB2：空目标给兜底标题，目标截到 200 字，id 做 URL 编码", () => {
  const it = libraryItem({ id: "a/b", goal: null, createdAt: new Date(0), updatedAt: new Date(0) });
  assert.equal(it.title, "未命名任务");
  assert.equal(it.downloads[0].href, "/api/missions/a%2Fb/export?format=md");
  assert.equal(libraryItem({ id: "x", goal: "字".repeat(500), createdAt: new Date(0), updatedAt: new Date(0) }).goal.length, 200);
});

test("LB3：搜索词规整——空白压缩、截断、空串视为不搜索", () => {
  assert.equal(normalizeLibraryQuery("  高蛋白   零食 "), "高蛋白 零食");
  assert.equal(normalizeLibraryQuery("   "), null);
  assert.equal(normalizeLibraryQuery(null), null);
  assert.equal(normalizeLibraryQuery("a".repeat(100))?.length, 60);
});
