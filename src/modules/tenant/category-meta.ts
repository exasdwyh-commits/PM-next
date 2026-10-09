/**
 * 品类外观元数据（图标 / 主色 / 渐变 / 投影）与**显示名**的唯一定价处。
 *
 * 背景：V2 把一套四分类的外观映射复制进了 20 多个 `*-rich` 组件，每个文件一份，
 * 既重复又把品类中文名写死在 `src/` 里，撞上 `tests/tenant-neutral-guard.test.ts`
 * （该守卫要求租户行业词只能存在于 `packs/`）。这里收口成一处：
 *
 * - 分类键（`regular_food` 等）可以用在 `src/`；
 * - 显示名从当前租户 pack 的 `categories.classifications` 读，pack 里没有时退回分类键；
 * - 图标 / 颜色 / 渐变属于表现层，不含行业词，留在本模块。
 *
 * 用法：`const catInfo = categoryMeta(category);` 然后 `catInfo.name` / `catInfo.color` …
 */
import { getTenantPack } from "./index";
import type { CategoryContent } from "./types";

export type CategoryKey = "regular_food" | "health_food" | "cross_border_food" | "cosmetics";

/** 兜底分类键：调用方未传或传入未知键时使用。 */
export const DEFAULT_CATEGORY: CategoryKey = "health_food";

export interface CategoryMeta {
  key: CategoryKey;
  icon: string;
  /** 对外显示名，取自租户 pack，不写在 src/ */
  name: string;
  color: string;
  gradient: string;
  shadow: string;
}

interface Presentation {
  icon: string;
  color: string;
  /** 渐变的起止色，用于卡片背景 */
  tint: [string, string];
}

/**
 * 表现层参数：与租户无关，任何 pack 都长这样。
 * `tint` 区分三套并存的配色方案（见 TINT_PRESETS），因为它们是**有意的视觉分层**：
 *   - `ui`（默认）：卡片/面板用，浅色底
 *   - `report`：报告与图表页用，另有���套浅色
 *   - `deep`：图表柱体用，同色系深浅（主色 → 深色），与前两套刻意不同
 * 三套并存是既有设计，不要为了「统一」改观感——统一属产品决策，不是重构。
 */
const PRESENTATION: Record<CategoryKey, Presentation> = {
  regular_food: { icon: "🍪", color: "#f59e0b", tint: ["#fffbeb", "#fef3c7"] },
  health_food: { icon: "💊", color: "#7c3aed", tint: ["#f5f3ff", "#ede9fe"] },
  cross_border_food: { icon: "🌍", color: "#0891b2", tint: ["#ecfeff", "#cffafe"] },
  cosmetics: { icon: "💄", color: "#db2777", tint: ["#fdf2f8", "#fce7f3"] },
};

/** 配色预设。键为分类键，值为该预设下的渐变两端色。 */
export type TintPreset = "ui" | "report" | "deep";

const TINT_PRESETS: Record<TintPreset, Record<CategoryKey, [string, string]>> = {
  // 卡片 / 面板：浅色底。全库默认值。
  ui: {
    regular_food: ["#fffbeb", "#fef3c7"],
    health_food: ["#f5f3ff", "#ede9fe"],
    cross_border_food: ["#ecfeff", "#cffafe"],
    cosmetics: ["#fdf2f8", "#fce7f3"],
  },
  // 报告 / 图表页：另一套浅色（普通食品一项与 ui 套相同）。
  report: {
    regular_food: ["#fffbeb", "#fef3c7"],
    health_food: ["#f3f0ff", "#e9d5ff"],
    cross_border_food: ["#ecfeff", "#a5f3fc"],
    cosmetics: ["#fdf2f8", "#fbcfe8"],
  },
  // 图表柱体：同色系深浅（主色 → 深色）。
  deep: {
    regular_food: ["#f59e0b", "#d97706"],
    health_food: ["#7c3aed", "#db2777"],
    cross_border_food: ["#0891b2", "#0e7490"],
    cosmetics: ["#db2777", "#7c3aed"],
  },
};

const UNKNOWN_PRESENTATION: Presentation = {
  icon: "📦",
  color: "#6b7280",
  tint: ["#f9fafb", "#f3f4f6"],
};

function shadowOf(color: string): string {
  const hex = color.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `0 8px 24px rgba(${r},${g},${b},0.15)`;
}

function isCategoryKey(value: string): value is CategoryKey {
  return Object.prototype.hasOwnProperty.call(PRESENTATION, value);
}

/**
 * 取品类外观元数据。
 *
 * @param key      分类键；未知 / 空值落到 `fallback`
 * @param fallback 兜底分类键，默认 `health_food`（与原 `CATEGORY_INFO.health_food` 行为一致）
 * @param opts.tint 配色预设，默认 `ui`。仅影响 gradient，不影响 icon/color/name。
 */
export function categoryMeta(
  key?: string | null,
  fallback: CategoryKey = DEFAULT_CATEGORY,
  opts?: { tint?: TintPreset },
): CategoryMeta {
  const resolved: CategoryKey = key && isCategoryKey(key) ? key : fallback;
  const p = PRESENTATION[resolved] ?? UNKNOWN_PRESENTATION;
  const preset = TINT_PRESETS[opts?.tint ?? "ui"] ?? TINT_PRESETS.ui;
  const tint = preset[resolved] ?? p.tint;
  return {
    key: resolved,
    icon: p.icon,
    name: categoryName(resolved),
    color: p.color,
    gradient: `linear-gradient(135deg,${tint[0]},${tint[1]})`,
    shadow: shadowOf(p.color),
  };
}

/**
 * 取该品类的营销 / 合规内容（卖点、价、成本、配方、合规措辞、话术、工具清单）。
 * 取值来自 pack，src/ 不留副本。
 *
 * @param key      分类键；未知 / 空值落到 `fallback`
 * @param fallback 兜底分类键，默认 `health_food`
 */
export function categoryContent(
  key?: string | null,
  fallback: CategoryKey = DEFAULT_CATEGORY,
): CategoryContent {
  const resolved: CategoryKey = key && isCategoryKey(key) ? key : fallback;
  // 剔除 pack JSON 里的元注释键（`_note` 等），与 tenant-soul 的「丢弃元注释」同一做法。
  const raw = getTenantPack().categoryContent ?? {};
  const all: Record<string, CategoryContent> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith("_")) continue;
    if (v && typeof v === "object") all[k] = v as CategoryContent;
  }
  const hit = all[resolved] ?? all[fallback] ?? all[DEFAULT_CATEGORY];
  if (!hit) {
    throw new Error(
      `租户包缺少品类内容：${resolved}（及兜底 ${fallback} / ${DEFAULT_CATEGORY}）。` +
        `请在 packs/<id>/domain/category-content.json 补齐。`,
    );
  }
  return hit;
}

/** 只取显示名：从当前租户 pack 读，pack 未登记该键时退回键名本身。 */
export function categoryName(key?: string | null, fallback: CategoryKey = DEFAULT_CATEGORY): string {
  const resolved: CategoryKey = key && isCategoryKey(key) ? key : fallback;
  const classifications = getTenantPack().categories.classifications;
  return classifications[resolved] ?? resolved;
}

/** 全部品类键，用于下拉框 / 遍历。 */
export function categoryKeys(): CategoryKey[] {
  return Object.keys(PRESENTATION) as CategoryKey[];
}
