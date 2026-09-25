"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell, { type RuntimeStatus } from "@/components/app-shell";
import { Empty, Modal, Panel } from "@/components/ui";
import { HeroBand, Kpi, KpiRow, Pill } from "@/components/cockpit";
import {
  DesktopActivityBody,
  useDesktopOverview,
} from "@/components/desktop-activity";
import Icon from "@/components/icons";
import {
  AutomationTraceList,
  type AutomationTraceView,
} from "@/components/automation-trace";
import { labelSquadLifecycleStatus } from "@/shared/status-labels";

type WorkforceOverview = {
  agents: Array<{
    id: string;
    code: string;
    name: string;
    description: string | null;
    roleKey: string;
    status: string;
    maxConcurrentTasks: number;
    skillBindings: Array<{
      skill: { id: string; key: string; name: string };
    }>;
    _count: { tasks: number; runs: number };
    presence: {
      availability: "READY" | "PAUSED" | "ARCHIVED";
      workload: "WORKING" | "QUEUED" | "IDLE";
      running: number;
      queued: number;
      waitingHuman: number;
      capacity: number;
    };
  }>;
  squads: Array<{
    id: string;
    code: string;
    name: string;
    description: string | null;
    status: string;
    leader: { id: string; code: string; name: string };
    members: Array<{
      id: string;
      roleDescription: string | null;
      agent: { id: string; code: string; name: string; status: string } | null;
      user: { id: string; name: string } | null;
    }>;
  }>;
  waitingTasks: Array<{
    id: string;
    goal: string;
    blockedReason: string | null;
    updatedAt: string;
    agent: { id: string; code: string; name: string };
    workItem: { id: string; title: string; projectId: string } | null;
  }>;
  returnReviews: Array<{
    id: string;
    goal: string;
    status: string;
    blockedReason: string | null;
    createdAt: string;
    updatedAt: string;
    agent: { id: string; code: string; name: string };
    decisionRun: { id: string; decisionKey: string; specVersion: string } | null;
    returned: {
      parentTaskId: string | null;
      parentTaskGoal: string | null;
      childTaskId: string | null;
      childAgentCode: string | null;
      childOutcome: string | null;
      resultSummary: string | null;
      reason: string | null;
    };
  }>;
};

function availabilityTone(value: string): "ok" | "warn" | "neutral" {
  if (value === "READY") return "ok";
  if (value === "PAUSED") return "warn";
  return "neutral";
}

function workloadTone(value: string): "info" | "warn" | "neutral" {
  if (value === "WORKING") return "info";
  if (value === "QUEUED") return "warn";
  return "neutral";
}

function availabilityLabel(value: string) {
  if (value === "READY") return "可接活";
  if (value === "PAUSED") return "已暂停";
  return "已归档";
}

function workloadLabel(value: string) {
  if (value === "WORKING") return "执行中";
  if (value === "QUEUED") return "有排队";
  return "空闲";
}

