"use client";

import React from "react";
import Link from "next/link";
import AppShell from "@/components/app-shell";
import { Badge } from "@/components/ui";
import Icon from "@/components/icons";
import {
  rankDecisions,
  type BriefDecisionItem,
  type BriefSourceItem,
} from "@/modules/workspace/briefing";
import {
  DesktopConversationStrip,
  useDesktopOverview,
} from "@/components/desktop-activity";
import { fmtDate, fmtDateTime } from "@/shared/datetime";
import { labelProductLifecycleStage } from "@/shared/status-labels";
import {
  AutomationTraceList,
  type AutomationTraceView,
} from "@/components/automation-trace";
import "./workbench.css";
import { Count, EmptyLine, Tag, type Tone } from "@/components/kx";

const FIRST_PRODUCT_DRAFT = "我想创建第一个产品。请先问我最少必要信息，再帮我整理产品 Brief、关键假设和第一轮验证计划。";
const CONTINUE_PRODUCT_DRAFT = "我想整理一个产品方向。请先确认目标与已有项目，再帮我梳理关键假设、需要的证据和下一步。";
const START_EXAMPLES = [
  { title: "评估一个新品方向", hint: "从市场、合规和成本，梳理需要验证的假设。", icon: "flask", prompt: "我想评估一个新品方向。请先询问必要信息，再梳理市场、合规、成本假设；每项判断标注依据，缺少资料的明确写未知。" },
  { title: "做一份竞品调研", hint: "把对比、来源和仍然未知的部分整理清楚。", icon: "search", prompt: "我想做一份竞品调研。请先确认产品方向、目标市场和对比范围，再整理定位、价格和渠道；标注来源，不要编造数据。" },
  { title: "整理项目验证计划", hint: "明确里程碑、需要的证据和下一步负责人。", icon: "target", prompt: "我想整理一个项目的第一轮验证计划。请先了解目标、约束和现有资料，再列出里程碑、证据缺口和需要我确认的事项。" },
] as const;

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

function decisionLabel(item: BriefDecisionItem): string {
  if (item.kind === "decision") return "等你决定";
  if (item.kind === "blocker") return "阻塞";
  return item.status === "SUBMITTED" ? "待验收" : "待处理";
}

function decisionTone(item: BriefDecisionItem): "warn" | "bad" | "brand" {
  if (item.kind === "blocker") return "bad";
  if (item.kind === "decision") return "warn";
  return "brand";
}

function CardHead({ title, count, link }: { title: string; count?: React.ReactNode; link?: { href: string; label: string } }) {
  return (
    <div className="kx-wb-card-h">
      <h2>{title}</h2>
      {count}
      {link ? (
        <Link href={link.href} className="kx-wb-link">
          {link.label}
        </Link>
      ) : null}
    </div>
  );
}

interface WarnItem {
  id: string;
  tone: Tone;
  title: string;
  meta: string;
  href?: string | null;
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
  const [activeUserId, setActiveUserId] = React.useState(
    currentSession?.userId || allUsers[0]?.id || ""
  );
  // 本机执行是「Kern 正在替我做什么」的一部分；没有本机任务时整块不出现。
  const { overview: desktopOverview } = useDesktopOverview({ intervalMs: 8000, limit: 4 });
  const activeUser = allUsers.find((u) => u.id === activeUserId) || allUsers[0];
  const displayName = activeUser?.name || currentSession?.userName || "你好";

  const ranked = React.useMemo(
    () =>
      rankDecisions(
        { items: overview.pendingDecisions.items },
        { items: overview.blockers.items },
        { items: overview.todos.items },
        currentSession.userId
      ),
    [
      overview.pendingDecisions.items,
      overview.blockers.items,
      overview.todos.items,
      currentSession.userId,
    ]
  );

  const top = ranked.decisions[0] ?? null;
  const rest = ranked.decisions.slice(1, 6);
  const productItems = overview.productsInFlight.items.slice(0, 6);
  const completedItems = overview.recentlyCompleted.items.slice(0, 2);

