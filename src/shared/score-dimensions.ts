/**
 * Scorecard 维度权重与顺序（唯一来源，P0-3）
 *
 * 为什么单独放这里：这份权重原先在 `modules/product-development/scoring.ts` 定义一次，
 * 又在 `app/products/[id]/product-overview-client.tsx` 里**手抄了第二份**。
 * 两处一旦不同步，同一个产品在后端榜和前端卡片上会显示两个「综合分」，
 * 而且没人会发现——这是评分体系最不能有的错误。
 *
 * 本模块**必须保持零依赖**（与 `status-labels.ts` 同一条约束）：
 * 它会被客户端组件直接 import，一旦引入 prisma / server-only / 领域模块，
 * 客户端打包就会失败。因此这里只放纯字面量。
 *
 * 使用约定：
 * - 需要「键的联合类型」时用 `ScorecardDimension`；
 * - 需要按任意字符串查权重（前端拿到的是 API 字符串）时用 `scorecardWeight()`，
 *   不要在各页面自己 `WEIGHTS[d.dimension]`。
 */

export const SCORECARD_DIMENSIONS = [
  "DEMAND_VALUE",
  "DIFFERENTIATION",
  "UNIT_ECONOMICS",
  "COMPANY_FIT",
  "DELIVERY_FEASIBILITY",
  "LAUNCH_READINESS",
] as const;

export type ScorecardDimension = (typeof SCORECARD_DIMENSIONS)[number];

/** 起始权重（百分比，合计 100）。蓝图 §4.4 的提案值，规则版本见 scoring.ts。 */
export const SCORECARD_DIMENSION_WEIGHTS: Record<ScorecardDimension, number> = {
  DEMAND_VALUE: 25,
  DIFFERENTIATION: 20,
  UNIT_ECONOMICS: 20,
  COMPANY_FIT: 15,
  DELIVERY_FEASIBILITY: 10,
  LAUNCH_READINESS: 10,
};

/** 展示顺序（与权重表分开，顺序改动不影响权重）。 */
export const SCORECARD_DIMENSION_ORDER: ScorecardDimension[] = [
  ...SCORECARD_DIMENSIONS,
];

/**
 * 按维度键取权重。未知键返回 0 而不是抛错——
 * 界面上宁可少显示一个权重，也不能因为多了一个新维度就整页崩掉。
 */
export function scorecardWeight(dimension: string): number {
  return (
    (SCORECARD_DIMENSION_WEIGHTS as Record<string, number>)[dimension] ?? 0
  );
}
