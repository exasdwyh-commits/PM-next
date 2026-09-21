// 纯函数：把市场信号按「主题」归纳。
// 不依赖任何 React / 运行时状态，因此可被一次性 node 脚本单独单测（见 /tmp）。
//
// 主题键取法（诚实优先，绝不补造分组）：
//   productRef 非空 → 用产品名；否则 channel 非空 → 用渠道名；二者皆空 → 归入「未归类」桶。
// 注意：绝不用 category——录入表单无此字段、全库默认 "trend"，用它会造出「全部信号都属于 trend」假分组。

export type ThemeKind = "product" | "channel" | "uncategorized";

// 主题归纳只需要这些字段；Signal 是此结构的超集，可直接传入（结构化类型兼容）。
export interface ThemeSignal {
  id: string;
  title: string;
  productRef: string | null;
  channel: string | null;
  valueTier: string | null;
  importance: number;
  collectedAt: string;
  verifyStatus: string;
  valueReason: string | null;
  sourceName: string;
}

export interface ThemeGroup {
  key: string;
  kind: ThemeKind;
  signals: ThemeSignal[];
}

// valueTier 数值越小越优先展示（high 最前，未评估 null 排最后）。
const TIER_RANK: Record<string, number> = { high: 0, normal: 1, low: 2 };
const NULL_TIER_RANK = 3;

// 主题键：productRef 优先，其次 channel，二者皆空归「未归类」。
export function themeKeyOf(s: ThemeSignal): { key: string; kind: ThemeKind } {
  if (s.productRef && s.productRef.trim()) return { key: s.productRef.trim(), kind: "product" };
  if (s.channel && s.channel.trim()) return { key: s.channel.trim(), kind: "channel" };
  return { key: "未归类", kind: "uncategorized" };
}

// 按主题键分桶；桶顺序按「信号数降序、同名按 key 字典序」排列，保证结果确定性、可复现。
export function groupSignalsByTheme(signals: ThemeSignal[]): ThemeGroup[] {
  const map = new Map<string, ThemeGroup>();
  for (const s of signals) {
    const { key, kind } = themeKeyOf(s);
    const bucket = map.get(key);
    if (bucket) bucket.signals.push(s);
    else map.set(key, { key, kind, signals: [s] });
  }
  return Array.from(map.values()).sort(
    (a, b) => b.signals.length - a.signals.length || a.key.localeCompare(b.key, "zh-Hans-CN")
  );
}

// 分组视图的渲染门槛：传入的分组 ≥ 2 组才渲染分组层，否则回退到扁平列表。
// 只统计 kind !== "uncategorized" 的组：「未归类」代表"还没有主题"，
// 把它当一张主题卡展示既不是归纳、也会挤占首屏；这些信号仍由扁平列表完整呈现。
export function shouldRenderThemeLayer(groups: ThemeGroup[]): boolean {
  return groups.filter((g) => g.kind !== "uncategorized").length >= 2;
}

// 交给界面渲染的分组：剔除「未归类」桶。
// 把这条不变式放在纯函数里（而不是散在组件里），是为了能直接被单测证明。
export function themeGroupsForDisplay(signals: ThemeSignal[]): ThemeGroup[] {
  return groupSignalsByTheme(signals).filter((g) => g.kind !== "uncategorized");
}

// 一个主题内挑最多 max 条最重要的信号。排序确定且可解释：
// 1) valueTier：high > normal > low > null；
// 2) importance 数值降序；
// 3) collectedAt 降序（越新越前）；
// 4) id 升序作最终兜底，保证完全确定性。
export function pickTopSignals(signals: ThemeSignal[], max = 3): ThemeSignal[] {
  return [...signals]
    .sort((a, b) => {
      const ra = a.valueTier ? (TIER_RANK[a.valueTier] ?? NULL_TIER_RANK) : NULL_TIER_RANK;
      const rb = b.valueTier ? (TIER_RANK[b.valueTier] ?? NULL_TIER_RANK) : NULL_TIER_RANK;
      if (ra !== rb) return ra - rb;
      if (b.importance !== a.importance) return b.importance - a.importance;
      const ta = new Date(a.collectedAt).getTime();
      const tb = new Date(b.collectedAt).getTime();
      if (tb !== ta) return tb - ta;
      return a.id.localeCompare(b.id);
    })
    .slice(0, max);
}
