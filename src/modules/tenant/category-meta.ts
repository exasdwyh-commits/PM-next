/**
 * 品类外观元数据（图标 / 主色 / 渐变 / 投影）与**显示名**的唯一定价处。
 *
 * 背景：V2 把一套四分类的外观映射复制进了 20 多个 `*-rich` 组件，每个文件一份，
 * 既重复又把品类中文名写死在 `src/` 里，撞上 `tests/tenant-neutral-guard.test.ts`
 * （该守卫要求租户行业词只能存在于 `packs/`）。这里收口成一处。
 *
 * ⚠️ 2026-10-09 第二次修正：原先 `PRESENTATION` / `TINT_PRESETS` /
 * `DEFAULT_CATEGORY` 三者**都硬编码在本模块里**（含 4 个品类键、配色与兜底键）。
 * 建第二个 pack（pet-food）时实测发现：这是**结构性租户假设**——
 * 键名与配色都绑定某个行业，且不含任何行业词，**词表守卫永远抓不到**，
 * 但换租户必然要改 `src/`。故全部下沉到 pack 的 `domain/category-content.json`：
 * - 分类键（`regular_food` / `dry_food` …）由 pack 定义；
 * - 显示名从 `categories.classifications` 读；
 * - 图标 / 颜色 / 渐变 / 投影从 `categoryContent.<key>` 读；
 * - 兜底键从 `categoryContent.defaultKey` 读。
 *
 * 用法：`const catInfo = categoryMeta(category);` 然后 `catInfo.name` / `catInfo.color` …
 */
import { getTenantPack } from "./index";
import type { CategoryContent } from "./types";

/**
 * 品类键。**不设联合类型** —— 联合类型等于把某个租户的分类写死在 src/，
 * 那正是本次要消除的东西。取值约束由 pack 自身保证（读不到会明确报错）。
 */
export type CategoryKey = string;

/** 配色预设名。`ui` 是全库默认，另两套是既有的视觉分层（报告页 / 图表柱体）。 */
export type TintPreset = "ui" | "report" | "deep";

export interface CategoryMeta {
  key: CategoryKey;
  icon: string;
  /** 对外显示名，取自租户 pack，不写在 src/ */
  name: string;
  color: string;
  gradient: string;
  shadow: string;
}

function packContentMap(): Record<string, CategoryContent> {
  // 剔除 pack JSON 里的元注释键（`_note` 等），与 tenant-soul 的「丢弃元注释」同一做法。
  const raw = getTenantPack().categoryContent ?? {};
  const out: Record<string, CategoryContent> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith("_")) continue;
    if (v && typeof v === "object") out[k] = v as CategoryContent;
  }
  return out;
}

/** 当前 pack 的全部品类键（顺序即 pack 中定义的顺序）。 */
export function categoryKeys(): CategoryKey[] {
  return Object.keys(packContentMap());
}

/** 当前 pack 声明的兜底品类键；pack 未声明时退回第一个已定义品类。 */
export function defaultCategoryKey(): CategoryKey {
  const all = packContentMap();
  const declared = (getTenantPack().categoryContent as Record<string, unknown> | undefined)?.defaultKey;
  if (typeof declared === "string" && all[declared]) return declared;
  return categoryKeys()[0] ?? "";
}

function contentOf(key?: string | null, fallback?: string): CategoryContent {
  const all = packContentMap();
  const fb = fallback ?? defaultCategoryKey();
  const hit = (key && all[key]) || all[fb] || all[categoryKeys()[0] ?? ""];
  if (!hit) {
    throw new Error(
      `租户包「${getTenantPack().tenant.id}」缺少品类内容：${key}（及兜底 ${fb}）。` +
        `请在 packs/<id>/domain/category-content.json 补齐。`,
    );
  }
  return hit;
}

/**
 * 取品类外观元数据。
 *
 * @param key      分类键；未知 / 空值落到 `fallback`，再落到 pack 的 `defaultKey`
 * @param fallback 兜底分类键；不传则用 pack 自带的 `defaultKey`
 * @param opts.tint 配色预设，默认 `ui`。仅影响 gradient，不影响 icon/color/name。
 */
export function categoryMeta(
  key?: string | null,
  fallback?: string,
  opts?: { tint?: TintPreset },
): CategoryMeta {
  const all = packContentMap();
  const fb = fallback ?? defaultCategoryKey();
  // resolved 必须是「实际取到内容的那个键」，不能是传入的原始 key ——
  // 未知键会落到兜底，此时 meta.key 若仍报原值，调用方会拿到一个不存在的键。
  const resolvedKey = (key && all[key]) ? key : fb;
  const c = contentOf(key, fallback);
  const tint = c.tints?.[opts?.tint ?? "ui"] ?? c.gradient;
  return {
    key: resolvedKey,
    icon: c.icon,
    name: categoryName(resolvedKey),
    color: c.color,
    gradient: tint,
    shadow: c.shadow,
  };
}

/** 只取显示名：从当前租户 pack 读，pack 未登记该键时退回分类键本身。 */
export function categoryName(key?: string | null, fallback?: string): string {
  const resolved = key || fallback || defaultCategoryKey();
  const classifications = getTenantPack().categories.classifications;
  return classifications[resolved] ?? resolved;
}

/**
 * 取该品类的营销 / 合规内容（卖点、价、成本、配方、合规措辞、话术、工具清单）。
 * 取值来自 pack，src/ 不留副本。
 */
export function categoryContent(
  key?: string | null,
  fallback?: string,
): CategoryContent {
  return contentOf(key, fallback);
}