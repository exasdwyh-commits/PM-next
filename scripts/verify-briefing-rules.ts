/**
 * 简报生成器纯函数探针（2026-09-15 分层信息设计）。
 * 不连数据库、不连模型：只验证确定性规则与诚实性约束。
 * 运行：npx tsx scripts/verify-briefing-rules.ts
 */
import {
  buildSituationBrief,
  rankDecisions,
  buildProductThemes,
} from "../src/modules/workspace/briefing";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`${cond ? "✔" : "✘"} ${label}${cond || !detail ? "" : ` — ${detail}`}`);
  if (!cond) failures++;
}

// ---------- buildSituationBrief ----------
const base = {
  scopeLabel: "我参与的项目 2 个 · 组织内产品 3 个",
  generatedAt: new Date("2026-09-15T10:00:00+08:00").toISOString(),
  decisions: [],
  decisionsTotal: 0,
  todoCount: 0,
  blockersTotal: 0,
  earliestBlockerDueAt: null as string | null,
  productsInFlight: 2,
  recentChanges: [] as { summary: string; timestamp: string }[],
  degraded: false,
  degradedNote: null as string | null,
};

const emptyBrief = buildSituationBrief(base);
check(
  "空队列不写成「全部正常」：只陈述队列为空",
  emptyBrief.paragraphs.some((p) => p.includes("没有待你决定")) &&
    !emptyBrief.paragraphs.some((p) => p.includes("一切正常") || p.includes("全部按期")),
  emptyBrief.paragraphs.join(" / ")
);

const degradedBrief = buildSituationBrief({ ...base, degraded: true, degradedNote: "最近变化读取失败" });
check(
  "降级时首句为「部分信息暂未更新」，不产生整体正常结论",
  degradedBrief.paragraphs[0].includes("部分信息暂未更新") && !degradedBrief.paragraphs.some((p) => p.includes("一切正常"))
);

const changeBrief = buildSituationBrief({
  ...base,
  recentChanges: [{ summary: "产品入库 「测试燕麦」（P-TEST-XXXX）", timestamp: base.generatedAt }],
  decisionsTotal: 2,
  todoCount: 4,
  blockersTotal: 1,
});
check(
  "有数据时包含范围、最近变化与压力概述",
  changeBrief.paragraphs.length === 3 &&
    changeBrief.paragraphs[1].includes("产品入库") &&
    changeBrief.paragraphs[2].includes("2 件事在等你决定"),
  changeBrief.paragraphs.join(" / ")
);

// ---------- rankDecisions ----------
const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const ranked = rankDecisions(
  { items: [{ id: "d1", title: "低糖燕麦 · 研究→打样门", meta: "提交人 张三", href: "/projects/p1", status: "IN_REVIEW", ownerName: "张三", dueAt: null }] },
  {
    items: [
      { id: "b1", title: "低糖燕麦：上市里程碑「渠道铺货」阻塞", meta: "上市阻塞", href: "/products/x", status: "BLOCKED", ownerName: null, dueAt: iso(2) },
      { id: "b2", title: "低糖燕麦：缺少已核实的真实市场依据", meta: "证据缺口", href: "/projects/p1", status: "OPEN", ownerName: null, dueAt: null },
    ],
  },
  {
    items: [
      { id: "t1", title: "安排打样原料备料", meta: "低糖燕麦 · TODO", href: "/projects/p1", status: "TODO", ownerName: "李四", dueAt: null },
      { id: "t2", title: "整理竞品报价", meta: "低糖燕麦 · SUBMITTED", href: "/projects/p1", status: "SUBMITTED", ownerName: "李四", dueAt: null },
    ],
  },
  "user-a"
);
// rankDecisions 返回完整排序队列；「默认 3 件」的展示预算由 UI 层应用
// （workbench-client.tsx：showAllDecisions ? 全量 : slice(0, 3)），高风险事项不因预算被丢弃。
check("rankDecisions 返回完整排序队列，展示预算由 UI 层应用", ranked.decisions.length === 5);
check("总数为完整队列，不因展示预算过滤", ranked.total === 5);
check(
  "排序：待我决策 → 有截止日阻塞 → 无截止日阻塞（阻塞先于待验收）",
  ranked.decisions[0].id === "d1" && ranked.decisions[1].id === "b1" && ranked.decisions[2].id === "b2",
  ranked.decisions.map((d) => d.id).join(",")
);
check("每件都说明为什么是现在", ranked.decisions.every((d) => d.whyNow.length > 4));
check("高风险事项保留在完整列表中（b2 在 total 内）", ranked.total === 5 && ranked.decisions.every((d) => !!d.href));

