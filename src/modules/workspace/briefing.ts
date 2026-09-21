/**
 * 分层信息设计 · 简报与主题文案生成器（docs/plans/2026-09-15-progressive-information-design.md）
 *
 * 硬性要求（摘要生成规则）：
 * - 纯确定性规则归纳，不调用模型，不创造因果关系。
 * - 区分事实、建议、待确认项；无记录不写成「无风险」，任务列表为空不写成「全部按期交付」。
 * - 没有截止日、影响范围或收益数据时明确「未知」，不编造。
 * - 「默认三件」是展示预算，不是业务过滤规则：完整列表始终随聚合数据返回，前端可展开。
 * - 本文件必须保持无服务端依赖（客户端可安全 type-import / import 纯函数）。
 */

import { fmtDate } from "@/shared/datetime";
import { labelProductLifecycleStage, labelScoreDimension } from "@/shared/status-labels";

// ---------------------------------------------------------------------------
// 共享类型
// ---------------------------------------------------------------------------

export interface BriefSourceItem {
  id: string;
  title: string;
  meta?: string | null;
  href?: string | null;
  status?: string | null;
  ownerName?: string | null;
  dueAt?: string | null;
}

/** 首页「需要你决定/关注」条目：说明要决定什么、为什么现在、建议动作 */
export interface BriefDecisionItem {
  id: string;
  /** 要决定什么（一句话） */
  what: string;
  /** 为什么是现在（截止日 / 依赖等待 / 无人可替代），无依据时如实说 */
  whyNow: string;
  /** 建议的下一步动作（一句话），无规则依据时为 null */
  suggestion: string | null;
  /** 对应处理入口 */
  href: string;
  /** 截止日（ISO）或 null */
  dueAt: string | null;
  /** 排序依据标签，用于解释为什么是它进前三 */
  rankReason: string;
  /**
   * 来源类别，供 UI 分栏与语义色使用；**不参与排序**（排序仍由 _rank 决定）。
   * - decision = 等我裁决的决策包
   * - blocker  = 阻塞项（证据/治理/审批/上市四类）
   * - todo     = 工作项（已提交待验收 / 进行中）
   */
  kind: "decision" | "blocker" | "todo";
  /**
   * 真实的风险类别标签，直取来源数据（阻塞项的 `meta`，如「证据缺口」）。
   * 没有可用的风险类别时为 null —— UI 不得据此补写「暂无风险」。
   */
  riskLabel: string | null;
  /** 责任人姓名（未设置为 null） */
  ownerName: string | null;
  /** 来源状态原值，供 UI 判定「待验收 / 进行中」 */
  status: string | null;
}

/** 首页整体判断输入 */
export interface BriefSituationInput {
  scopeLabel: string;
  generatedAt: string;
  decisions: BriefDecisionItem[];
  decisionsTotal: number;
  todoCount: number;
  blockersTotal: number;
  earliestBlockerDueAt: string | null;
  productsInFlight: number;
  recentChanges: { summary: string; timestamp: string }[];
  /** 数据抓取失败或部分聚合不可用时置 true，此时禁止产出「整体正常」式结论 */
  degraded?: boolean;
  degradedNote?: string | null;
}

// ---------------------------------------------------------------------------
// 首页：第一层「现在的情况」
// ---------------------------------------------------------------------------

function daysUntil(iso: string, now: Date): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
}

/**
 * 生成 2–3 句的现状段落。规则：
 * - 只描述范围、最近变化、最主要的待处理压力，不逐项播报所有计数；
 * - 无记录 ≠ 无风险：没有待办时说「没有待处理事项」，不说「一切正常」；
 * - degraded 时第一句必须是降级说明。
 */
