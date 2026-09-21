import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PREVIEW_COUNT,
  visiblePreviewItems,
  collapseToggleLabel,
} from "./collapsible-list";

/**
 * CollapsibleList 的切片与文案逻辑单测。
 * 渲染行为(状态切换、按钮点击)由 UI 层承担,这里锁定纯函数契约:
 * 折叠切片、默认条数、按钮文案与计数覆盖、空列表不渲染按钮。
 */

test("visiblePreviewItems: 折叠时只取前 previewCount 条", () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8];
  assert.deepEqual(visiblePreviewItems(items, false, 5), [1, 2, 3, 4, 5]);
});

test("visiblePreviewItems: 展开时返回完整列表", () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8];
  assert.deepEqual(visiblePreviewItems(items, true, 5), items);
});

test("visiblePreviewItems: 未超限时折叠与展开结果一致(不出现幽灵按钮)", () => {
  const items = [1, 2, 3];
  assert.deepEqual(visiblePreviewItems(items, false, 5), items);
});

test("visiblePreviewItems: 不修改原数组", () => {
  const items = [1, 2, 3, 4, 5];
  const snapshot = [...items];
  visiblePreviewItems(items, false, 2);
  assert.deepEqual(items, snapshot);
});

test("DEFAULT_PREVIEW_COUNT 为 5(与原 Dashboard 挑战报告约定一致)", () => {
  assert.equal(DEFAULT_PREVIEW_COUNT, 5);
});

test("collapseToggleLabel: 未展开显示「查看全部 N 单位」", () => {
  assert.equal(collapseToggleLabel(8, false, "条"), "查看全部 8 条");
});

test("collapseToggleLabel: 展开后显示「收起」", () => {
  assert.equal(collapseToggleLabel(8, true, "条"), "收起");
});

test("collapseToggleLabel: totalOverride 覆盖计数(工作简报归并队列场景)", () => {
  assert.equal(collapseToggleLabel(5, false, "件", 7), "查看全部 7 件");
});

test("collapseToggleLabel: 自定义单位(顾问决策记录场景)", () => {
  assert.equal(collapseToggleLabel(4, false, "条记录"), "查看全部 4 条记录");
});

test("collapseToggleLabel: 空列表返回 null(不渲染按钮)", () => {
  assert.equal(collapseToggleLabel(0, false, "条"), null);
});
