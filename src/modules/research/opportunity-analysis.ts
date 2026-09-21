/**
 * P1-02 机会分析与市场验证 (纯函数)
 *
 * 将统一证据洞察 (buildEvidenceInsight 的输出) 与需求约束转化为「机会分析」：
 *  - 机会类型三选一（默认 PENDING，不猜测可上市/有效性结论）：
 *      FOLLOW_HIT_PRODUCT 需已核实销量 + 竞品价格 FACT；TREND_NEW_PRODUCT 需线索类(clue.*)证据；
 *  - 八要素交付，每要素明确区分 事实(fact)/推断(inference)/假设(assumption) 三态；
 *    事实只来自已核实证据可追溯取值；推断/假设显式标为【待验证】，禁止把模板推断包装成事实。
 *  - 不做正则猜测市场数字，不接爬虫，纯读证据。
 */

import { ResolvedFieldValue } from "./evidence-claims";
import { ParsedRequirementConstraints } from "./requirement-parser";
import {
  OPPORTUNITY_TYPE_LABELS as OPPORTUNITY_TYPE_LABELS_SHARED,
  OPPORTUNITY_ELEMENT_LABELS as OPPORTUNITY_ELEMENT_LABELS_SHARED,
} from "@/shared/status-labels";

export type OpportunityType = "PENDING" | "TREND_NEW_PRODUCT" | "FOLLOW_HIT_PRODUCT";

export type OpportunityElementKey =
  | "targetUserAndNeed"
  | "channelFit"
  | "competitorPricing"
  | "evidenceDifferentiator"
  | "marketValidation"
  | "keyCounterEvidence"
  | "dataGaps"
  | "nextSteps";

/**
 * 机会类型 / 八要素中文标签。
 *
 * 字面量集中在 `@/shared/status-labels`（该模块零依赖，客户端可直接 import；本模块会连带引入
 * 服务端链条，客户端不可 import）。这里只做**带类型的再导出**，好处是领域侧仍能拿到
 * `Record<OpportunityType, string>` 的穷尽性检查——新增枚举值时此处会报错。
 *
 * 为什么 UI 不能直接渲染：`PENDING` / `targetUserAndNeed` 这类内部标识出现在中文界面上，
 * 会让业务使用者以为系统"没做完"（2026-09-17 全流程走查实测观察到）。
 */
export const OPPORTUNITY_TYPE_LABELS = OPPORTUNITY_TYPE_LABELS_SHARED as Record<OpportunityType, string>;
export const OPPORTUNITY_ELEMENT_LABELS = OPPORTUNITY_ELEMENT_LABELS_SHARED as Record<OpportunityElementKey, string>;

export interface OpportunityElement {
  key: OpportunityElementKey;
  /** 已核实证据可追溯取值 */
  fact: string[];
  /** 规则/证据链推断，显式标【推断·待验证】 */
  inference: string[];
  /** 未确认假设，显式标【假设·待验证】 */
  assumption: string[];
}

export interface OpportunityBasis {
  policy: string[];
  painNeed: string[];
  techMature: string[];
  rawMaterial: string[];
}

export interface OpportunityAnalysisInput {
  resolved: ResolvedFieldValue[];
  gaps: Array<{ fieldKey: string; fieldName: string; description: string }>;
}

export interface OpportunityAnalysis {
  /** FOLLOW_HIT_PRODUCT / TREND_NEW_PRODUCT / PENDING（默认，证据不足不猜测） */
  type: OpportunityType;
  /** 机会判定依据的线索（线索≠可上市或有效性结论） */
  basis: OpportunityBasis;
  /** 八要素交付，三态分列 */
  elements: OpportunityElement[];
}

const PRICE_RE = /price|retailPrice|salePrice|售价|价格|成交价/;
const VOLUME_RE = /salesVolume|销量|月销/;

function fmt(r: ResolvedFieldValue): string {
  const unit = r.unit ? ` ${r.unit}` : "";
  const mech = r.mechanism ? `（${r.mechanism}）` : "";
  return `${r.value}${unit}${mech}（来源：${r.source}）`;
}

