/**
 * 统一证据结构·断言/缺口/冲突处理 (P1-01, C02/R2-03)
 *
 * 提供三类纯函数，不接任何外部爬虫，不抓取页面，不凭空构造数字：
 * 1. normalizeEvidenceClaim：校验并规范化一条证据断言（价格必须带规格/单位/机制）；
 * 2. pickResolvedClaims：按 fieldKey 取出「已核实 FACT」断言，冲突并列时按 selectionReason 选用；
 * 3. computeEvidenceGaps：根据证据覆盖情况产出数据缺口（缺失保持未知，不自动补成事实）。
 */

import { EvidenceClaim, EvidenceClaimKind } from "@prisma/client";

export interface EvidenceClaimInput {
  fieldKey: string;
  fieldName: string;
  kind: "FACT" | "INFERENCE" | "ASSUMPTION";
  value: string;
  currency?: string;
  spec?: string | null;
  unit?: string | null;
  mechanism?: string | null;
  applicableProduct?: string | null;
  applicableChannel?: string | null;
  conflictGroup?: string | null;
  selectionReason?: string | null;
}

const KIND_SET = new Set<string>(["FACT", "INFERENCE", "ASSUMPTION"]);

/**
 * 校验并规范化一条断言。
 * - FACT 必须给出 value；价格类字段(FACT) 若带数字，则必须说明计价单位与机制，避免单盒价与组合装价混算。
 * - 静默返回 null 表示该断言被拒绝（缺失必要信息）。
 */
export function normalizeEvidenceClaim(
  input: EvidenceClaimInput,
  index: number
): EvidenceClaimInput | null {
  const fieldKey = input.fieldKey?.trim();
  const fieldName = input.fieldName?.trim() || fieldKey;
  const value = input.value?.trim();
  const kind = input.kind ?? "ASSUMPTION";

  if (!fieldKey || !kind || !KIND_SET.has(kind)) {
    throw new Error(`证据断言#${index} 缺少字段标识或取值类型非法`);
  }
  if (!value) {
    throw new Error(`证据断言#${index}[${fieldKey}] 缺少取值 value`);
  }

  const normalized: EvidenceClaimInput = {
    fieldKey,
    fieldName,
    kind: kind as EvidenceClaimKind,
    value,
    currency: input.currency?.trim() || "CNY",
    spec: input.spec?.trim() || null,
    unit: input.unit?.trim() || null,
    mechanism: input.mechanism?.trim() || null,
    applicableProduct: input.applicableProduct?.trim() || null,
    applicableChannel: input.applicableChannel?.trim() || null,
    conflictGroup: input.conflictGroup?.trim() || null,
    selectionReason: input.selectionReason?.trim() || null,
  };

  // 价格字段的 FACT/INFERENCE：必须有单位与机制（价格规格校验）
  const isPriceField = /price|retailPrice|salePrice|价格|售价|成交价/.test(fieldKey);
  if ((kind === "FACT" || kind === "INFERENCE") && isPriceField) {
    if (!normalized.unit) {
      throw new Error(`证据断言#${index}[${fieldKey}] 价格类 FACT 必须给出计价单位（如 盒/条/组），防止单盒价与组合装价混算`);
    }
    if (!normalized.mechanism) {
      throw new Error(`证据断言#${index}[${fieldKey}] 价格类 FACT 必须给出计价机制（如 到手价/划线价/组合装价）`);
    }
  }

  return normalized;
}

/** 从断言数组构造可入库的 DB 记录对象（不含 id/evidenceId/createdAt） */
export function toClaimDbData(input: EvidenceClaimInput) {
  const kind = input.kind as EvidenceClaimKind;
  return {
    fieldKey: input.fieldKey,
    fieldName: input.fieldName,
    kind,
    value: input.value,
    currency: input.currency ?? "CNY",
    spec: input.spec,
    unit: input.unit,
    mechanism: input.mechanism,
    applicableProduct: input.applicableProduct,
    applicableChannel: input.applicableChannel,
    conflictGroup: input.conflictGroup,
    selectionReason: input.selectionReason,
  };
}

export interface ResolvedFieldValue {
  fieldKey: string;
  fieldName: string;
  value: string;
  evidenceId: string;
  spec?: string | null;
  unit?: string | null;
  mechanism?: string | null;
  source: string;
  conflictGroup?: string | null;
  selectionReason?: string | null;
}

/**
 * 仅取「已核实 FACT」有效性：返回某项字段中被选中的取值。
 * 规则：
 *  - 仅 FACT（含 conflict 中 marked 为选用者）参与；INFERENCE/ASSUMPTION 一律不当作事实。
 *  - 同一 fieldKey 存在多条断言：按 evidence 核实状态 + conflictGroup 分组，
 *    同组冲突若记录了 selectionReason 则选用该条，否则取第一条并列返回 all。
 */