// ---------- buildProductThemes ----------
const themesUnknown = buildProductThemes({
  product: { coreIdea: null, targetAudience: null, coreSellingPoints: null, targetChannels: null, lifecycleStage: "IDEA", targetLaunchDate: null },
  scorecard: null,
  dimensions: [],
  evidenceCompleteness: { total: 0, verifiedReal: 0, unverified: 0 },
  launchPlan: null,
  nextStep: null,
});
const direction = themesUnknown.find((t) => t.key === "DIRECTION")!;
const validation = themesUnknown.find((t) => t.key === "VALIDATION")!;
const launch = themesUnknown.find((t) => t.key === "LAUNCH")!;
check("方向缺失时如实说「尚未记录」", direction.conclusion.includes("尚未记录"));
check("无分析时验证段明确「还没有任何分析结果」", validation.conclusion.includes("还没有任何分析结果"));
check("无证据不写成「无风险」", !themesUnknown.some((t) => t.conclusion.includes("无风险")));
check("无计划时上市段说明当前阶段", launch.conclusion.includes("尚未建立上市计划"));

const themesFull = buildProductThemes({
  product: {
    coreIdea: "低糖慢碳的功能燕麦",
    targetAudience: "25-40 岁控糖人群",
    coreSellingPoints: "低 GI 认证配方",
    targetChannels: "抖音自播 + 私域",
    lifecycleStage: "ANALYSIS",
    targetLaunchDate: iso(45),
  },
  scorecard: { weightedScore: 62, coverageRatio: 0.67, provisional: true },
  dimensions: [
    { dimension: "DEMAND_VALUE", score: 55, gaps: "缺目标渠道真实反馈", recommendation: "先取得目标渠道反馈", basis: "方案文字", },
    { dimension: "UNIT_ECONOMICS", score: null, gaps: null, recommendation: "录入供应商报价", basis: null },
  ],
  evidenceCompleteness: { total: 4, verifiedReal: 1, unverified: 2 },
  launchPlan: {
    status: "ACTIVE",
    approvedAt: null,
    actualLaunchedAt: null,
    milestones: [
      { title: "素材定稿", status: "DONE", dueDate: null },
      { title: "渠道铺货", status: "BLOCKED", dueDate: iso(3) },
    ],
  },
  nextStep: "先取得目标渠道反馈，再决定是否投入打样",
});
const vFull = themesFull.find((t) => t.key === "VALIDATION")!;
const lFull = themesFull.find((t) => t.key === "LAUNCH")!;
check("暂评时验证结论标注「暂评」", vFull.conclusion.includes("暂评"));
check("最重要的未知项指向单位经济性（带建议的未知维度优先）", (vFull.detail.join("") ).includes("单位经济性"), vFull.detail.join(" / "));
check("阻塞里程碑进入上市结论", lFull.conclusion.includes("1 项阻塞里程碑"));
check("分数未覆盖充分时不说「正式评定」", !themesFull.some((t) => t.conclusion.includes("正式评定")));

console.log(failures === 0 ? "\n🏆 简报规则探针全部通过" : `\n✘ ${failures} 项未通过`);
process.exit(failures === 0 ? 0 : 1);
