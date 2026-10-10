/**
 * 执行层深度报告 · 聚合与校验（纯函数，无 DB 依赖）
 * ==================================================
 * 批次 C 核心件：九大块的契约校验与骨架生成都收拢在这一个文件——
 * - 校验单点：specialist 透传的 executorResult.deep 一律在这里过 schema，
 *   畸形/伪造字段直接丢弃（返回 undefined），绝不放行到报告体；
 * - 骨架单点：九节状态由此计算——有实数据 ready，否则 unknown，
 *   且每节给出「缺什么/如何补齐」，与 OpGap/UNKNOWN 语义一致；
 * - 纯函数、可单测：orchestrator 只做数据搬运，判断逻辑全在这里。
 */

import type {
  ExecutiveReportDeep,
  ExecutiveReportDeepSection,
  ExecutiveReportDeepSpec,
  ExecutiveReportDeepBom,
  ExecutiveReportDeepValidation,
  ExecutiveReportDeepSpecRow,
  ExecutiveReportDeepBomLine,
  ExecutiveReportDeepValidationItem,
} from "@/shared/executive-report-types";

export const DEEP_SPEC_ROWS_CAP = 40;
export const DEEP_BOM_LINES_CAP = 60;
export const DEEP_VALIDATION_ITEMS_CAP = 50;
export const DEEP_GAPS_CAP = 12;

/** 九大块骨架（对应 report-full 执行层标准结构 s1–s9）。 */
export const DEEP_SECTION_META: ReadonlyArray<{
  key: ExecutiveReportDeepSection["key"];
  title: string;
  /** 缺数据时如何补齐（视图与缺口块共用这一句） */
  fill: string;
}> = [
  {
    key: "definition",
    title: "① 产品定义与规格",
    fill: "由 formulation_agent 在具备结构化配方约束（原料/剂量/剂型/工艺）时产出 result.deep.spec；无真实输入一律 UNKNOWN。",
  },
  {
    key: "bom",
    title: "② 配方与 BOM 成本",
    fill: "由 cost_bom_agent 在具备可追溯报价（来源+规格+MOQ+日期）时产出 result.deep.bom；无真实报价一律 UNKNOWN，不做估算。",
  },
  {
    key: "process",
    title: "③ 工艺与中试",
    fill: "待工艺/中试数据源接入后由对应 specialist 产出 result.deep.process（本批未接生产者）。",
  },
  {
    key: "quality",
    title: "④ 质量与稳定性",
    fill: "待企业标准/逐点稳定性记录源接入（本批未接生产者）。",
  },
  {
    key: "economics",
    title: "⑤ 经济性与定价",
    fill: "待价格桥/渠道费率/敏感性输入接入（本批未接生产者）。",
  },
  {
    key: "compliance",
    title: "⑥ 合规与宣称边界",
    fill: "待合规路径结构化条目接入（知识库批次 D 之后由 compliance_agent 输出）。",
  },
  {
    key: "fmea",
    title: "⑦ FMEA 风险",
    fill: "待严重度×发生度的结构化 FMEA 产出接入（本批未接生产者）。",
  },
  {
    key: "validation",
    title: "⑧ 验证计划与待拍板",
    fill: "由已落库的 claim 核验记录自动聚合（verifications 最新状态+时间锚点），无需 specialist 额外产出。",
  },
  {
    key: "appendix",
    title: "⑨ 附录 · 出处/假设/未决",
    fill: "由报告 provenance / assumptions / unknowns 兜底呈现；三者皆空时为 UNKNOWN。",
  },
];