export function synthesizeOpportunityAnalysis(
  input: OpportunityAnalysisInput,
  constraints: ParsedRequirementConstraints
): OpportunityAnalysis {
  const resolved = input.resolved ?? [];

  const priceClaims = resolved.filter((r) => PRICE_RE.test(r.fieldKey));
  const volumeClaims = resolved.filter((r) => VOLUME_RE.test(r.fieldKey));
  const clueClaims = resolved.filter((r) => r.fieldKey?.startsWith("clue."));

  // 机会类型：证据驱动，默认 PENDING
  let type: OpportunityType = "PENDING";
  const hasPrice = priceClaims.length > 0;
  const hasVolume = volumeClaims.length > 0;
  if (hasVolume && hasPrice) type = "FOLLOW_HIT_PRODUCT";
  else if (clueClaims.length > 0) type = "TREND_NEW_PRODUCT";

  // 判定依据线索分类
  const basis: OpportunityBasis = { policy: [], painNeed: [], techMature: [], rawMaterial: [] };
  for (const c of clueClaims) {
    const key = c.fieldKey.toLowerCase();
    if (key.includes("policy") || key.includes("regulat") || key.includes("合规")) basis.policy.push(fmt(c));
    else if (key.includes("pain") || key.includes("need") || key.includes("刚需") || key.includes("痛点")) basis.painNeed.push(fmt(c));
    else if (key.includes("tech") || key.includes("技术")) basis.techMature.push(fmt(c));
    else if (key.includes("material") || key.includes("原料") || key.includes(" ingredient")) basis.rawMaterial.push(fmt(c));
    else basis.painNeed.push(fmt(c));
  }

  const by = (re: RegExp) => resolved.filter((r) => re.test(r.fieldKey));
  const els: OpportunityElement[] = [];

  // 1. 目标用户及需求
  {
    const fact = by(/targetAudience|userNeed|clue\.painNeed/).map(fmt);
    const inference: string[] = [];
    if (constraints.targetAudience) {
      inference.push(`【推断·待验证】需求解析推测目标人群为「${constraints.targetAudience}」，尚无已核实人群画像证据支撑`);
    }
    inference.push("【推断·待验证】除证据原文引用外的用户需求画像为规则模板推断，待补充渠道/用户一手资料");
    els.push({ key: "targetUserAndNeed", fact, inference, assumption: [] });
  }

  // 2. 渠道适配
  {
    const fact = by(/channel/).map(fmt);
    const inference: string[] = [];
    if (constraints.targetChannel) {
      inference.push(`【推断·待验证】需求指定/推测渠道「${constraints.targetChannel}」，渠道佣金与传播假设仍为推断`);
    } else {
      inference.push("【推断·待验证】渠道适配为规则模板推断，未取得已核实渠道证据");
    }
    els.push({ key: "channelFit", fact, inference, assumption: [] });
  }

  // 3. 竞品与价格机制
  {
    const fact = by(/price|retailPrice|salePrice|售价|价格|成交价|salesVolume|销量|月销|netWeight|净含量|规格/).map(fmt);
    const inference: string[] = [];
    if (!hasPrice) inference.push("【推断·待验证】未取得已核实竞品成交价，价格机制处于待验证，不能据此反推可承受成本");
    if (!hasVolume) inference.push("【推断·待验证】未取得已核实销量，热销/爆品判断不可下结论");
    els.push({ key: "competitorPricing", fact, inference, assumption: [] });
  }

  // 4. 证据支持的差异点
  {
    const fact = by(/differentiat|差异|优势|clue\.differentiator|spec|unit|mechanism/).map(fmt);
    const inference = fact.length
      ? []
      : ["【推断·待验证】暂无已核实证据支撑的差异化点，差异主张需补证后再陈述"];
    els.push({ key: "evidenceDifferentiator", fact, inference, assumption: [] });
  }

  // 5. 市场验证结果（真实渠道反馈/带时间销售资料/明确用户反馈；未取得→待验证，不以模型评分替代）
  {
    const fact = by(/validation\./).map((r) => `${fmt(r)}${r.selectionReason ? `（选用理由：${r.selectionReason}）` : ""}`);
    const inference = fact.length
      ? []
      : ["【待验证】未取得真实市场验证（渠道反馈/带时间范围销售资料/明确用户反馈），状态保持待验证，禁止以模型评分替代验证"];
    els.push({ key: "marketValidation", fact, inference, assumption: fact.length ? [] : ["【假设·待验证】市场验证需由负责人手动确认后方可转为已验证"] });
  }

  // 6. 关键反证
  {
    const fact = by(/counter|反证|negativ|风险|clue\.counterEvidence/).map(fmt);
    const inference = fact.length
      ? []
      : ["【推断·待验证】暂无已核实反证，策略风险未被系统识别，需人工补充竞品负评/失败案例证据"];
    els.push({ key: "keyCounterEvidence", fact, inference, assumption: [] });
  }

  // 7. 数据缺口（保持未知，不补成事实）
  {
    const gaps = (input.gaps ?? []).map((g) => `缺口：${g.fieldName} — ${g.description}`);
    els.push({ key: "dataGaps", fact: [], inference: gaps.length ? gaps : ["已核实证据覆盖全部关键业务字段，暂无缺口"], assumption: [] });
  }

  // 8. 建议下一步
  {
    const gapFields = (input.gaps ?? []).map((g) => g.fieldName).slice(0, 3);
    const inference = gapFields.length
      ? [`先补足关键证据缺口：${gapFields.join("、")}，再推进产品定义与打样决策`]
      : ["关键证据已具备，可按证据链推进 P1-03 产品定义与备选路线"];
    els.push({ key: "nextSteps", fact: [], inference, assumption: ["【假设·待验证】下一步推进需负责人确认机会类型与市场验证状态"] });
  }

  return { type, basis, elements: els };
}