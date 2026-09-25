"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/app-shell";
import { Badge, Empty, Panel } from "@/components/ui";
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

const QUICK_ACTIONS = [
  { label: "研究一个新产品", query: "我有一个新产品想法，请帮我先梳理目标用户、核心需求、市场机会和研发路径。" },
  { label: "分析市场机会", query: "帮我分析最近值得关注的市场机会，并说明证据、风险和下一步验证方式。" },
  { label: "开始产品研发", query: "我想启动一轮完整产品研发，请先帮我整理研发 Brief，再告诉我还缺哪些输入。" },
  { label: "专家会诊", query: "我需要一次多专业专家会诊，请从市场、科研、配方、合规、成本和反方视角审查当前问题。" },
];

const TIER_LABEL: Record<string, string> = {
  high: "高价值",
  normal: "一般",
  low: "低",
};

function decisionLabel(item: BriefDecisionItem): string {
  if (item.kind === "decision") return "等你决定";
  if (item.kind === "blocker") return "阻塞";
  return item.status === "SUBMITTED" ? "待验收" : "待处理";
}

function decisionTone(item: BriefDecisionItem): "warn" | "danger" | "info" {
  if (item.kind === "blocker") return "danger";
  if (item.kind === "decision") return "warn";
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
  const router = useRouter();
  const [activeUserId, setActiveUserId] = React.useState(
    currentSession?.userId || allUsers[0]?.id || ""
  );
  const [command, setCommand] = React.useState("");
  // 本机执行是「Hermes 正在替我做什么」的一部分；没有本机任务时整块不出现。
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
  const productItems = overview.productsInFlight.items.slice(0, 5);
  const signalItems = overview.opportunities.items.slice(0, 5);
  const completedItems = overview.recentlyCompleted.items.slice(0, 4);

  // 「正在工作」是现在进行时，只有窗口内真的有自动化活动才能这么说；
  // 全零时这块是历史统计，标题就按统计说，不要让空面板宣告 Hermes 在干活。
  const hasAutomationActivity =
    workforceActivity.eventCount > 0 ||
    workforceActivity.attentionCount > 0 ||
    workforceActivity.recentTraces.length > 0;

  const submitCommand = (e: React.FormEvent) => {
    e.preventDefault();
    const q = command.trim();
    if (!q) return;
    router.push(`/advisor?query=${encodeURIComponent(q)}`);
  };

  return (
    <AppShell
      active="overview"
      user={{ name: displayName, meta: currentSession?.userEmail }}
      runtime={runtime}
      topbarLeft={
        <div className="hermes-topbar-title">
          <span className="eyebrow">HERMES · DEPARTMENT ASSISTANT</span>
          <strong>今日</strong>
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
          <Link href="/workforce" className="hermes-outline-btn">
            <Icon name="nodes" size={16} />
            自动化中心
          </Link>
        </div>
      }
    >
      <section className="hermes-command-center" aria-labelledby="today-command-title">
        <div className="hermes-command-copy">
          <span className="eyebrow">AI 部门助理</span>
          <h1 id="today-command-title">{displayName}，今天想让 Hermes 做什么？</h1>
          <p>
            直接说业务目标。Hermes 会先理解上下文，再决定是回答、研究、拆任务，还是启动产品研发流程。
          </p>
        </div>

        <form className="hermes-command-box" onSubmit={submitCommand}>
          <Icon name="chat" size={20} />
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="例如：我要做一款针对 25–45 岁女性的肠道产品，售价 299，先帮我评估"
            aria-label="告诉 Hermes 你想完成什么"
          />
          <button type="submit" className="hermes-primary-btn" disabled={!command.trim()}>
            交给 Hermes
            <Icon name="arrow" size={15} />
          </button>
        </form>

        <div className="hermes-command-actions" aria-label="常用任务">
          {QUICK_ACTIONS.map((action) => (
            <Link
              key={action.label}
              href={`/advisor?query=${encodeURIComponent(action.query)}`}
              className="hermes-command-chip"
            >
              {action.label}
            </Link>
          ))}
        </div>
      </section>

      <DesktopConversationStrip overview={desktopOverview} />

      {overview.portfolio.productCount === 0 ? (
        <section className="hermes-onboarding" aria-labelledby="hermes-onboarding-title">
          <div className="hermes-onboarding-head">
            <div>
              <span className="eyebrow">GET STARTED</span>
              <h2 id="hermes-onboarding-title">第一次使用，三步就够了</h2>
              <p>不用先研究 Agent、项目或治理对象。把基础环境准备好，然后直接告诉 Hermes 你想做什么。</p>
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
              href={`/advisor?query=${encodeURIComponent("我想创建第一个产品。请先问我最少必要信息，再帮我整理产品 Brief、关键假设和第一轮验证计划。")}`}
              className="hermes-onboarding-step is-primary"
            >
              <span>3</span>
              <div>
                <strong>告诉 Hermes 你的产品想法</strong>
                <small>从对话开始，不需要先手工建立复杂项目结构。</small>
              </div>
              <Icon name="arrow" size={14} />
            </Link>
          </div>
        </section>
      ) : null}

      {overview.degraded ? (
        <div className="hermes-home-alert" role="status">
          <strong>部分信息暂未更新。</strong>
          <span>{overview.degradedNote || "当前页面仍展示最后一次可用的真实数据。"}</span>
        </div>
      ) : null}

      <section className="hermes-today-stats" aria-label="今日摘要">
        <div>
          <span>需要你处理</span>
          <strong>{ranked.total}</strong>
          <small>{overview.blockers.count > 0 ? `其中阻塞 ${overview.blockers.count} 项` : "当前无阻塞项"}</small>
        </div>
        <div>
          <span>正在推进产品</span>
          <strong>{overview.productsInFlight.count}</strong>
          <small>组织内产品 {overview.portfolio.productCount} 个</small>
        </div>
        <div>
          <span>高价值市场机会</span>
          <strong>{overview.opportunities.count}</strong>
          <small>仅统计已分级信号</small>
        </div>
        <div>
          <span>Hermes 等你</span>
          <strong>{workforceActivity.attentionCount}</strong>
          <small>结果复核或人工判断</small>
        </div>
      </section>

      <div className="hermes-today-grid">
        <section className="hermes-today-main">
          <Panel
            icon="target"
            title="需要你处理"
            sub={
              ranked.total > 0
                ? `按截止时间、依赖等待与责任归属排序 · 共 ${ranked.total} 件`
                : "当前没有等待你处理的事项"
            }
          >
            {top ? (
              <div className="hermes-focus-task">
                <div className="hermes-focus-task-head">
                  <Badge tone={decisionTone(top)}>{decisionLabel(top)}</Badge>
                  {top.dueAt ? <span>截止 {fmtDate(top.dueAt)}</span> : null}
                </div>
                <h2>{top.what}</h2>
                <p>{top.whyNow}</p>
                <div className="hermes-focus-task-facts">
                  {top.suggestion ? (
                    <div>
                      <span>Hermes 建议</span>
                      <strong>{top.suggestion}</strong>
                    </div>
                  ) : null}
                  {top.riskLabel ? (
                    <div>
                      <span>关键风险</span>
                      <strong>{top.riskLabel}</strong>
                    </div>
                  ) : null}
                </div>
                <div className="hermes-focus-task-actions">
                  <Link href={top.href} className="hermes-primary-btn">
                    去处理
                    <Icon name="arrow" size={15} />
                  </Link>
                  <Link
                    href={`/advisor?query=${encodeURIComponent(`帮我分析这个待处理事项：${top.what}。请说明为什么现在要处理、主要风险和建议动作。`)}`}
                    className="hermes-outline-btn"
                  >
                    和 Hermes 讨论
                  </Link>
                </div>
              </div>
            ) : (
              <Empty>
                当前没有待审批、阻塞或待验收事项。你可以直接在上方告诉 Hermes 下一项工作。
              </Empty>
            )}

            {rest.length > 0 ? (
              <div className="hermes-simple-queue">
                {rest.map((item) => (
                  <Link key={item.id} href={item.href} className="hermes-simple-queue-row">
                    <div>
                      <strong>{item.what}</strong>
                      <span>
                        {item.ownerName ? `${item.ownerName} · ` : ""}
                        {item.dueAt ? `截止 ${fmtDate(item.dueAt)}` : "未设置截止时间"}
                      </span>
                    </div>
                    <Badge tone={decisionTone(item)}>{decisionLabel(item)}</Badge>
                  </Link>
                ))}
                {ranked.total > 6 ? (
                  <div className="hermes-queue-more">还有 {ranked.total - 6} 件，请从对应产品继续处理。</div>
                ) : null}
              </div>
            ) : null}
          </Panel>

          <Panel
            icon="flask"
            title="产品推进"
            sub="从产品出发查看研发、打样、生产准备与上市，而不是先理解项目对象"
            actions={
              <Link href="/products" className="hermes-link">
                查看全部产品 <Icon name="arrow" size={13} />
              </Link>
            }
          >
            {productItems.length > 0 ? (
              <div className="hermes-object-list">
                {productItems.map((item) => (
                  <Link key={item.id} href={item.href || "/products"} className="hermes-object-row">
                    <span className="hermes-object-mark" aria-hidden="true">
                      {item.title.trim().slice(0, 1)}
                    </span>
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.meta || "暂无补充说明"}</span>
                    </div>
                    <Badge tone="neutral">{labelProductLifecycleStage(item.status)}</Badge>
                  </Link>
                ))}
              </div>
            ) : (
              <Empty>
                还没有正在推进的产品。可以在上方直接描述一个产品想法，让 Hermes 帮你开始。
              </Empty>
            )}
          </Panel>
        </section>

        <aside className="hermes-today-side">
          <Panel
            icon="nodes"
            title={hasAutomationActivity ? "Hermes 正在工作" : "自动化活动"}
            sub={
              hasAutomationActivity
                ? `最近 ${workforceActivity.windowHours} 小时的真实自动化活动`
                : `最近 ${workforceActivity.windowHours} 小时没有自动化活动`
            }
            actions={
              <Link href="/workforce" className="hermes-link">
                查看自动化中心 <Icon name="arrow" size={13} />
              </Link>
            }
          >
            <div className="hermes-automation-summary">
              <div>
                <strong>{workforceActivity.triggeredCount}</strong>
                <span>自动触发</span>
              </div>
              <div>
                <strong>{workforceActivity.returnReviewCount}</strong>
                <span>结果待复核</span>
              </div>
              <div>
                <strong>{workforceActivity.waitingHumanCount + workforceActivity.waitingPolicyCount}</strong>
                <span>等待人工</span>
              </div>
              <div className={workforceActivity.failedCount > 0 ? "is-alert" : ""}>
                <strong>{workforceActivity.failedCount}</strong>
                <span>失败</span>
              </div>
            </div>
            <AutomationTraceList
              traces={workforceActivity.recentTraces.slice(0, 4)}
              emptyText="最近还没有业务事件驱动的自动工作。"
            />
          </Panel>

          <Panel
            icon="signal"
            title="值得看的市场机会"
            actions={
              <Link href="/opportunities" className="hermes-link">
                查看全部 <Icon name="arrow" size={13} />
              </Link>
            }
          >
            {signalItems.length > 0 ? (
              <div className="hermes-object-list is-compact">
                {signalItems.map((item) => (
                  <Link key={item.id} href={item.href || "/opportunities"} className="hermes-object-row">
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.meta || item.summary || "等待进一步验证"}</span>
                    </div>
                    <Badge tone={item.tier === "high" ? "ok" : "neutral"}>
                      {item.tier ? TIER_LABEL[item.tier] || item.tier : "未评估"}
                    </Badge>
                  </Link>
                ))}
              </div>
            ) : (
              <Empty>目前没有高价值市场信号。</Empty>
            )}
          </Panel>

          <Panel icon="check" title="最近完成">
            {completedItems.length > 0 ? (
              <div className="hermes-completed-list">
                {completedItems.map((item) => (
                  <Link key={item.id} href={item.href || "/products"}>
                    <Icon name="check" size={14} />
                    <span>
                      <strong>{item.title}</strong>
                      {/* 这个列表只收 ACCEPTED 工作项，所以缺 meta 时按真实状态说「已验收」，
                          不要用一句泛泛的「已完成」替代缺失信息。 */}
                      <small>{item.meta || "已验收"}</small>
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <Empty>暂无最近完成事项。</Empty>
            )}
          </Panel>
        </aside>
      </div>

      <footer className="hermes-home-scope">
        <span>更新时间 {fmtDateTime(overview.meta.generatedAt)}</span>
        <span>{overview.meta.scopeLabel}</span>
        <span>{overview.meta.permissionLabel}</span>
        {overview.earliestBlockerDueAt ? (
          <span>最早阻塞截止 {fmtDate(overview.earliestBlockerDueAt)}</span>
        ) : null}
      </footer>
    </AppShell>
  );
}
