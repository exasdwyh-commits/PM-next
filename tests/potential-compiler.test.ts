/**
 * Evidence → Product Potential Compiler 的单元测试（P0-1 / P0-2 / P0-4）
 *
 * 这里守的是「不许把不知道的东西说成知道」这条底线，所以断言写得比实现更苛刻：
 * 每条不变量都对应一次真实可能发生的误判。全部为纯函数测试，不连库、不调模型。
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyEvidence,
  compileProductPotentialInput,
  compileAndAssess,
  decideEvidenceGapLoop,
  COVERAGE_SUFFICIENT_THRESHOLD,
  MAX_ROUNDS_WITHOUT_NEW_EVIDENCE,
  type CompilerEvidence,
  type CompiledDimension,
} from "../src/modules/product-development/potential-compiler";
import { assessProductPotential } from "../src/modules/product-development/potential-assessment";

/** 造一条已核实 REAL 证据，字段值直接给。 */
function verified(
  id: string,
  claims: Array<{ id: string; fieldKey: string; kind: "FACT" | "INFERENCE" | "ASSUMPTION"; value: string }>
): CompilerEvidence {
  return {
    id,
    source: `source-${id}`,
    nature: "REAL",
    verifyStatus: "VERIFIED",
    validationStatus: "UNAPPLIED",
    claims,
  };
}

function demo(
  id: string,
  claims: Array<{ id: string; fieldKey: string; kind: "FACT" | "INFERENCE" | "ASSUMPTION"; value: string }>
): CompilerEvidence {
  return {
    id,
    source: `template-${id}`,
    nature: "DEMO",
    verifyStatus: "VERIFIED",
    validationStatus: "UNAPPLIED",
    claims,
  };
}

function dimensionOf(
  dims: CompiledDimension[],
  key: CompiledDimension["key"]
): CompiledDimension {
  const found = dims.find((d) => d.key === key);
  assert.ok(found, `缺少维度 ${key}`);
  return found!;
}

/** 把 7 个维度的全部必需事实都填满，用于「资料充足」的基线。 */
function fullyCoveredEvidence(): CompilerEvidence[] {
  const facts: Array<[string, string]> = [
    ["salesVolume", "月销 12000 件"],
    ["price", "299"],
    ["targetAudience", "30-45 岁女性 约 2000 万"],
    ["painPoint", "差评集中在冲泡结块"],
    ["channel", "私域会销 199-599 元价格带"],
    ["channelCommission", "佣金 25%"],
    ["channelPriceBand", "199-599"],
    ["channelFeedback", "首场试销 3 万"],
    ["costQuote", "60"],
    ["channelFee", "佣金 25% 平台 3%"],
    ["packagingFreight", "包材 6 元 运费 8 元"],
    ["formulaOrTech", "后生元路线"],
    ["competitorComparison", "竞品为活菌"],
    ["ipOrPatent", "独家原料授权"],
    ["consumerPerception", "试销反馈可感知"],
    ["consumptionCycle", "30 条/盒 每日 1 条"],
    ["repurchaseData", "私域复购率 38%"],
    ["userFeedback", "口碑正向"],
    ["subscriptionSignal", "有订阅方案"],
    ["supplierConfirmation", "工厂确认可交付"],
    ["dosageForm", "粉剂"],
    ["leadTime", "45 天"],
    ["compliancePackaging", "包装稿已过审"],
    ["companyPolicy", "公司品类规划包含"],
    ["existingCapability", "已有团队"],
    ["channelOwnership", "私域 20 万用户"],
    ["brandPortfolio", "与现有品牌定位一致"],
  ];
  return facts.map(([fieldKey, value]) =>
    verified(`ev-${fieldKey}`, [
      { id: `cl-${fieldKey}`, fieldKey, kind: "FACT", value },
    ])
  );
}

// ---------------------------------------------------------------------------
// P0-2 证据防火墙
// ---------------------------------------------------------------------------

