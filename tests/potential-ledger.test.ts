/**
 * 持续职责台账的单元测试（研发办公室阶段三 A 的判断侧）
 *
 * 守三件事：幂等、未接入不派活、没有有效变化就待命。
 * 全部为纯函数测试，不连库、不调模型。
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  compileProductPotentialInput,
  evidenceGapKey,
  type CompilerEvidence,
} from "../src/modules/product-development/potential-compiler";
import { assessProductPotential } from "../src/modules/product-development/potential-assessment";
import {
  assessEvidenceDelta,
  buildStandingDuties,
  selectNewDuties,
  sourceChannelForField,
  toJudgmentSnapshot,
  type JudgmentSnapshot,
} from "../src/modules/product-development/potential-ledger";

function verifiedFacts(
  id: string,
  facts: Array<[string, string]>
): CompilerEvidence {
  return {
    id,
    source: `source-${id}`,
    nature: "REAL",
    verifyStatus: "VERIFIED",
    validationStatus: "UNAPPLIED",
    claims: facts.map(([fieldKey, value], index) => ({
      id: `${id}-c${index}`,
      fieldKey,
      kind: "FACT" as const,
      value,
    })),
  };
}

function snapshotOf(evidence: CompilerEvidence[]): JudgmentSnapshot {
  const compiled = compileProductPotentialInput({ evidence, gates: [] });
  return toJudgmentSnapshot(compiled, assessProductPotential(compiled.input));
}

function compileOf(evidence: CompilerEvidence[]) {
  return compileProductPotentialInput({ evidence, gates: [] });
}

// ---------------------------------------------------------------------------
// 幂等
// ---------------------------------------------------------------------------

test("幂等：同一份证据重复编译，缺口键完全一致", () => {
  const evidence = [verifiedFacts("e1", [["price", "299"]])];
  const first = compileOf(evidence).gaps.map(evidenceGapKey).sort();
  const second = compileOf(evidence).gaps.map(evidenceGapKey).sort();
  assert.deepEqual(first, second);
  assert.ok(first.length > 0, "应当产出缺口");
});

test("幂等：缺口键不随描述性文案变化（不含 priority / suggestedQuery）", () => {
  const gap = compileOf([verifiedFacts("e1", [["price", "299"]])]).gaps[0];
  const renamed = {
    ...gap,
    priority: "LOW" as const,
    suggestedQuery: "换一个查询词",
    whyItMatters: "换一段说明",
  };
  assert.equal(evidenceGapKey(gap), evidenceGapKey(renamed));
});

test("幂等：假设台账的键稳定且可区分来源类型", () => {
  const evidence: CompilerEvidence[] = [
    {
      id: "u1",
      source: "未核实资料",
      nature: "REAL",
      verifyStatus: "UNVERIFIED",
      claims: [
        { id: "u1-c1", fieldKey: "salesVolume", kind: "FACT", value: "疑似热销" },
      ],
    },
    {
      id: "t1",
      source: "规则模板",
      nature: "DEMO",
      verifyStatus: "VERIFIED",
      claims: [{ id: "t1-c1", fieldKey: "price", kind: "FACT", value: "199" }],
    },
  ];
  const first = compileOf(evidence).assumptions.map((item) => item.key).sort();
  const second = compileOf(evidence).assumptions.map((item) => item.key).sort();
  assert.deepEqual(first, second);
  assert.ok(first.some((key) => key.includes(":HYPOTHESIS:")));
  assert.ok(first.some((key) => key.includes(":TEMPLATE:")));
});

// ---------------------------------------------------------------------------
// 去重
// ---------------------------------------------------------------------------

test("去重：职责清单里没有重复键，已存在的不再重复派发", () => {
  const compiled = compileOf([verifiedFacts("e1", [["price", "299"]])]);
  const duties = buildStandingDuties({ compiled });
  assert.ok(duties.length > 0);
  assert.equal(new Set(duties.map((duty) => duty.key)).size, duties.length);

  const known = duties.map((duty) => duty.key);
  assert.equal(selectNewDuties(duties, known).length, 0);
  assert.equal(selectNewDuties(duties, []).length, duties.length);
});

test("排序稳定：同样输入得到同样顺序", () => {
  const compiled = compileOf([verifiedFacts("e1", [["price", "299"]])]);
  const a = buildStandingDuties({ compiled }).map((duty) => duty.key);
  const b = buildStandingDuties({ compiled }).map((duty) => duty.key);
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------
// 未接入就不派活
// ---------------------------------------------------------------------------

test("未接入的数据源只显示未接入，不产生可派发的职责", () => {
  const compiled = compileOf([verifiedFacts("e1", [["price", "299"]])]);

  // 什么都没接入：除了需要人工的，其余一律 NOT_CONFIGURED 且不可派发。
  const bare = buildStandingDuties({ compiled });
  assert.ok(
    bare.every((duty) => duty.actionable === false),
    "没有配置任何数据源时不应有任何可自动派发的职责"
  );

  const sales = bare.find((duty) => duty.title.includes("salesVolume"));
  assert.ok(sales, "应当有销量缺口");
  assert.equal(sales!.sourceChannel, "ecommerce");
  assert.equal(sales!.sourceStatus, "NOT_CONFIGURED");

  // 接入电商通道后，同一条职责才变成可派发。
  const wired = buildStandingDuties({
    compiled,
    availableSources: ["ecommerce"],
  });
  const salesWired = wired.find((duty) => duty.title.includes("salesVolume"))!;
  assert.equal(salesWired.sourceStatus, "AVAILABLE");
  assert.equal(salesWired.actionable, true);
});

test("需要人工提供的职责永远是 HUMAN_ONLY，接入数据源也不会变成自动派发", () => {
  const compiled = compileOf([verifiedFacts("e1", [["price", "299"]])]);
  const duties = buildStandingDuties({
    compiled,
    // 把能配的都配上，人工项仍不应变成自动项。
    availableSources: [
      "ecommerce",
      "supplier",
      "channel_policy",
      "channel_feedback",
      "internal",
      "user_feedback",
      "research_report",
      "patent_db",
      "compliance",
    ],
  });

  const cost = duties.find((duty) => duty.title.includes("costQuote"))!;
  assert.equal(cost.sourceChannel, "supplier");
  assert.equal(cost.requiresHumanInput, true);
  assert.equal(cost.sourceStatus, "HUMAN_ONLY");
  assert.equal(cost.actionable, false);
});

test("字段到数据通道的映射覆盖所有 rubric 必需字段", () => {
  const compiled = compileOf([]);
  const fieldKeys = compiled.gaps
    .map((gap) => gap.fieldKey)
    .filter((key): key is string => Boolean(key));
  assert.ok(fieldKeys.length > 0);
  for (const fieldKey of fieldKeys) {
    assert.ok(
      sourceChannelForField(fieldKey),
      `字段 ${fieldKey} 没有登记数据通道，未接入判定会失真`
    );
  }
});

// ---------------------------------------------------------------------------
// 待核验假设台账
// ---------------------------------------------------------------------------

test("假设台账：未核实材料与模板值都进台账，并说明为什么还不能算事实", () => {
  const compiled = compileOf([
    {
      id: "u1",
      source: "未核实的网络转载",
      nature: "REAL",
      verifyStatus: "UNVERIFIED",
      claims: [
        { id: "u1-c1", fieldKey: "salesVolume", kind: "FACT", value: "疑似热销" },
      ],
    },
    {
      id: "t1",
      source: "规则模板默认值",
      nature: "DEMO",
      verifyStatus: "VERIFIED",
      claims: [{ id: "t1-c1", fieldKey: "price", kind: "FACT", value: "199" }],
    },
  ]);

  const hypotheses = compiled.assumptions.filter((a) => a.basis === "HYPOTHESIS");
  const templates = compiled.assumptions.filter((a) => a.basis === "TEMPLATE");
  assert.ok(hypotheses.length > 0, "未核实材料必须进台账");
  assert.ok(templates.length > 0, "模板值必须进台账");
  assert.ok(
    compiled.assumptions.every(
      (item) => item.whyUnverified.length > 0 && item.verificationSuggestion.length > 0
    ),
    "每条假设都要说明「为什么还不能算事实」和「怎么核验」"
  );

  // 模板假设只能被真实来源替换，不能靠补证升级，因此必须走人工。
  const duties = buildStandingDuties({ compiled });
  const templateDuty = duties.find(
    (duty) =>
      duty.kind === "UNVERIFIED_ASSUMPTION" &&
      duty.key.includes(":TEMPLATE:") === true
  );
  assert.ok(templateDuty, "模板假设必须出现在职责清单里");
  assert.equal(templateDuty!.requiresHumanInput, true);
  assert.equal(templateDuty!.sourceStatus, "HUMAN_ONLY");
});

test("假设台账不产生分数：模板值只登记，不进维度评分", () => {
  const compiled = compileOf([
    {
      id: "t1",
      source: "规则模板默认值",
      nature: "DEMO",
      verifyStatus: "VERIFIED",
      claims: [{ id: "t1-c1", fieldKey: "price", kind: "FACT", value: "199" }],
    },
  ]);
  assert.ok(compiled.assumptions.length > 0);
  for (const dimension of compiled.dimensions) {
    assert.equal(dimension.score, null);
    assert.equal(dimension.evidenceState, "UNKNOWN");
  }
});

// ---------------------------------------------------------------------------
// 新证据影响评估
// ---------------------------------------------------------------------------

test("影响评估：首次没有基线，必须交付一次", () => {
  const current = snapshotOf([verifiedFacts("e1", [["price", "299"]])]);
  const delta = assessEvidenceDelta(null, current);
  assert.equal(delta.hasEffectiveChange, true);
  assert.ok(delta.reason.includes("首次"));
});

test("影响评估：完全没有变化时办公室待命", () => {
  const current = snapshotOf([verifiedFacts("e1", [["price", "299"]])]);
  const delta = assessEvidenceDelta(current, current);
  assert.equal(delta.hasEffectiveChange, false);
  assert.ok(delta.reason.includes("待命"));
  assert.equal(delta.newEvidenceIds.length, 0);
  assert.equal(delta.closedGapKeys.length, 0);
  assert.equal(delta.openedGapKeys.length, 0);
  assert.equal(delta.verdictChanged, null);
});

test("影响评估：补上新证据后，能说清维度变化与缺口关闭", () => {
  const before = snapshotOf([verifiedFacts("e1", [["price", "299"]])]);
  const after = snapshotOf([
    verifiedFacts("e1", [["price", "299"]]),
    verifiedFacts("e2", [
      ["salesVolume", "月销 12000"],
      ["targetAudience", "30-45 岁女性"],
      ["painPoint", "差评集中在结块"],
    ]),
  ]);

  const delta = assessEvidenceDelta(before, after);
  assert.equal(delta.hasEffectiveChange, true);
  assert.deepEqual(delta.newEvidenceIds, ["e2"]);

  const demand = delta.dimensionChanges.find((c) => c.key === "DEMAND")!;
  assert.equal(demand.from.evidenceState, "SUPPORTED");
  assert.equal(demand.to.evidenceState, "VERIFIED");
  assert.equal(demand.direction, "UP");

  assert.ok(delta.closedGapKeys.some((key) => key.includes("salesVolume")));
  assert.ok(delta.reason.includes("维度"));
});

test("影响评估：与判断无关的证据不构成有效变化", () => {
  const before = snapshotOf([verifiedFacts("e1", [["price", "299"]])]);
  // 新增一条不属于任何 rubric 必需事实的证据：它进不了任何维度，也就影响不了判断。
  const after = snapshotOf([
    verifiedFacts("e1", [["price", "299"]]),
    verifiedFacts("e2", [["unknownFieldKey", "无关内容"]]),
  ]);
  const delta = assessEvidenceDelta(before, after);
  assert.deepEqual(delta.newEvidenceIds, []);
  assert.equal(delta.hasEffectiveChange, false);
  assert.ok(delta.reason.includes("待命"));
});

test("影响评估：有新证据但没改变任何判断时，仍然待命", () => {
  const before = snapshotOf([verifiedFacts("e1", [["price", "299"]])]);
  // 再给一条同字段的事实级证据：证据集变大了，但维度覆盖、缺口、结论都没变。
  const after = snapshotOf([
    verifiedFacts("e1", [["price", "299"]]),
    verifiedFacts("e2", [["price", "299"]]),
  ]);
  const delta = assessEvidenceDelta(before, after);
  assert.deepEqual(delta.newEvidenceIds, ["e2"]);
  assert.equal(delta.hasEffectiveChange, false);
  assert.ok(
    delta.reason.includes("待命"),
    "抓取到重复内容不应该把办公室叫醒"
  );
});

test("影响评估：结论变化必须被单独报出来", () => {
  const before = snapshotOf([verifiedFacts("e1", [["price", "299"]])]);
  const after = snapshotOf([
    verifiedFacts("e1", [
      ["price", "299"],
      ["salesVolume", "月销 12000"],
      ["targetAudience", "30-45 岁女性"],
      ["painPoint", "差评集中在结块"],
      ["channel", "私域/会销"],
      ["channelCommission", "佣金 25%"],
      ["channelPriceBand", "199-599"],
      ["channelFeedback", "首场试销 3 万"],
      ["costQuote", "60"],
      ["channelFee", "佣金 25%"],
      ["packagingFreight", "包材 6 运费 8"],
      ["formulaOrTech", "后生元路线"],
      ["competitorComparison", "竞品为活菌"],
      ["ipOrPatent", "独家授权"],
      ["consumerPerception", "可感知"],
      ["consumptionCycle", "30 条/盒"],
      ["repurchaseData", "复购 38%"],
      ["userFeedback", "口碑正向"],
      ["subscriptionSignal", "有订阅"],
      ["supplierConfirmation", "工厂确认"],
      ["dosageForm", "粉剂"],
      ["leadTime", "45 天"],
      ["compliancePackaging", "已过审"],
      ["companyPolicy", "含在规划"],
      ["existingCapability", "已有团队"],
      ["channelOwnership", "私域 20 万"],
      ["brandPortfolio", "定位一致"],
    ]),
  ]);

  const delta = assessEvidenceDelta(before, after);
  assert.ok(delta.verdictChanged, "结论应当发生变化");
  assert.equal(delta.verdictChanged!.from, "NEEDS_EVIDENCE");
  assert.equal(delta.verdictChanged!.to, "VALIDATE");
  assert.ok(delta.closedGapKeys.length > 0);
  assert.equal(delta.openedGapKeys.length, 0);
});
