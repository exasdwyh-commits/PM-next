/**
 * 上市"准备就绪"与"正式 G3 授权"的区分回归锁（TASK-005b）
 *
 * 盯住两件事，防止回退：
 *   ① **服务层**：`describeLaunchAuthorization()` 必须把旧机制批准标为 `LEGACY_APPROVAL`，
 *      且 `FORMAL_G3` **恒不存在**（当前系统没有正式 G3 授权）。调用方不得只看 `approvedAt`。
 *   ② **文案层**：UI 不得再把仅有 `approvedAt` 呈现为"已获准上市"的表述；
 *      必须明确"旧机制批准 · 准备就绪 · 非正式 G3 授权"。
 *
 * 本测试为**纯逻辑**（不起服务、不连库）：服务函数直接调用；文案断言用**源码扫描**
 * （读 `launch-tab.tsx` / `briefing.ts` 文本）。运行：
 *   node_modules/.bin/tsx tests/regression-launch-authorization.test.ts
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
const briefing = read("src/modules/workspace/briefing.ts");

// ───────────────────────────────────────────────────────────────────────────
// ① 服务层：机制来源标注
// ───────────────────────────────────────────────────────────────────────────

test("正例：未放行 → approved=false、mechanism=null、formalG3=false、gap=null", () => {
  const a = describeLaunchAuthorization({ approvedAt: null });
  assert.equal(a.approved, false);
  assert.equal(a.mechanism, null);
  assert.equal(a.formalG3, false);
  assert.equal(a.gap, null);
});

test("正例：有 approvedAt → 机制来源为 LEGACY_APPROVAL，gap 非空", () => {
  const a = describeLaunchAuthorization({ approvedAt: new Date() });
  assert.equal(a.approved, true);
  assert.equal(a.mechanism, "LEGACY_APPROVAL");
  assert.equal(a.formalG3, false);
  assert.equal(a.gap, FORMAL_G3_UNAVAILABLE_GAP);
  assert.ok(a.gap && a.gap.includes("正式 G3"), `缺口文案应点名正式 G3，实际：${a.gap}`);
});

test("正例：FORMAL_G3 在当前系统中恒不存在（任何路径都不产出）", () => {
  for (const approvedAt of [null, new Date(0), new Date()]) {
    assert.notEqual(describeLaunchAuthorization({ approvedAt }).mechanism, "FORMAL_G3");
  }
  assert.equal(describeLaunchExecutionAuthorization().formalG3, false);
});

test("缺口断言：confirmLaunchExecution 的授权对象含『无正式 G3 授权』缺口", () => {
  const a = describeLaunchExecutionAuthorization();
  assert.equal(a.formalG3, false);
  assert.ok(
    a.gap && a.gap.includes("无正式 G3 授权"),
    `缺口文案应含"无正式 G3 授权"，实际：${a.gap}`
  );
  assert.equal(a.gap, LAUNCH_EXECUTION_NO_FORMAL_G3_GAP);
});

// ───────────────────────────────────────────────────────────────────────────
// ② 文案层：不再有"已获准上市"歧义；保留诚实表述并补 G3 说明
// ───────────────────────────────────────────────────────────────────────────

test("反例（文案）：launch-tab 不再出现会被读成『已获准上市』的表述", () => {
  const forbidden = [
    "上市计划已获准放行", // 5a #1
    "已获准", // 5a #3 / #5 / #6 共同子串（按钮/KV/阶段条）
  ];
  for (const s of forbidden) {
    assert.ok(!launchTab.includes(s), `launch-tab 不应再含「${s}」`);
  }
  assert.ok(!briefing.includes("获准放行"), "briefing 不应再含「获准放行」");
});

test("正例（文案）：launch-tab 明确标注『旧机制批准 · 准备就绪 · 非正式 G3』", () => {
  assert.ok(launchTab.includes("旧机制批准"), "应含『旧机制批准』");
  assert.ok(launchTab.includes("非正式 G3"), "应含『非正式 G3』");
  assert.ok(launchTab.includes("authorization"), "UI 应消费 authorization 机制来源");
});

test("正例（文案）：『获准 ≠ 已上市』保留，并补充『不是正式 G3 授权』", () => {
  assert.ok(launchTab.includes("获准 ≠ 已上市"), "应保留『获准 ≠ 已上市』的诚实表述");
  assert.ok(launchTab.includes("不是正式 G3 授权"), "应补充『不是正式 G3 授权』");
});

// ───────────────────────────────────────────────────────────────────────────
// ② 渲染守卫：JSX 文本不得含 markdown 星号（`**` 不会被渲染成粗体，会原样显示）
// ───────────────────────────────────────────────────────────────────────────

/** 去掉注释但**保留行数**（多行块注释用等量换行占位），以便报出准确行号。 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, "")) // 块注释 → 等量空行
    .replace(/^[ \t]*\/\/.*$/gm, ""); // 整行行注释 → 空行
}

test("反例（渲染）：JSX 文本不得含 markdown 星号（不会渲染成粗体，会原样显示）", () => {
  const offenders = stripComments(launchTab)
    .split("\n")
    .map((line, i) => [i + 1, line] as const)
    .filter(([, line]) => line.includes("**"));
  assert.equal(
    offenders.length,
    0,
    `launch-tab.tsx 剥注释后不应含 "**"（JSX 不会渲染粗体，会原样显示）。命中：\n` +
      offenders.map(([n, l]) => `  :${n} ${l.trim().slice(0, 90)}`).join("\n")
  );
});