  // 「正在工作」是现在进行时，只有窗口内真的有自动化活动才能这么说；
  // 全零时这块是历史统计，就按统计说，不要让空面板宣告 Kern 在干活。
  const hasAutomationActivity =
    workforceActivity.eventCount > 0 ||
    workforceActivity.attentionCount > 0 ||
    workforceActivity.recentTraces.length > 0;
  const waitingCount = workforceActivity.waitingHumanCount + workforceActivity.waitingPolicyCount;

  // 「哪里异常」只收真实信号：阻塞、自动化失败、模型 / 运行时告警、数据读取降级。
  const warnItems: WarnItem[] = [
    ...overview.blockers.items.slice(0, 3).map((item) => ({
      id: `blocker-${item.id}`,
      tone: "bad" as const,
      title: item.title,
      meta: item.meta || "阻塞",
      href: item.href,
    })),
    ...(workforceActivity.failedCount > 0
      ? [{
          id: "automation-failed",
          tone: "bad" as const,
          title: `${workforceActivity.failedCount} 次自动化失败`,
          meta: `最近 ${workforceActivity.windowHours} 小时 · 自动化中心`,
          href: "/workforce",
        }]
      : []),
    ...(runtime.tone === "warn"
      ? [{ id: "runtime", tone: "warn" as const, title: runtime.label, meta: runtime.detail, href: "/settings" }]
      : []),
    ...(overview.degraded
      ? [{
          id: "degraded",
          tone: "warn" as const,
          title: "部分信息暂未更新",
          meta: overview.degradedNote || "当前页面仍展示最后一次可用的真实数据",
          href: null,
        }]
      : []),
  ];
  const doingCount = desktopOverview?.runningCount ?? 0;
  // 已有独立项目（即使还没有产品）不能被误判为第一次使用。
  const isFirstUse = overview.portfolio.productCount === 0 && overview.portfolio.projectCount === 0;
  // 降级读取中的零计数不证明没有产品或项目，入口可用但不能宣称首次使用。
  const hasKnownEmptyWorkspace = isFirstUse && !overview.degraded;
  const showNeeds = !isFirstUse || ranked.total > 0 || overview.todos.count > 0 || overview.pendingDecisions.count > 0 || overview.blockers.count > 0;
  const showProducts = !isFirstUse || overview.productsInFlight.count > 0;
  const showAutomation = hasAutomationActivity || doingCount > 0;
  // 新工作空间的告警放在开始入口前；正常的零异常不再单独占一张卡。
  const showWarnings = !isFirstUse && warnItems.length > 0;
  const showCompleted = overview.recentlyCompleted.count > 0;
  const showAside = showAutomation || showWarnings || showCompleted;
  const showOverview = showNeeds || showProducts || showAside;

