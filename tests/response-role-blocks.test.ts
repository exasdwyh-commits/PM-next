/**
 * 角色视图渲染契约（RB1–RB3）
 * ==========================
 * 背景：V2 的「角色视图」switch 只覆盖了部分块类型，`callout` / `unknown` / `decision`
 * 落到 default 分支后，把整个 block 对象 `JSON.stringify` 打进了界面 ——
 * 报告结尾因此出现 `{"type":"callout","full":true,…}` 这类内部结构源码。
 *
 * 这里锁住三件事：
 *   RB1 任何角色视图都不得序列化 block 对象；
 *   RB2 信封真实会产出的块类型必须被多个视图覆盖（不是靠兜底糊过去）；
 *   RB3 兜底分支不得把内部类型名（英文枚举）暴露给用户。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const file = resolve(here, "../src/app/muse/response/response-role-based.tsx");
const src = readFileSync(file, "utf8");

test("RB1：角色视图不得把 block 对象序列化到界面", () => {
  const hits = [...src.matchAll(/JSON\.stringify\(\s*b\b/g)].map((m) => m[0]);
  assert.equal(hits.length, 0, `发现 ${hits.length} 处 JSON.stringify(block)：${hits.join(" | ")}`);
});

test("RB2：callout / unknown / decision 必须被多个视图显式渲染", () => {
  for (const type of ["callout", "unknown", "decision"]) {
    const n = (src.match(new RegExp(`case "${type}":`, "g")) ?? []).length;
    assert.ok(n >= 2, `块类型 "${type}" 只被 ${n} 个视图处理（应 ≥2），容易落到兜底分支`);
  }
});

test("RB3：兜底分支不得暴露内部结构或英文枚举", () => {
  const defaults = [...src.matchAll(/default:\s*return[\s\S]{0,220}?;\s*\n\s*\}/g)].map((m) => m[0]);
  assert.ok(defaults.length >= 3, `应能找到 3 个角色视图的 default 分支，实际 ${defaults.length}`);
  for (const d of defaults) {
    assert.ok(!/JSON\.stringify/.test(d), `default 分支仍在序列化 block：${d.slice(0, 140)}`);
    assert.ok(!/\{\s*b\.type\s*\}/.test(d), `default 分支仍把英文类型名渲染给用户：${d.slice(0, 140)}`);
  }
});
