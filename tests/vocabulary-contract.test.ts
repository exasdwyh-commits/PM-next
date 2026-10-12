/**
 * 词汇宪法守卫（VC1–VC7）：四轴词表只有一份来源，且任何历史写法都不得把英文漏给用户。
 *
 * 背景：`labelOf` 的兜底是 `map[key] ?? key` —— 词表漏登记一个取值，页面上就会直接
 * 显示英文键名（曾出现「证据 HIGH」「证据 WEAK」）。这个测试锁两件事：
 *  1. 每个轴的每个取值都有**纯中文**标签；
 *  2. 适配器认识所有历史写法（大小写不敏感），认不出的也有中文兜底，绝不返回空串/英文。
 *
 * 这些断言是**纯函数 + 静态扫描**，不需要数据库、不连外网。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const CN = /^[\u4e00-\u9fa5·]+$/;

test("VC1 每个轴的取值都有纯中文标签，且标签互不重复（防复制粘贴错位）", async () => {
  const v = await import("@/shared/vocabulary");

  const axes: [string, readonly string[], Record<string, string>][] = [
    ["主张依据", v.CLAIM_BASES, v.CLAIM_BASIS_LABEL],
    ["来源权威", v.SOURCE_AUTHORITIES, v.SOURCE_AUTHORITY_LABEL],
    ["证据强度", v.EVIDENCE_STRENGTHS, v.EVIDENCE_STRENGTH_LABEL],
    ["来源出处", v.SOURCE_PROVENANCES, v.SOURCE_PROVENANCE_LABEL],
  ];

  for (const [axis, keys, labels] of axes) {
    const seen = new Set<string>();
    for (const key of keys) {
      const label = labels[key];
      assert.ok(label, `${axis} 缺标签：${key}`);
      assert.ok(CN.test(label), `${axis} 的 ${key} 标签必须是纯中文，实际「${label}」`);
      assert.equal(seen.has(label), false, `${axis} 的标签重复：「${label}」`);
      seen.add(label);
    }
    // 不得有词表外的多余条目（多了说明取值集与标签集不同步）
    for (const labelKey of Object.keys(labels)) {
      assert.ok(
        (keys as readonly string[]).includes(labelKey),
        `${axis} 的标签表有词表外的键：${labelKey}`
      );
    }
  }
});

test("VC2 证据强度适配器：所有历史写法都收敛成中文，绝不透传英文", async () => {
  const { evidenceStrengthOf, evidenceStrengthLabel } = await import("@/shared/vocabulary");

  const cases: [unknown, string][] = [
    // 现有 canonical（大小写不敏感）
    ["VERIFIED", "VERIFIED"],
    ["verified", "VERIFIED"],
    ["Strong", "STRONG"],
    ["SUPPORTED", "SUPPORTED"],
    ["weak", "WEAK"],
    ["ASSUMED", "ASSUMED"],
    ["UNKNOWN", "UNKNOWN"],
    // 旧 evidence-bridge：按权威分归一
    ["HIGH", "STRONG"],
    ["MEDIUM", "SUPPORTED"],
    ["LOW", "WEAK"],
    // 旧 visual-intelligence / 原料档案：字母级
    ["A", "STRONG"],
    ["b", "SUPPORTED"],
    ["C", "WEAK"],
    ["d", "UNKNOWN"],
    // 垃圾输入
    ["", "UNKNOWN"],
    ["  ", "UNKNOWN"],
    ["nonsense", "UNKNOWN"],
    [null, "UNKNOWN"],
    [undefined, "UNKNOWN"],
    [123, "UNKNOWN"],
    [{}, "UNKNOWN"],
  ];

  for (const [raw, expected] of cases) {
    assert.equal(evidenceStrengthOf(raw), expected, `evidenceStrengthOf(${JSON.stringify(raw)})`);
  }

  // 显示层：任何认得出的历史写法都必须返回纯中文（这就是修「证据 HIGH」的那条断言）
  for (const raw of ["VERIFIED", "WEAK", "STRONG", "HIGH", "MEDIUM", "LOW", "A", "B", "C", "D", "ASSUMED"]) {
    const label = evidenceStrengthLabel(raw);
    assert.ok(CN.test(label), `证据强度标签必须是纯中文：${raw} → ${label}`);
  }
  assert.equal(evidenceStrengthLabel("WEAK"), "弱支撑");
  assert.equal(evidenceStrengthLabel("HIGH"), "强支撑");
});

test("VC3 主张依据适配器：大写 FACT 与小写 fact 合并到同一轴", async () => {
  const { claimBasisOf, claimBasisLabel } = await import("@/shared/vocabulary");

  const cases: [unknown, string][] = [
    ["FACT", "fact"],
    ["fact", "fact"],
    ["Inference", "inference"],
    ["INFERENCE", "inference"],
    ["ASSUMPTION", "assumption"],
    ["assumption", "assumption"],
    // 旧 EVIDENCE_LEVEL 里的 ASSUMED 是「只是假设」，归到 assumption
    ["ASSUMED", "assumption"],
    ["UNKNOWN", "unknown"],
    ["", "unknown"],
    [null, "unknown"],
    [7, "unknown"],
  ];
  for (const [raw, expected] of cases) {
    assert.equal(claimBasisOf(raw), expected, `claimBasisOf(${JSON.stringify(raw)})`);
  }
  for (const raw of ["FACT", "inference", "assumption", "UNKNOWN", "ASSUMED"]) {
    assert.ok(CN.test(claimBasisLabel(raw)), `主张依据标签必须是纯中文：${raw}`);
  }
});

test("VC4 来源权威：上游没给档位必须落「未评级」，绝不猜一个", async () => {
  const { sourceAuthorityOf, sourceAuthorityLabel } = await import("@/shared/vocabulary");

  assert.equal(sourceAuthorityOf({ authorityTier: "first_party", verified: true }), "confirmed");
  assert.equal(sourceAuthorityOf({ authorityTier: "first_party", verified: false }), "internal");
  assert.equal(sourceAuthorityOf({ authorityTier: "curated" }), "curated");
  assert.equal(sourceAuthorityOf({ authorityTier: "public" }), "public");
  // 上下游都认不出的输入一律 unrated —— 猜一个档等于造假绿标
  for (const meta of [{}, { authorityTier: "unknown" }, { authorityTier: null }, { authorityTier: 1 }, { verified: true }]) {
    assert.equal(sourceAuthorityOf(meta), "unrated", `sourceAuthorityOf(${JSON.stringify(meta)})`);
  }
  assert.equal(sourceAuthorityLabel("unrated"), "未评级");
  assert.equal(sourceAuthorityLabel("nonsense"), "未评级");
});

test("VC5 来源出处：认不出时按「外部未核实」兜底，不默认成自家记录", async () => {
  const { sourceProvenanceOf } = await import("@/shared/vocabulary");

  assert.equal(sourceProvenanceOf("user"), "user");
  assert.equal(sourceProvenanceOf("INTERNAL"), "internal");
  assert.equal(sourceProvenanceOf("model"), "model");
  // 认不出的出处不能默认成 internal（自家记录）或 model（模型知识）——那是把不可信材料升格
  for (const raw of ["", "nonsense", null, undefined, 42, {}]) {
    assert.equal(sourceProvenanceOf(raw), "external", `sourceProvenanceOf(${JSON.stringify(raw)})`);
  }
});

test("VC6 权威分归一分档收敛在 vocabulary（evidence-bridge 不再自造 HIGH/MEDIUM/LOW）", async () => {
  const { evidenceStrengthFromAuthority } = await import("@/shared/vocabulary");
  assert.equal(evidenceStrengthFromAuthority(1), "STRONG");
  assert.equal(evidenceStrengthFromAuthority(0.7), "STRONG");
  assert.equal(evidenceStrengthFromAuthority(0.69), "SUPPORTED");
  assert.equal(evidenceStrengthFromAuthority(0.4), "SUPPORTED");
  assert.equal(evidenceStrengthFromAuthority(0.39), "WEAK");
  assert.equal(evidenceStrengthFromAuthority(0), "WEAK");
  assert.equal(evidenceStrengthFromAuthority(Number.NaN), "UNKNOWN");

  const bridge = read("src/modules/knowledge/evidence-bridge.ts");
  assert.ok(bridge.includes("evidenceStrengthFromAuthority"), "evidence-bridge 必须走 vocabulary 的分档函数");
  assert.equal(
    bridge.includes('"HIGH" :'),
    false,
    'evidence-bridge 不得再自造 HIGH/MEDIUM/LOW 词表'
  );
});

test("VC7 词表唯一性：没有第二份定义，且历史重复定义已删", async () => {
  // ① 四个 canonical 标签表只能由 vocabulary.ts 定义一次
  const srcFiles: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) srcFiles.push(full);
    }
  };
  walk(path.join(ROOT, "src"));

  const canonicalNames = ["CLAIM_BASIS_LABEL", "SOURCE_AUTHORITY_LABEL", "EVIDENCE_STRENGTH_LABEL", "SOURCE_PROVENANCE_LABEL"];
  for (const name of canonicalNames) {
    const definers = srcFiles.filter((f) =>
      new RegExp(`export const ${name}\\b`).test(fs.readFileSync(f, "utf8"))
    );
    assert.deepEqual(
      definers.map((f) => path.relative(ROOT, f).replace(/\\/g, "/")),
      ["src/shared/vocabulary.ts"],
      `${name} 只能由 vocabulary.ts 定义`
    );
  }

  // ② 各轴消费者必须从 vocabulary 取词，不得自留副本
  for (const rel of [
    "src/shared/status-labels.ts",
    "src/modules/artifacts/rich-blocks.ts",
    "src/modules/muse/confidence.ts",
    "src/modules/muse/types.ts",
    "src/modules/response-format/types.ts",
    "src/app/muse/components/kit.tsx",
    "src/app/muse/response/response-role-based.tsx",
  ]) {
    assert.ok(read(rel).includes("@/shared/vocabulary"), `${rel} 必须从 vocabulary 取词表`);
  }

  // ②b 明文英文/伪造级次不得出现在渲染位（曾出现「A级/B级」「UNKNOWN」）
  const roleBased = read("src/app/muse/response/response-role-based.tsx");
  assert.equal(
    /["']A级["']|["']B级["']|["']UNKNOWN["']/.test(roleBased),
    false,
    "response-role-based 不得硬编码 A级/B级/UNKNOWN（可信度列须走词汇表）"
  );

  // ③ 历史重复定义必须已删：visual-intelligence 曾自带一份 SourceTrust
  const vi = read("src/modules/visual-intelligence/healthcare-innovation-brief.ts");
  assert.equal(
    /export type SourceTrust = "user"/.test(vi),
    false,
    "visual-intelligence 不得再重复定义 SourceTrust"
  );
  assert.ok(vi.includes("SourceProvenance"), "visual-intelligence 的 SourceTrust 应改为 vocabulary 的别名");

  // ④ status-labels 的旧表必须改为引用 canonical，不得再抄一份字面量
  const labels = read("src/shared/status-labels.ts");
  assert.ok(labels.includes("EVIDENCE_LEVEL_LABELS: Record<string, string> = EVIDENCE_STRENGTH_LABEL"));
  assert.equal(
    /UNKNOWN:\s*"未知"/.test(labels),
    false,
    "status-labels 不得再自持证据强度字面量表"
  );
});