test("防火墙：DEMO 证据即使标成 VERIFIED 也只能是 TEMPLATE_ASSUMPTION", () => {
  assert.equal(
    classifyEvidence({
      id: "e1",
      nature: "DEMO",
      verifyStatus: "VERIFIED",
      claimKind: "FACT",
    }),
    "TEMPLATE_ASSUMPTION"
  );
});

test("防火墙：未核实材料只能是 HYPOTHESIS，被否决的证据是 UNKNOWN", () => {
  assert.equal(
    classifyEvidence({ id: "e1", nature: "REAL", verifyStatus: "UNVERIFIED", claimKind: "FACT" }),
    "HYPOTHESIS"
  );
  assert.equal(
    classifyEvidence({ id: "e2", nature: "REAL", verifyStatus: "REJECTED", claimKind: "FACT" }),
    "UNKNOWN"
  );
});

test("防火墙：已核实证据上的推断只能到 SUPPORTED_INFERENCE，假设只能到 HYPOTHESIS", () => {
  assert.equal(
    classifyEvidence({ id: "e1", nature: "REAL", verifyStatus: "VERIFIED", claimKind: "INFERENCE" }),
    "SUPPORTED_INFERENCE"
  );
  assert.equal(
    classifyEvidence({ id: "e1", nature: "REAL", verifyStatus: "VERIFIED", claimKind: "ASSUMPTION" }),
    "HYPOTHESIS"
  );
  assert.equal(
    classifyEvidence({ id: "e1", nature: "REAL", verifyStatus: "VERIFIED", claimKind: "FACT" }),
    "FACT"
  );
});

test("TEMPLATE_ASSUMPTION 不能成为 VERIFIED，也不能产生分数", () => {
  const result = compileProductPotentialInput({
    evidence: [
      demo("t1", [{ id: "tc1", fieldKey: "salesVolume", kind: "FACT", value: "月销 10 万" }]),
      demo("t2", [{ id: "tc2", fieldKey: "price", kind: "FACT", value: "199" }]),
      demo("t3", [{ id: "tc3", fieldKey: "targetAudience", kind: "FACT", value: "全人群" }]),
      demo("t4", [{ id: "tc4", fieldKey: "painPoint", kind: "FACT", value: "效果不明显" }]),
    ],
    gates: [],
    marketValidationVerified: true,
  });

  const demand = dimensionOf(result.dimensions, "DEMAND");
  assert.equal(demand.score, null, "模板推断不得产生分数");
  assert.equal(demand.evidenceState, "UNKNOWN", "模板推断只能是未知，不能是 VERIFIED");
  assert.equal(demand.sourceRefs.length, 0, "模板推断不得成为 sourceRefs");

  // 模板值必须被显式登记成「假设」，供界面展示，而不是被当成市场事实。
  // 同一字段可能同时是多个维度的必需事实（如 price 同时属于 DEMAND 与 UNIT_ECONOMICS），
  // 因此按维度分别登记，这里校验 DEMAND 的四项都登记到了。
  const demandTemplates = result.templateAssumptions.filter(
    (item) => item.dimension === "DEMAND"
  );
  assert.deepEqual(
    demandTemplates.map((item) => item.fieldKey).sort(),
    ["painPoint", "price", "salesVolume", "targetAudience"]
  );
  assert.ok(
    result.templateAssumptions.every((item) => item.displayText.includes("假设值")),
    "模板值展示文案必须自带「假设」措辞"
  );

  // 模板推断不得增加 verifiedCoverageRatio。
  const assessment = assessProductPotential(result.input);
  assert.equal(assessment.verifiedCoverageRatio, 0);
});