export function buildSituationBrief(input: BriefSituationInput): { paragraphs: string[] } {
  const now = new Date(input.generatedAt);
  const paragraphs: string[] = [];

  if (input.degraded) {
    paragraphs.push(
      `部分信息暂未更新${input.degradedNote ? `（${input.degradedNote}）` : ""}。以下简报只覆盖当前可读到的数据，不代表全局结论。`
    );
  }

  // 句 1：当前范围（事实）
  paragraphs.push(`当前范围：${input.scopeLabel}。`);

  // 句 2：最近变化（事实，取最近 1 条审计摘要）
  const latestChange = input.recentChanges[0];
  if (latestChange) {
    const when = new Date(latestChange.timestamp);
    const whenText = Number.isNaN(when.getTime()) ? "最近" : fmtDate(when);
    paragraphs.push(`最近一次业务变化是${whenText}「${latestChange.summary}」。`);
  }

  // 句 3：最主要的压力（事实 + 截止时间；不推断影响）
  const pressure: string[] = [];
  if (input.decisionsTotal > 0) {
    pressure.push(`${input.decisionsTotal} 件事在等你决定`);
  }
  const blockedWithDue = input.earliestBlockerDueAt
    ? `阻塞项中最早截止的是 ${fmtDate(input.earliestBlockerDueAt)}`
    : null;
  if (input.blockersTotal > 0) {
    pressure.push(blockedWithDue ? `有 ${input.blockersTotal} 个阻塞项（${blockedWithDue}）` : `有 ${input.blockersTotal} 个阻塞项，均未设截止日`);
  }
  if (input.todoCount > 0) {
    pressure.push(`${input.todoCount} 项工作未验收`);
  }

  if (pressure.length === 0) {
    paragraphs.push("当前没有待你决定的事项，也没有阻塞项；工作项列表为空或已全部验收。");
  } else if (input.decisions[0]?.dueAt) {
    const days = daysUntil(input.decisions[0].dueAt, now);
    paragraphs.push(
      `最紧迫的是${input.decisions[0].what}${
        days !== null ? `，${days >= 0 ? `还有 ${days} 天截止` : "已过截止日"}` : ""
      }。`
    );
  } else {
    paragraphs.push(`当前需要留意：${pressure.slice(0, 2).join("，")}。`);
  }

  return { paragraphs: paragraphs.slice(0, 3) };
}

// ---------------------------------------------------------------------------
// 首页：第一层「需要你决定」排序与建议
// ---------------------------------------------------------------------------

/**
 * 优先级 = 截止时间 → 实际依赖（门禁/审批等待）→ 责任归属（是否轮到我）。
 * 不按数据类型机械排列：三类来源先归一成统一结构再比较。
 */
export function rankDecisions(
  decisions: { items: BriefSourceItem[] } & Record<string, unknown>,
  blockers: { items: BriefSourceItem[] } & Record<string, unknown>,
  todos: { items: BriefSourceItem[] } & Record<string, unknown>,
  userId: string
): { decisions: BriefDecisionItem[]; total: number } {
  const now = new Date();
  const ranked: (BriefDecisionItem & { _rank: number[] })[] = [];

  // 1. 待我决策：我拍板后流程才能继续 → 依赖等待，权重最高
  for (const it of decisions.items) {
    ranked.push({
      id: it.id,
      what: it.title,
      whyNow: it.ownerName ? `提交人 ${it.ownerName} 在等你的裁决，流程暂停于此` : "决策包已提交，流程暂停等待裁决",
      suggestion: "打开决策包审阅依据后批准或要求修改",
      href: it.href || "#",
      dueAt: it.dueAt ?? null,
      rankReason: "等你拍板，流程暂停",
      kind: "decision",
      riskLabel: null,
      ownerName: it.ownerName ?? null,
      status: it.status ?? null,
      _rank: [0, it.dueAt ? new Date(it.dueAt).getTime() : Number.MAX_SAFE_INTEGER],
    });
  }

  // 2. 阻塞项：阻断产品推进，有截止日的更紧
  for (const it of blockers.items) {
    const days = it.dueAt ? daysUntil(it.dueAt, now) : null;
    ranked.push({
      id: it.id,
      what: it.title,
      whyNow: days !== null ? `阻塞已影响上市时间线，截止 ${fmtDate(it.dueAt!)}` : "阻塞未解除前，该产品无法推进到下一阶段",
      suggestion: it.meta === "审批阻塞" ? "按修改要求更新决策包并重新提交" : "打开对应对象补齐缺失依据",
      href: it.href || "#",
      dueAt: it.dueAt ?? null,
      rankReason: days !== null ? `阻塞 · 截止 ${fmtDate(it.dueAt!)}` : "阻塞产品推进",
      kind: "blocker",
      // 阻塞项的风险类别由服务端在 meta 里给出（证据缺口 / 治理缺口 / 审批阻塞 / 上市阻塞），
      // 这里是**直取**而不是推断；缺失时保持 null。
      riskLabel: it.meta ?? null,
      ownerName: it.ownerName ?? null,
      status: it.status ?? null,
      _rank: [1, it.dueAt ? new Date(it.dueAt).getTime() : Number.MAX_SAFE_INTEGER],
    });
  }

  // 3. 待验收工作项（SUBMITTED 优先于纯 TODO）
  for (const it of todos.items) {
    const isSubmitted = it.status === "SUBMITTED";
    ranked.push({
      id: it.id,
      what: it.title,
      whyNow: isSubmitted ? "成果已提交，等待验收后才能关闭" : "进行中的工作项，按计划推进即可",
      suggestion: isSubmitted ? "查看提交内容并验收或退回" : null,
      href: it.href || "#",
      dueAt: it.dueAt ?? null,
      rankReason: isSubmitted ? "成果待验收" : "进行中工作项",
      kind: "todo",
      // 工作项的 meta 是「项目名 · 状态」而非风险类别，故此处不填风险标签。
      riskLabel: null,
      ownerName: it.ownerName ?? null,
      status: it.status ?? null,
      _rank: [2, it.dueAt ? new Date(it.dueAt).getTime() : Number.MAX_SAFE_INTEGER],
    });
  }

  ranked.sort((a, b) => a._rank[0] - b._rank[0] || a._rank[1] - b._rank[1]);
  // 注意：「默认三件」是展示预算，由调用方切片展示；这里必须返回完整排序队列，
  // 否则「查看全部」无数据可展，会丢弃高风险事项（验收不通过项）。
  return {
    decisions: ranked.map(({ _rank, ...rest }) => rest),
    total: ranked.length,
  };
}

