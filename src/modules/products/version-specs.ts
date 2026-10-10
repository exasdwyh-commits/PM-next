/**
 * 工厂级参数标准（R3·product-version-specs/v1）
 * ============================================
 * ProductVersion.specs 之前是自由 JSON：字段名随手起、类型随手放、缺省时被
 * 静默填造。本模块把「工厂要能拿去生产的参数」定义成一份显式契约：
 *
 * - 字段集：投料 / 工艺 / 质量标准 / 保质期 / 合规类别 / 成本参数六个工厂家族，
 *   外加 workbench 家族承接产品入库时既有键，避免把既有数据误判成未知键；
 * - 每字段都有显式 口径（写什么、单位、不得写什么）与 来源标注（允许的来源类型）；
 * - 运行时校验：已知字段做类型/值域/枚举与长度检查，违例即问题（服务层返回 422）；
 * - 缺数据显式标 SPEC_UNKNOWN（"UNKNOWN"）或 true 的 null，校验器把它们记进
 *   unknownFields（“这个缺口存在”），绝不补造值；数组/对象之外的额外未知键
 *   透传不拦——不删既有自由扩展能力，只让它可见（extras）。
 *
 * 本模块是纯函数：不连库、不联网、不带时间——测试可枚举全部口径。
 */

export const SPECS_CONTRACT_VERSION = "product-version-specs/v1";

/** 缺省即未知：字段值允许的字面量；发票级展示常量不要自行发散（UI/报告共用）。 */
export const SPEC_UNKNOWN = "UNKNOWN";

export type SpecFieldType = "text" | "number" | "money" | "date" | "enum" | "list";

/** 来源标注：字段值允许来自哪里。 */
export type SpecSourceKind =
  | "MANUAL" // 人工填写（用户或运营）
  | "AI_EXTRACTED" // 对话/粘贴内容抽取，且用户已确认
  | "SUPPLIER_QUOTE" // 供应商报价/COA/样品单
  | "LAB_REPORT" // 实验室检测/中试记录
  | "REGULATORY_SOURCE" // 法规/标准文本
  | "INFERENCE" // 推断（必须显式标注，含来源字段或前后文）
  | "MIGRATED"; // 历史数据迁移（入库首屏工作台字段等）

export type SpecGroup = "投料" | "工艺" | "质量标准" | "保质期" | "合规类别" | "成本参数" | "workbench";

export interface SpecFieldDef {
  /** specs JSON 里的键（扁平 camelCase，与既有 workbench 键同面）。 */
  key: string;
  label: string;
  group: SpecGroup;
  /**
   * 类型；有实测证据的既有用法可用联合候选（如既有渠道回归里 targetChannels
   * 携字符串数组，见 tests/golden-channel-route-persistence）。
   * 判定：任一候选类型通过即合规，不报首个候选的失败。
   */
  type: SpecFieldType | readonly SpecFieldType[];
  /** 口径：含义、单位与不得填的内容。 */
  definition: string;
  /** 允许的来源标注。 */
  sources: readonly SpecSourceKind[];
  /**
   * 是否必填。R3 口径下工厂字段一律不要求填写——缺省即 UNKNOWN（缺口可见），
   * 绝不因缺省阻断发布；required 位为将来的品类模板保留。
   */
  required: boolean;
  unit?: string;
  enumValues?: readonly string[];
  maxChars?: number;
  min?: number;
}

const FIELD = (def: SpecFieldDef) => def;

