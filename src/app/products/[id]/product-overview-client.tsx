"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/app-shell";
import CollapsibleList from "@/components/collapsible-list";
import { Badge, Empty, KV, Panel, Tabs, Thinking, cx } from "@/components/ui";
import Icon from "@/components/icons";
import { ProgressRing, ScoreBar } from "@/components/viz";
import RevisionPanel from "./revision-panel";
import LaunchTab from "./launch-tab";
import CostCalculator from "./cost-calculator";
import ChannelRoutesPanel from "./channel-routes";
import { buildProductThemes, type ProductThemeInput } from "@/modules/workspace/briefing";
import { fmtDate, fmtDateTime } from "@/shared/datetime";
import {
  AutomationTraceList,
  type AutomationTraceView,
} from "@/components/automation-trace";
import {
  labelProjectStage,
  labelEvidenceVerifyStatus,
  labelValidationStatus,
  labelAuditAction,
  PRODUCT_SPEC_FIELD_LABELS,
  labelProductLifecycleStage,
  labelScoreDimension,
} from "@/shared/status-labels";

/**
 * 产品总览（2026-09-15 分层信息设计 · 第二层「按主题了解」样板页）
 *
 * 结构：紧凑头部（名称/阶段/负责人为主，版本与日期为次级）→ 三段主题
 * （产品方向 / 验证进展 / 上市安排，各一段结论 + ≤2 行说明 + 一个展开入口）
 * → 六个业务页签作为深入工作入口保留。
 *
 * 与旧版差异：删除总览中的重复评分区、重复推荐动作条、全量定义字段与空里程碑面板；
 * 这些内容下沉到主题详情与对应页签，数据不删除。总览首屏不再出现 JSON 与评分明细。
 */

const WEIGHTS: Record<string, number> = {
  DEMAND_VALUE: 25,
  DIFFERENTIATION: 20,
  UNIT_ECONOMICS: 20,
  COMPANY_FIT: 15,
  DELIVERY_FEASIBILITY: 10,
  LAUNCH_READINESS: 10,
};

type TabKey = "overview" | "analysis" | "version" | "channel" | "cost" | "validation" | "launch";

const NATURE_BADGE: Record<string, { tone: "ok" | "warn" | "neutral"; label: string }> = {
  fact: { tone: "ok", label: "已有依据" },
  pending: { tone: "warn", label: "待确认" },
  unknown: { tone: "neutral", label: "暂无依据" },
};

/**
 * 分析运行方式（AnalysisRun.runMode）→ 如实中文。
 * MVQ 标注：能力边界必须写在结论旁边，不能让使用者以为「分数是模型算出来的」。
 */
const RUN_MODE_LABEL: Record<string, string> = {
  MANUAL: "确定性规则（未调用模型）",
  TEST_STUB: "测试桩（非真实结果）",
  AUTOMATED: "自动任务（未调用模型）",
  LLM: "模型辅助生成",
};

/**
 * 分析执行步骤：与「确定性规则合成」的实际链路一致（读字段 → 校验证据 → 六维打分 → 推缺口）。
 * 这是「会做什么」的说明，不是进度条；不标已完成、不画百分比。
 */
const ANALYSIS_STEPS = [
  "读取当前版本的方案字段",
  "校验证据的核实状态与真实 / 演示属性",
  "对六个维度打分并计算覆盖率",
  "推导缺口、假设与下一步建议",
];