export default function WorkforceClient({
  overview,
  automationTraces,
  session,
  runtime,
  canBootstrap,
}: {
  overview: WorkforceOverview;
  automationTraces: AutomationTraceView[];
  session: { userId: string; userName: string; userEmail: string };
  runtime: RuntimeStatus;
  canBootstrap: boolean;
}) {
  const router = useRouter();
  const { overview: desktopOverview, loaded: desktopLoaded } = useDesktopOverview({
    intervalMs: 6000,
  });
  // 页头这句话是现在进行时，必须跟真实计数一致：没有任何在跑或待办时，
  // 不能一直宣称「Hermes 正在替你推进工作」。
  const runningNow = overview.agents.reduce((sum, a) => sum + a.presence.running, 0);
  const attentionNow = overview.waitingTasks.length + overview.returnReviews.length;
  const heroTagline =
    runningNow > 0
      ? `Hermes 正在执行 ${runningNow} 项工作。`
      : attentionNow > 0
        ? `有 ${attentionNow} 项需要你处理。`
        : "当前没有正在执行的自动化工作。";

  const [bootstrapping, setBootstrapping] = React.useState(false);
  const [bootstrapError, setBootstrapError] = React.useState<string | null>(null);
  const [reviewBusyId, setReviewBusyId] = React.useState<string | null>(null);
  const [reviewError, setReviewError] = React.useState<string | null>(null);
  const [reviewModal, setReviewModal] = React.useState<{
    mode: "delegate" | "escalate" | "close";
    review: WorkforceOverview["returnReviews"][number];
  } | null>(null);
  const [reviewForm, setReviewForm] = React.useState({
    toAgentId: "",
    goal: "",
    reason: "",
  });

  const activeAgents = overview.agents.filter((agent) => agent.status === "ACTIVE").length;
  const working = overview.agents.filter(
    (agent) => agent.presence.workload === "WORKING"
  ).length;
  const queued = overview.agents.reduce(
    (sum, agent) => sum + agent.presence.queued,
    0
  );
  const waitingHuman = overview.agents.reduce(
    (sum, agent) => sum + agent.presence.waitingHuman,
    0
  );

  async function bootstrap() {
    setBootstrapping(true);
    setBootstrapError(null);
    try {
      const response = await fetch("/api/workforce/bootstrap", { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || body?.message || "初始化数字员工团队失败");
      }
      router.refresh();
    } catch (error) {
      setBootstrapError(error instanceof Error ? error.message : "初始化数字员工团队失败");
    } finally {
      setBootstrapping(false);
    }
  }

  async function reviewAction(
    reviewId: string,
    action: "ACCEPT_RESULT" | "CONTINUE_DELEGATION" | "ESCALATE_HUMAN" | "CLOSE_PARENT",
    extra: Record<string, string> = {}
  ) {
    setReviewBusyId(reviewId);
    setReviewError(null);
    try {
      const response = await fetch(
        `/api/workforce/tasks/${reviewId}/review-return`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...extra }),
        }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error || body?.message || "复核动作失败");
      }
      setReviewModal(null);
      setReviewForm({ toAgentId: "", goal: "", reason: "" });
      router.refresh();
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "复核动作失败");
    } finally {
      setReviewBusyId(null);
    }
  }

  function openReviewModal(
    mode: "delegate" | "escalate" | "close",
    review: WorkforceOverview["returnReviews"][number]
  ) {
    setReviewError(null);
    setReviewForm({
      toAgentId: "",
      goal:
        mode === "delegate"
          ? `继续处理：${review.returned.parentTaskGoal || review.goal}`
          : "",
      reason: "",
    });
    setReviewModal({ mode, review });
  }

  return (
    <AppShell
      active="workforce"
      user={{ name: session.userName, meta: session.userEmail }}
      runtime={runtime}
      topbarLeft={
        <div className="hermes-topbar-title">
          <span className="eyebrow">HERMES · AUTONOMOUS WORKFORCE</span>
          <strong>自动化中心</strong>
        </div>
      }
      topbarRight={
        overview.agents.length === 0 && canBootstrap ? (
          <button
            type="button"
            className="hermes-primary-btn"
            onClick={bootstrap}
            disabled={bootstrapping}
          >
            <Icon name="users" size={16} />
            {bootstrapping ? "初始化中…" : "初始化 Hermes 团队"}
          </button>
        ) : null
      }
    >
      <HeroBand
        eyebrow="等待你处理 · 正在执行 · 最近完成"
        mark="自动化中心"
        tagline={heroTagline}
        intro="先看需要你拍板的事，再看正在跑的任务。改变业务事实要经过治理链，需要你判断时会明确停下来等你，不会自己替你决定。"
        quote={
          <>
            Governed Autonomy
            <br />
            Human Final Say
          </>
        }
      />

      <KpiRow>
        <Kpi label="数字员工" value={overview.agents.length} note={"活跃 " + activeAgents + " 名"} />
        <Kpi label="正在执行" value={working} emphasis="primary" note="按 Agent 计" />
        <Kpi label="排队任务" value={queued} note="等待执行资源" />
        <Kpi
          label="等待你拍板"
          value={waitingHuman}
          tone={waitingHuman > 0 ? "alert" : undefined}
          emphasis={waitingHuman > 0 ? "decision" : undefined}
          note="不会伪装成已完成"
        />
        <Kpi label="Squad" value={overview.squads.length} note="Hermes PM 负责路由" />
      </KpiRow>

      {bootstrapError ? <div className="hermes-banner is-danger">{bootstrapError}</div> : null}

      {overview.agents.length === 0 ? (
        <Panel icon="users" title="还没有数字员工">
          <Empty>
            {canBootstrap
              ? "当前组织尚未初始化 Workforce Kernel。点击右上角即可建立 Hermes PM、Product、Research、Marketing、Ops 和 Red Team。"
              : "当前组织尚未初始化数字员工团队，请由组织管理员完成初始化。"}
          </Empty>
        </Panel>
      ) : (
        <div className="hermes-cockpit">
          <div className="hermes-cockpit-main">
            <Panel
              icon="target"
              title="等待你拍板"
              sub="Agent 主动停止并请求人类判断的任务。"
            >
              {overview.waitingTasks.length > 0 ? (
                <div className="hermes-list">
                  {overview.waitingTasks.map((task) => (
                    <div className="hermes-row is-flat" key={task.id}>
                      <div className="hermes-row-head">
                        <strong className="hermes-row-title">{task.goal}</strong>
                        <Pill tone="warn">{task.agent.name}</Pill>
                      </div>
                      {task.blockedReason ? (
                        <div className="hermes-row-body">{task.blockedReason}</div>
                      ) : null}
                      {task.workItem ? (
                        <div style={{ marginTop: 8 }}>
                          <Link
                            href={"/projects/" + task.workItem.projectId}
                            className="hermes-link"
                          >
                            查看关联工作项 <Icon name="arrow" size={13} />
                          </Link>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <Empty>当前没有数字员工在等待人工判断。</Empty>
              )}
            </Panel>

            <Panel
              icon="nodes"
              title="本机执行"
              sub="Hermes 在你这台 Mac 上真实执行的工作。排队中的任务需要 Mac 端连上才会开始。"
            >
              <DesktopActivityBody overview={desktopOverview} loaded={desktopLoaded} />
            </Panel>

            <Panel
              icon="users"
              title="数字员工团队"
              sub="长期身份与执行运行分离；这里展示当前真实负载，不把历史失败当成在线状态。"
            >
              <div className="hermes-list">
                {overview.agents.map((agent) => (
                  <div className="hermes-row" key={agent.id}>
                    <div className="hermes-row-head">
                      <span className="hermes-row-mark">{agent.name.slice(0, 1)}</span>
                      <strong className="hermes-row-title">{agent.name}</strong>
                      <Pill tone={availabilityTone(agent.presence.availability)}>
                        {availabilityLabel(agent.presence.availability)}
                      </Pill>
                      <Pill tone={workloadTone(agent.presence.workload)}>
                        {workloadLabel(agent.presence.workload)}
                      </Pill>
                    </div>
                    <div className="hermes-row-meta">
                      <span>{agent.roleKey}</span>
                      <span>
                        并发 {agent.presence.running}/{agent.presence.capacity}
                      </span>
                      <span>排队 {agent.presence.queued}</span>
                      <span>等待人类 {agent.presence.waitingHuman}</span>
                      <span>历史运行 {agent._count.runs}</span>
                    </div>
                    <div className="hermes-row-body">
                      <div>{agent.description || "未填写职责描述"}</div>
                      <div className="hermes-inline" style={{ marginTop: 8 }}>
                        {agent.skillBindings.map((binding) => (
                          <span className="hermes-chip" key={binding.skill.id}>
                            {binding.skill.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel
              icon="check"
              title="结果待复核"
              sub="专业 Agent 返回结果后由原父 Agent 复核；接受、继续委派、升级人工和关闭父工作都会留痕。"
            >
              {overview.returnReviews.length > 0 ? (
                <div className="hermes-list">
                  {overview.returnReviews.map((review) => (
                    <div className="hermes-row" key={review.id}>
                      <div className="hermes-row-head">
                        <strong className="hermes-row-title">
                          {review.returned.parentTaskGoal || review.goal}
                        </strong>
                        <Pill tone={review.status === "WAITING_HUMAN" ? "warn" : "info"}>
                          {review.agent.name} 复核
                        </Pill>
                      </div>
                      <div className="hermes-row-meta">
                        <span>子 Agent {review.returned.childAgentCode || "未知"}</span>
                        <span>结果 {review.returned.childOutcome || "未知"}</span>
                        <span>
                          {review.decisionRun
                            ? `${review.decisionRun.decisionKey}@${review.decisionRun.specVersion}`
                            : "无 DecisionRun"}
                        </span>
                      </div>
                      <div className="hermes-row-body">
                        <strong>返回摘要</strong>
                        <div style={{ marginTop: 5 }}>
                          {review.returned.resultSummary || review.returned.reason || "没有可读结果摘要。"}
                        </div>
                      </div>
                      {review.blockedReason ? (
                        <div className="hermes-note" style={{ marginTop: 8 }}>
                          人工判断原因：{review.blockedReason}
                        </div>
                      ) : null}
                      <div className="hermes-inline" style={{ marginTop: 10 }}>
                        <button
                          type="button"
                          className="hermes-primary-btn hermes-btn-sm"
                          disabled={reviewBusyId === review.id}
                          onClick={() => reviewAction(review.id, "ACCEPT_RESULT")}
                        >
                          接受结果
                        </button>
                        <button
                          type="button"
                          className="hermes-outline-btn hermes-btn-sm"
                          disabled={reviewBusyId === review.id}
                          onClick={() => openReviewModal("delegate", review)}
                        >
                          继续委派
                        </button>
                        <button
                          type="button"
                          className="hermes-outline-btn hermes-btn-sm"
                          disabled={reviewBusyId === review.id}
                          onClick={() => openReviewModal("escalate", review)}
                        >
                          升级人工
                        </button>
                        <button
                          type="button"
                          className="hermes-ghost-btn hermes-btn-sm"
                          disabled={reviewBusyId === review.id}
                          onClick={() => openReviewModal("close", review)}
                        >
                          关闭父工作
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty>当前没有专业 Agent 返回结果等待复核。</Empty>
              )}
            </Panel>

            <Panel
              icon="nodes"
              title="自动化因果链"
              sub="真实业务事件 → Autopilot → DecisionRun → AgentTask。被抑制的判断也保留原因，不静默丢弃。"
            >
              <AutomationTraceList
                traces={automationTraces}
                emptyText="还没有业务事件驱动数字员工；手工任务不会伪装成自动化。"
              />
            </Panel>

            <Panel
              icon="target"
              title="Squad"
              sub="Leader 不是把所有 Agent 一起唤醒，而是先判断，再把工作交给最合适的成员。"
            >
              <div className="hermes-list">
                {overview.squads.map((squad) => (
                  <div className="hermes-row" key={squad.id}>
                    <div className="hermes-row-head">
                      <span className="hermes-row-mark">{squad.name.slice(0, 1)}</span>
                      <strong className="hermes-row-title">{squad.name}</strong>
                      <Pill tone="info">Leader · {squad.leader.name}</Pill>
                    </div>
                    <div className="hermes-row-meta">
                      <span>{squad.members.length} 名成员</span>
                      <span>{labelSquadLifecycleStatus(squad.status)}</span>
                    </div>
                    <div className="hermes-row-body">
                      <div>{squad.description || "未填写 Squad 描述"}</div>
                      <div className="hermes-inline" style={{ marginTop: 8 }}>
                        {squad.members.map((member) => (
                          <span className="hermes-chip" key={member.id}>
                            {member.agent?.name || member.user?.name || "未知成员"}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <aside className="hermes-cockpit-side">

            <Panel icon="shield" title="自治边界">
              <div className="hermes-list">
                <div className="hermes-row is-flat">
                  <strong className="hermes-row-title">可自主</strong>
                  <div className="hermes-row-body">
                    分析、补证、内部任务拆解、受控委派、形成草案。
                  </div>
                </div>
                <div className="hermes-row is-flat">
                  <strong className="hermes-row-title">进入治理链</strong>
                  <div className="hermes-row-body">
                    Product / Project 业务事实修改继续走授权、Proposal、Audit 与 Receipt。
                  </div>
                </div>
                <div className="hermes-row is-flat">
                  <strong className="hermes-row-title">必须找人</strong>
                  <div className="hermes-row-body">
                    关键基线改变、高风险外部动作、无法由证据解决的业务判断。
                  </div>
                </div>
              </div>
            </Panel>
          </aside>
        </div>
      )}
      {reviewModal ? (
        <Modal
          eyebrow="RETURN REVIEW"
          title={
            reviewModal.mode === "delegate"
              ? "继续委派"
              : reviewModal.mode === "escalate"
                ? "升级人工判断"
                : "关闭父工作"
          }
          sub={
            reviewModal.mode === "delegate"
              ? "为下一位专业 Agent 明确目标与委派理由。"
              : reviewModal.mode === "escalate"
                ? "说明为什么现有证据不足以让 Agent 自主继续。"
                : "这是人工确认的工作流终态；请写清关闭依据。"
          }
          onClose={() => setReviewModal(null)}
        >
          {reviewError ? (
            <div className="hermes-banner is-danger" style={{ marginBottom: 12 }}>
              {reviewError}
            </div>
          ) : null}
          <div className="hermes-note" style={{ marginBottom: 12 }}>
            子 Agent 返回：{reviewModal.review.returned.resultSummary || reviewModal.review.returned.reason || "无摘要"}
          </div>
          <div className="hermes-form-grid">
            {reviewModal.mode === "delegate" ? (
              <>
                <label className="hermes-label">
                  <span>下一位 Agent</span>
                  <select
                    className="hermes-select"
                    value={reviewForm.toAgentId}
                    onChange={(e) =>
                      setReviewForm((current) => ({
                        ...current,
                        toAgentId: e.target.value,
                      }))
                    }
                  >
                    <option value="">选择专业 Agent</option>
                    {overview.agents
                      .filter(
                        (agent) =>
                          agent.status === "ACTIVE" &&
                          agent.id !== reviewModal.review.agent.id
                      )
                      .map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name} · {agent.roleKey}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="hermes-label">
                  <span>后续目标</span>
                  <textarea
                    rows={3}
                    className="hermes-textarea"
                    value={reviewForm.goal}
                    onChange={(e) =>
                      setReviewForm((current) => ({
                        ...current,
                        goal: e.target.value,
                      }))
                    }
                  />
                </label>
              </>
            ) : null}
            <label className="hermes-label">
              <span>
                {reviewModal.mode === "delegate"
                  ? "委派理由"
                  : reviewModal.mode === "escalate"
                    ? "升级原因"
                    : "关闭依据"}
              </span>
              <textarea
                rows={3}
                className="hermes-textarea"
                value={reviewForm.reason}
                onChange={(e) =>
                  setReviewForm((current) => ({
                    ...current,
                    reason: e.target.value,
                  }))
                }
              />
            </label>
            <div className="hermes-modal-actions">
              <button
                type="button"
                className="hermes-outline-btn"
                onClick={() => setReviewModal(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="hermes-primary-btn"
                disabled={
                  reviewBusyId === reviewModal.review.id ||
                  !reviewForm.reason.trim() ||
                  (reviewModal.mode === "delegate" &&
                    (!reviewForm.toAgentId || !reviewForm.goal.trim()))
                }
                onClick={() =>
                  reviewAction(
                    reviewModal.review.id,
                    reviewModal.mode === "delegate"
                      ? "CONTINUE_DELEGATION"
                      : reviewModal.mode === "escalate"
                        ? "ESCALATE_HUMAN"
                        : "CLOSE_PARENT",
                    reviewModal.mode === "delegate"
                      ? {
                          toAgentId: reviewForm.toAgentId,
                          goal: reviewForm.goal,
                          reason: reviewForm.reason,
                        }
                      : { reason: reviewForm.reason }
                  )
                }
              >
                {reviewBusyId === reviewModal.review.id ? "处理中…" : "确认"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </AppShell>
  );
}
