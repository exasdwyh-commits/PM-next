/**
 * 产品多轮优化闭环（蓝图 §4.4）
 *
 * 蓝图规定的流程：
 *   v1 分析 → 展示主要弱项 → 顾问提出修改草案 → 用户选择采纳项 → 创建 v2
 *   → 对受影响维度重评 → 显示变更前后与代价 → 进入下一轮
 *
 * 三条不可违反的规则：
 *  1. **v1 不被覆盖**：新一轮改动一律写成新的 ProductVersion（isImmutable），旧版本原样保留。
 *  2. **不覆盖他人新修改**：创建 v2 前必须校验 baseVersionId 仍是当前最新版本；
 *     若产品已产生更新版本，抛 ConflictError，要求基于最新版本重新生成草案（蓝图 §5.3）。
 *  3. **不承诺分数会涨**：采纳项只声明「改了哪个字段、会影响哪些维度」，
 *     真正的分数变化由重评后的 AnalysisRun 对比给出；没有证据的维度改了文案也仍然是未知。
 *
 * 本模块仍是**确定性规则**，不调用任何模型。
 */

import prisma from "@/shared/db";
import { ConflictError, NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import { PRODUCT_SPEC_FIELD_LABELS } from "@/shared/status-labels";
import { Prisma, AnalysisDimensionKey } from "@prisma/client";
import { createAuditEventInTx } from "@/shared/audit";
import { SessionContext } from "../identity/session";
import { PRODUCT_WRITE_ROLES, requireProductRead, requireProductRole } from "../identity/product-access";
import { analyzeProductVersion } from "./analysis";
import { DIMENSION_LABELS, DIMENSION_ORDER } from "./scoring";

// ---------------------------------------------------------------------------
// 可采纳字段白名单
// 只允许改动这几个字段：它们是「方案描述」，不是证据、不是审批结论。
// 白名单之外的字段一律拒绝，避免绕过业务命令直接改库。
// ---------------------------------------------------------------------------

export type ProductSpecField =
  | "coreIdea"
  | "targetAudience"
  | "coreSellingPoints"
  | "targetChannels"
  | "priceExpectation"
  | "formSpec"
  | "forbiddenItems"
  | "targetCost";

export const FIELD_LABELS: Record<ProductSpecField, string> = PRODUCT_SPEC_FIELD_LABELS;

/**
 * 字段 → 受影响维度。
 * 这是「结构上会读这个字段的维度」，不是「改了就一定得分」：
 * 例如需求价值要的是已核实证据，改目标人群文案不会让需求证据凭空出现。
 */
const FIELD_AFFECTED_DIMENSIONS: Record<ProductSpecField, AnalysisDimensionKey[]> = {
  coreIdea: ["DEMAND_VALUE", "DIFFERENTIATION"],
  targetAudience: ["DEMAND_VALUE"],
  coreSellingPoints: ["DIFFERENTIATION", "DEMAND_VALUE"],
  targetChannels: ["COMPANY_FIT", "LAUNCH_READINESS"],
  priceExpectation: ["UNIT_ECONOMICS"],
  formSpec: ["DIFFERENTIATION", "DELIVERY_FEASIBILITY"],
  forbiddenItems: ["DELIVERY_FEASIBILITY", "COMPANY_FIT"],
  targetCost: ["UNIT_ECONOMICS"],
};

/** 每个字段的「变更代价」提示：改它的前提条件是什么，避免用户以为改个数字就完事 */
const FIELD_COST_NOTE: Record<ProductSpecField, string> = {
  coreIdea: "改动仅影响方案描述；需求侧结论仍需已核实的真实证据支撑。",
  targetAudience: "改动仅影响方案描述；需求规模判定仍需已核实的销售/人群证据。",
  coreSellingPoints: "改动仅影响方案描述；差异化是否成立仍需竞品与价格带证据。",
  targetChannels: "渠道变动会影响公司适配与上市准备度，需确认渠道能力事实是否仍然成立。",
  priceExpectation: "价格预期是录入假设；改动后原利润结论不再自动适用，需重新计算并补充价格证据。",
  formSpec: "剂型/规格改动会影响差异化与可制造性，需工厂端反馈确认。",
  forbiddenItems: "禁用项改动会影响交付可行性与合规，需重新核验。",
  targetCost: "目标成本是录入假设；改动后原毛利结论不再自动适用，需供应商报价支撑。",
};

function isSpecField(x: string): x is ProductSpecField {
  return Object.prototype.hasOwnProperty.call(FIELD_LABELS, x);
}

/** 从 specs Json 里安全取字符串 */
function specOf(specs: unknown, field: ProductSpecField): string | null {
  if (!specs || typeof specs !== "object") return null;
  const v = (specs as Record<string, unknown>)[field];
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

/** 把任意输入规整成「非空字符串」或 null —— 空字符串一律视为未填，不写进版本 */
function normalizeValue(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim();
  return s.length > 0 ? s : null;
}

// ---------------------------------------------------------------------------
// 1. 从最新分析结果生成「可采纳项」
// ---------------------------------------------------------------------------

export interface RevisionTarget {
  field: ProductSpecField;
  label: string;
  currentValue: string | null;
  placeholder: string;
}

export interface RevisionOption {
  key: string;
  dimension: AnalysisDimensionKey;
  dimensionLabel: string;
  title: string;
  /** 为什么建议改：直接引用该维度的缺口原文，不做二次美化 */
  reason: string;
  /** 该维度当前建议 */
  recommendation: string | null;
  targets: RevisionTarget[];
  affectedDimensions: { key: AnalysisDimensionKey; label: string }[];
  /** 变更代价 / 前提条件 */
  costNote: string;
  /** 采纳后是否可能真正改变分数（false = 结构上不读这个字段，改文案不会改变结论） */
  mayMoveScore: boolean;
}

const PLACEHOLDERS: Record<ProductSpecField, string> = {
  coreIdea: "例如：给上班族一个不靠糖分提神的下午加餐",
  targetAudience: "例如：25-35 岁办公室人群，下午三四点能量低谷",
  coreSellingPoints: "例如：慢碳配方 + 每份 6g 膳食纤维，不加蔗糖",
  targetChannels: "例如：抖音自播 + 小红书种草",
  priceExpectation: "例如：39.9 元 / 盒",
  formSpec: "例如：60g 独立小袋 × 6",
  forbiddenItems: "例如：不加蔗糖、不用人工色素",
  targetCost: "例如：18（元/盒，仅数字）",
};

/**
 * 生成可采纳项。
 * 只有「有缺口」的维度才会产出采纳项 —— 未知量不补造，也不提供无意义的建议。
 */
export async function proposeRevisionOptions(
  session: SessionContext,
  productId: string
): Promise<{
  product: { id: string; name: string };
  baseVersion: { id: string; versionTag: string; createdAt: Date } | null;
  baseRunId: string | null;
  options: RevisionOption[];
  note: string;
}> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      versions: { orderBy: { createdAt: "desc" } },
      analysisRuns: {
        where: { status: "SUCCEEDED" },
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { dimensions: true, scorecard: true },
      },
    },
  });

  if (!product) {
    throw new NotFoundError("Product not found");
  }

  // B4（2026-09-16 拍板）：读路径 = 组织内可读。跨组织 / 不存在统一 404。
  await requireProductRead(session, productId);

  const baseVersion = product.versions[0] ?? null;
  const latestRun = product.analysisRuns[0] ?? null;

  if (!baseVersion) {
    throw new UnprocessableEntityError("该产品还没有任何版本，无法生成修改草案");
  }
  if (!latestRun) {
    return {
      product: { id: product.id, name: product.name },
      baseVersion: { id: baseVersion.id, versionTag: baseVersion.versionTag, createdAt: baseVersion.createdAt },
      baseRunId: null,
      options: [],
      note: "尚未运行分析。请先在「分析与评分」页签运行基线分析，再根据缺口生成修改草案。",
    };
  }

  /** 维度缺口 → 建议采纳的字段集合 */
  const TARGETS_BY_DIMENSION: Record<AnalysisDimensionKey, ProductSpecField[]> = {
    DEMAND_VALUE: ["targetAudience", "coreIdea"],
    DIFFERENTIATION: ["formSpec", "coreSellingPoints"],
    UNIT_ECONOMICS: ["priceExpectation", "targetCost"],
    COMPANY_FIT: ["targetChannels"],
    DELIVERY_FEASIBILITY: ["formSpec", "forbiddenItems"],
    // 上市准备度不通过改产品描述解决，必须去上市计划页签补齐；此处不出采纳项
    LAUNCH_READINESS: [],
  };

  const options: RevisionOption[] = [];

  for (const key of DIMENSION_ORDER) {
    const dim = latestRun.dimensions.find((d) => d.dimension === key);
    if (!dim) continue;
    // 缺口为空说明该维度没有明确问题，不产出无意义建议
    if (!dim.gaps || dim.gaps.trim().length === 0) continue;

    const fields = TARGETS_BY_DIMENSION[key];
    if (fields.length === 0) continue;

    const targets: RevisionTarget[] = fields.map((f) => {
      const current =
        f === "targetCost"
          ? baseVersion.targetCost !== null
            ? String(Number(baseVersion.targetCost))
            : null
          : specOf(baseVersion.specs, f);
      return { field: f, label: FIELD_LABELS[f], currentValue: current, placeholder: PLACEHOLDERS[f] };
    });

    const affected = new Set<AnalysisDimensionKey>();
    for (const f of fields) for (const d of FIELD_AFFECTED_DIMENSIONS[f]) affected.add(d);

    options.push({
      key: `${key}:${fields.join("+")}`,
      dimension: key,
      dimensionLabel: DIMENSION_LABELS[key],
      title: `补齐「${DIMENSION_LABELS[key]}」相关信息`,
      reason: dim.gaps,
      recommendation: dim.recommendation,
      targets,
      affectedDimensions: [...affected].map((k) => ({ key: k, label: DIMENSION_LABELS[k] })),
      costNote: fields.map((f) => FIELD_COST_NOTE[f]).join(" "),
      // 该维度是否真的读这些字段：读 → 可能变化；不读（如需求价值读的是证据覆盖）→ 文案改动不改变结论
      mayMoveScore: doesDimensionReadFields(key, fields),
    });
  }

  return {
    product: { id: product.id, name: product.name },
    baseVersion: { id: baseVersion.id, versionTag: baseVersion.versionTag, createdAt: baseVersion.createdAt },
    baseRunId: latestRun.id,
    options,
    note:
      options.length === 0
        ? "当前最新分析没有可转化为方案改动的缺口。"
        : "采纳项只描述「改哪个字段、会影响哪些维度」，不承诺分数上升；分数变化以重评结果为准。",
  };
}