// ---------------------------------------------------------------------------
// 产品详情：第二层「按主题了解」三段
// ---------------------------------------------------------------------------

export interface ProductThemeInput {
  product: {
    coreIdea: string | null;
    targetAudience: string | null;
    coreSellingPoints: string | null;
    targetChannels: string | null;
    lifecycleStage: string;
    targetLaunchDate: string | null;
  };
  scorecard: { weightedScore: number | null; coverageRatio: number; provisional: boolean } | null;
  dimensions: { dimension: string; score: number | null; gaps: string | null; recommendation: string | null; basis: string | null }[];
  evidenceCompleteness: { total: number; verifiedReal: number; unverified: number };
  launchPlan: { status: string; approvedAt: string | null; actualLaunchedAt: string | null; milestones: { title: string; status: string; dueDate: string | null }[] } | null;
  nextStep: string | null;
}

export interface ProductThemeSection {
  key: "DIRECTION" | "VALIDATION" | "LAUNCH";
  title: string;
  /** 一句可读结论（事实层面） */
  conclusion: string;
  /** 最多两行说明 */
  detail: string[];
  /** 展开后跳转的页签 key */
  tabKey: string;
  /** 结论性质标注：事实 / 待确认 */
  nature: "fact" | "pending" | "unknown";
}

