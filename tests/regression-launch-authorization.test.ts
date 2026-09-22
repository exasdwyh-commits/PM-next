/**
 * 正式 G3 上市授权回归锁（纯逻辑 + UI 文案）
 *
 * 数据库级权限、快照漂移、CAS 与历史留痕由 regression-formal-g3.ts 覆盖。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  describeLaunchAuthorization,
  describeLaunchExecutionAuthorization,
  FORMAL_G3_UNAVAILABLE_GAP,
  LAUNCH_EXECUTION_NO_FORMAL_G3_GAP,
} from "../src/modules/launch/service";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const launchTab = read("src/app/products/[id]/launch-tab.tsx");

test("无任何批准 → 未授权", () => {
  const a = describeLaunchAuthorization({
    approvedAt: null,
    formalG3ApprovedAt: null,
    formalG3PacketId: null,
  });
  assert.equal(a.approved, false);
  assert.equal(a.mechanism, null);
  assert.equal(a.formalG3, false);
  assert.equal(a.gap, null);
});

test("历史 approvedAt 但无 G3 → 只能识别为 LEGACY_APPROVAL，不能执行上市", () => {
  const a = describeLaunchAuthorization({
    approvedAt: new Date("2026-09-22T00:00:00Z"),
    formalG3ApprovedAt: null,
    formalG3PacketId: null,
  });
  assert.equal(a.approved, true);
  assert.equal(a.mechanism, "LEGACY_APPROVAL");
  assert.equal(a.formalG3, false);
  assert.equal(a.gap, FORMAL_G3_UNAVAILABLE_GAP);

  const execution = describeLaunchExecutionAuthorization({
    formalG3ApprovedAt: null,
    formalG3PacketId: null,
  });
  assert.equal(execution.approved, false);
  assert.equal(execution.formalG3, false);
  assert.equal(execution.gap, LAUNCH_EXECUTION_NO_FORMAL_G3_GAP);
});

test("正式 G3 指针 + 批准时间 → FORMAL_G3 且无授权缺口", () => {
  const approvedAt = new Date("2026-09-22T01:00:00Z");
  const a = describeLaunchAuthorization({
    approvedAt,
    formalG3ApprovedAt: approvedAt,
    formalG3PacketId: "g3-packet-1",
  });
  assert.equal(a.approved, true);
  assert.equal(a.mechanism, "FORMAL_G3");
  assert.equal(a.formalG3, true);
  assert.equal(a.gap, null);
  assert.equal(a.packetId, "g3-packet-1");

  const execution = describeLaunchExecutionAuthorization({
    formalG3ApprovedAt: approvedAt,
    formalG3PacketId: "g3-packet-1",
  });
  assert.equal(execution.formalG3, true);
  assert.equal(execution.mechanism, "FORMAL_G3");
  assert.equal(execution.gap, null);
});

test("UI 已切换为负责人提交 + 指定决策人审批 + G3 后再确认上市", () => {
  assert.ok(launchTab.includes("提交正式 G3 审批"));
  assert.ok(launchTab.includes("批准 G3"));
  assert.ok(launchTab.includes("驳回 G3"));
  assert.ok(launchTab.includes("指定决策人"));
  assert.ok(launchTab.includes("负责人不能自批"));
  assert.ok(launchTab.includes("没有当前有效的正式 G3时按钮不可用") || launchTab.includes("没有当前有效的正式 G3 时按钮不可用"));
  assert.ok(!launchTab.includes("TASK-034/035"), "实现完成后 UI 不应再显示未来任务占位");
  assert.ok(!launchTab.includes("放行（获准）"), "正式 G3 上线后不应保留旧直接放行按钮");
});

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""))
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

test("JSX 文本不得含 markdown 星号", () => {
  const offenders = stripComments(launchTab)
    .split("\n")
    .map((line, i) => [i + 1, line] as const)
    .filter(([, line]) => line.includes("**"));
  assert.equal(
    offenders.length,
    0,
    offenders.map(([n, l]) => `:${n} ${l.trim().slice(0, 90)}`).join("\n")
  );
});