export const SPEC_FIELD_DEFS: readonly SpecFieldDef[] = [
  // ── workbench：入库首屏既有键（保持自由扩展历史数据的身份可见）──────
  FIELD({
    key: "coreIdea", label: "一句话产品构想", group: "workbench", type: "text",
    definition: "产品是什么/为谁解决什么的一句话表述；不得写功效宣称或价格承诺。",
    sources: ["MANUAL", "AI_EXTRACTED", "MIGRATED"], required: false, maxChars: 400,
  }),
  FIELD({
    key: "coreSellingPoints", label: "核心卖点", group: "workbench", type: "text",
    definition: "面向首批目标人群的 1–3 条差异化卖点；功效类表述需另有合规依据。",
    sources: ["MANUAL", "AI_EXTRACTED", "MIGRATED"], required: false, maxChars: 400,
  }),
  FIELD({
    key: "targetChannels", label: "目标渠道", group: "workbench", type: ["text", "list"],
    definition: "首发目标渠道（如 天猫/抖音/线下集合店）；不得写成已上架事实。" +
      "多型键：入库工作台是字符串，渠道回归流实测为字符串数组——契约承认两种既有形态。",
    sources: ["MANUAL", "AI_EXTRACTED", "MIGRATED"], required: false, maxChars: 200,
  }),
  FIELD({
    key: "formSpec", label: "剂型/形态规格", group: "workbench", type: "text",
    definition: "例如『软糖 3g×30』『粉剂 5g×14』；没有就打 UNKNOWN。",
    sources: ["MANUAL", "AI_EXTRACTED", "SUPPLIER_QUOTE", "MIGRATED"], required: false, maxChars: 200,
  }),
  FIELD({
    key: "priceExpectation", label: "价格预期", group: "workbench", type: "text",
    definition: "零售价区间或目标带（含币种）；推断结论须明示（推断）。",
    sources: ["MANUAL", "AI_EXTRACTED", "INFERENCE", "MIGRATED"], required: false, maxChars: 200,
  }),
  FIELD({
    key: "forbiddenItems", label: "禁忌成分/约束", group: "workbench", type: "text",
    definition: "不得包含的成分、人群或场景约束；依据须在合规字段落实。",
    sources: ["MANUAL", "AI_EXTRACTED", "REGULATORY_SOURCE", "MIGRATED"], required: false, maxChars: 400,
  }),
  FIELD({
    key: "targetAudience", label: "目标人群", group: "workbench", type: "text",
    definition: "首批目标人群画像；源自样本调查的写样本口径，模型画像标（推断）。",
    sources: ["MANUAL", "AI_EXTRACTED", "INFERENCE", "MIGRATED"], required: false, maxChars: 400,
  }),

  // ── 投料 ────────────────────────────────────────────────────────────
  FIELD({
    key: "rawMaterials", label: "主料清单", group: "投料", type: "list",
    definition: "逐项列原料名称与规格等级（如『赤藓糖醇·食品级』）；不得写功效宣称。",
    sources: ["MANUAL", "AI_EXTRACTED", "SUPPLIER_QUOTE"], required: false, maxChars: 200,
  }),
  FIELD({
    key: "excipients", label: "辅料与添加剂", group: "投料", type: "text",
    definition: "辅料、食品添加剂及依据（标准/供应商）；无则 UNKNOWN。",
    sources: ["MANUAL", "AI_EXTRACTED", "SUPPLIER_QUOTE", "REGULATORY_SOURCE"], required: false, maxChars: 600,
  }),
  FIELD({
    key: "feedingRatios", label: "投料配比", group: "投料", type: "text",
    definition: "各原料比例或单位投料量（含单位）；缺中试/打样数据一律 UNKNOWN，不得用配方常识凑数。",
    sources: ["LAB_REPORT", "MANUAL", "SUPPLIER_QUOTE"], required: false, maxChars: 600,
  }),
  FIELD({
    key: "supplierRequirements", label: "供应商与产地要求", group: "投料", type: "text",
    definition: "资质门槛、产地限定、批次要求；未与供应商核实前按推断处理并标注。",
    sources: ["MANUAL", "SUPPLIER_QUOTE", "AI_EXTRACTED"], required: false, maxChars: 400,
  }),

  // ── 工艺 ────────────────────────────────────────────────────────────
  FIELD({
    key: "processFlow", label: "工艺流程", group: "工艺", type: "text",
    definition: "按顺序列工序并标注关键设备；未经中试验证的流程标（推断）。",
    sources: ["LAB_REPORT", "MANUAL", "AI_EXTRACTED"], required: false, maxChars: 800,
  }),
  FIELD({
    key: "criticalControlPoints", label: "关键控制点（CCP）", group: "工艺", type: "list",
    definition: "对安全/质量有决定性影响的控制点及控制参数；不得省略已识别项。",
    sources: ["LAB_REPORT", "REGULATORY_SOURCE", "MANUAL"], required: false, maxChars: 200,
  }),
  FIELD({
    key: "processTemperature", label: "工艺温度", group: "工艺", type: "text",
    definition: "关键工序温度带上下限与容差（如 78–82℃±1）；无实测数据标 UNKNOWN。",
    sources: ["LAB_REPORT", "MANUAL"], required: false, unit: "℃", maxChars: 200,
  }),

  // ── 质量标准 ────────────────────────────────────────────────────────
  FIELD({
    key: "qualityStandard", label: "执行标准", group: "质量标准", type: "text",
    definition: "国标/行标/企标的编号与名称（如 GB 7101、Q/XXX 0001S）；未定标准 UNKNOWN。",
    sources: ["REGULATORY_SOURCE", "MANUAL"], required: false, maxChars: 300,
  }),
  FIELD({
    key: "qualityIndicators", label: "质量指标与限值", group: "质量标准", type: "list",
    definition: "「指标名＋限值＋检验方法」三元组；限值无检测依据的写 UNKNOWN，不得写典型值。",
    sources: ["LAB_REPORT", "REGULATORY_SOURCE", "MANUAL"], required: false, maxChars: 240,
  }),
  FIELD({
    key: "inspectionPlan", label: "检验计划", group: "质量标准", type: "text",
    definition: "出厂/型式检验项目与频次；委托检验写受托机构要求。",
    sources: ["MANUAL", "LAB_REPORT", "REGULATORY_SOURCE"], required: false, maxChars: 600,
  }),

  // ── 保质期 ──────────────────────────────────────────────────────────
  FIELD({
    key: "shelfLife", label: "保质期", group: "保质期", type: "text",
    definition: "时长与依据（稳定性试验结果或推断标注）；未做试验不得直接写时长。",
    sources: ["LAB_REPORT", "SUPPLIER_QUOTE", "INFERENCE", "MANUAL"], required: false, maxChars: 200,
  }),
  FIELD({
    key: "storageConditions", label: "储存条件", group: "保质期", type: "text",
    definition: "温度/湿度/避光等条件；与包装联动的约束一并写明。",
    sources: ["LAB_REPORT", "MANUAL", "AI_EXTRACTED"], required: false, maxChars: 300,
  }),
  FIELD({
    key: "packageSpec", label: "包装规格", group: "保质期", type: "text",
    definition: "内包装材质与规格、外箱量（如『3g 镀铝袋×30/盒×24 盒/箱』）。",
    sources: ["MANUAL", "SUPPLIER_QUOTE", "AI_EXTRACTED"], required: false, maxChars: 300,
  }),

  // ── 合规类别 ────────────────────────────────────────────────────────
  FIELD({
    key: "complianceCategory", label: "合规类别", group: "合规类别", type: "enum",
    definition: "决定证照与宣称边界的品类归属；不确定即 UNKNOWN，不得猜测。",
    sources: ["REGULATORY_SOURCE", "MANUAL"], required: false,
    enumValues: ["普通食品", "保健食品", "特殊膳食食品", "化妆品", "其他"],
  }),
  FIELD({
    key: "claimsBoundary", label: "宣称边界", group: "合规类别", type: "text",
    definition: "允许/禁止宣称的红线清单及法规出处，含『可审查 ≠ 已批准』提示；蓝帽子与 SC 的资质差异在此落实。",
    sources: ["REGULATORY_SOURCE", "MANUAL"], required: false, maxChars: 800,
  }),
  FIELD({
    key: "regulatoryNotes", label: "注册备案要求", group: "合规类别", type: "text",
    definition: "注册/备案/许可路径与预计周期来源；平台准入（如抖音类目资质）差异单独写明。",
    sources: ["REGULATORY_SOURCE", "MANUAL", "AI_EXTRACTED"], required: false, maxChars: 800,
  }),

  // ── 成本参数 ────────────────────────────────────────────────────────
  FIELD({
    key: "targetUnitCost", label: "单位目标成本", group: "成本参数", type: "money",
    definition: "含税/不含税口径须在前文成本结构说明写清；无报价依据不填值，填造即违规。",
    sources: ["SUPPLIER_QUOTE", "MANUAL", "LAB_REPORT", "INFERENCE"], required: false,
    unit: "CNY/件", min: 0,
  }),
  FIELD({
    key: "moq", label: "最小起订量", group: "成本参数", type: "text",
    definition: "上游报出的 MOQ（含单位：件/kg/L）；无报价标 UNKNOWN。",
    sources: ["SUPPLIER_QUOTE", "MANUAL"], required: false, maxChars: 120,
  }),
  FIELD({
    key: "costStructureNote", label: "成本结构说明", group: "成本参数", type: "text",
    definition: "六类成本口径（原材料/包材/加工/质检物流/平台佣金/隐性成本）与含税口径；推断占比须标注（推断）。",
    sources: ["MANUAL", "SUPPLIER_QUOTE", "INFERENCE", "AI_EXTRACTED"], required: false, maxChars: 800,
  }),
];