/**
 * 该维度在分析实现里是否真的读取这些字段。
 * 不读取 → 改文案不会改变分数（例如需求价值读的是已核实证据覆盖），必须如实告诉用户。
 */
function doesDimensionReadFields(dimension: AnalysisDimensionKey, fields: ProductSpecField[]): boolean {
  if (dimension === "UNIT_ECONOMICS") {
    return fields.some((f) => f === "priceExpectation" || f === "targetCost");
  }
  if (dimension === "LAUNCH_READINESS") return fields.length > 0;
  return false;
}

// ---------------------------------------------------------------------------
// 2. 版本差异
// ---------------------------------------------------------------------------

export interface VersionDiffRow {
  field: ProductSpecField;
  label: string;
  before: string | null;
  after: string | null;
  changed: boolean;
}

export function diffVersionSpecs(
  before: { specs: unknown; targetCost: unknown },
  after: { specs: unknown; targetCost: unknown }
): VersionDiffRow[] {
  const read = (src: { specs: unknown; targetCost: unknown }, f: ProductSpecField): string | null =>
    f === "targetCost"
      ? src.targetCost !== null && src.targetCost !== undefined
        ? String(Number(src.targetCost))
        : null
      : specOf(src.specs, f);

  const fields = Object.keys(FIELD_LABELS) as ProductSpecField[];
  return fields.map((f) => {
    const b = read(before, f);
    const a = read(after, f);
    return { field: f, label: FIELD_LABELS[f], before: b, after: a, changed: b !== a };
  });
}

