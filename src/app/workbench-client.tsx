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
            <h1>今日</h1>
            <p>{summary}</p>
          </div>
          <Link href="/muse" className="hermes-outline-btn kx-wb-talk">
            去和 Kern 说
            <Icon name="arrow" size={14} />
          </Link>
        </header>

        <DesktopConversationStrip overview={desktopOverview} />

        {overview.portfolio.productCount === 0 ? (
          <section className="hermes-onboarding" aria-labelledby="hermes-onboarding-title">
            <div className="hermes-onboarding-head">
              <div>
                <h2 id="hermes-onboarding-title">第一次使用，三步就够了</h2>
                <p>不用先研究 Agent、项目或治理对象。把基础环境准备好，然后直接告诉 Kern 你想做什么。</p>
              </div>
              <Badge tone="info">尚未创建产品</Badge>
            </div>

            <div className="hermes-onboarding-steps">
              <Link href="/settings" className="hermes-onboarding-step">
                <span>1</span>
                <div>
                  <strong>确认 AI 与模型</strong>
                  <small>配置可用模型；未配置时结构化治理能力仍可运行。</small>
                </div>
                <Icon name="arrow" size={14} />
              </Link>
              <Link href="/knowledge" className="hermes-onboarding-step">
                <span>2</span>
                <div>
                  <strong>补充公司知识</strong>
                  <small>导入产品、渠道、规范与历史资料，让建议带上公司上下文。</small>
                </div>
                <Icon name="arrow" size={14} />
              </Link>
              <Link
                href={`/muse?query=${encodeURIComponent("我想创建第一个产品。请先问我最少必要信息，再帮我整理产品 Brief、关键假设和第一轮验证计划。")}`}
                className="hermes-onboarding-step is-primary"
              >
                <span>3</span>
                <div>
                  <strong>告诉 Kern 你的产品想法</strong>
                  <small>从对话开始，不需要先手工建立复杂项目结构。</small>
                </div>
                <Icon name="arrow" size={14} />
              </Link>
            </div>
          </section>
        ) : null}

        <div className="kx-wb-cols">
          <div className="kx-wb-stack">
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
          </div>

          <aside className="kx-wb-stack" aria-label="Kern 与异常">
            <section className="kx-wb-card">
              <CardHead
                title="Kern 正在做什么？"
                count={<Count n={doingCount + workforceActivity.attentionCount} />}
                link={{ href: "/workforce", label: "自动化中心" }}
              />
              {hasAutomationActivity ? (
                <>
                  <p className="kx-wb-line">
                    Kern 正在工作 · 最近 {workforceActivity.windowHours} 小时：自动触发 {workforceActivity.triggeredCount} · 待复核{" "}
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
          </aside>
        </div>

        <footer className="kx-wb-foot">
          {/* 2026-10-04：原先在此把组织 UUID 截断成 8 位展示（实现腔文案）。
              组织标识改由设置 · 账户承担，这里只陈述口径事实。 */}
          <span>{overview.meta.permissionLabel}</span>
          {overview.earliestBlockerDueAt ? <span>最早阻塞截止 {fmtDate(overview.earliestBlockerDueAt)}</span> : null}
        </footer>
      </div>
    </AppShell>
  );
}