export default function ProductOverviewClient({
  overview,
  automationTraces,
  currentSession,
  runtime,
}: {
  overview: any;
  automationTraces: AutomationTraceView[];
  currentSession: { userName: string; userEmail: string };
  runtime: { tone: "ok" | "warn" | "neutral"; label: string; detail: string };
}) {
  const router = useRouter();
  const [tab, setTab] = React.useState<TabKey>("overview");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  // 纠错区默认收起：它是「结论不对时」的备选路径，不该在常态下占版面。
  const [showFix, setShowFix] = React.useState(false);

  // 变更审计折叠：默认展示最近 8 条，其余由 CollapsibleList「查看全部 / 收起」展开。
  const CHANGES_PREVIEW_COUNT = 8;

  const handleTabChange = (nextTab: TabKey) => {
    setTab(nextTab);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", nextTab);
      window.history.replaceState(null, "", url.toString());
    }
  };

  React.useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const urlTab = params.get("tab") as TabKey | null;
      if (urlTab && ["overview", "analysis", "version", "channel", "cost", "validation", "launch"].includes(urlTab)) {
        setTab(urlTab);
      }
    }
  }, []);

  const p = overview.product;
  const dims: any[] = overview.dimensions ?? [];
  const scorecard = overview.scorecard;
  const plan = overview.launchPlan;

  // ── TASK-012: 已保存的成本情景 ──
  const [savedScenarios, setSavedScenarios] = React.useState<any[]>([]);
  React.useEffect(() => {
    if (tab === "cost" && p?.id) {
      fetch(`/api/products/${p.id}/cost-scenarios`)
        .then((r) => (r.ok ? r.json() : { scenarios: [] }))
        .then((d) => setSavedScenarios(d.scenarios ?? []))
        .catch(() => setSavedScenarios([]));
    }
  }, [tab, p?.id]);

  const handleSaveScenario = async (scenario: {
    scenarioName: string;
    costInput: any;
    sourceStatus: string;
    unit: string;
    currency: string;
    expenseBase: string;
  }) => {
    const res = await fetch(`/api/products/${p.id}/cost-scenarios`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...scenario, workItemId: p.projects?.[0]?.id }),
    });
    if (!res.ok) throw new Error("Save failed");
    // 刷新情景列表
    const d = await fetch(`/api/products/${p.id}/cost-scenarios`).then((r) => r.json());
    setSavedScenarios(d.scenarios ?? []);
  };

  // 派生量集中在最前：下面「产品简报」「分析结论」两处都要用，
  // 若把声明留在各自的渲染段里，会出现 TDZ（声明前引用）导致整页白屏。
  const rated = dims.filter((d) => d.score !== null);
  const worst = rated.length > 0 ? rated.reduce((a, b) => ((a.score ?? 0) <= (b.score ?? 0) ? a : b)) : null;
  const unknownDims = dims.filter((d) => d.score === null);

  // 结论的「运行口径」与「依据口径」：均取服务端真实字段，不另算、不补默认值。
  const latestRun = overview.latestRun ?? null;
  const allEvidences: any[] = p.projects.flatMap((proj: any) => proj.evidences || []);
  const evidenceTotal: number = overview.evidenceCompleteness.total;
  const evidenceVerified: number = overview.evidenceCompleteness.verifiedReal;

  const runAnalysis = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/products/${p.id}/analyses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "分析失败");
      setMsg({ tone: "ok", text: "分析已完成（规则合成，未调用模型），正在刷新…" });
      router.refresh();
    } catch (e: any) {
      setMsg({ tone: "danger", text: e.message || "分析失败" });
    } finally {
      setBusy(false);
    }
  };

  const themeInput: ProductThemeInput = {
    product: {
      coreIdea: p.coreIdea ?? null,
      targetAudience: p.targetAudience ?? null,
      coreSellingPoints: p.coreSellingPoints ?? null,
      targetChannels: p.targetChannels ?? null,
      lifecycleStage: p.lifecycleStage,
      targetLaunchDate: p.targetLaunchDate ?? null,
    },
    scorecard: scorecard
      ? {
          weightedScore: scorecard.weightedScore,
          coverageRatio: scorecard.coverageRatio,
          provisional: scorecard.provisional,
        }
      : null,
    dimensions: dims.map((d) => ({
      dimension: d.dimension,
      score: d.score ?? null,
      gaps: d.gaps ?? null,
      recommendation: d.recommendation ?? null,
      basis: d.basis ?? null,
    })),
    evidenceCompleteness: overview.evidenceCompleteness,
    launchPlan: plan
      ? {
          status: plan.status,
          approvedAt: plan.approvedAt ?? null,
          actualLaunchedAt: plan.actualLaunchedAt ?? null,
          milestones: (plan.milestones ?? []).map((m: any) => ({
            title: m.title,
            status: m.status,
            dueDate: m.dueDate ?? null,
          })),
        }
      : null,
    nextStep: overview.nextStep ?? null,
  };
  const themes = buildProductThemes(themeInput);

  // ── 第二层：三段主题（每段：一句结论 + ≤2 行说明 + 展开入口） ──
  //
  // 第一层是「产品简报」：只回答三件事 —— 现在能不能判断、最大风险是什么、下一步做什么。
  // 刻意不在这里显示具体分数：脱离依据解释的分数会让人以为精确，实际只会制造误判。
  const briefJudgement = !scorecard
    ? "还没有分析结论。先运行一次分析，才能判断这个产品值不值得继续投入。"
    : scorecard.provisional || scorecard.coverageRatio < 0.8
      ? `目前判断尚不完整：六个维度里只有 ${rated.length} 个有依据，覆盖率 ${Math.round(scorecard.coverageRatio * 100)}%。缺依据的部分不代表没问题，只代表还不知道。`
      : `六个维度已有 ${rated.length} 个有依据（覆盖率 ${Math.round(scorecard.coverageRatio * 100)}%），当前判断可以支撑这一阶段继续推进。`;

  const briefRisk =
    overview.risks.length > 0
      ? overview.risks[0].text
      : worst?.gaps
        ? `${labelScoreDimension(worst.dimension)}：${worst.gaps}`
        : "暂未发现明确缺陷；但证据不足本身也是风险，上线前仍需真实市场验证。";

  const briefAction = overview.nextStep || "暂无明确的下一步建议；补充方案字段或真实证据后再运行分析。";

  const overviewTab = (
    <div className="hermes-stack" style={{ gap: 16 }}>
      {p.projects?.[0]?.id ? (
        <Link href={`/projects/${p.projects[0].id}`} className="hermes-product-execution-strip">
          <div>
            <span>当前执行</span>
            <strong>{p.projects[0].title}</strong>
            <small>{labelProjectStage(p.projects[0].stage)} · 进入工作区查看 AI 研发、任务、证据与决策</small>
          </div>
          <span className="hermes-primary-btn hermes-btn-sm">
            继续推进
            <Icon name="arrow" size={14} />
          </span>
        </Link>
      ) : (
        <Link
          href={`/muse?product=${p.id}&query=${encodeURIComponent("我想启动这个产品的一轮完整研发。请先根据当前产品资料整理研发 Brief，并告诉我还缺哪些输入。")}`}
          className="hermes-product-execution-strip"
        >
          <div>
            <span>下一步</span>
            <strong>让 Kern 启动产品研发</strong>
            <small>先整理研发 Brief，再进入专业研究、独立 QA 与管理报告流程</small>
          </div>
          <span className="hermes-primary-btn hermes-btn-sm">
            开始研发
            <Icon name="arrow" size={14} />
          </span>
        </Link>
      )}

      <section className="hermes-brief-page" style={{ maxWidth: "none" }}>
        <h2 className="hermes-brief-section-title">产品简报</h2>
        <div className="hermes-brief-paragraphs">
          <p className="hermes-brief-para">{briefJudgement}</p>
          <p className="hermes-brief-para">
            <span className="hermes-brief-why-label">最大风险</span>
            {briefRisk}
          </p>
          <p className="hermes-brief-para">
            <span className="hermes-brief-why-label">推荐动作</span>
            {briefAction}
          </p>
        </div>
        {/* 推荐动作必须就地可点：简报既然说「下一步先运行分析」，按钮就得在这里。
            原先按钮只存在于「分析与评分」页签，结论与动作脱节，用户要自己找。
            空态不只给一个按钮：另外两个真实起点并列在同一条动作条里（避免「空白提示焦虑」）。 */}
        {!scorecard && (
          <>
            <div className="hermes-ai-actions">
              <button className="hermes-primary-btn hermes-btn-sm" onClick={runAnalysis} disabled={busy}>
                <Icon name="play" size={13} />
                {busy ? "分析中…" : "运行首次分析"}
              </button>
              <button
                type="button"
                className="hermes-ghost-btn hermes-btn-sm"
                onClick={() => handleTabChange("version")}
                disabled={busy}
              >
                <Icon name="edit" size={13} />
                先补方案字段
              </button>
              <button
                type="button"
                className="hermes-ghost-btn hermes-btn-sm"
                onClick={() => handleTabChange("validation")}
                disabled={busy}
              >
                <Icon name="shield" size={13} />
                先录入真实证据
              </button>
            </div>
            <p className="hermes-note" style={{ marginTop: 10 }}>
              三者不冲突：先补字段或先录证据，再跑一轮，覆盖率会上升。未提供的字段保持未知，不会被补造数值。
            </p>
          </>
        )}
        {busy && (
          <Thinking label="正在按确定性规则重跑分析…" hint="本次执行的步骤（不调用模型）" steps={ANALYSIS_STEPS} />
        )}
        {msg && (
          <div className={cx("hermes-banner", msg.tone === "ok" ? "is-ok" : "is-danger")} style={{ marginTop: 10 }}>
            {msg.text}
          </div>
        )}
      </section>

      <details className="hermes-details">
        <summary style={{ fontWeight: 600, padding: "4px 0" }}>
          查看 Kern 自动化记录（{automationTraces.length}）
        </summary>
        <div style={{ marginTop: 10 }}>
          <AutomationTraceList
            traces={automationTraces}
            emptyText="当前产品还没有由产品版本或已核实证据触发的自动化记录。"
          />
        </div>
      </details>

      <hr className="hermes-brief-divider" />

      <div className="hermes-themes">
        {themes.map((t) => (
          <section key={t.key} className="hermes-theme-section">
            <div className="hermes-theme-head">
              <h2 className="hermes-theme-title">{t.title}</h2>
              <Badge tone={NATURE_BADGE[t.nature].tone}>{NATURE_BADGE[t.nature].label}</Badge>
            </div>
            <p className="hermes-theme-conclusion">{t.conclusion}</p>
            <div className="hermes-theme-detail">
              {t.detail.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
            <button type="button" className="hermes-ghost-btn" onClick={() => handleTabChange(t.tabKey as TabKey)}>
              展开「{t.title}」详情
              <Icon name="arrow" size={13} />
            </button>
          </section>
        ))}
      </div>

      <details className="hermes-details">
        <summary style={{ fontWeight: 600, padding: "4px 0" }}>
          变更审计与历史留痕（最近 {overview.recentChanges.length} 条）
        </summary>
        <div style={{ marginTop: 10 }}>
          {overview.recentChanges.length === 0 ? (
            <Empty>还没有审计记录。对产品执行受治理的修改、审批或自动化动作后，会在这里留下可追溯记录。</Empty>
          ) : (
            <>
              <CollapsibleList
                items={overview.recentChanges}
                previewCount={CHANGES_PREVIEW_COUNT}
                listClassName="hermes-timeline"
                renderItem={(e: any) => (
                  <div key={e.id} className="hermes-row">
                    <div className="hermes-row-head">
                      <span className="hermes-row-title">{labelAuditAction(e.action)}</span>
                      <span className="muted-line">{fmtDateTime(e.timestamp ?? e.createdAt)}</span>
                    </div>
                    <div className="hermes-row-meta">
                      <span>{e.summary}</span>
                      {e.actor?.name && <span>操作人 {e.actor.name}</span>}
                    </div>
                  </div>
                )}
              />
            </>
          )}
        </div>
      </details>
    </div>
  );

  // ── 第三层：AI 判断卡 —— 结论 / 建议 / 依据 / 动作 / 纠错 收进同一张卡 ──
  // 上一版把「运行口径」摊成一行灰字、把「纠错路径」做成第三个虚线折叠框，观感像调试面板。
  // 这一版按一条主线组合：一句话结论 → 建议动作 → 依据带 → 动作条 →（按需展开的）纠错区。
  const analysisTab = (
    <div className="hermes-stack">
      <Panel
        eyebrow="AI VERDICT"
        icon="chart"
        title="分析结论"
        actions={
          scorecard ? (
            <Badge tone={scorecard.provisional ? "warn" : "ok"}>
              覆盖率 {Math.round(scorecard.coverageRatio * 100)}%{scorecard.provisional ? " · 暂评" : ""}
            </Badge>
          ) : undefined
        }
      >
        {/* 结论：整张卡里唯一被强调的一句 */}
        <p className="hermes-ai-lead">
          {!scorecard
            ? "尚未运行分析。规则引擎会按当前方案给出各维度完备度、缺口与建议；未提供的字段保持未知，不会补造数值。"
            : worst
              ? `当前最薄弱的是「${labelScoreDimension(worst.dimension)}」（${worst.score} 分）：${worst.gaps ?? "依据不足"}。`
              : "分析已运行，但所有维度都缺依据；请先补充方案或真实证据后重评。"}
        </p>
        {scorecard && (
          <p className="hermes-brief-para" style={{ marginTop: 10 }}>
            <span className="hermes-brief-why-label">建议动作</span>
            {worst?.recommendation
              ? worst.recommendation
              : unknownDims[0]?.recommendation
                ? `先处理未知维度「${labelScoreDimension(unknownDims[0].dimension)}」：${unknownDims[0].recommendation}`
                : "暂无新的建议动作。"}
          </p>
        )}

        {/* 依据带：把「这条结论怎么来的」收成一条（依据口径 / 运行方式 / 规则版本 / 计算时间）。
            全部取真实字段（evidenceCompleteness / runMode / ruleVersion / computedAt），不另算。 */}
        {scorecard && (
          <div className="hermes-ai-rail">
            <span className="hermes-ai-rail-k">依据</span>
            <span className="hermes-ai-rail-v">
              {evidenceTotal === 0 ? "暂无证据" : `已核实真实 ${evidenceVerified}/${evidenceTotal} 条`}
            </span>
            <span>{RUN_MODE_LABEL[latestRun?.runMode] ?? "运行方式未记录"}</span>
            <span>规则 {scorecard.ruleVersion}</span>
            <span>{fmtDateTime(scorecard.computedAt)}</span>
            <button type="button" className="hermes-ai-rail-link" onClick={() => handleTabChange("validation")}>
              查看证据原文 <Icon name="arrow" size={12} />
            </button>
          </div>
        )}

        {/* 动作条：主按钮在前；空态另给两个真实起点（避免「空白提示焦虑」）。 */}
        <div className="hermes-ai-actions">
          <button className="hermes-primary-btn hermes-btn-sm" onClick={runAnalysis} disabled={busy}>
            <Icon name="play" size={13} />
            {busy ? "分析中…" : scorecard ? "重新分析" : "运行首次分析"}
          </button>
          {scorecard ? (
            <button
              type="button"
              className="hermes-ghost-btn hermes-btn-sm"
              onClick={() => setShowFix((v) => !v)}
              aria-expanded={showFix}
            >
              <Icon name="alert" size={13} />
              {showFix ? "收起纠错" : "结论有误？"}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="hermes-ghost-btn hermes-btn-sm"
                onClick={() => handleTabChange("version")}
                disabled={busy}
              >
                <Icon name="edit" size={13} />
                先补方案字段
              </button>
              <button
                type="button"
                className="hermes-ghost-btn hermes-btn-sm"
                onClick={() => handleTabChange("validation")}
                disabled={busy}
              >
                <Icon name="shield" size={13} />
                先录入真实证据
              </button>
            </>
          )}
        </div>

        {!scorecard && (
          <p className="hermes-note" style={{ marginTop: 10 }}>
            三者不冲突：先补字段或先录证据，再跑一轮，覆盖率会上升。未提供的字段保持未知，不会被补造数值。
          </p>
        )}

        {/* 失败路径（AI UX · The "Wrong" Path）：默认收起，只在主动点「结论有误？」后展开，
            不占常态版面。刻意不做「一键改分」——纠正必须落到具体字段或具体证据，并写进版本与审计。 */}
        {scorecard && showFix && (
          <div className="hermes-ai-fix">
            <p className="hermes-note">
              结论由「方案字段 + 证据」共同推导，所以结论不对，通常是这两类输入之一有问题。先修输入、再重跑，结论才会变。
            </p>
            <div className="hermes-inline">
              <button
                type="button"
                className="hermes-outline-btn hermes-btn-sm"
                onClick={() => handleTabChange("version")}
              >
                <Icon name="edit" size={13} />
                方案字段写错了 → 去修正
              </button>
              <button
                type="button"
                className="hermes-outline-btn hermes-btn-sm"
                onClick={() => handleTabChange("validation")}
              >
                <Icon name="shield" size={13} />
                依据不可靠 → 去标注
              </button>
            </div>
            <p className="hermes-note">
              这里不提供「一键纠正」：纠正必须落到具体字段或具体证据上，并写进版本与审计，下一轮分析才读得到。
            </p>
          </div>
        )}

        {/* 状态透明：分析期间如实说明这次会做什么（步骤 ≠ 进度百分比） */}
        {busy && (
          <Thinking label="正在按确定性规则重跑分析…" hint="本次执行的步骤（不调用模型）" steps={ANALYSIS_STEPS} />
        )}

        {msg && (
          <div className={cx("hermes-banner", msg.tone === "ok" ? "is-ok" : "is-danger")} style={{ marginTop: 10 }}>
            {msg.text}
          </div>
        )}
      </Panel>

      {/* 六维评分 = 「查看评估明细」，默认收起（第四层口径：计算过程按需查看） */}
      <details className="hermes-details">
        <summary style={{ fontWeight: 600, padding: "4px 0" }}>查看评估明细（六维评分 · 依据 · 缺口 · 建议）</summary>
        <div style={{ marginTop: 12 }}>
          {dims.length === 0 ? (
            <Empty
              title="还没有分析结果"
              action={
                <button className="hermes-primary-btn hermes-btn-sm" onClick={runAnalysis} disabled={busy}>
                  <Icon name="play" size={13} />
                  {busy ? "分析中…" : "运行首次分析"}
                </button>
              }
            >
              运行一次分析后，这里会按六个维度列出评分、依据、缺口与建议。
            </Empty>
          ) : (
            <>
              {/* 维度总览：移植老版 ScoreSummary 的维度条。
                  有依据才画条；没有依据的维度只写「未知」，**不给 0 分、不画空条**——
                  空白是「还不知道」，不是「很低分」。条色统一用强调色，不做阈值红黄绿：
                  这里的分数是**完备度**（有没有依据），不是好坏，涂红会被读成「这维度很差」。 */}
              <div className="hermes-score-grid">
                {dims.map((d) => (
                  <ScoreBar
                    key={d.dimension}
                    label={labelScoreDimension(d.dimension)}
                    value={d.score ?? null}
                    note={`权重 ${WEIGHTS[d.dimension]}%`}
                  />
                ))}
              </div>
              <div className="hermes-list">
                {dims.map((d) => (
                  <div key={d.dimension} className="hermes-row">
                    <div className="hermes-row-head">
                      <span className="hermes-row-title">{labelScoreDimension(d.dimension)}</span>
                      {d.score === null ? <Badge tone="neutral">未知</Badge> : <span className="health-score"><i />{d.score}</span>}
                    </div>
                    <div className="hermes-dim-body">
                      <div>
                        <span className="hermes-section-label">依据</span>
                        <p>{d.basis || "无（本维度缺依据）"}</p>
                      </div>
                      <div>
                        <span className="hermes-section-label">假设</span>
                        <p>{d.assumptions || "无"}</p>
                      </div>
                      <div>
                        <span className="hermes-section-label">缺口</span>
                        <p>{d.gaps || "无"}</p>
                      </div>
                      <div>
                        <span className="hermes-section-label">建议</span>
                        <p>{d.recommendation || "无"}</p>
                      </div>
                      <div>
                        <span className="hermes-section-label">证据引用</span>
                        <p>
                          {Array.isArray(d.evidenceRefs) && d.evidenceRefs.length > 0
                            ? d.evidenceRefs
                                .map((r: any) => `${r.fieldName || r.label || r.key || "事实"}：${r.value ?? r.label ?? r.key ?? ""}`)
                                .join("；")
                            : "无"}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </details>

      <RevisionPanel productId={p.id} onChanged={() => router.refresh()} />
    </div>
  );

  // ── 第三层：方案默认当前可读方案，版本列表与原始 JSON 收起 ──
  const currentVersion = p.versions[0] ?? null;
  const currentSpecs = (currentVersion?.specs ?? {}) as Record<string, any>;
  const versionTab = (
    <div className="hermes-stack">
      <section className="hermes-theme-section">
        <div className="hermes-theme-head">
          <h2 className="hermes-theme-title">当前方案</h2>
          {currentVersion && (
            <span className="hermes-inline">
              <Badge tone={currentVersion.isConfirmed ? "ok" : "warn"}>
                {currentVersion.versionTag}
                {currentVersion.isConfirmed ? " · 已确认" : " · 未确认"}
              </Badge>
            </span>
          )}
        </div>
        {currentVersion ? (
          <>
            <KV
              items={[
                { k: "一句话想法", v: currentSpecs.coreIdea || p.coreIdea || "未填写" },
                { k: "目标人群与场景", v: currentSpecs.targetAudience || p.targetAudience || "未填写" },
                { k: "核心卖点", v: currentSpecs.coreSellingPoints || p.coreSellingPoints || "未填写" },
                { k: "预期渠道", v: currentSpecs.targetChannels || p.targetChannels || "未填写" },
                { k: "价格预期", v: currentSpecs.priceExpectation || p.priceExpectation || "未设置" },
                { k: "剂型 / 规格", v: currentSpecs.formSpec || p.formSpec || "未设置" },
                { k: "禁用项", v: currentSpecs.forbiddenItems || p.forbiddenItems || "未设置" },
                {
                  k: "目标成本",
                  v:
                    currentVersion.targetCost !== null && currentVersion.targetCost !== undefined
                      ? `${Number(currentVersion.targetCost)} ${currentVersion.currency}`
                      : "未设置",
                },
              ]}
            />
            <p className="hermes-note" style={{ marginTop: 10 }}>
              在下方「提出修改草案」中调整字段；每次采纳都会创建新版本，旧版本不会被覆盖。
            </p>
          </>
        ) : (
          <Empty>还没有版本记录。先建立并确认首个产品版本，后续修订会在这里按版本保留。</Empty>
        )}
      </section>

      <RevisionPanel productId={p.id} onChanged={() => router.refresh()} />

      <details className="hermes-details">
        <summary style={{ fontWeight: 600, padding: "4px 0" }}>
          历史版本（{p.versions.length}）与原始方案字段
        </summary>
        <div style={{ marginTop: 12 }}>
          {p.versions.length === 0 ? (
            <Empty>还没有版本记录。</Empty>
          ) : (
            <div className="hermes-list">
              {p.versions.map((v: any) => {
                const meta = (v.unknowns ?? {}) as any;
                const changedFields: string[] = Array.isArray(meta.changedFields) ? meta.changedFields : [];
                return (
                  <div key={v.id} className="hermes-row">
                    <div className="hermes-row-head">
                      <span className="hermes-row-title">
                        {v.versionTag}
                        <span className="muted-line"> · {fmtDate(v.createdAt)}</span>
                      </span>
                      <span className="hermes-inline">
                        {v.isConfirmed ? <Badge tone="ok">已确认</Badge> : <Badge tone="warn">未确认</Badge>}
                        {v.isImmutable && <Badge tone="neutral">不可变</Badge>}
                        {meta.basedOnVersionTag && <Badge tone="info">基于 {meta.basedOnVersionTag}</Badge>}
                      </span>
                    </div>
                    <div className="hermes-row-meta">
                      <span>
                        目标成本{" "}
                        {v.targetCost !== null && v.targetCost !== undefined ? `${Number(v.targetCost)} ${v.currency}` : "未设置"}
                      </span>
                      {v.technicalAdvice && <span>修改理由：{v.technicalAdvice}</span>}
                    </div>
                    {changedFields.length > 0 && (
                      <div className="hermes-row-body">本轮变更：{changedFields.map((f) => PRODUCT_SPEC_FIELD_LABELS[f] ?? f).join("、")}</div>
                    )}
                    <details className="hermes-details" style={{ marginTop: 10 }}>
                      <summary>原始方案字段（JSON）</summary>
                      <pre className="hermes-mono" style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
                        {JSON.stringify(v.specs, null, 2)}
                      </pre>
                    </details>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </details>
    </div>
  );

  // ── 第三层：成本先给适用口径结果 + 主要成本来源；无真实输入时准确写「暂不能计算」 ──
  const costTab = (
    <div className="hermes-stack">
      <CostCalculator
        targetCost={currentVersion?.targetCost ?? null}
        currency={currentVersion?.currency ?? null}
        versionTag={currentVersion?.versionTag ?? null}
        workItemId={p.projects?.[0]?.id}
        productId={p.id}
        savedScenarios={savedScenarios}
        onSaveScenario={handleSaveScenario}
      />

      <section className="hermes-theme-section">
        <div className="hermes-theme-head">
          <h2 className="hermes-theme-title">关联项目执行与报价进度</h2>
        </div>
        {p.projects.length === 0 ? (
          <Empty>暂无关联开发项目。可让 Kern 启动产品研发，或从项目管理创建执行项目并绑定该产品。</Empty>
        ) : (
          <div className="hermes-list">
            {p.projects.map((proj: any) => (
              <div key={proj.id} className="hermes-row">
                <div className="hermes-row-head">
                  <span className="hermes-row-title">{proj.title}</span>
                  <Badge tone="info">{labelProjectStage(proj.stage)}</Badge>
                </div>
                <div className="hermes-row-meta">
                  <span>版本基线 r{proj.revision}</span>
                  <span>证据数 {proj.evidences?.length ?? 0} 条</span>
                </div>
                <div className="hermes-inline-end" style={{ marginTop: 8 }}>
                  <Link href={`/projects/${proj.id}`} className="hermes-outline-btn hermes-btn-sm">
                    <Icon name="arrow" size={13} />
                    进入项目录入报价 / BOM
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );

  // ── 验证页签：保留原始证据（第四层：原文按需查看），顶部先给一句归纳 ──
  // 证据核实完整度直接取服务端真实口径（evidenceCompleteness），不另算、不补默认值：
  //   verifiedReal = verifyStatus=VERIFIED 且 nature=REAL 的证据数；total = 依据总数。
  // 该口径同时被「分析结论」的运行口径条引用，故三个派生量已在渲染前统一声明（见上方派生量区）。
  const validationTab = (
    <div className="hermes-stack">
      <section className="hermes-theme-section">
        <div className="hermes-theme-head">
          <h2 className="hermes-theme-title">验证结论</h2>
          <Badge tone={evidenceVerified > 0 ? "ok" : "neutral"}>
            {evidenceTotal === 0 ? "暂无证据" : `已核实真实 ${evidenceVerified}/${evidenceTotal}`}
          </Badge>
        </div>
        {/* 证据核实环：环值 = 已核实真实 / 依据总数（只有 total>0 才画环）。
            total=0 → 未建档空环；有据但全未核实 → 环在 0 且用比率「0/M 已核实」表述，绝不写 0%。 */}
        <div className="hermes-evidence-ring">
          {/* 环心只放短标签：长句塞进 126px 的圆里会溢出圆外、压住环线。
              口径说明改为环右侧的一段小字（原来塞在 caption 里，实测溢出）。 */}
          <ProgressRing
            value={evidenceTotal > 0 ? Math.round((evidenceVerified / evidenceTotal) * 100) : null}
            valueText={evidenceTotal > 0 ? `${evidenceVerified}/${evidenceTotal} 已核实` : undefined}
            label="证据核实"
            tone={evidenceVerified > 0 ? "ok" : "neutral"}
          />
          <div className="hermes-evidence-ring-copy">
            <p className="hermes-theme-conclusion">
              {evidenceTotal === 0
                ? "尚未录入任何市场或实验证据；当前所有判断都来自方案文字，未经过市场验证。"
                : evidenceVerified > 0
                  ? `已有 ${evidenceVerified} 条经负责人核实的真实依据支撑判断。`
                  : "已录入资料均未核实，不能作为事实使用。"}
            </p>
            <p className="hermes-note">
              {evidenceTotal > 0
                ? `口径：已核实真实依据 ${evidenceVerified} 条 / 依据总数 ${evidenceTotal} 条；未核实与演示数据不计入分子。`
                : "口径：暂无依据可核实（依据总数 0 条）。待补证后再评估已核实占比。"}
            </p>
          </div>
        </div>
      </section>

      <details className="hermes-details" open={allEvidences.length <= 3}>
        <summary style={{ fontWeight: 600, padding: "4px 0" }}>证据原文与核验记录（{allEvidences.length} 条）</summary>
        <div style={{ marginTop: 12 }}>
          {allEvidences.length === 0 ? (
            <Empty
              title="尚未录入任何证据"
              action={
                <>
                  <Link href="/opportunities" className="hermes-primary-btn hermes-btn-sm">
                    去市场机会转入信号
                  </Link>
                  <button type="button" className="hermes-ghost-btn hermes-btn-sm" onClick={() => handleTabChange("version")}>
                    先补方案字段
                  </button>
                </>
              }
            >
              当前所有判断都来自方案文字，未经市场验证。可到「市场机会」转入信号，或进入关联项目补充竞品及渠道资料。
            </Empty>
          ) : (
            <div className="hermes-list">
              {allEvidences.map((ev: any) => (
                <div key={ev.id} className="hermes-row">
                  <div className="hermes-row-head">
                    <span className="hermes-row-title">{ev.contentOrUri}</span>
                    <span className="hermes-inline">
                      <Badge status={ev.verifyStatus}>{labelEvidenceVerifyStatus(ev.verifyStatus)}</Badge>
                      {ev.nature === "REAL" ? <Badge tone="ok">真实依据</Badge> : <Badge tone="warn">演示数据</Badge>}
                      {ev.validationStatus && ev.validationStatus !== "UNAPPLIED" && <Badge tone="info">{labelValidationStatus(ev.validationStatus)}</Badge>}
                    </span>
                  </div>
                  <div className="hermes-row-meta">
                    <span>来源 {ev.source}</span>
                    {ev.author && <span>录入人 {ev.author}</span>}
                    {ev.channel && <span>渠道 {ev.channel}</span>}
                    {ev.productRef && <span>竞品/产品 {ev.productRef}</span>}
                  </div>
                  {Array.isArray(ev.claims) && ev.claims.length > 0 && (
                    <div className="hermes-dim-body" style={{ marginTop: 6 }}>
                      {ev.claims.map((c: any) => (
                        <div key={c.id}>
                          <span className="hermes-section-label">{c.fieldName}</span>
                          <p>
                            {c.value} {c.unit || ""} {c.mechanism ? `(${c.mechanism})` : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </details>

      {overview.risks.length > 0 && (
        <section className="hermes-theme-section">
          <div className="hermes-theme-head">
            <h2 className="hermes-theme-title">待关闭风险缺口</h2>
          </div>
          <div className="hermes-list">
            {overview.risks.map((r: any, idx: number) => (
              <div key={idx} className="hermes-row">
                <div className="hermes-row-head">
                  <span className="hermes-row-title">{labelScoreDimension(r.dimension)}</span>
                  <Badge tone="danger">阻断点</Badge>
                </div>
                <div className="hermes-row-body">{r.text}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );

  return (
    <AppShell
      active="products"
      user={{ name: currentSession?.userName, meta: currentSession?.userEmail }}
      runtime={runtime}
      topbarLeft={
        <div className="hermes-topbar-title">
          <span className="eyebrow">
            <Link href="/products" className="hermes-link">
              产品
            </Link>{" "}
            / {p.identityCode}
          </span>
          <strong>{p.name}</strong>
        </div>
      }
    >
      {/* 紧凑头部：名称、当前阶段、负责人为主；版本与日期为次级信息 */}
      <div className="hermes-page-heading">
        <div>
          <p className="eyebrow">
            {labelProductLifecycleStage(p.lifecycleStage)} · 负责人 {p.owner?.name || "未设置"}
          </p>
          <h1>{p.name}</h1>
          <p className="hermes-header-secondary">
            当前版本 {p.versions[0]?.versionTag ?? "未设置"}
            {p.targetLaunchDate ? ` · 目标上市 ${fmtDate(p.targetLaunchDate)}` : " · 目标上市未设置"}
          </p>
        </div>
        <div className="hermes-inline">
          {p.projects?.[0]?.id ? (
            <Link href={`/projects/${p.projects[0].id}`} className="hermes-primary-btn">
              <Icon name="arrow" size={16} />
              继续推进
            </Link>
          ) : (
            <Link
              href={`/muse?product=${p.id}&query=${encodeURIComponent("我想启动这个产品的一轮完整研发。请先根据当前产品资料整理研发 Brief，并告诉我还缺哪些输入。")}`}
              className="hermes-primary-btn"
            >
              <Icon name="play" size={16} />
              启动研发
            </Link>
          )}
          <Link href={`/muse?product=${p.id}`} className="hermes-outline-btn">
            <Icon name="chat" size={16} />
            和 Kern 讨论
          </Link>
          <Link href="/products" className="hermes-link">
            返回产品库
          </Link>
        </div>
      </div>

      <Tabs
        items={[
          { key: "overview", label: "总览" },
          { key: "analysis", label: "AI 判断" },
          { key: "version", label: "产品方案" },
          { key: "channel", label: "渠道路线" },
          { key: "cost", label: "成本与供应" },
          { key: "validation", label: "证据与风险" },
          { key: "launch", label: "上市计划" },
        ]}
        active={tab}
        onChange={(k) => handleTabChange(k as TabKey)}
      />

      <div style={{ marginTop: 14 }}>
        {tab === "overview" && overviewTab}
        {tab === "analysis" && analysisTab}
        {tab === "version" && versionTab}
        {tab === "channel" && <ChannelRoutesPanel productId={p.id} />}
        {tab === "cost" && costTab}
        {tab === "validation" && validationTab}
        {tab === "launch" && <LaunchTab productId={p.id} onChanged={() => router.refresh()} />}
      </div>
    </AppShell>
  );
}