// ---------------------------------------------------------------------------
// 3. 创建 v2（不覆盖 v1）并对受影响维度重评
// ---------------------------------------------------------------------------

export interface CreateRevisionParams {
  productId: string;
  /** 生成草案时所依据的版本；必须是当前最新版本，否则拒绝执行 */
  baseVersionId: string;
  /** 采纳项 key 列表（仅用于留痕，实际写入以 changes 为准） */
  adoptedKeys?: string[];
  /** 字段 → 新值。不在白名单内的键直接拒绝。 */
  changes: Record<string, string | number | null>;
  /** 被拒绝的采纳项与理由（蓝图 §4.3：方案与版本页签要记录反馈采纳与拒绝） */
  rejected?: { key: string; reason: string }[];
  /** 本轮修改理由（人工填写，写入版本留痕） */
  note?: string | null;
  rationale?: string | null;
}

export interface CreateRevisionResult {
  versionId: string;
  versionTag: string;
  supersedesVersionId: string;
  supersedesVersionTag: string;
  diff: VersionDiffRow[];
  affectedDimensions: { key: AnalysisDimensionKey; label: string }[];
  analysisRunId: string | null;
  previousRunId: string | null;
}

export async function createRevision(
  session: SessionContext,
  params: CreateRevisionParams
): Promise<CreateRevisionResult> {
  const product = await prisma.product.findUnique({
    where: { id: params.productId },
    include: {
      versions: { orderBy: { createdAt: "desc" } },
      analysisRuns: { where: { status: "SUCCEEDED" }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (!product) {
    throw new NotFoundError("Product not found");
  }

  // B4：写入门禁 —— 采纳修订会产生新版本，需为该产品关联项目的
  // OWNER / DECISION_MAKER。产品不存在 / 跨组织统一 404。
  await requireProductRole(session, params.productId, PRODUCT_WRITE_ROLES);

  const latest = product.versions[0];
  if (!latest) throw new UnprocessableEntityError("该产品还没有任何版本");

  // 规则 2：不覆盖他人新修改
  if (latest.id !== params.baseVersionId) {
    throw new ConflictError(
      `修改草案基于 ${product.versions.find((v) => v.id === params.baseVersionId)?.versionTag ?? "未知版本"} 生成，` +
        `但产品当前最新版本已是 ${latest.versionTag}。请基于最新版本重新生成草案，本轮不覆盖新修改。`
    );
  }

  const base = latest;

  // 白名单校验 + 取值
  const accepted: Partial<Record<ProductSpecField, string | null>> = {};
  const rejectedFields: string[] = [];
  for (const [k, v] of Object.entries(params.changes ?? {})) {
    if (!isSpecField(k)) {
      rejectedFields.push(k);
      continue;
    }
    accepted[k] = normalizeValue(v);
  }
  if (rejectedFields.length > 0) {
    throw new UnprocessableEntityError(
      `以下字段不在可采纳白名单内，已拒绝写入：${rejectedFields.join("、")}`
    );
  }

  const changedFields = (Object.keys(accepted) as ProductSpecField[]).filter((f) => {
    const before =
      f === "targetCost"
        ? base.targetCost !== null
          ? String(Number(base.targetCost))
          : null
        : specOf(base.specs, f);
    return before !== accepted[f];
  });

  if (changedFields.length === 0) {
    throw new UnprocessableEntityError("没有任何字段发生实际变化，未创建新版本");
  }

  // 版本号递增：从既有 tag 里找 v<n> 最大值 +1；找不到就用 versions.length + 1
  const maxTag = product.versions
    .map((v) => /^v(\d+)$/.exec(v.versionTag)?.[1])
    .filter((x): x is string => !!x)
    .map(Number)
    .reduce((a, b) => Math.max(a, b), 0);
  const nextTag = `v${Math.max(maxTag, product.versions.length) + 1}`;

  // 新 specs：以 base 为底，只覆盖发生变化的字段
  const baseSpecs =
    base.specs && typeof base.specs === "object" ? { ...(base.specs as Record<string, unknown>) } : {};
  const nextSpecs: Record<string, unknown> = { ...baseSpecs };
  let nextTargetCost: number | null = base.targetCost !== null ? Number(base.targetCost) : null;

  for (const f of changedFields) {
    if (f === "targetCost") {
      const raw = accepted[f];
      const num = raw === null ? NaN : Number(String(raw).replace(/,/g, ""));
      if (raw !== null && !Number.isFinite(num)) {
        throw new UnprocessableEntityError(`目标成本必须是数字，收到「${raw}」`);
      }
      nextTargetCost = raw === null ? null : num;
      nextSpecs.targetCost = nextTargetCost;
    } else {
      nextSpecs[f] = accepted[f];
    }
  }

  const affectedSet = new Set<AnalysisDimensionKey>();
  for (const f of changedFields) for (const d of FIELD_AFFECTED_DIMENSIONS[f]) affectedSet.add(d);
  const affectedDimensions = [...affectedSet].map((k) => ({ key: k, label: DIMENSION_LABELS[k] }));

  const diff = diffVersionSpecs(
    { specs: base.specs, targetCost: base.targetCost },
    { specs: nextSpecs, targetCost: nextTargetCost }
  );

  const previousRunId = product.analysisRuns[0]?.id ?? null;

  // 事务：新版本 + 审计。重评在事务外调用（它自身开事务），避免长事务。
  const version = await prisma.$transaction(async (tx) => {
    // 再查一次版本列表，防止并发双开 v2（两个请求同时通过上面的检查）
    const again = await tx.productVersion.findFirst({
      where: { productId: product.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, versionTag: true },
    });
    if (again && again.id !== base.id) {
      throw new ConflictError(
        `检测到并发修改：产品最新版本已变为 ${again.versionTag}，本轮草案未写入。请基于最新版本重新生成。`
      );
    }

    const created = await tx.productVersion.create({
      data: {
        productId: product.id,
        versionTag: nextTag,
        specs: nextSpecs as Prisma.InputJsonValue,
        targetCost: nextTargetCost,
        isImmutable: true,
        isConfirmed: false,
        // 留痕：本轮改了什么、依据哪一轮分析、拒绝了什么
        technicalAdvice: (params.note ?? params.rationale)?.trim() || null,
        unknowns: {
          note: "未采纳字段保持上一版本取值；未知项不补造数值",
          changedFields,
          adoptedKeys: params.adoptedKeys ?? [],
          rejected: params.rejected ?? [],
          basedOnVersionTag: base.versionTag,
          basedOnAnalysisRunId: previousRunId,
          affectedDimensions: affectedDimensions.map((d) => d.key),
        } as Prisma.InputJsonValue,
      },
    });

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "PRODUCT_VERSION_REVISED",
      objectType: "Product",
      objectId: product.id,
      summary:
        `创建 ${nextTag}（基于 ${base.versionTag}），变更字段：` +
        `${changedFields.map((f) => FIELD_LABELS[f]).join("、")}；` +
        `缘由：${params.note?.trim() || "未填写"}`,
      details: {
        versionId: created.id,
        versionTag: nextTag,
        supersedesVersionId: base.id,
        supersedesVersionTag: base.versionTag,
        changedFields,
        diff: diff.filter((d) => d.changed).map((d) => ({ field: d.field, before: d.before, after: d.after })),
        adoptedKeys: params.adoptedKeys ?? [],
        rejected: params.rejected ?? [],
      } as Prisma.InputJsonValue,
    });

    return created;
  });

  // 对受影响维度重评：走同一条 analyzeProductVersion 通道，kind=REVISION_REVIEW + supersedesRunId
  // 注意：历史 run 不被覆盖，新 run 用 supersedesRunId 指向被替代者（蓝图 §4.4）。
  let analysisRunId: string | null = null;
  try {
    analysisRunId = await analyzeProductVersion(session, {
      productId: product.id,
      productVersionId: version.id,
      kind: "REVISION_REVIEW",
      supersedesRunId: previousRunId ?? undefined,
    });
  } catch (e) {
    // 版本已写入，重评失败不应回滚版本；把失败如实抛给调用方，由前端提示「可手动重跑分析」
    throw new UnprocessableEntityError(
      `${nextTag} 已创建，但自动重评失败：${(e as Error).message}。可在「分析与评分」页签手动运行分析。`
    );
  }

  return {
    versionId: version.id,
    versionTag: nextTag,
    supersedesVersionId: base.id,
    supersedesVersionTag: base.versionTag,
    diff,
    affectedDimensions,
    analysisRunId,
    previousRunId,
  };
}

// ---------------------------------------------------------------------------
// 4. 版本对比（变更前后 + 代价）
// ---------------------------------------------------------------------------

export interface DimensionComparison {
  key: AnalysisDimensionKey;
  label: string;
  before: number | null;
  after: number | null;
  delta: number | null;
  status: "improved" | "declined" | "unchanged" | "still_unknown" | "newly_known";
  beforeGaps: string | null;
  afterGaps: string | null;
}

export interface RevisionComparison {
  before: {
    runId: string;
    versionTag: string;
    kind: string;
    weightedScore: number | null;
    coverageRatio: number;
    provisional: boolean;
    createdAt: Date;
  };
  after: {
    runId: string;
    versionTag: string;
    kind: string;
    weightedScore: number | null;
    coverageRatio: number;
    provisional: boolean;
    createdAt: Date;
  };
  diff: VersionDiffRow[];
  dimensions: DimensionComparison[];
  /** 变更代价：这批改动让哪些结论不再适用 */
  costs: string[];
}

export async function compareRevisions(
  session: SessionContext,
  beforeRunId: string,
  afterRunId: string
): Promise<RevisionComparison> {
  const [before, after] = await Promise.all([
    prisma.analysisRun.findUnique({
      where: { id: beforeRunId },
      include: { dimensions: true, scorecard: true, productVersion: true },
    }),
    prisma.analysisRun.findUnique({
      where: { id: afterRunId },
      include: { dimensions: true, scorecard: true, productVersion: true },
    }),
  ]);

  if (!before || !after) throw new NotFoundError("Analysis run not found");
  if (before.organizationId !== session.organizationId || after.organizationId !== session.organizationId) {
    throw new NotFoundError("Analysis run not found");
  }
  // B5：before / after 来自查询参数，除组织归属外还须属于**同一个产品**，
  // 否则可拿 A 产品的轮次与 B 产品的轮次对比，得出无意义的"改善/下降"结论。
  if (before.productId !== after.productId) {
    throw new NotFoundError("Analysis run not found");
  }
  // B4（2026-09-16 拍板）：读路径 = 组织内可读
  await requireProductRead(session, before.productId);

  const dimensions: DimensionComparison[] = DIMENSION_ORDER.map((key) => {
    const b = before.dimensions.find((d) => d.dimension === key) ?? null;
    const a = after.dimensions.find((d) => d.dimension === key) ?? null;
    const bs = b?.score ?? null;
    const as = a?.score ?? null;
    let status: DimensionComparison["status"];
    if (bs === null && as === null) status = "still_unknown";
    else if (bs === null) status = "newly_known";
    else if (as === null) status = "declined"; // 从有分退回未知，视为结论失效
    else if (as > bs) status = "improved";
    else if (as < bs) status = "declined";
    else status = "unchanged";

    return {
      key,
      label: DIMENSION_LABELS[key],
      before: bs,
      after: as,
      delta: bs !== null && as !== null ? as - bs : null,
      status,
      beforeGaps: b?.gaps ?? null,
      afterGaps: a?.gaps ?? null,
    };
  });

  const diff = diffVersionSpecs(
    { specs: before.productVersion.specs, targetCost: before.productVersion.targetCost },
    { specs: after.productVersion.specs, targetCost: after.productVersion.targetCost }
  );

  // 代价清单：由「实际变化的字段」推导，不写泛泛提示
  const costs: string[] = [];
  const changed = new Set(diff.filter((d) => d.changed).map((d) => d.field));
  if (changed.has("priceExpectation") || changed.has("targetCost")) {
    costs.push("价格/成本假设已变更：变更前的毛利结论不再自动适用，需重新计算并补充价格与报价证据。");
  }
  if (changed.has("formSpec")) {
    costs.push("剂型/规格已变更：既有打样记录与工厂可制造性反馈可能不再对应当前规格，需重新确认。");
  }
  if (changed.has("targetChannels")) {
    costs.push("渠道已变更：原渠道适配判断与上市准备清单需重新评估。");
  }
  if (changed.has("forbiddenItems")) {
    costs.push("禁用项已变更：合规待核验项需重新核验。");
  }
  const evidenceUnchanged =
    before.evidenceFingerprint !== null &&
    after.evidenceFingerprint !== null &&
    before.evidenceFingerprint === after.evidenceFingerprint;
  if (evidenceUnchanged && changed.size > 0) {
    costs.push("本轮仅改动方案描述，证据集合未变：依赖证据的维度（如需求价值、差异化）不会因改文案而改变结论。");
  }

  return {
    before: {
      runId: before.id,
      versionTag: before.productVersion.versionTag,
      kind: before.kind,
      weightedScore: before.scorecard?.weightedScore ?? null,
      coverageRatio: before.scorecard?.coverageRatio ?? 0,
      provisional: before.scorecard?.provisional ?? true,
      createdAt: before.createdAt,
    },
    after: {
      runId: after.id,
      versionTag: after.productVersion.versionTag,
      kind: after.kind,
      weightedScore: after.scorecard?.weightedScore ?? null,
      coverageRatio: after.scorecard?.coverageRatio ?? 0,
      provisional: after.scorecard?.provisional ?? true,
      createdAt: after.createdAt,
    },
    diff,
    dimensions,
    costs,
  };
}

/**
 * 读取产品的全部历史分析轮次（含版本号），供「方案与版本」页签展示版本轨迹。
 * 历史结果不可被最新结果覆盖，因此这里返回全部 run，而不是只返回最新。
 */
export async function listAnalysisHistory(session: SessionContext, productId: string) {
  // B4（2026-09-16 拍板）：读路径 = 组织内可读
  await requireProductRead(session, productId);

  const runs = await prisma.analysisRun.findMany({
    where: { organizationId: session.organizationId, productId },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { scorecard: true, productVersion: { select: { id: true, versionTag: true } } },
  });
  return runs.map((r) => ({
    runId: r.id,
    kind: r.kind,
    status: r.status,
    versionTag: r.productVersion.versionTag,
    productVersionId: r.productVersionId,
    ruleVersion: r.ruleVersion,
    runMode: r.runMode,
    weightedScore: r.scorecard?.weightedScore ?? null,
    coverageRatio: r.scorecard?.coverageRatio ?? 0,
    provisional: r.scorecard?.provisional ?? true,
    supersedesRunId: r.supersedesRunId,
    evidenceFingerprint: r.evidenceFingerprint,
    createdAt: r.createdAt,
  }));
}

// ---------------------------------------------------------------------------
// 5. 专业分析 → 可采纳项转换
// ---------------------------------------------------------------------------

/** 专业分析推荐动作类型 */
export type ProfessionalAnalysisActionType =
  | "SUPPLEMENT_EVIDENCE" // 补证任务
  | "UPDATE_FIELD" // 字段差异
  | "REQUEST_REVISION"; // 局部修订

/** 专业分析推荐动作标签 */
export const PROFESSIONAL_ANALYSIS_ACTION_LABELS: Record<ProfessionalAnalysisActionType, string> = {
  SUPPLEMENT_EVIDENCE: "补充证据任务",
  UPDATE_FIELD: "修改产品方案字段",
  REQUEST_REVISION: "创建产品新版本",
};

/**
 * 从专业分析输出生成可采纳项
 *
 * 将专业分析的 recommendedActions、unknowns、risks 转换为 RevisionOption：
 * - SUPPLEMENT_Evidence → CREATE_WORK_ITEM（补证任务）
 * - UPDATE_FIELD → UPDATE_FIELD（字段差异）
 * - REQUEST_REVISION → CREATE_REVISION（局部修订）
 *
 * 保持白名单、revision、幂等；不能让新分析直接发布版本或批准。
 */
export async function proposeRevisionOptionsFromAnalysis(
  session: SessionContext,
  productId: string,
  analysis: {
    recommendedActions?: Array<{
      action: string;
      priority: "HIGH" | "MEDIUM" | "LOW";
      owner?: string;
    }>;
    unknowns?: string[];
    risks?: Array<{
      description: string;
      severity: "HIGH" | "MEDIUM" | "LOW";
      mitigation?: string;
    }>;
  }
): Promise<{
  product: { id: string; name: string };
  baseVersion: { id: string; versionTag: string; createdAt: Date } | null;
  options: RevisionOption[];
  note: string;
}> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      versions: { orderBy: { createdAt: "desc" } },
      analysisRuns: {
        where: { status: "SUCCEEDED" },
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { dimensions: true, scorecard: true },
      },
    },
  });

  if (!product) {
    throw new NotFoundError("Product not found");
  }

  // B4（2026-09-16 拍板）：读路径 = 组织内可读。跨组织 / 不存在统一 404。
  await requireProductRead(session, productId);

  const baseVersion = product.versions[0] ?? null;
  const latestRun = product.analysisRuns[0] ?? null;

  if (!baseVersion) {
    throw new UnprocessableEntityError("该产品还没有任何版本，无法生成修改草案");
  }

  const options: RevisionOption[] = [];

  // 1. 从 recommendedActions 生成补证任务选项
  for (const action of analysis.recommendedActions ?? []) {
    if (!action.action || action.action.trim().length === 0) continue;

    // 识别是否是字段修改建议
    const fieldMatch = identifyFieldFromAction(action.action);
    if (fieldMatch) {
      // 字段修改建议 → 生成 UPDATE_FIELD 选项
      const targets: RevisionTarget[] = [
        {
          field: fieldMatch.field,
          label: FIELD_LABELS[fieldMatch.field],
          currentValue:
            fieldMatch.field === "targetCost"
              ? baseVersion.targetCost !== null
                ? String(Number(baseVersion.targetCost))
                : null
              : specOf(baseVersion.specs, fieldMatch.field),
          placeholder: PLACEHOLDERS[fieldMatch.field],
        },
      ];

      const affected = new Set<AnalysisDimensionKey>();
      for (const d of FIELD_AFFECTED_DIMENSIONS[fieldMatch.field]) affected.add(d);

      options.push({
        key: `professional-analysis:UPDATE_FIELD:${fieldMatch.field}`,
        dimension: "DEMAND_VALUE", // 默认维度，实际不影响
        dimensionLabel: "专业分析建议",
        title: `根据专业分析修改「${FIELD_LABELS[fieldMatch.field]}」`,
        reason: `[专业分析推荐] ${action.action}`,
        recommendation: fieldMatch.value,
        targets,
        affectedDimensions: [...affected].map((k) => ({ key: k, label: DIMENSION_LABELS[k] })),
        costNote: FIELD_COST_NOTE[fieldMatch.field],
        mayMoveScore: doesDimensionReadFields("DEMAND_VALUE", [fieldMatch.field]),
      });
    } else {
      // 非字段修改建议 → 生成补证任务选项
      const targets: RevisionTarget[] = [];

      options.push({
        key: `professional-analysis:SUPPLEMENT_EVIDENCE:${action.action.slice(0, 50)}`,
        dimension: "DEMAND_VALUE", // 默认维度
        dimensionLabel: "专业分析建议",
        title: `补充证据：${action.action.slice(0, 50)}`,
        reason: `[专业分析推荐] ${action.action}（优先级：${action.priority}）`,
        recommendation: action.owner ? `建议由 ${action.owner} 负责` : null,
        targets,
        affectedDimensions: [],
        costNote: "补证任务不直接影响方案字段，但会影响维度评分。",
        mayMoveScore: false,
      });
    }
  }

  // 2. 从 unknowns 生成补证任务选项
  for (const unknown of analysis.unknowns ?? []) {
    if (!unknown || unknown.trim().length === 0) continue;

    options.push({
      key: `professional-analysis:UNKNOWN:${unknown.slice(0, 50)}`,
      dimension: "DEMAND_VALUE", // 默认维度
      dimensionLabel: "专业分析未知项",
      title: `补证：${unknown.slice(0, 50)}`,
      reason: `[专业分析未知项] ${unknown}`,
      recommendation: null,
      targets: [],
      affectedDimensions: [],
      costNote: "补证任务不直接影响方案字段，但会影响维度评分。",
      mayMoveScore: false,
    });
  }

  // 3. 从高风险项生成补证任务选项（仅 HIGH 风险）
  for (const risk of (analysis.risks ?? []).filter((r) => r.severity === "HIGH")) {
    if (!risk.description || risk.description.trim().length === 0) continue;

    options.push({
      key: `professional-analysis:RISK:${risk.description.slice(0, 50)}`,
      dimension: "DEMAND_VALUE", // 默认维度
      dimensionLabel: "专业分析高风险",
      title: `风险缓解：${risk.description.slice(0, 50)}`,
      reason: `[专业分析高风险] ${risk.description}`,
      recommendation: risk.mitigation ? `缓解措施：${risk.mitigation}` : null,
      targets: [],
      affectedDimensions: [],
      costNote: "风险缓解任务不直接影响方案字段，但会影响维度评分。",
      mayMoveScore: false,
    });
  }

  return {
    product: { id: product.id, name: product.name },
    baseVersion: { id: baseVersion.id, versionTag: baseVersion.versionTag, createdAt: baseVersion.createdAt },
    options,
    note:
      options.length === 0
        ? "当前专业分析没有可转化为方案改动的建议。"
        : "采纳项只描述「改哪个字段、会影响哪些维度」，不承诺分数上升；分数变化以重评结果为准。",
  };
}

