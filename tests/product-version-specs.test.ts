import assert from "node:assert/strict";
import test from "node:test";

import {
  SPECS_CONTRACT_VERSION,
  SPEC_FIELD_DEFS,
  SPEC_FIELD_INDEX,
  SPEC_UNKNOWN,
  validateProductSpecs,
  type SpecFieldDef,
} from "../src/modules/products/version-specs";

const GROUPS = ["投料", "工艺", "质量标准", "保质期", "合规类别", "成本参数", "workbench"] as const;

test("R3-A：字段契约完整——六类工厂家族齐全、每字段带口径与来源", () => {
  const contractGroups = new Set(SPEC_FIELD_DEFS.filter((d) => d.group !== "workbench").map((d) => d.group));
  for (const g of GROUPS.filter((x) => x !== "workbench")) {
    assert.ok(contractGroups.has(g), `缺少家族「${g}」的字段定义`);
  }

  assert.equal(SPECS_CONTRACT_VERSION, "product-version-specs/v1");
  assert.equal(SPEC_FIELD_INDEX.size, SPEC_FIELD_DEFS.length, "字段键必须唯一");

  const defKeys = new Set<string>();
  for (const def of SPEC_FIELD_DEFS) {
    assert.ok(!defKeys.has(def.key), `重复字段键 ${def.key}`);
    defKeys.add(def.key);
    assert.ok(/^[a-z][a-zA-Z0-9]*$/.test(def.key), `键 ${def.key} 必须 camelCase`);
    assert.ok(def.label.length >= 2 && def.label.length <= 30, `${def.key} label 缺失`);
    assert.ok(def.definition.length >= 12, `${def.key} 口径（definition）缺失或过短`);
    assert.ok(def.sources.length >= 1, `${def.key} 缺少来源标注`);
    assert.ok(GROUPS.includes(def.group), `${def.key} 家族非法：${def.group}`);
    // R3 口径：字段缺省即 UNKNOWN 缺口而非阻断；必填位暂不使用但字段必须存在。
    assert.equal(typeof def.required, "boolean");
  }
});

test("R3-B：标准样品通过校验，缺口如实列出而非被填造", () => {
  const specs = {
    coreIdea: "面向一线城市 25–40 岁女性的睡前晚安饮", // workbench，已知
    rawMaterials: ["γ-氨基丁酸·食品级", "赤藓糖醇·食品级"],
    feedingRatios: SPEC_UNKNOWN, // 显式缺口
    processFlow: "配料→溶解→灌装（推断，未中试）",
    qualityStandard: "",
    qualityIndicators: ["微生物菌落总数 ≤100 CFU/g（GB 4789.2）"],
    shelfLife: SPEC_UNKNOWN,
    complianceCategory: "普通食品",
    claimsBoundary: "不得宣称助眠/治疗功效（推断，待法务确认）",
    targetUnitCost: 8.5,
    moq: SPEC_UNKNOWN,
    // compliance 家族未给出 regulatoryNotes → 缺省缺口
    factoryFreeFromNote: "车间共用产线已清洁验证", // 契约外键 → extras 透传
    unlikelyLegacyFlag: true, // 契约外布尔键 → extras 透传不拦
  };

  const v = validateProductSpecs(specs);
  assert.deepEqual(v.problems, [], `标准样品应通过：${v.problems.join("；")}`);
  assert.ok(v.ok);

  // 缺口可见：显式 UNKNOWN + 缺省工厂字段都被点名，且绝不带值。
  assert.ok(v.unknownFields.includes("feedingRatios"));
  assert.ok(v.unknownFields.includes("shelfLife"));
  assert.ok(v.unknownFields.includes("moq"));
  assert.ok(v.unknownFields.includes("regulatoryNotes"), "缺省的工厂字段也要列入缺口");
  assert.ok(!v.unknownFields.includes("rawMaterials"));

  // 契约外键透传不拦，但可见。
  assert.ok(v.extras.includes("factoryFreeFromNote"));
  assert.ok(v.extras.includes("unlikelyLegacyFlag"));
});