const CLAIM_KIND_WHITELIST = new Set(["FACT", "INFERENCE", "ESTIMATE", "OPINION", "UNKNOWN"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown, max = 400): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  if (!t) return undefined;
  return t.slice(0, max);
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function kind(value: unknown): string | undefined {
  const k = str(value, 32)?.toUpperCase();
  return k && CLAIM_KIND_WHITELIST.has(k) ? k : undefined;
}

/** 校验 ① 规格块：每行至少要有 name+value，行数封顶；畸形行丢弃，整行全废则整块作废。 */
export function validateDeepSpec(raw: unknown, cap = DEEP_SPEC_ROWS_CAP): ExecutiveReportDeepSpec | undefined {
  const rec = asRecord(raw);
  if (!rec) return undefined;
  const itemsIn = Array.isArray(rec.rows) ? rec.rows : [];
  const rows: ExecutiveReportDeepSpecRow[] = [];
  for (const entry of itemsIn.slice(0, cap)) {
    const row = asRecord(entry);
    if (!row) continue;
    const name = str(row.name, 120);
    const value = str(row.value, 200);
    if (!name || !value) continue; // 缺主键即丢弃该行
    rows.push({
      name,
      value,
      unit: str(row.unit, 40),
      note: str(row.note, 200),
      claimKind: kind(row.claimKind),
      evidenceRef: str(row.evidenceRef, 200),
    });
  }
  if (rows.length === 0) return undefined;
  return {
    title: str(rec.title, 80),
    dosageForm: str(rec.dosageForm, 80),
    rows,
  };
}

/** 校验 ② BOM 块：每行至少要有 item；金额允许数字或字符串（后端可给 "—" 显式标缺）。 */
export function validateDeepBom(raw: unknown, cap = DEEP_BOM_LINES_CAP): ExecutiveReportDeepBom | undefined {
  const rec = asRecord(raw);
  if (!rec) return undefined;
  const linesIn = Array.isArray(rec.lines) ? rec.lines : [];
  const lines: ExecutiveReportDeepBomLine[] = [];
  for (const entry of linesIn.slice(0, cap)) {
    const line = asRecord(entry);
    if (!line) continue;
    const item = str(line.item, 120);
    if (!item) continue;
    lines.push({
      item,
      qty: num(line.qty) ?? str(line.qty, 40),
      uom: str(line.uom, 24),
      unitCost: num(line.unitCost) ?? str(line.unitCost, 40),
      total: num(line.total) ?? str(line.total, 40),
      sourceRef: str(line.sourceRef, 200) ?? null,
      note: str(line.note, 200),
    });
  }
  if (lines.length === 0) return undefined;
  return {
    currency: str(rec.currency, 8) ?? "CNY",
    basis: str(rec.basis, 200),
    lines,
  };
}

/** 校验 ⑧ 验证块输入：orchestrator 从已落库核验记录组装后过这道关。 */
export function validateDeepValidation(
  raw: unknown,
  cap = DEEP_VALIDATION_ITEMS_CAP
): ExecutiveReportDeepValidation | undefined {
  const rec = asRecord(raw);
  if (!rec) return undefined;
  const itemsIn = Array.isArray(rec.items) ? rec.items : [];
  const items: ExecutiveReportDeepValidationItem[] = [];
  for (const entry of itemsIn.slice(0, cap)) {
    const item = asRecord(entry);
    if (!item) continue;
    const claim = str(item.claim, 240);
    if (!claim) continue;
    items.push({
      claim,
      latestStatus: str(item.latestStatus, 40) ?? "NO_VERIFICATION",
      checkedAt: str(item.checkedAt, 40) ?? null,
      claimKind: kind(item.claimKind),
      evidenceLevel: str(item.evidenceLevel, 8),
    });
  }
  const gapsIn = Array.isArray(rec.gaps) ? rec.gaps : [];
  const gaps = gapsIn.slice(0, DEEP_GAPS_CAP).map((g) => str(g, 240)).filter((g): g is string => !!g);
  if (items.length === 0 && gaps.length === 0) return undefined;
  const supported = items.filter((i) => i.latestStatus === "SUPPORTED").length;
  return {
    totals: { claims: items.length, supported, unverified: items.length - supported },
    items,
    gaps,
    qaStatus: str(rec.qaStatus, 60),
  };
}

/** 从 specialist 任务链上取 executorResult.deep（通道：contextSnapshot.executorResult.deep）。 */
export function pickTaskDeep(
  tasks: ReadonlyArray<{ agent: { code: string }; contextSnapshot: unknown }>,
  agentCode: string,
  key: string
): unknown {
  const task = tasks.find((t) => t.agent.code === agentCode);
  const snap = asRecord(task?.contextSnapshot);
  const executorResult = asRecord(snap?.executorResult);
  const deep = asRecord(executorResult?.deep);
  return deep?.[key];
}

/** 生成九节骨架：ready 完全由实数据有无决定，不猜、不藏。 */
export function buildDeepSections(input: {
  spec?: ExecutiveReportDeepSpec;
  bom?: ExecutiveReportDeepBom;
  validation?: ExecutiveReportDeepValidation;
  appendixCount?: number;
}): ExecutiveReportDeepSection[] {
  const ready: Record<ExecutiveReportDeepSection["key"], boolean> = {
    definition: !!input.spec,
    bom: !!input.bom,
    process: false,
    quality: false,
    economics: false,
    compliance: false,
    fmea: false,
    validation: !!input.validation,
    appendix: (input.appendixCount ?? 0) > 0,
  };
  return DEEP_SECTION_META.map((meta) => ({
    key: meta.key,
    title: meta.title,
    ready: ready[meta.key],
    gap: ready[meta.key] ? undefined : meta.fill,
  }));
}

/** 聚合入口：orchestrator 与 preview 共用，保证落库 JSON 与裁剪层口径一致。 */
export function composeDeepReport(input: {
  spec?: unknown;
  bom?: unknown;
  validation?: unknown;
  appendixCount?: number;
}): ExecutiveReportDeep {
  const spec = validateDeepSpec(input.spec);
  const bom = validateDeepBom(input.bom);
  const validation = validateDeepValidation(input.validation);
  return {
    ...(spec ? { spec } : {}),
    ...(bom ? { bom } : {}),
    ...(validation ? { validation } : {}),
    sections: buildDeepSections({
      spec,
      bom,
      validation,
      appendixCount: input.appendixCount ?? 0,
    }),
  };
}