test("ASSUMED 维度计入覆盖率但不计入 verifiedCoverageRatio", () => {
  const result = compileProductPotentialInput({
    evidence: [
      {
        id: "u1",
        source: "未核实资料",
        nature: "REAL",
        verifyStatus: "UNVERIFIED",
        validationStatus: "UNAPPLIED",
        claims: [
          { id: "uc1", fieldKey: "salesVolume", kind: "FACT", value: "疑似热销" },
          { id: "uc2", fieldKey: "price", kind: "FACT", value: "199" },
        ],
      },
    ],
    gates: [],
  });

  const demand = dimensionOf(result.dimensions, "DEMAND");
  assert.equal(demand.evidenceState, "ASSUMED");
  assert.equal(demand.inferenceOnly, true);
  assert.notEqual(demand.score, null, "假设级证据仍可给受限分数，但要标明仅推断");

  const assessment = assessProductPotential(result.input);
  assert.ok(assessment.coverageRatio > 0, "已评分维度应计入 coverageRatio");
  assert.equal(assessment.verifiedCoverageRatio, 0, "ASSUMED 不得计入 verifiedCoverage");
});

test("仅推断/假设支撑时，维度状态是 ASSUMED 而不是 SUPPORTED，且分数被上限压住", () => {
  const result = compileProductPotentialInput({
    evidence: [
      {
        id: "i1",
        source: "已核实资料的推断",
        nature: "REAL",
        verifyStatus: "VERIFIED",
        validationStatus: "UNAPPLIED",
        claims: [
          { id: "ic1", fieldKey: "salesVolume", kind: "INFERENCE", value: "推测月销较高" },
          { id: "ic2", fieldKey: "price", kind: "INFERENCE", value: "推测 199" },
          { id: "ic3", fieldKey: "targetAudience", kind: "INFERENCE", value: "推测人群" },
          { id: "ic4", fieldKey: "painPoint", kind: "INFERENCE", value: "推测痛点" },
        ],
      },
    ],
    gates: [],
  });

  const demand = dimensionOf(result.dimensions, "DEMAND");
  assert.equal(
    demand.evidenceState,
    "ASSUMED",
    "只有推断支撑时不得升级成 SUPPORTED（模型推断 ≠ 事实）"
  );
  assert.equal(demand.inferenceOnly, true);
  assert.ok(
    (demand.score ?? 0) <= 45,
    `仅推断时不得给高分，实际 ${demand.score}`
  );
});

test("部分事实级证据 + 部分推断时，维度状态是 SUPPORTED（诚实表达「只验证了一部分」）", () => {
  const result = compileProductPotentialInput({
    evidence: [
      verified("e1", [
        { id: "c1", fieldKey: "salesVolume", kind: "FACT", value: "月销 12000" },
      ]),
      {
        id: "e2",
        source: "已核实资料的推断",
        nature: "REAL",
        verifyStatus: "VERIFIED",
        validationStatus: "UNAPPLIED",
        claims: [
          { id: "c2", fieldKey: "price", kind: "INFERENCE", value: "推测 299" },
          { id: "c3", fieldKey: "targetAudience", kind: "INFERENCE", value: "推测人群" },
        ],
      },
    ],
    gates: [],
  });

  const demand = dimensionOf(result.dimensions, "DEMAND");
  assert.equal(demand.evidenceState, "SUPPORTED");
  assert.equal(demand.inferenceOnly, false);
  assert.equal(demand.missingEvidence.includes("painPoint"), true);
});

// ---------------------------------------------------------------------------
// P0-1 编译与可追溯性
// ---------------------------------------------------------------------------

test("编译：每个正式评分都能回溯到 sourceRefs / evidenceIds / claimIds", () => {
  const result = compileProductPotentialInput({
    evidence: fullyCoveredEvidence(),
    gates: [],
    marketValidationVerified: true,
  });

  for (const dimension of result.dimensions) {
    if (dimension.evidenceState === "UNKNOWN") continue;
    assert.ok(dimension.sourceRefs.length > 0, `${dimension.key} 缺 sourceRefs`);
    assert.ok(dimension.evidenceIds.length > 0, `${dimension.key} 缺 evidenceIds`);
    assert.ok(dimension.claimIds.length > 0, `${dimension.key} 缺 claimIds`);
    assert.ok(
      dimension.sourceRefs.every((ref) => ref.startsWith("evidence:")),
      "sourceRefs 必须是可解析的 evidence:<id>"
    );
    assert.ok(dimension.updatedAt, `${dimension.key} 缺 updatedAt`);
  }
});