/**
 * 从专业分析推荐动作中识别字段修改建议
 *
 * 尝试从自然语言描述中提取目标字段和目标值。
 * 例如："修改目标受众为 25-35 岁办公室人群" → { field: "targetAudience", value: "25-35 岁办公室人群" }
 */
function identifyFieldFromAction(action: string): { field: ProductSpecField; value: string } | null {
  const lowerAction = action.toLowerCase();

  // 字段关键词映射
  const fieldKeywords: Record<ProductSpecField, string[]> = {
    coreIdea: ["核心创意", "核心理念", "产品理念", "核心卖点"],
    targetAudience: ["目标受众", "目标人群", "用户画像", "目标用户"],
    coreSellingPoints: ["核心卖点", "卖点", "差异化"],
    targetChannels: ["目标渠道", "渠道", "推广渠道"],
    priceExpectation: ["价格", "定价", "价格预期"],
    formSpec: ["剂型", "规格", "包装", "形式"],
    forbiddenItems: ["禁用项", "禁止", "不能"],
    targetCost: ["成本", "目标成本", "成本预期"],
  };

  // 尝试匹配字段关键词
  for (const [field, keywords] of Object.entries(fieldKeywords) as [ProductSpecField, string[]][]) {
    for (const keyword of keywords) {
      if (lowerAction.includes(keyword)) {
        // 提取关键词后面的内容作为目标值
        const regex = new RegExp(`${keyword}[：:为是\\s]+(.+?)(?:[，,。.]|$)`, "i");
        const match = action.match(regex);
        if (match && match[1]) {
          return { field, value: match[1].trim() };
        }
        // 如果没有明确的目标值，返回空值
        return { field, value: "" };
      }
    }
  }

  return null;
}
