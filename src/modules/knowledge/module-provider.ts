/**
 * 批次 D：知识库四模块 provider（结构化条规 + 事后回填）。
 *
 * 设计要点（改动前先读）：
 *
 * 1. **只提供结构，不预置内容。** 四个模块（合规红线 / 品类框架 / 渠道准入 / 操盘 SOP）
 *    的具体条目是领域知识，凭空写出来就是编造 —— 与全仓防编造铁律冲突。条目一律由
 *    真实来源录入（带 sourceRef），本文件只负责把它们送到合成层。
 *
 * 2. **引用标注落在 `uri` 上。** 每条命中的 `uri` 就是条目的 `sourceRef`（法规编号 /
 *    内部文件号 / URL），合成后可直接回溯，报告能标出「这句话出自哪里」。
 *
 * 3. **回填与条规并列，不覆盖。** 回填值输出为**独立的一条命中**，与对应静态条目共享
 *    同一个 `conflictGroup`（`entry:{id}`）。既有冲突机制于是会呈现
 *    「教科书值 vs 本公司实测值」两种说法，而不是让实测悄悄改写条规 ——
 *    这正是路线图说的「让系统越用越懂这家公司（不止懂教科书）」。
 *
 * 4. **`verified` 恒为 false。** 这些条目未经本轮核验，不冒充已验证来源；
 *    是否采信交给模型与 Evidence 层判断。
 *
 * 依赖方向：本文件只从 `./authority` 取权威分、从 `./router` **仅取类型**，
 * 由 router.ts 导入并注册，避免 L3 内部循环依赖。
 */
import type { KnowledgeModule, KnowledgeModuleEntry, KnowledgeBackfill } from "@prisma/client";
import type { AuthorityTier, KnowledgeResultItem } from "@/modules/kern-contracts";
import type { KnowledgeProvider } from "./router";
import { authorityScore, loadAuthorityPolicy } from "./authority";
import prisma from "@/shared/db";

/** 模块 → 知识域（与 kern-contracts 的 KNOWLEDGE_SCOPES 一一对应）。 */
export const MODULE_SCOPES: Record<KnowledgeModule, string> = {
  COMPLIANCE_REDLINE: "compliance_redline",
  CATEGORY_FRAMEWORK: "category_framework",
  CHANNEL_ACCESS: "channel_access",
  OPERATION_SOP: "operation_sop",
};

export const MODULE_LABELS: Record<KnowledgeModule, string> = {
  COMPLIANCE_REDLINE: "合规红线（能不能说、能不能卖的硬边界）",
  CATEGORY_FRAMEWORK: "品类框架（品类怎么拆、看哪些指标）",
  CHANNEL_ACCESS: "渠道准入（进各渠道要什么资质与门槛）",
  OPERATION_SOP: "操盘 SOP（打法与执行顺序）",
};

const ALL_MODULES: KnowledgeModule[] = [
  "COMPLIANCE_REDLINE",
  "CATEGORY_FRAMEWORK",
  "CHANNEL_ACCESS",
  "OPERATION_SOP",
];

const AUTHORITY_TIERS: AuthorityTier[] = ["first_party", "curated", "public", "unknown"];

/** 库里存的是字符串（避免 Prisma enum 与 TS 联合类型各自漂移），取值时收敛到白名单。 */
export function asAuthorityTier(value: string): AuthorityTier {
  return (AUTHORITY_TIERS as string[]).includes(value) ? (value as AuthorityTier) : "unknown";
}

/**
 * 极简分词：拉丁词 + 中文二字组。
 * 与 synthesis.ts 的 tokens() 同思路（那边用于去重，这里用于匹配），刻意不复用
 * —— 两处语义不同，耦合起来会互相牵制。
 */
export function queryTokens(text: string): string[] {
  const lower = text.toLowerCase();
  const latin = lower.match(/[a-z0-9_.-]{2,}/g) ?? [];
  const cjk = lower.match(/[一-龥]+/g) ?? [];
  const out: string[] = [...latin];
  for (const run of cjk) {
    if (run.length <= 2) out.push(run);
    else for (let i = 0; i + 2 <= run.length; i += 1) out.push(run.slice(i, i + 2));
  }
  return out;
}

/** 命中多少查询词。返回 0 表示完全不相关，调用方据此过滤。 */
export function matchCount(query: string, haystack: string): number {
  const tokens = queryTokens(query);
  if (!tokens.length) return 0;
  const target = haystack.toLowerCase();
  let hits = 0;
  for (const t of new Set(tokens)) if (target.includes(t)) hits += 1;
  return hits;
}

/** 回填值的人读描述。数值缺失时退回 textValue，都没有就如实说"未填数值"。 */
export function describeBackfill(b: Pick<KnowledgeBackfill, "metricKey" | "numericLow" | "numericHigh" | "numericValue" | "unit" | "textValue">): string {
  const unit = b.unit ? ` ${b.unit}` : "";
  if (b.numericLow != null && b.numericHigh != null) return `${b.metricKey} 实测区间 ${b.numericLow}–${b.numericHigh}${unit}`;
  if (b.numericValue != null) return `${b.metricKey} 实测 ${b.numericValue}${unit}`;
  if (b.textValue) return `${b.metricKey} 实测：${b.textValue}`;
  return `${b.metricKey} 有回填记录但未填数值`;
}

