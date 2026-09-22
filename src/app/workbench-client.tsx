"use client";

import React from "react";
import Link from "next/link";
import AppShell from "@/components/app-shell";
import CollapsibleList from "@/components/collapsible-list";
import { Empty, Panel } from "@/components/ui";
import {
  DecisionBoard,
  FeedRow,
  HeroBand,
  Kpi,
  KpiRow,
  Pill,
  ProgressRow,
  type DecisionColumn,
} from "@/components/cockpit";
import Icon from "@/components/icons";
import { StepTrack, type StepItem } from "@/components/viz";
import {
  buildSituationBrief,
  rankDecisions,
  type BriefSourceItem,
  type BriefDecisionItem,
} from "@/modules/workspace/briefing";
import { fmtDate, fmtDateTime } from "@/shared/datetime";
import { labelProductLifecycleStage } from "@/shared/status-labels";
import {
  AutomationTraceList,
  type AutomationTraceView,
} from "@/components/automation-trace";

/**
 * 首页 · 产品中心驾驶舱（2026-09-19 重写）
 *
 * 与旧版（三段式极简简报）的差异：
 * 旧版只保留「现在的情况 / 需要你决定 / 其他工作」三块，把驾驶舱减成了骨架。
 * 本版按 `hermes-frontend-v2` 的 composition 重排：
 *   品牌带 → KPI 行 → 阶段分布条 → 主区（现在的情况 / 决策板 / 产品推进 + 市场机会）
 *   ＋ 侧栏（今日重点 / 最近完成）。
 *
 * 仍然必须守住的既有契约（不因版式变化而放松）：
 * - 所有数字与文案都来自真实聚合；无数据一律渲染空态，**禁止**补占位数字或「整体正常」式结论。
 * - 「默认三件」只是展示预算：完整队列始终可展开，高风险事项不因预算被丢弃。
 * - 统计时间 / 筛选范围 / 权限范围始终可见（页脚口径行）。
 * - 任一聚合读取失败时以 degraded 呈现，不写「一切正常」。
 */

interface OverviewItem extends BriefSourceItem {
  tier?: string | null;
  summary?: string | null;
  at?: string | null;
}

interface Overview {
  meta: { generatedAt: string; scopeLabel: string; permissionLabel: string };
  todos: { count: number; items: OverviewItem[] };
  pendingDecisions: { count: number; items: OverviewItem[] };
  productsInFlight: {
    count: number;
    byStage: { stage: string; label: string; count: number }[];
    items: OverviewItem[];
  };
  blockers: { count: number; items: OverviewItem[] };
  opportunities: { count: number; items: OverviewItem[] };
  recentlyCompleted: { count: number; items: OverviewItem[] };
  portfolio: { projectCount: number; productCount: number };
  recentChanges?: { summary: string; timestamp: string }[];
  earliestBlockerDueAt?: string | null;
  degraded?: boolean;
  degradedNote?: string | null;
}

interface WorkforceActivity {
  generatedAt: string;
  since: string;
  windowHours: number;
  eventCount: number;
  triggeredCount: number;
  suppressedCount: number;
  waitingPolicyCount: number;
  failedCount: number;
  waitingHumanCount: number;
  returnReviewCount: number;
  attentionCount: number;
  attentionItems: Array<{
    id: string;
    kind: "RETURN_REVIEW" | "WAITING_HUMAN" | "POLICY_WAITING";
    title: string;
    detail: string;
    agentName: string;
    updatedAt: string;
    href: string;
  }>;
  recentTraces: AutomationTraceView[];
}

/** 信号价值分级标签：与 /opportunities 页保持同一口径（不新造词汇）。 */
const TIER_LABEL: Record<string, { label: string; tone: "ok" | "info" | "neutral" }> = {
  high: { label: "高价值", tone: "ok" },
  normal: { label: "一般", tone: "info" },
  low: { label: "低", tone: "neutral" },
};