test("编译：资料充足时 7 维全部 VERIFIED，覆盖率与验证覆盖率均为 1", () => {
  const result = compileProductPotentialInput({
    evidence: fullyCoveredEvidence(),
    gates: [],
    marketValidationVerified: true,
  });

  const assessment = assessProductPotential(result.input);
  assert.equal(assessment.coverageRatio, 1);
  assert.equal(assessment.verifiedCoverageRatio, 1);
  assert.equal(assessment.unknownGates.length, 0);
  assert.ok(
    ["VALIDATE", "PRIORITIZE_FOR_VALIDATION"].includes(assessment.verdict),
    `资料充足应给出可推进结论，实际 ${assessment.verdict}`
  );
});

test("编译：没有任何证据时 7 维全为 UNKNOWN + null，不产生 0 分", () => {
  const result = compileProductPotentialInput({ evidence: [], gates: [] });

  assert.equal(result.dimensions.length, 7);
  for (const dimension of result.dimensions) {
    assert.equal(dimension.score, null, `${dimension.key} 不该有分数`);
    assert.equal(dimension.evidenceState, "UNKNOWN");
    assert.equal(dimension.sourceRefs.length, 0);
  }

  const assessment = assessProductPotential(result.input);
  assert.equal(assessment.diagnosticIndex, null);
  assert.equal(assessment.coverageRatio, 0);
  assert.equal(assessment.verdict, "NEEDS_EVIDENCE");
});

test("编译：coverage 不足时 verdict 保持 NEEDS_EVIDENCE，不用评分代替缺失事实", () => {
  const result = compileProductPotentialInput({
    evidence: [
      verified("e1", [
        { id: "c1", fieldKey: "salesVolume", kind: "FACT", value: "月销 8000" },
        { id: "c2", fieldKey: "price", kind: "FACT", value: "299" },
      ]),
    ],
    gates: [],
  });

  const assessment = assessProductPotential(result.input);
  assert.equal(assessment.verdict, "NEEDS_EVIDENCE");
  assert.ok(assessment.coverageRatio < 0.7);
  assert.equal(assessment.confidenceBand, "LOW");
});

test("编译：硬门槛 FAIL 永远优先于高分，不能被平均掉", () => {
  const { assessment } = compileAndAssess(
    {
      evidence: fullyCoveredEvidence(),
      gates: [
        {
          key: "channel-spec",
          label: "渠道规格经济性",
          status: "FAIL",
          reason: "目标佣金后为负贡献",
          sourceRefs: ["calc:1"],
        },
      ],
      marketValidationVerified: true,
    },
    assessProductPotential
  );

  assert.equal(assessment.verdict, "BLOCKED");
  assert.ok((assessment.diagnosticIndex ?? 0) > 80, "诊断指数确实很高，但被门槛挡住");
  assert.equal(assessment.blockers.length, 1);
});

test("编译：门槛 UNKNOWN 时 verdict 为 NEEDS_EVIDENCE，且生成门槛补证缺口", () => {
  const { assessment } = compileAndAssess(
    {
      evidence: fullyCoveredEvidence(),
      gates: [
        {
          key: "compliance",
          label: "法规合规门槛",
          status: "UNKNOWN",
          reason: "尚未取得目标市场法规结论",
          sourceRefs: [],
        },
      ],
      marketValidationVerified: true,
    },
    assessProductPotential
  );

  assert.equal(assessment.verdict, "NEEDS_EVIDENCE");
  assert.equal(assessment.unknownGates.length, 1);
});

// ---------------------------------------------------------------------------
// UNIT_ECONOMICS 专项：缺报价不得生成 verified
// ---------------------------------------------------------------------------