export function pickResolvedClaims(
  claims: (EvidenceClaim & { evidence?: { source: string; verifyStatus: string } })[]
): { selected: ResolvedFieldValue[]; conflicts: ResolvedFieldValue[][] } {
  const FACT = "FACT";
  const factClaims = claims.filter(
    (c) => c.kind === FACT && c.evidence?.verifyStatus === "VERIFIED"
  );

  const selected: ResolvedFieldValue[] = [];
  const conflicts: ResolvedFieldValue[][] = [];

  const byField = new Map<string, ResolvedFieldValue[]>();
  for (const c of factClaims) {
    if (!byField.has(c.fieldKey)) byField.set(c.fieldKey, []);
    byField.get(c.fieldKey)!.push({
      fieldKey: c.fieldKey,
      fieldName: c.fieldName,
      value: c.value,
      evidenceId: c.evidenceId,
      spec: c.spec,
      unit: c.unit,
      mechanism: c.mechanism,
      source: c.evidence?.source ?? "",
      conflictGroup: c.conflictGroup,
      selectionReason: c.selectionReason,
    });
  }

  for (const [, values] of byField) {
    if (values.length === 1) {
      selected.push(values[0]);
      continue;
    }
    // 多条同字段断言：按 conflictGroup 聚类
    const groups = new Map<string, ResolvedFieldValue[]>();
    for (const v of values) {
      const g = v.conflictGroup ?? v.source;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(v);
    }
    if (groups.size === 1) {
      // 同一来源多断言并列展示为冲突，不静默覆盖
      conflicts.push(values);
      // 有选用理由者入选
      const chosen = values.find((v) => v.selectionReason) ?? values[0];
      selected.push(chosen);
    } else {
      // 多来源冲突：全部并列，取有理由者或第一条
      conflicts.push(values);
      const chosen = values.find((v) => v.selectionReason) ?? values[0];
      selected.push(chosen);
    }
  }

  return { selected, conflicts };
}

export interface EvidenceGap {
  fieldKey: string;
  fieldName: string;
  description: string;
}

/**
 * 计算证据缺口：仅当某关键字段没有任何已核实 FACT 覆盖时才记为缺口。
 * 缺失保持 OPEN，不自动补成事实；调用方负责持久化到 DataGap。
 */
export function computeEvidenceGaps(
  coveredClaimFields: string[]
): EvidenceGap[] {
  const gaps: EvidenceGap[] = [];
  const covered = new Set(coveredClaimFields);

  // 关键业务字段清单（P1-01：竞品价格带、销量、净含量、剂型、人群、渠道）
  const fieldExpectations: Array<{ key: string; name: string; desc: string }> = [
    { key: "price", name: "竞品价格/价格带", desc: "缺少已核实竞品成交价或价格带证据，不得据此导出成本反推" },
    { key: "salesVolume", name: "竞品销量/月销", desc: "缺少已核实销量数据，无法支撑「热销」判断，需标记为待验证" },
    { key: "netWeight", name: "净含量/规格", desc: "缺少净含量或包装规格证据，价格单位换算无法闭合" },
    { key: "dosageForm", name: "剂型", desc: "缺少对手剂型证据，路线比选的剂型维度待补资料" },
    { key: "targetAudience", name: "目标人群", desc: "缺少消费人群画像证据，市场机会的人群假设未确认" },
    { key: "channel", name: "渠道", desc: "缺少渠道适配证据，渠道佣金与传播假设仍为推断" },
  ];

  for (const exp of fieldExpectations) {
    if (!covered.has(exp.key)) {
      gaps.push({ fieldKey: exp.key, fieldName: exp.name, description: exp.desc });
    }
  }
  return gaps;
}

/**
 * P1-01: 由项目证据（含 claims）构建统一的证据洞察 { resolved, conflicts, gaps }。
 * 仅已核实 VERIFIED FACT 计入已覆盖字段；缺失字段保持 OPEN 缺口，不自动补成事实。
 * 供服务端渲染（page.tsx 初始）与 /evidence-gaps API 共用，避免两套口径。
 */
export function buildEvidenceInsight(
  evidences: {
    source: string;
    verifyStatus: string;
    claims: (EvidenceClaim & {
      evidenceId: string;
      fieldName: string;
      spec?: string | null;
      unit?: string | null;
      mechanism?: string | null;
      conflictGroup?: string | null;
      selectionReason?: string | null;
      source?: string | null;
    })[];
  }[]
): { resolved: ResolvedFieldValue[]; conflicts: ResolvedFieldValue[][]; gaps: EvidenceGap[] } {
  const claimRows = evidences.flatMap((ev) =>
    ev.claims.map((c) => ({ ...c, evidence: { source: ev.source, verifyStatus: ev.verifyStatus } }))
  );
  const { selected, conflicts } = pickResolvedClaims(claimRows);
  const gaps = computeEvidenceGaps(selected.map((s) => s.fieldKey));
  return { resolved: selected, conflicts, gaps };
}