export const SPEC_FIELD_INDEX: ReadonlyMap<string, SpecFieldDef> = new Map(
  SPEC_FIELD_DEFS.map((def) => [def.key, def]),
);

export const UNKNOWN_SCALAR_TYPES: readonly SpecFieldType[] = ["text", "enum", "date", "list"];

export interface SpecsValidation {
  ok: boolean;
  /** 硬违例：类型/值域/枚举/长度错误；服务层据此返回 422。 */
  problems: string[];
  /**
   * 已知字段里显式 UNKNOWN / null 的键（“这个缺口存在”，服务层可并入审计与
   * workbench 的 unknowns 投影）；缺省（键不存在）的工厂字段也一并列出。
   */
  unknownFields: string[];
  /** 契约外的额外键：透传不拦，但让调用方看得见。 */
  extras: string[];
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function checkValue(def: SpecFieldDef, value: unknown): string | null {
  switch (def.type) {
    case "text": {
      if (typeof value !== "string") return `应为字符串`;
      const max = def.maxChars ?? 400;
      if (value.length > max) return `超过 ${max} 字上限（当前 ${value.length}）`;
      return null;
    }
    case "enum":
      if (typeof value !== "string" || !(def.enumValues ?? []).includes(value)) {
        return `应为枚举 ${JSON.stringify(def.enumValues ?? [])} 之一（或 "${SPEC_UNKNOWN}"）`;
      }
      return null;
    case "number":
    case "money":
      if (typeof value !== "number" || !Number.isFinite(value)) return `应为数字`;
      if (def.min !== undefined && value < def.min) return `不得小于 ${def.min}`;
      return null;
    case "date":
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T[^\n]{1,40})?$/.test(value)) {
        return `应为 ISO 日期（YYYY-MM-DD 或 ISO8601）`;
      }
      return null;
    case "list": {
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return `应为字符串数组`;
      const max = def.maxChars ?? 200;
      const tooLong = (value as string[]).find((item) => item.length > max);
      if (tooLong !== undefined) return `数组单项超过 ${max} 字上限`;
      return null;
    }
    default:
      return null;
  }
}