test("缺工厂报价时 UNIT_ECONOMICS 必须保持 UNKNOWN，不得用价格比例推算", () => {
  const result = compileProductPotentialInput({
    evidence: [
      verified("e1", [{ id: "c1", fieldKey: "price", kind: "FACT", value: "299" }]),
      // 模板给出的「目标成本 = 价格 × 0.22」属于 DEMO/模板数据，不得顶替报价。
      demo("t1", [{ id: "tc1", fieldKey: "costQuote", kind: "FACT", value: "65.78" }]),
    ],
    gates: [],
  });

  const unit = dimensionOf(result.dimensions, "UNIT_ECONOMICS");
  assert.equal(unit.score, null, "没有报价就不该有毛利分");
  assert.equal(unit.evidenceState, "UNKNOWN");
  assert.ok(
    result.firewallRejections.some((line) => line.includes("UNIT_ECONOMICS")),
    "必须显式记录「缺报价」而不是静默给分"
  );
});

test("报价与零售价都是事实级证据时，UNIT_ECONOMICS 由确定性代码算出并可追溯", () => {
  const result = compileProductPotentialInput({
    evidence: [
      verified("e1", [{ id: "c1", fieldKey: "costQuote", kind: "FACT", value: "60" }]),
      verified("e2", [{ id: "c2", fieldKey: "price", kind: "FACT", value: "299" }]),
      verified("e3", [{ id: "c3", fieldKey: "channelFee", kind: "FACT", value: "佣金 25%" }]),
      verified("e4", [{ id: "c4", fieldKey: "packagingFreight", kind: "FACT", value: "包材 6 运费 8" }]),
    ],
    gates: [],
  });

  const unit = dimensionOf(result.dimensions, "UNIT_ECONOMICS");
  assert.equal(unit.evidenceState, "VERIFIED");
  assert.equal(unit.score, 90, "毛利率约 80% 应对应最高档");
  assert.deepEqual(unit.evidenceIds.sort(), ["e1", "e2", "e3", "e4"]);
  assert.ok(unit.rubricBand && unit.rubricBand.includes("60%"));
});

// ---------------------------------------------------------------------------
// P0-4 证据缺口与停止条件
// ---------------------------------------------------------------------------

test("缺口：每个未覆盖的必需事实都产出可执行缺口（含优先级与补证方式）", () => {
  const result = compileProductPotentialInput({
    evidence: [
      verified("e1", [{ id: "c1", fieldKey: "price", kind: "FACT", value: "299" }]),
    ],
    gates: [
      {
        key: "compliance",
        label: "法规合规门槛",
        status: "UNKNOWN",
        reason: "尚无结论",
        sourceRefs: [],
      },
    ],
  });

  const costGap = result.gaps.find((gap) => gap.missingFact.includes("costQuote"));
  assert.ok(costGap, "必须给出工厂报价缺口");
  assert.equal(costGap!.requiresHumanInput, true);
  assert.equal(costGap!.canAutoResearch, false);
  assert.equal(costGap!.priority, "HIGH");
  assert.ok(costGap!.suggestedQuery.length > 0);
  assert.ok(costGap!.whyItMatters.length > 0);

  const salesGap = result.gaps.find((gap) => gap.missingFact.includes("salesVolume"));
  assert.ok(salesGap, "必须给出销量缺口");
  assert.equal(salesGap!.canAutoResearch, true);

  const gateGap = result.gaps.find((gap) => gap.gateKey === "compliance");
  assert.ok(gateGap, "未知门槛也要变成缺口，否则 Mission 会在假完成状态下结束");
  assert.equal(gateGap!.dimension, null);
});

test("停止条件：硬门槛失败时不再补证", () => {
  const result = compileProductPotentialInput({
    evidence: fullyCoveredEvidence(),
    gates: [
      { key: "channel-spec", label: "渠道规格经济性", status: "FAIL", reason: "负贡献", sourceRefs: [] },
    ],
  });
  const assessment = assessProductPotential(result.input);
  const decision = decideEvidenceGapLoop({
    assessment,
    dimensions: result.dimensions,
    gaps: result.gaps,
    roundsCompleted: 1,
    maxRounds: 3,
    roundsWithoutNewEvidence: 0,
    newEvidenceCount: 5,
  });
  assert.equal(decision.continue, false);
  assert.equal(decision.code, "GATE_FAILED");
  assert.equal(decision.nextTargets.length, 0);
});