  const summary = [
    `${ranked.total} 件待处理`,
    hasAutomationActivity ? `${workforceActivity.eventCount} 次自动化活动` : null,
    `${warnItems.length} 项异常`,
    `${fmtDateTime(overview.meta.generatedAt)} 更新`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <AppShell
      active="overview"
      user={{ name: displayName, meta: currentSession?.userEmail }}
      runtime={runtime}
      topbarLeft={
        /* 2026-10-04：原先此处是 <strong>今日</strong>，与下方 <h1>今日</h1>
           完全同名同屏出现两次（首屏可见的冗余）。顶栏改为只承载动作，
           页面标题由 h1 独占。同样的重复存在于 products / settings /
           opportunities / advisor / workforce 等页面的 topbarLeft，
           属全站模式，本次只改 /manage 与 /workforce，其余待统一决策。 */
        <div className="hermes-topbar-title">
          <span className="hermes-topbar-scope">工作台</span>
        </div>
      }
      topbarRight={
        <div className="hermes-inline-end">
          {mockAuth ? (
            <div className="hermes-identity">
              <span>当前身份（开发态）</span>
              <select
                value={activeUserId}
                onChange={(e) => setActiveUserId(e.target.value)}
                aria-label="切换操作人"
              >
                {allUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {/* 2026-10-04：移除顶栏「自动化中心」按钮。
              该入口此前同屏出现三次：侧栏「运行」分组、顶栏按钮、以及右侧
              「Kern 正在做什么？」卡片头链接。侧栏是规范导航，卡片链接是
              贴着内容的上下文入口，顶栏按钮既不贴内容也不独享上下文，属纯冗余。 */}
        </div>
      }
    >
      <div className="kx-wb">
        <header className="kx-wb-head">
          <div>
            <h1>{isFirstUse ? hasKnownEmptyWorkspace ? "欢迎使用 Kern" : "工作空间信息待更新" : "今日工作"}</h1>
            <p>{isFirstUse ? hasKnownEmptyWorkspace ? "从一个产品想法开始。进度、证据和待办会在这里汇总。" : "部分信息暂未更新。可以继续整理目标，恢复后再查看项目与产品进度。" : summary}</p>
          </div>
          {!isFirstUse ? <Link href="/muse" className="hermes-outline-btn kx-wb-talk">
            去和 Kern 说
            <Icon name="arrow" size={14} />
          </Link> : null}
        </header>

        <DesktopConversationStrip overview={desktopOverview} />

        {isFirstUse && warnItems.length > 0 ? (
          <section className="kx-wb-setup-notice" aria-label="开始前需要检查" role="status">
            <h2>开始前需要检查</h2>
            {warnItems.map((item) => (
              <div key={item.id} data-tone={item.tone}>
                <span><strong>{item.title}</strong><small>{item.meta}</small></span>
                {item.href ? <Link href={item.href}>查看状态 <Icon name="arrow" size={14} /></Link> : null}
              </div>
            ))}
          </section>
        ) : null}

        {isFirstUse ? (
          <>
            <section className="hermes-onboarding kx-wb-start" aria-labelledby="hermes-onboarding-title">
              <div className="kx-wb-start-copy">
                <div className="kx-wb-start-eyebrow"><span>建立你的产品工作空间</span><Badge tone="info">{hasKnownEmptyWorkspace ? "尚未创建产品" : "信息暂未完整更新"}</Badge></div>
                <h2 id="hermes-onboarding-title">{hasKnownEmptyWorkspace ? "第一次使用，三步就够了" : "从一个清晰的目标继续"}</h2>
                <p>不用先研究 Agent、项目或治理对象。先告诉 Kern 你的产品想法，把模糊的方向变成可验证的下一步。</p>
                <Link href={`/muse?query=${encodeURIComponent(hasKnownEmptyWorkspace ? FIRST_PRODUCT_DRAFT : CONTINUE_PRODUCT_DRAFT)}`} className="hermes-primary-btn kx-wb-start-cta">
                  {hasKnownEmptyWorkspace ? "整理第一个产品想法" : "整理一个产品方向"} <Icon name="arrow" size={16} />
                </Link>
                <small className="kx-wb-start-note">先整理目标；发起研究前，请确认模型与执行服务可用。</small>
              </div>
              <ol className="kx-wb-start-steps" aria-label={hasKnownEmptyWorkspace ? "首次使用步骤" : "继续前可检查的事项"}>
                <li>
                  <div className="kx-wb-start-step is-next"><span aria-hidden>1</span><div><strong>描述产品想法</strong><small>说清目标、受众与约束，Kern 先询问必要信息。</small></div></div>
                </li>
                <li>
                  <Link href="/settings" className="kx-wb-start-step"><span aria-hidden>2</span><div><strong>检查运行状态</strong><small>确认可用模型、检索与后台执行服务。</small></div><Icon name="arrow" size={14} /></Link>
                </li>
                <li>
                  <Link href="/knowledge" className="kx-wb-start-step"><span aria-hidden>3</span><div><strong>补充公司上下文</strong><small>导入产品、渠道和规范，让建议有依据。</small></div><Icon name="arrow" size={14} /></Link>
                </li>
              </ol>
            </section>
            <section className="kx-wb-start-examples" aria-labelledby="kx-wb-examples-title">
              <div className="kx-wb-examples-head"><h2 id="kx-wb-examples-title">也可以从一件具体的工作开始</h2><span>选择后进入对话草稿，不会自动执行</span></div>
              <div className="kx-wb-examples-grid">
                {START_EXAMPLES.map((example) => <Link key={example.title} href={`/muse?query=${encodeURIComponent(example.prompt)}`} className="kx-wb-example"><Icon name={example.icon} size={20} /><strong>{example.title}</strong><p>{example.hint}</p><span>交给 Kern <Icon name="arrow" size={14} /></span></Link>)}
              </div>
            </section>
          </>
        ) : null}

        {showOverview ? <div className="kx-wb-cols" data-aside={showAside ? "true" : "false"} data-main={showNeeds || showProducts ? "true" : "false"}>
          <div className="kx-wb-stack">
            {showNeeds ? (
            <section className="kx-wb-card" aria-label="需要你处理">
              <CardHead title="需要你处理什么？" count={<Count n={ranked.total} bad />} />
              {top ? (
                <div className="kx-wb-focus">
                  <div className="kx-wb-focus-t">
                    <Tag tone={decisionTone(top)}>{decisionLabel(top)}</Tag>
                    <b>{top.what}</b>
                  </div>
                  <p className="kx-wb-muted">
                    {top.whyNow}
                    {top.dueAt ? ` · 截止 ${fmtDate(top.dueAt)}` : ""}
                  </p>
                  {top.suggestion || top.riskLabel ? (
                    <div className="kx-wb-facts">
                      {top.suggestion ? (
                        <div>
                          <small>Kern 建议</small>
                          <b>{top.suggestion}</b>
                        </div>
                      ) : null}
                      {top.riskLabel ? (
                        <div>
                          <small>关键风险</small>
                          <b>{top.riskLabel}</b>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="kx-wb-actions">
                    <Link href={top.href} className="hermes-primary-btn hermes-btn-sm">
                      去处理
                      <Icon name="arrow" size={14} />
                    </Link>
                    <Link
                      href={`/muse?query=${encodeURIComponent(`帮我分析这个待处理事项：${top.what}。请说明为什么现在要处理、主要风险和建议动作。`)}`}
                      className="hermes-outline-btn hermes-btn-sm"
                    >
                      和 Kern 讨论
                    </Link>
                  </div>
                </div>
              ) : (
                <EmptyLine tone="ok">当前没有待审批、阻塞或待验收事项。有新工作可以直接去和 Kern 说。</EmptyLine>
              )}
              {rest.map((item, i) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="kx-wb-row is-enter"
                  style={{ "--m-row-index": i } as React.CSSProperties}
                >
                  <span className="kx-wb-row-t">
                    <b>{item.what}</b>
                    <small>
                      {item.ownerName ? `${item.ownerName} · ` : ""}
                      {item.dueAt ? `截止 ${fmtDate(item.dueAt)}` : "未设置截止时间"}
                    </small>
                  </span>
                  <Tag tone={decisionTone(item)}>{decisionLabel(item)}</Tag>
                </Link>
              ))}
              {ranked.total > 6 ? (
                <p className="kx-wb-more">还有 {ranked.total - 6} 件，请从对应产品继续处理。</p>
              ) : null}
            </section>
            ) : null}

            {showProducts ? (
            <section className="kx-wb-card" aria-label="核心工作推进">
              <CardHead
                title="核心工作推进到哪里？"
                count={<Count n={overview.productsInFlight.count} />}
                link={{ href: "/products", label: "全部产品" }}
              />
              {productItems.length > 0 ? (
                <table className="kx-wb-table">
                  <thead>
                    <tr>
                      <th scope="col">产品</th>
                      <th scope="col">阶段</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productItems.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <Link href={item.href || "/products"} className="kx-wb-cell">
                            <b>{item.title}</b>
                            {item.meta ? <small>{item.meta}</small> : null}
                          </Link>
                        </td>
                        <td>
                          <Tag>{labelProductLifecycleStage(item.status)}</Tag>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyLine>还没有正在推进的产品。可以去和 Kern 说一个产品想法，让它帮你开始。</EmptyLine>
              )}
            </section>
            ) : null}
          </div>

          <aside className="kx-wb-stack" aria-label="Kern 与异常">
            {showAutomation ? (
            <section className="kx-wb-card">
              <CardHead
                title="自动化活动"
                count={<Count n={doingCount + workforceActivity.attentionCount} />}
                link={{ href: "/workforce", label: "自动化中心" }}
              />
              {hasAutomationActivity ? (
                <>
                  <p className="kx-wb-line">
                    最近 {workforceActivity.windowHours} 小时记录：自动触发 {workforceActivity.triggeredCount} · 待复核{" "}
                    {workforceActivity.returnReviewCount} · 等待人工 {waitingCount}
                  </p>
                  <div className="kx-wb-traces">
                    <AutomationTraceList
                      traces={workforceActivity.recentTraces.slice(0, 3)}
                      emptyText="最近还没有业务事件驱动的自动工作。"
                    />
                  </div>
                </>
              ) : (
                <EmptyLine>最近 {workforceActivity.windowHours} 小时没有自动化活动。</EmptyLine>
              )}
            </section>
            ) : null}

            {showWarnings ? (
            <section className="kx-wb-card">
              <CardHead title="哪里异常？" count={<Count n={warnItems.length} bad />} />
              {warnItems.length > 0 ? (
                warnItems.map((item, i) =>
                  item.href ? (
                    <Link
                      key={item.id}
                      href={item.href}
                      className="kx-wb-row is-dot is-enter"
                      style={{ "--m-row-index": i } as React.CSSProperties}
                    >
                      <i className={`kx-dot is-${item.tone}`} aria-hidden />
                      <span className="kx-wb-row-t">
                        <b>{item.title}</b>
                        <small>{item.meta}</small>
                      </span>
                    </Link>
                  ) : (
                    <div
                      key={item.id}
                      className="kx-wb-row is-dot is-enter"
                      role="status"
                      style={{ "--m-row-index": i } as React.CSSProperties}
                    >
                      <i className={`kx-dot is-${item.tone}`} aria-hidden />
                      <span className="kx-wb-row-t">
                        <b>{item.title}</b>
                        <small>{item.meta}</small>
                      </span>
                    </div>
                  )
                )
              ) : (
                <EmptyLine tone="ok">没有异常。</EmptyLine>
              )}
            </section>
            ) : null}

            {showCompleted ? (
            <section className="kx-wb-card">
              <CardHead title="最近完成" count={<Count n={overview.recentlyCompleted.count} />} />
              {completedItems.length > 0 ? (
                completedItems.map((item, i) => (
                  <Link
                    key={item.id}
                    href={item.href || "/products"}
                    className="kx-wb-row is-enter"
                    style={{ "--m-row-index": i } as React.CSSProperties}
                  >
                    <span className="kx-wb-row-t">
                      <b>{item.title}</b>
                      {/* 这个列表只收 ACCEPTED 工作项，所以缺 meta 时按真实状态说「已验收」。 */}
                      <small>{item.meta || "已验收"}</small>
                    </span>
                  </Link>
                ))
              ) : (
                <EmptyLine>最近还没有验收完成的工作项。</EmptyLine>
              )}
            </section>
            ) : null}
          </aside>
        </div> : null}

        <footer className="kx-wb-foot">
          {/* 2026-10-04：原先在此把组织 UUID 截断成 8 位展示（实现腔文案）。
              组织标识改由设置 · 账户承担，这里只陈述口径事实。 */}
          <span>{overview.meta.permissionLabel}</span>
          {isFirstUse ? <span>数据更新于 {fmtDateTime(overview.meta.generatedAt)}</span> : null}
          {overview.earliestBlockerDueAt ? <span>最早阻塞截止 {fmtDate(overview.earliestBlockerDueAt)}</span> : null}
        </footer>
      </div>
    </AppShell>
  );
}