/**
 * 校验 ProductVersion.specs。
 * - 硬违例进 problems（发布/确认前应被拦截）；
 * - 缺省或 UNKNOWN/null 进 unknownFields（缺口可见、绝不补造）；
 * - 契约外键进 extras（透传不拦）。
 */
export function validateProductSpecs(specs: unknown): SpecsValidation {
  const problems: string[] = [];
  const unknownFields: string[] = [];
  const extras: string[] = [];

  if (!isPlainObject(specs)) {
    return { ok: false, problems: ["specs 必须是 JSON 对象"], unknownFields: [], extras: [] };
  }

  for (const def of SPEC_FIELD_DEFS) {
    if (!(def.key in specs)) {
      // 缺省 = 尚未知：只出现在工厂家族（workbench 键缺省属正常历史形态）
      if (def.group !== "workbench") unknownFields.push(def.key);
      if (def.required) problems.push(`缺少必填字段「${def.key}（${def.label}）」`);
      continue;
    }
    const value = specs[def.key];
    if (value === null || value === SPEC_UNKNOWN) {
      unknownFields.push(def.key);
      continue;
    }
    const candidates: readonly SpecFieldType[] = Array.isArray(def.type) ? def.type : [def.type];
    // 联合类型：任一候选通过即合规；否则报第一个候选的失败（消息里仍可见口径）。
    let problem: string | null = null;
    for (const type of candidates) {
      const attempt = checkValue({ ...def, type }, value);
      if (!attempt) { problem = null; break; }
      problem = attempt;
    }
    if (problem) problems.push(`字段「${def.key}（${def.label}）」${problem}`);
  }

  for (const key of Object.keys(specs)) {
    if (!SPEC_FIELD_INDEX.has(key)) extras.push(key);
  }

  return { ok: problems.length === 0, problems, unknownFields, extras };
}