test("停止条件：覆盖率达标且无未知维度/门槛时结束研究", () => {
  const result = compileProductPotentialInput({
    evidence: fullyCoveredEvidence(),
    gates: [],
    marketValidationVerified: true,
  });
  const assessment = assessProductPotential(result.input);
  assert.ok(assessment.coverageRatio >= COVERAGE_SUFFICIENT_THRESHOLD);

  const decision = decideEvidenceGapLoop({
    assessment,
    dimensions: result.dimensions,
    gaps: result.gaps,
    roundsCompleted: 1,
    maxRounds: 3,
    roundsWithoutNewEvidence: 0,
    newEvidenceCount: 10,
  });
  assert.equal(decision.continue, false);
  assert.equal(decision.code, "COVERAGE_SUFFICIENT");
});

test("停止条件：预算耗尽时停止，并保留未知", () => {
  const result = compileProductPotentialInput({ evidence: [], gates: [] });
  const assessment = assessProductPotential(result.input);
  const decision = decideEvidenceGapLoop({
    assessment,
    dimensions: result.dimensions,
    gaps: result.gaps,
    roundsCompleted: 3,
    maxRounds: 3,
    roundsWithoutNewEvidence: 0,
    newEvidenceCount: 1,
  });
  assert.equal(decision.continue, false);
  assert.equal(decision.code, "BUDGET_EXHAUSTED");
  assert.ok(decision.nextTargets.length > 0, "停止时仍要告诉人下一步该补什么");
});

test("停止条件：剩余缺口全部需要人工输入时转人工，不空跑检索", () => {
  // 只给一项可自动研究的事实，其余关键事实都只能人工提供。
  const result = compileProductPotentialInput({
    evidence: [
      verified("e1", [{ id: "c1", fieldKey: "salesVolume", kind: "FACT", value: "月销 5000" }]),
    ],
    gates: [],
  });
  const assessment = assessProductPotential(result.input);

  const humanOnlyGaps = result.gaps.map((gap) => ({
    ...gap,
    requiresHumanInput: true,
    canAutoResearch: false,
  }));
  const decision = decideEvidenceGapLoop({
    assessment,
    dimensions: result.dimensions,
    gaps: humanOnlyGaps,
    roundsCompleted: 1,
    maxRounds: 3,
    roundsWithoutNewEvidence: 0,
    newEvidenceCount: 1,
  });
  assert.equal(decision.continue, false);
  assert.equal(decision.code, "HUMAN_ONLY");
});

test("停止条件：连续两轮无新增证据时停止，避免无限研究", () => {
  const result = compileProductPotentialInput({
    evidence: [
      verified("e1", [{ id: "c1", fieldKey: "price", kind: "FACT", value: "299" }]),
    ],
    gates: [],
  });
  const assessment = assessProductPotential(result.input);

  const stale = decideEvidenceGapLoop({
    assessment,
    dimensions: result.dimensions,
    gaps: result.gaps,
    roundsCompleted: 2,
    maxRounds: 5,
    roundsWithoutNewEvidence: MAX_ROUNDS_WITHOUT_NEW_EVIDENCE,
    newEvidenceCount: 0,
  });
  assert.equal(stale.continue, false);
  assert.equal(stale.code, "NO_NEW_EVIDENCE");

  const fresh = decideEvidenceGapLoop({
    assessment,
    dimensions: result.dimensions,
    gaps: result.gaps,
    roundsCompleted: 2,
    maxRounds: 5,
    roundsWithoutNewEvidence: MAX_ROUNDS_WITHOUT_NEW_EVIDENCE - 1,
    newEvidenceCount: 3,
  });
  assert.equal(fresh.continue, true);
  assert.equal(fresh.code, "CONTINUE");
  assert.ok(fresh.nextTargets.length > 0 && fresh.nextTargets.length <= 3);
});