test("R3-C：硬违例逐条点名，绝无 '', 空串蒙混过关", () => {
  const v1 = validateProductSpecs({ targetUnitCost: -5 });
  assert.ok(v1.problems.some((p) => p.includes("targetUnitCost") && p.includes("不得小于 0")));

  const v2 = validateProductSpecs({ targetUnitCost: "8.5元" });
  assert.ok(v2.problems.some((p) => p.includes("targetUnitCost") && p.includes("数字")));

  const v3 = validateProductSpecs({ complianceCategory: "蓝帽子" });
  assert.ok(v3.problems.some((p) => p.includes("complianceCategory") && p.includes("枚举")));

  const v4 = validateProductSpecs({ rawMaterials: "γ-氨基丁酸" });
  assert.ok(v4.problems.some((p) => p.includes("rawMaterials") && p.includes("字符串数组")));

  const v5 = validateProductSpecs({ coreIdea: "x".repeat(900) });
  assert.ok(v5.problems.some((p) => p.includes("coreIdea") && p.includes("上限")));

  assert.deepEqual(validateProductSpecs("not-an-object").ok, false);
  assert.deepEqual(validateProductSpecs([1, 2]).ok, false);

  // UNKNOWN 是合法缺口，不是违例。
  const v6 = validateProductSpecs({ complianceCategory: SPEC_UNKNOWN, targetUnitCost: SPEC_UNKNOWN });
  assert.deepEqual(v6.problems, [], `UNKNOWN 应被视为合法缺口：${v6.problems.join("；")}`);
  assert.ok(v6.unknownFields.includes("complianceCategory"));
  assert.ok(v6.unknownFields.includes("targetUnitCost"));

  // null 等同显式缺口（历史 v1 快照含 null 值字段，不得因契约升级而报错）。
  const v7 = validateProductSpecs({ formSpec: null, targetAudience: "夜班妈妈" });
  assert.deepEqual(v7.problems, []);
  assert.ok(v7.unknownFields.includes("formSpec"));
});

test("R3-E：多形键承认既有用法——targetChannels 字符串数组不拦，数字仍拦", () => {
  // 既有渠道回归（golden-channel-route-persistence）实测：specs.targetChannels 为字符串数组。
  const v = validateProductSpecs({ targetChannels: ["私域/会销", "快手直播"], bundleOptions: ["299/12盒"] });
  assert.deepEqual(v.problems, [], `多形键应放行既有数组形态：${v.problems.join("；")}`);
  assert.ok(v.extras.includes("bundleOptions"), "bundleOptions 未入契约 → extras 透传可见");

  const bad = validateProductSpecs({ targetChannels: 123 });
  assert.ok(bad.problems.some((p) => p.includes("targetChannels")), "非法类型（数字）必须被点名");

  const badItem = validateProductSpecs({ targetChannels: ["天猫", 666 as unknown as string] });
  assert.ok(badItem.problems.some((p) => p.includes("targetChannels")), "数组内非字符串项必须被点名");
});

test("R3-D：枚举/日期/金额类型在定义里自洽", () => {
  for (const def of SPEC_FIELD_DEFS) {
    if (def.type === "enum") {
      assert.ok((def.enumValues ?? []).length >= 2, `${def.key} 枚举至少两个候选`);
      assert.ok(!def.enumValues!.includes(SPEC_UNKNOWN), `${def.key} 不要手写 UNKNOWN 枚举值（走缺口通道）`);
    }
    if (def.type === "money" || (def.type === "number" && def.min !== undefined)) {
      assert.equal(def.min, 0, `${def.key} 金额/数量下限应为 0`);
    }
    if (def.type === "number" && def.unit) {
      assert.ok(def.unit.length <= 16, `${def.key} 单位过长`);
    }
  }

  // 工厂家族全部使用 sources 允许通道（守卫：不要悄悄引入新来源类型）。
  const allowed = new Set(["MANUAL", "AI_EXTRACTED", "SUPPLIER_QUOTE", "LAB_REPORT", "REGULATORY_SOURCE", "INFERENCE", "MIGRATED"]);
  for (const def of SPEC_FIELD_DEFS) {
    for (const s of def.sources) {
      assert.ok(allowed.has(s), `${def.key} 引入未知来源类型 ${s}`);
    }
  }
});
