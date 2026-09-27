import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { RULES, validate, isRenderable } from "../src/modules/response-format/validate";
import type { ResponseEnvelope } from "../src/modules/response-format/types";

const fixture = (name: string): ResponseEnvelope =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/response", `${name}.json`), "utf8"));

/** 复制一份再改，避免用例之间互相污染。 */
const mutate = (base: ResponseEnvelope, fn: (e: ResponseEnvelope) => void): ResponseEnvelope => {
  const copy = JSON.parse(JSON.stringify(base)) as ResponseEnvelope;
  fn(copy);
  return copy;
};

const ids = (env: ResponseEnvelope) => validate(env).map((i) => i.id);

// ── 金样本 ──────────────────────────────────────────────────
test("金样本：新产品结论信封应全部通过", () => {
  const env = fixture("new-product-conclusion");
  const issues = validate(env);
  assert.deepEqual(issues, [], `金样本不应有问题，实际:\n${issues.map((i) => `${i.id} ${i.detail}`).join("\n")}`);
  assert.equal(isRenderable(env), true);
});

test("规则集没有重复 id，且每条都有描述", () => {
  const seen = new Set<string>();
  for (const r of RULES) {
    assert.equal(seen.has(r.id), false, `规则 id 重复: ${r.id}`);
    seen.add(r.id);
    assert.ok(r.desc.length > 0, `${r.id} 缺描述`);
    assert.ok(["error", "warn"].includes(r.level));
  }
});

// ── 逐条反例 ────────────────────────────────────────────────
const base = fixture("new-product-conclusion");

test("R1 lede 超长会被拦截", () => {
  assert.ok(ids(mutate(base, (e) => { e.lede = "很".repeat(61); })).includes("R1"));
  assert.ok(ids(mutate(base, (e) => { e.lede = ""; })).includes("R1"));
});

test("R2 要点未标 kind 会被拦截", () => {
  const bad = mutate(base, (e) => {
    const kp = e.blocks.find((b) => b.type === "keypoints");
    if (kp && kp.type === "keypoints") kp.items[0].kind = "guess" as never;
  });
  assert.ok(ids(bad).includes("R2"));
});

test("R3 事实缺来源角标 / 角标悬空都会被拦截", () => {
  const noRef = mutate(base, (e) => {
    const kp = e.blocks.find((b) => b.type === "keypoints");
    if (kp && kp.type === "keypoints") kp.items[0].text = "同价位竞品蛋白含量领先";
  });
  assert.ok(ids(noRef).includes("R3"));

  const dangling = mutate(base, (e) => {
    const kp = e.blocks.find((b) => b.type === "keypoints");
    if (kp && kp.type === "keypoints") kp.items[0].text = "领先很多 [9]";
  });
  const detail = validate(dangling).find((i) => i.id === "R3")?.detail ?? "";
  assert.match(detail, /没有对应来源/);
});

test("R4 决策卡缺反对理由或风险会被拦截", () => {
  const bad = mutate(base, (e) => {
    const d = e.blocks.find((b) => b.type === "decision");
    if (d && d.type === "decision") { d.against = []; d.risks = []; }
  });
  const detail = validate(bad).find((i) => i.id === "R4")?.detail ?? "";
  assert.match(detail, /against/);
  assert.match(detail, /risks/);
});

test("R5 超长段落只告警不阻断", () => {
  const bad = mutate(base, (e) => {
    const p = e.blocks.find((b) => b.type === "prose");
    if (p && p.type === "prose") p.body[0] = "字".repeat(300);
  });
  const issue = validate(bad).find((i) => i.id === "R5");
  assert.equal(issue?.level, "warn");
  assert.equal(isRenderable(bad), true, "warn 不应阻断渲染");
});

test("R6 表格超 6 列或行列数不一致会被拦截", () => {
  const wide = mutate(base, (e) => {
    const t = e.blocks.find((b) => b.type === "table");
    if (t && t.type === "table") {
      t.cols = Array.from({ length: 7 }, (_, i) => ({ label: `c${i}` }));
      t.rows = [{ cells: Array.from({ length: 7 }, () => "x") }];
    }
  });
  assert.ok(ids(wide).includes("R6"));

  const ragged = mutate(base, (e) => {
    const t = e.blocks.find((b) => b.type === "table");
    if (t && t.type === "table") t.rows[0].cells = ["只有一个"];
  });
  assert.match(validate(ragged).find((i) => i.id === "R6")?.detail ?? "", /≠ 列数/);
});

test("R7 meta 缺字段会被拦截", () => {
  const bad = mutate(base, (e) => { (e.meta as { model?: string }).model = undefined; });
  assert.ok(ids(bad).includes("R7"));
});

test("R8 演示运行不得声明额度消耗", () => {
  const bad = mutate(base, (e) => { e.meta.quota = { used: 3, limit: 20 }; });
  assert.ok(ids(bad).includes("R8"));
  // 真实运行则允许有额度
  const real = mutate(base, (e) => { e.demo = false; e.meta.quota = { used: 3, limit: 20 }; });
  assert.equal(ids(real).includes("R8"), false);
});

test("R9 AI 套话会被拦截", () => {
  for (const phrase of ["作为一个 AI 助手，我", "希望这对你有帮助", "我无法提供准确数据"]) {
    const bad = mutate(base, (e) => {
      const p = e.blocks.find((b) => b.type === "prose");
      if (p && p.type === "prose") p.body.push(phrase);
    });
    assert.ok(ids(bad).includes("R9"), `未拦截: ${phrase}`);
  }
});

test("R10 有 unknown 要点但没写缺什么源会被拦截", () => {
  const noBlock = mutate(base, (e) => { e.blocks = e.blocks.filter((b) => b.type !== "unknown"); });
  assert.ok(ids(noBlock).includes("R10"));

  const emptyNeeds = mutate(base, (e) => {
    const u = e.blocks.find((b) => b.type === "unknown");
    if (u && u.type === "unknown") u.items[0].needs = "  ";
  });
  assert.ok(ids(emptyNeeds).includes("R10"));
});

test("R11 ask 必须说明为什么是你，且至少 2 个选项", () => {
  assert.ok(ids(mutate(base, (e) => { e.ask!.why_you = ""; })).includes("R11"));
  assert.ok(ids(mutate(base, (e) => { e.ask!.options = [e.ask!.options[0]]; })).includes("R11"));
});

test("R13 信封类型与必备块对应", () => {
  const noDecision = mutate(base, (e) => { e.blocks = e.blocks.filter((b) => b.type !== "decision"); });
  assert.match(validate(noDecision).find((i) => i.id === "R13")?.detail ?? "", /CONCLUSION/);

  const progress = mutate(base, (e) => { e.kind = "PROGRESS"; });
  assert.match(validate(progress).find((i) => i.id === "R13")?.detail ?? "", /PROGRESS/);
});

test("R14 图表必须标单位与来源", () => {
  const noUnit = mutate(base, (e) => {
    const c = e.blocks.find((b) => b.type === "chart");
    if (c && c.type === "chart") c.unit = "";
  });
  assert.match(validate(noUnit).find((i) => i.id === "R14")?.detail ?? "", /缺单位/);
});

// ── 渲染门禁 ────────────────────────────────────────────────
test("error 级问题会阻断渲染，warn 不会", () => {
  const err = mutate(base, (e) => { e.lede = ""; });
  assert.equal(isRenderable(err), false);
});
