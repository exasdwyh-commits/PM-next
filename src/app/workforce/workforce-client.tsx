"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell, { type RuntimeStatus } from "@/components/app-shell";
import { Empty, Panel } from "@/components/ui";
import { HeroBand, Kpi, KpiRow, Pill } from "@/components/cockpit";
import Icon from "@/components/icons";
import {
  AutomationTraceList,
  type AutomationTraceView,
} from "@/components/automation-trace";

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
  const [bootstrapping, setBootstrapping] = React.useState(false);
  const [bootstrapError, setBootstrapError] = React.useState<string | null>(null);

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

  return (
    <AppShell
      active="workforce"
      user={{ name: session.userName, meta: session.userEmail }}
      runtime={runtime}
      topbarLeft={
        <div className="hermes-topbar-title">
          <span className="eyebrow">HERMES · AUTONOMOUS WORKFORCE</span>
          <strong>数字员工</strong>
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
        eyebrow="AGENTS · SQUADS · SKILLS · DELEGATION"
        mark="WORKFORCE"
        tagline="让 AI 从顾问变成真正接活的数字员工。"
        intro="Hermes PM 负责拆解、委派与复核；专业 Agent 各司其职。需要改变业务事实时仍进入治理链，需要你判断时明确停在等待拍板。"
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
                      <span>{squad.status}</span>
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
    </AppShell>
  );
}