/** 产品生命周期阶段 → 药丸色调。仅映射已有枚举，未知值回落 neutral。 */
const STAGE_TONE: Record<string, "neutral" | "warn" | "info" | "ok"> = {
  IDEA: "neutral",
  ANALYSIS: "warn",
  SAMPLING: "info",
  LAUNCH_PREP: "ok",
};

/** 首页队列条目的类别标签（真实来源类别，不表示优先级高低）。 */
function kindLabel(d: BriefDecisionItem): string {
  if (d.kind === "decision") return "等你裁决";
  if (d.kind === "blocker") return "阻塞";
  return d.status === "SUBMITTED" ? "待验收" : "进行中";
}

/** 副题只放**不与药丸重复**的真实信息：风险类别 / 工作项状态 / 责任人。 */
function kindSub(d: BriefDecisionItem): string | undefined {
  const parts: string[] = [];
  if (d.kind === "blocker" && d.riskLabel) parts.push(d.riskLabel);
  if (d.kind === "todo") parts.push(d.status === "SUBMITTED" ? "成果已提交" : "按计划推进");
  if (d.ownerName) parts.push(d.ownerName);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function kindTone(d: BriefDecisionItem): "warn" | "danger" | "info" {
  if (d.kind === "decision") return "warn";
  if (d.kind === "blocker") return "danger";
  return "info";
}

export default function WorkbenchClient({
  overview,
  workforceActivity,
  allUsers,
  currentSession,
  runtime,
  mockAuth = false,
}: {
  overview: Overview;
  workforceActivity: WorkforceActivity;
  allUsers: { id: string; name: string; email: string }[];
  currentSession: { userId: string; userName: string; userEmail: string };
  runtime: { tone: "ok" | "warn" | "neutral"; label: string; detail: string };
  mockAuth?: boolean;
}) {
  const [activeUserId, setActiveUserId] = React.useState(currentSession?.userId || allUsers[0]?.id || "");
  const activeUser = allUsers.find((u) => u.id === activeUserId) || allUsers[0];

  // 归一排序：截止时间 → 依赖等待 → 责任归属。完整队列始终返回，展示预算由 UI 层决定。
  const ranked = React.useMemo(
    () =>
      rankDecisions(
        { items: overview.pendingDecisions.items },
        { items: overview.blockers.items },
        { items: overview.todos.items },
        currentSession.userId
      ),
    [overview.pendingDecisions.items, overview.blockers.items, overview.todos.items, currentSession.userId]
  );

  const situation = React.useMemo(
    () =>
      buildSituationBrief({
        scopeLabel: overview.meta.scopeLabel,
        generatedAt: overview.meta.generatedAt,
        decisions: ranked.decisions,
        decisionsTotal: ranked.total,
        todoCount: overview.todos.count,
        blockersTotal: overview.blockers.count,
        earliestBlockerDueAt: overview.earliestBlockerDueAt ?? null,
        productsInFlight: overview.productsInFlight.count,
        recentChanges: overview.recentChanges ?? [],
        degraded: overview.degraded ?? false,
        degradedNote: overview.degradedNote ?? null,
      }),
    [overview, ranked.decisions, ranked.total]
  );

  // 决策板承接队列第一件；侧栏「今日重点」只展示其余，避免同一事项在两处重复出现。
  const top = ranked.decisions[0] ?? null;
  const rest = ranked.decisions.slice(1);

  const boardColumns: DecisionColumn[] = React.useMemo(() => {
    if (!top) return [];
    const cols: DecisionColumn[] = [{ label: "当前现状", text: top.whyNow }];
    if (top.suggestion) cols.push({ label: "Hermes 建议", text: top.suggestion });
    if (top.riskLabel) cols.push({ label: "关键风险", text: top.riskLabel });
    cols.push({ label: "优先级依据", text: top.rankReason });
    return cols;
  }, [top]);

  // 阶段分布步进条：标签已由服务端经 status-labels 中文化，这里只做状态归位。
  const byStage = overview.productsInFlight.byStage;
  const firstNonEmpty = byStage.findIndex((s) => s.count > 0);
  const stageSteps: StepItem[] = byStage.map((s, i) => ({
    key: s.stage,
    label: s.label,
    state: s.count > 0 ? (i === firstNonEmpty ? "current" : "done") : "pending",
    note: `${s.count} 个`,
  }));

  const leadStage = byStage.find((s) => s.count > 0)?.label ?? null;
  const productItems = overview.productsInFlight.items.slice(0, 4);
  const signalItems = overview.opportunities.items.slice(0, 4);
  const completedItems = overview.recentlyCompleted.items.slice(0, 4);

  return (
    <AppShell
      active="overview"
      user={{ name: activeUser?.name || currentSession?.userName, meta: currentSession?.userEmail }}
      runtime={runtime}
      topbarLeft={
        <div className="hermes-topbar-title">
          <span className="eyebrow">HERMES · 产品中心</span>
          <strong>驾驶舱</strong>
        </div>
      }
      topbarRight={
        <div className="hermes-inline-end">
          {mockAuth ? (
            <div className="hermes-identity">
              <span>当前身份（开发态）</span>
              <select value={activeUserId} onChange={(e) => setActiveUserId(e.target.value)} aria-label="切换操作人">
                {allUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <Link href="/advisor" className="hermes-outline-btn">
            <Icon name="chat" size={16} />
            问顾问
          </Link>
        </div>
      }
    >
      <HeroBand
        eyebrow={`统计时间 ${fmtDateTime(overview.meta.generatedAt)}`}
        mark="HERMES"
        tagline="让每一个产品决策都有证据。"
        intro="从市场洞察到产品上市，AI 与专业知识共同驱动更好的决策。"
        quote={
          <>
            Better Products
            <br />
            A Healthier World
          </>
        }
      />

      <KpiRow>
        <Kpi
          label="产品正在推进"
          value={overview.productsInFlight.count}
          emphasis="primary"
          note={leadStage ? `最靠前阶段「${leadStage}」` : "暂无在推进产品"}
        />
        <Kpi
          label="需要你今天决定"
          value={ranked.total}
          tone={ranked.total > 0 ? "alert" : undefined}
          emphasis="decision"
          note={
            ranked.total === 0
              ? "当前队列为空"
              : overview.blockers.count > 0
                ? `阻塞 ${overview.blockers.count} 项 · ${
                    overview.earliestBlockerDueAt
                      ? `最早截止 ${fmtDate(overview.earliestBlockerDueAt)}`
                      : "均未设截止日"
                  }`
                : "当前无阻塞项"
          }
        />
        <Kpi label="进行中的工作项" value={overview.todos.count} />
        <Kpi label="高价值市场信号" value={overview.opportunities.count} note="valueTier = high" />
        <Kpi label="待处理决策包" value={overview.pendingDecisions.count} />
        <Kpi
          label="我参与的项目"
          value={overview.portfolio.projectCount}
          note={`组织内产品 ${overview.portfolio.productCount} 个`}
        />
      </KpiRow>

      <div className="hermes-stage-band">
        <span className="hermes-stage-band-label">Hermes 最近 {workforceActivity.windowHours} 小时</span>
        <span>感知 {workforceActivity.eventCount} 个业务事件</span>
        <span>自动触发 {workforceActivity.triggeredCount} 个任务</span>
        <span>抑制 {workforceActivity.suppressedCount} 次不必要动作</span>
        <span>
          等你处理 {workforceActivity.attentionCount} 项
          {workforceActivity.failedCount > 0 ? ` · 自动化失败 ${workforceActivity.failedCount}` : ""}
        </span>
        <Link href="/workforce" className="hermes-link">
          查看自动团队 <Icon name="arrow" size={13} />
        </Link>
      </div>

      {/* 阶段分布：全宽细带，承担旧版「产品阶段推进」的能力，不占主栅格列宽 */}
      <div className="hermes-stage-band">
        <span className="hermes-stage-band-label">产品阶段分布</span>
        <StepTrack steps={stageSteps} ariaLabel="产品阶段分布" />
      </div>

      <div className="hermes-cockpit">
        <div className="hermes-cockpit-main">
          {/* ── 现在的情况（真实聚合归纳，非模型生成） ────────────────── */}
          <section className="hermes-brief-situation">
            <Panel
              icon="grid"
              title="现在的情况"
              sub={overview.degraded ? `部分信息暂未更新（${overview.degradedNote ?? "原因未知"}）` : undefined}
            >
              <div className="hermes-brief-paragraphs">
                {situation.paragraphs.map((p, i) => (
                  <p key={i} className={i === 0 && overview.degraded ? "hermes-brief-para is-degraded" : "hermes-brief-para"}>
                    {p}
                  </p>
                ))}
              </div>
            </Panel>
          </section>

          <section>
            <Panel
              icon="nodes"
              title="Hermes 自动工作"
              sub={`最近 ${workforceActivity.windowHours} 小时 · 真实业务事件驱动，不把手工任务算成自动化`}
              actions={
                <Link href="/workforce" className="hermes-link">
                  查看完整因果链 <Icon name="arrow" size={13} />
                </Link>
              }
            >
              <AutomationTraceList
                traces={workforceActivity.recentTraces.slice(0, 5)}
                emptyText="最近 24 小时还没有业务事件驱动数字员工。"
              />
            </Panel>
          </section>

          {/* ── 需要你决定（队列首件展开为三栏决策板） ───────────────── */}
          <section className="hermes-brief-decisions">
            {top ? (
              <DecisionBoard
                index={1}
                title={top.what}
                summary={top.dueAt ? `截止 ${fmtDate(top.dueAt)}` : undefined}
                columns={boardColumns}
                meta={`共 ${ranked.total} 件待你处理`}
                actions={
                  <>
                    <Link href="/trace" className="hermes-outline-btn">
                      <Icon name="target" size={16} />
                      查看判断依据
                    </Link>
                    <Link href={top.href} className="hermes-primary-btn">
                      去处理
                      <Icon name="arrow" size={16} />
                    </Link>
                  </>
                }
              />
            ) : (
              <Panel title="需要你决定">
                <Empty>
                  没有待你决定的决策包，也没有阻塞项；工作项列表为空或已全部验收。这不代表没有业务风险，仅表示当前队列为空。
                </Empty>
              </Panel>
            )}
          </section>

          {/* ── 其他工作：主题行（产品推进 / 市场机会） ───────────────── */}
          <div className="hermes-cockpit-pair hermes-brief-themes">
            <Panel
              icon="flask"
              title="产品推进"
              actions={
                <Link href="/products" className="hermes-link">
                  查看全部 <Icon name="arrow" size={13} />
                </Link>
              }
            >
              {productItems.length > 0 ? (
                productItems.map((p) => (
                  <ProgressRow
                    key={p.id}
                    href={p.href || "/products"}
                    name={p.title}
                    sub={p.meta ?? undefined}
                    pill={
                      <Pill tone={STAGE_TONE[p.status ?? ""] ?? "neutral"}>
                        {labelProductLifecycleStage(p.status)}
                      </Pill>
                    }
                  />
                ))
              ) : (
                <Empty>暂无在推进的产品；新建产品入库后会出现在这里。</Empty>
              )}
            </Panel>

            <Panel
              icon="signal"
              title="市场机会"
              actions={
                <Link href="/opportunities" className="hermes-link">
                  查看全部 <Icon name="arrow" size={13} />
                </Link>
              }
            >
              {signalItems.length > 0 ? (
                signalItems.map((s) => (
                  <ProgressRow
                    key={s.id}
                    href={s.href || "/opportunities"}
                    name={s.title}
                    sub={s.meta ?? undefined}
                    pill={
                      <Pill tone={s.tier ? TIER_LABEL[s.tier]?.tone ?? "neutral" : "neutral"}>
                        {s.tier ? TIER_LABEL[s.tier]?.label ?? s.tier : "未评估"}
                      </Pill>
                    }
                  />
                ))
              ) : (
                <Empty>尚无高价值信号。信号在 /opportunities 采录并分级后会出现在这里。</Empty>
              )}
            </Panel>
          </div>
        </div>

        <aside className="hermes-cockpit-side">
          <Panel
            icon="bell"
            title="Hermes 等你"
            sub={
              workforceActivity.attentionCount > 0
                ? `结果复核 ${workforceActivity.returnReviewCount} · 人工判断 ${workforceActivity.waitingHumanCount + workforceActivity.waitingPolicyCount}`
                : "当前没有数字员工等待你的判断"
            }
          >
            {workforceActivity.attentionItems.length > 0 ? (
              <div className="hermes-list">
                {workforceActivity.attentionItems.map((item) => (
                  <div className="hermes-row is-flat" key={item.kind + ":" + item.id}>
                    <div className="hermes-row-head">
                      <strong className="hermes-row-title">{item.title}</strong>
                      <Pill tone={item.kind === "RETURN_REVIEW" ? "info" : "warn"}>
                        {item.kind === "RETURN_REVIEW"
                          ? "结果待复核"
                          : item.kind === "POLICY_WAITING"
                            ? "策略门等待"
                            : "等你拍板"}
                      </Pill>
                    </div>
                    <div className="hermes-row-meta">
                      <span>{item.agentName}</span>
                      <span>{fmtDateTime(item.updatedAt)}</span>
                    </div>
                    <div className="hermes-row-body">{item.detail}</div>
                    <div style={{ marginTop: 8 }}>
                      <Link href={item.href} className="hermes-link">
                        去处理 <Icon name="arrow" size={13} />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>当前没有专业 Agent 返回结果或人工判断请求。</Empty>
            )}
          </Panel>

          {/* ── 今日重点：队列除首件外的其余事项，默认 4 件、可展开 ───── */}
          <Panel
            icon="target"
            title="今日重点"
            sub={`按截止时间 → 依赖等待 → 责任归属排序 · 共 ${ranked.total} 件`}
          >
            {rest.length > 0 ? (
              <CollapsibleList
                items={rest}
                previewCount={4}
                unit="件"
                toggleMarginTop={8}
                renderItem={(d: BriefDecisionItem) => (
                  <FeedRow
                    key={d.id}
                    href={d.href}
                    title={d.what}
                    sub={kindSub(d)}
                    pill={<Pill tone={kindTone(d)}>{kindLabel(d)}</Pill>}
                  />
                )}
              />
            ) : top ? (
              <Empty>队列只有 1 件，已在上方「需要你决定」展开。</Empty>
            ) : (
              <Empty>当前没有等待你处理的事项。</Empty>
            )}
          </Panel>

          {/* ── 最近完成：已验收工作项，按最近更新时间倒序 ───────────── */}
          <Panel
            icon="check"
            title="最近完成"
            sub={overview.recentlyCompleted.count > 0 ? `已验收 ${overview.recentlyCompleted.count} 项` : undefined}
          >
            {completedItems.length > 0 ? (
              <CollapsibleList
                items={completedItems}
                previewCount={4}
                unit="项"
                toggleMarginTop={8}
                renderItem={(c: OverviewItem) => (
                  <FeedRow
                    key={c.id}
                    href={c.href}
                    done
                    title={c.title}
                    sub={`${c.meta ?? "未关联项目"}${c.at ? ` · ${fmtDate(c.at)}` : ""}`}
                  />
                )}
              />
            ) : (
              <Empty>还没有已验收的工作项。</Empty>
            )}
          </Panel>
        </aside>
      </div>

      {/* 统计口径：统计时间 / 筛选范围 / 权限范围必须始终可见 */}
      <div className="hermes-overview-meta">
        <span>
          <Icon name="clock" size={13} /> 统计时间 {fmtDateTime(overview.meta.generatedAt)}
        </span>
        <span>筛选范围 {overview.meta.scopeLabel}</span>
        <span>权限范围 {overview.meta.permissionLabel}</span>
      </div>
    </AppShell>
  );
}