/** 三段主题：产品方向 / 验证进展 / 上市安排。每段一句结论 + 最多两行说明。 */
export function buildProductThemes(input: ProductThemeInput): ProductThemeSection[] {
  const p = input.product;

  // ---- 产品方向 ----
  const directionParts: string[] = [];
  if (p.targetAudience) directionParts.push(`面向${p.targetAudience}`);
  if (p.coreSellingPoints) directionParts.push(`主打「${p.coreSellingPoints}」`);
  if (p.targetChannels) directionParts.push(`走${p.targetChannels}`);

  const direction: ProductThemeSection = {
    key: "DIRECTION",
    title: "产品方向",
    conclusion: p.coreIdea
      ? directionParts.length > 0
        ? p.coreIdea
        : `方向已记录：${p.coreIdea}`
      : "方向尚未记录：还没有一句话想法，无法判断产品要为谁解决什么问题。",
    detail: directionParts.length > 0 ? [directionParts.join("；") + "。"] : ["人群、卖点、渠道均未填写。建议先在方案中补齐这三项，方向判断才有依据。"],
    tabKey: "version",
    nature: p.coreIdea && directionParts.length >= 2 ? "fact" : "pending",
  };

  // ---- 验证进展 ----
  const rated = input.dimensions.filter((d) => d.score !== null);
  const unknownDims = input.dimensions.filter((d) => d.score === null);
  const ev = input.evidenceCompleteness;

  let validationConclusion: string;
  let validationNature: ProductThemeSection["nature"];
  if (input.scorecard === null) {
    validationConclusion = "还没有任何分析结果，无法判断哪些假设已有依据。";
    validationNature = "unknown";
  } else if (rated.length === 0) {
    validationConclusion = "分析已运行，但所有维度都缺依据，暂无可信判断。";
    validationNature = "unknown";
  } else if (input.scorecard.provisional) {
    validationConclusion = `初步判断已形成（暂评，覆盖率 ${Math.round(input.scorecard.coverageRatio * 100)}%），还不能作为完整评分使用。`;
    validationNature = "pending";
  } else {
    validationConclusion = `多数判断已有依据（覆盖率 ${Math.round(input.scorecard.coverageRatio * 100)}%），规则合成为非暂评结果。`;
    validationNature = "fact";
  }

  // 最重要的未知项：优先带建议的未知维度 → 有缺口的已评维度
  const unknownWithRec = unknownDims.find((d) => d.recommendation);
  const gapDim = input.dimensions.find((d) => d.gaps);
  const mostImportantUnknown = unknownWithRec ?? (unknownDims[0] ?? gapDim ?? null);
  const unknownLine = mostImportantUnknown
    ? `最重要的未知项是「${labelScoreDimension(mostImportantUnknown.dimension)}」：${mostImportantUnknown.gaps ?? mostImportantUnknown.recommendation ?? "尚无依据"}。`
    : ev.total === 0
      ? "还没有录入任何真实证据；当前判断全部来自方案文字，未经过市场验证。"
      : null;

  const validation: ProductThemeSection = {
    key: "VALIDATION",
    title: "验证进展",
    conclusion: validationConclusion,
    detail: [
      `已核实真实证据 ${ev.verifiedReal} 条（共 ${ev.total} 条${ev.unverified > 0 ? `，其中 ${ev.unverified} 条待核验` : ""}）。`,
      ...(unknownLine ? [unknownLine] : []),
    ],
    tabKey: "validation",
    nature: validationNature,
  };

  // ---- 上市安排 ----
  const plan = input.launchPlan;
  let launchConclusion: string;
  let launchNature: ProductThemeSection["nature"] = "fact";
  if (!plan) {
    launchConclusion = "尚未建立上市计划；当前处于「" + labelProductLifecycleStage(p.lifecycleStage) + "」阶段。";
    launchNature = "pending";
  } else if (plan.actualLaunchedAt) {
    launchConclusion = `已于 ${fmtDate(plan.actualLaunchedAt)} 确认上市。`;
  } else if (plan.approvedAt) {
    launchConclusion = "计划已获旧机制批准（准备就绪），等待确认实际上市；非正式 G3 授权。";
    launchNature = "pending";
  } else {
    const blocked = plan.milestones.filter((m) => m.status === "BLOCKED");
    const pending = plan.milestones.filter((m) => m.status !== "DONE");
    launchConclusion =
      blocked.length > 0
        ? `上市推进被 ${blocked.length} 项阻塞里程碑拦住。`
        : pending.length > 0
          ? `上市推进中，还有 ${pending.length} 项准备工作未完成。`
          : "准备工作已完备，等待放行审批。";
    launchNature = blocked.length > 0 ? "pending" : "fact";
  }

  const ownerLine = input.nextStep ? `当前建议动作：${input.nextStep}` : null;
  const dueLine = p.targetLaunchDate ? `目标上市日 ${fmtDate(p.targetLaunchDate)}。` : "目标上市日未设置。";

  const launch: ProductThemeSection = {
    key: "LAUNCH",
    title: "上市安排",
    conclusion: launchConclusion,
    detail: [dueLine, ...(ownerLine ? [ownerLine] : [])],
    tabKey: "launch",
    nature: launchNature,
  };

  return [direction, validation, launch];
}