type EntryWithBackfills = KnowledgeModuleEntry & { backfills: KnowledgeBackfill[] };

/** 静态条目 → 合成层命中。导出以便脱离数据库单测。 */
export function entryToItem(
  entry: Pick<KnowledgeModuleEntry, "id" | "key" | "title" | "statement" | "scopeLabel" | "sourceRef" | "authorityTier" | "updatedAt">,
  opts: { module: KnowledgeModule; hits: number; policy: ReturnType<typeof loadAuthorityPolicy> }
): KnowledgeResultItem {
  const tier = asAuthorityTier(entry.authorityTier);
  return {
    scope: MODULE_SCOPES[opts.module],
    ref: `entry:${entry.id}`,
    title: entry.title,
    snippet: (entry.statement ?? entry.title).slice(0, 300),
    // 引用标注：uri 就是来源锚点，合成后可回溯
    uri: entry.sourceRef,
    capturedAt: entry.updatedAt instanceof Date ? entry.updatedAt.toISOString() : String(entry.updatedAt),
    authorityTier: tier,
    authority: authorityScore(tier, false, opts.policy),
    // provider 内可比即可，综合时会归一化
    score: Math.max(1, opts.hits * 3),
    verified: false,
    // 与它自己的回填同组 → 合成层呈现「条规 vs 实测」两种说法
    conflictGroup: `entry:${entry.id}`,
    statement: entry.statement,
  };
}

/** 回填值 → 合成层命中（与所属条目同 conflictGroup）。 */
export function backfillToItem(
  entry: Pick<KnowledgeModuleEntry, "id" | "title">,
  backfill: KnowledgeBackfill,
  opts: { module: KnowledgeModule; policy: ReturnType<typeof loadAuthorityPolicy> }
): KnowledgeResultItem {
  // 本方实测数据：权威档 first_party（权威表里它排在最前），但**未经本轮核验**，
  // 与条规同组呈现，由合成层与模型判断采信哪个。
  const tier: AuthorityTier = "first_party";
  return {
    scope: MODULE_SCOPES[opts.module],
    ref: `backfill:${backfill.id}`,
    title: `${entry.title}（本公司实测回填）`,
    snippet: describeBackfill(backfill).slice(0, 300),
    uri: backfill.sourceRef,
    capturedAt: backfill.observedAt instanceof Date ? backfill.observedAt.toISOString() : String(backfill.observedAt),
    authorityTier: tier,
    authority: authorityScore(tier, false, opts.policy),
    score: Math.max(1, 4),
    verified: false,
    conflictGroup: `entry:${entry.id}`,
    statement: describeBackfill(backfill),
  };
}

/**
 * 一批条目 → 命中列表（纯函数，可脱离数据库单测）。
 * 命中数为 0 的条目直接不返回：**没匹配上就不该出现在结果里**，
 * 凑数只会稀释置信度、让报告看起来有支撑其实没有。
 */
export function entriesToItems(
  entries: EntryWithBackfills[],
  module: KnowledgeModule,
  query: string,
  limit: number
): KnowledgeResultItem[] {
  const policy = loadAuthorityPolicy();
  const scored = entries
    .map((e) => ({
      entry: e,
      hits: matchCount(query, [e.key, e.title, e.statement ?? "", e.scopeLabel ?? ""].join(" ")),
    }))
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  const out: KnowledgeResultItem[] = [];
  for (const { entry, hits } of scored) {
    if (out.length >= limit) break;
    out.push(entryToItem(entry, { module, hits, policy }));
    // 回填紧跟所属条目，且共享 conflictGroup
    for (const b of entry.backfills ?? []) {
      if (out.length >= limit) break;
      out.push(backfillToItem(entry, b, { module, policy }));
    }
  }
  return out;
}

/**
 * 四个模块的 provider 定义。由 `router.ts` 导入并注册（本文件不反向 import router 的
 * 运行时值，避免 L3 内部循环依赖）。
 */
export const KNOWLEDGE_MODULE_PROVIDERS: KnowledgeProvider[] = ALL_MODULES.map((module) => ({
  scope: MODULE_SCOPES[module],
  label: MODULE_LABELS[module],
  search: async (ctx) => {
    // C5-A1：取消链 —— 条目取回是内存匹配前的唯一 I/O，检查一次即可。
    ctx.signal.throwIfAborted();
    const entries = await prisma.knowledgeModuleEntry.findMany({
      where: { organizationId: ctx.session.organizationId, module, deletedAt: null },
      include: { backfills: { orderBy: { observedAt: "desc" } } },
      // 条目量按模块计，全量取回再内存匹配即可；真到万级再换全文检索
      take: 200,
      orderBy: { updatedAt: "desc" },
    });
    return entriesToItems(entries as EntryWithBackfills[], module, ctx.query, ctx.limit);
  },
}));
