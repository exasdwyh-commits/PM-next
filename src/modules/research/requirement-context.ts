export const REQUIREMENT_CONTEXT_VERSION = "requirement-context/v2" as const;

export interface RequirementProductContext {
  name?: string | null;
  coreIdea?: string | null;
  targetAudience?: string | null;
  coreSellingPoints?: string | null;
  targetChannels?: string | null;
  priceExpectation?: string | null;
  formSpec?: string | null;
  forbiddenItems?: string | null;
}

export interface BuildRequirementContextInput {
  question?: string | null;
  projectTarget?: string | null;
  projectConstraints?: string | null;
  product?: RequirementProductContext | null;
  versionSpecs?: unknown;
}

export interface FrozenRequirementContext {
  version: typeof REQUIREMENT_CONTEXT_VERSION;
  productName: string | null;
  requirementText: string;
}

function normalizedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function specValue(specs: unknown, key: string): string | null {
  if (!specs || typeof specs !== "object" || Array.isArray(specs)) return null;
  return normalizedString((specs as Record<string, unknown>)[key]);
}

/**
 * 将散落在 Project / Product / ProductVersion / 本轮研究问题里的需求合并成一个冻结文本。
 *
 * 去重按“原始值”而不是带标签文本，避免同一条核心想法同时存在 Product 与 Version 时被注入两次。
 * 标签用于给规则解析器保留上下文，例如“价格预期：1999元半年套餐”。
 */
export function buildRequirementContext(
  input: BuildRequirementContextInput
): FrozenRequirementContext {
  const seen = new Set<string>();
  const lines: string[] = [];

  const add = (label: string, value: unknown) => {
    const text = normalizedString(value);
    if (!text) return;
    const key = text.replace(/\s+/g, " ");
    if (seen.has(key)) return;
    seen.add(key);
    lines.push(`${label}：${text}`);
  };

  add("研究问题", input.question);
  add("项目目标", input.projectTarget);
  add("项目约束", input.projectConstraints);

  const product = input.product ?? null;
  add("产品核心想法", product?.coreIdea);
  add("目标人群", product?.targetAudience);
  add("核心卖点", product?.coreSellingPoints);
  add("目标渠道", product?.targetChannels);
  add("价格预期", product?.priceExpectation);
  add("剂型规格", product?.formSpec);
  add("禁止项", product?.forbiddenItems);

  // 兼容版本级覆盖：只补 Product 未提供或与 Product 不同的信息。
  add("版本核心想法", specValue(input.versionSpecs, "coreIdea"));
  add("版本核心卖点", specValue(input.versionSpecs, "coreSellingPoints"));
  add("版本目标渠道", specValue(input.versionSpecs, "targetChannels"));
  add("版本价格预期", specValue(input.versionSpecs, "priceExpectation"));
  add("版本剂型规格", specValue(input.versionSpecs, "formSpec"));
  add("版本禁止项", specValue(input.versionSpecs, "forbiddenItems"));

  return {
    version: REQUIREMENT_CONTEXT_VERSION,
    productName: normalizedString(product?.name),
    requirementText: lines.join("\n"),
  };
}

export function readFrozenRequirementContext(
  scopeSnapshotJson: unknown
): FrozenRequirementContext | null {
  if (!scopeSnapshotJson) return null;
  try {
    const parsed =
      typeof scopeSnapshotJson === "string"
        ? (JSON.parse(scopeSnapshotJson) as Record<string, unknown>)
        : scopeSnapshotJson && typeof scopeSnapshotJson === "object" && !Array.isArray(scopeSnapshotJson)
          ? (scopeSnapshotJson as Record<string, unknown>)
          : null;
    if (!parsed) return null;
    const candidate = parsed.requirementContext;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const ctx = candidate as Record<string, unknown>;
    if (
      ctx.version !== REQUIREMENT_CONTEXT_VERSION ||
      typeof ctx.requirementText !== "string" ||
      ctx.requirementText.trim().length === 0
    ) {
      return null;
    }
    return {
      version: REQUIREMENT_CONTEXT_VERSION,
      productName: normalizedString(ctx.productName),
      requirementText: ctx.requirementText,
    };
  } catch {
    return null;
  }
}
