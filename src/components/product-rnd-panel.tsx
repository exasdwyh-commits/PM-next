"use client";

import * as React from "react";
import { Badge, Button, Empty, Panel, Thinking } from "@/components/ui";
import { ExecutiveReportRoleBased } from "@/components/executive-report-role-based";
import { identityHeaders } from "@/shared/client-identity";
import type { ExecutiveReportPayload } from "@/shared/executive-report-types";
import { labelAgentTaskStatus } from "@/shared/status-labels";
import { fmtTime } from "@/shared/datetime";

/**
 * AI 产品研发（数字员工流水线）
 *
 * 这里只展示业务阶段与负责人下一步；AgentTask / AgentRun 等底层对象留在自动化中心。
 * 后端仍是唯一状态源，前端不自行推进工作流、不伪造进度。
 */

const TASK_LABELS: Record<string, string> = {
  research_agent: "市场与竞品",
  scientific_evidence_agent: "科学证据",
  formulation_agent: "配方与规格",
  compliance_agent: "法规与宣称",
  cost_bom_agent: "成本与 BOM",
  qa_verifier: "独立 QA",
};

const DONE_STATUSES = new Set(["SUCCEEDED", "SUBMITTED"]);
const ACTIVE_STATUSES = new Set(["RUNNING", "QUEUED"]);
const BLOCKED_STATUSES = new Set(["BLOCKED", "FAILED", "WAITING_HUMAN"]);

interface ProductRndTaskRow {
  id: string;
  agentCode: string;
  agentName: string;
  status: string;
  latestRun: {
    id: string;
    status: string;
    outputSummary: string | null;
    errorReason: string | null;
  } | null;
}

interface ProductRndStatusResponse {
  workItem: { id: string; status: string; inputRevision: number };
  parentTaskId: string | null;
  /** 当前有效的 QA attempt（服务端按「最新且未被 fencing 作废」判定）。 */
  currentQaTaskId: string | null;
  autoAdvance?: {
    attempts: number;
    maxAttempts: number;
    message: string;
    nextRetryAt: string | null;
    exhausted: boolean;
  } | null;
  tasks: ProductRndTaskRow[];
  latestReport:
    | ({
        id: string;
        title: string;
        contentVersion: number;
        createdAt: string;
        reviewStatus?: string;
        preview: ExecutiveReportPayload | null;
      })
    | null;
}

type StageState = "done" | "current" | "blocked" | "pending";

/**
 * 独立 QA 可下的复核结论。与 `modules/product-rnd/qa-signoff.ts` 的
 * `ProductRndQaVerdict` 一一对应 —— 这里重复一份字面量而不是 import，
 * 是因为该模块会连带加载 prisma / 服务端依赖，客户端组件不得引入。
 */
type QaVerdict = "SUCCEEDED" | "FAILED" | "BLOCKED";

const QA_VERDICT_OPTIONS: Array<{ value: QaVerdict; label: string }> = [
  { value: "SUCCEEDED", label: "通过 —— 证据与结论可支撑，允许合成管理报告" },
  { value: "FAILED", label: "不通过 —— 需要退回专业研究返工" },
  { value: "BLOCKED", label: "证据不足，暂缓 —— 不合成报告" },
];

function taskState(status?: string | null): StageState {
  if (DONE_STATUSES.has(status || "")) return "done";
  if (BLOCKED_STATUSES.has(status || "")) return "blocked";
  if (ACTIVE_STATUSES.has(status || "")) return "current";
  return "pending";
}

function stageStateFromTasks(tasks: ProductRndTaskRow[]): StageState {
  if (tasks.length === 0) return "pending";
  if (tasks.some((task) => BLOCKED_STATUSES.has(task.status))) return "blocked";
  if (tasks.every((task) => DONE_STATUSES.has(task.status))) return "done";
  if (tasks.some((task) => ACTIVE_STATUSES.has(task.status))) return "current";
  return "pending";
}

export function ProductRndPanelOriginal({
  projectId,
  workItemId,
  mockAuth,
  activeUserId,
  canOperate,
  onChanged,
  onNotice,
  onOpenDecisions,
  onOpenEvidence,
}: {
  projectId: string;
  workItemId: string;
  mockAuth: boolean;
  activeUserId?: string;
  canOperate: boolean;
  onChanged?: () => void | Promise<void>;
  onNotice?: (text: string, type: "ok" | "error") => void;
  onOpenDecisions?: () => void;
  onOpenEvidence?: () => void;
}) {
  const [status, setStatus] = React.useState<ProductRndStatusResponse | null>(null);
  const [brief, setBrief] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [started, setStarted] = React.useState(false);
  // 独立 QA 人工复核签字表单
  const [qaVerdict, setQaVerdict] = React.useState<QaVerdict>("SUCCEEDED");
  const [qaSummary, setQaSummary] = React.useState("");
  const [qaReason, setQaReason] = React.useState("");

  const headers = React.useMemo(
    () => identityHeaders(mockAuth, activeUserId),
    [mockAuth, activeUserId]
  );

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/product-rnd?workItemId=${encodeURIComponent(workItemId)}`,
        { headers }
      );
      if (!res.ok) throw new Error(`读取产品研发状态失败（HTTP ${res.status}）`);
      const data = (await res.json()) as ProductRndStatusResponse;
      setStatus(data);
    } catch (error) {
      onNotice?.(
        error instanceof Error ? error.message : "读取产品研发状态失败",
        "error"
      );
    } finally {
      setLoading(false);
    }
  }, [headers, onNotice, projectId, workItemId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const call = React.useCallback(
    async (body: Record<string, unknown>, successText: string): Promise<boolean> => {
      setBusy(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/product-rnd`, {
          method: "POST",
          headers: identityHeaders(mockAuth, activeUserId, {
            "Content-Type": "application/json",
          }),
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (data as { message?: string }).message ||
              `请求失败（HTTP ${res.status}）`
          );
        }
        await load();
        await onChanged?.();
        onNotice?.(successText, "ok");
        return true;
      } catch (error) {
        onNotice?.(
          error instanceof Error ? error.message : "请求失败",
          "error"
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [activeUserId, load, mockAuth, onChanged, onNotice, projectId]
  );

  const parentTaskId = status?.parentTaskId ?? null;
  const tasks = status?.tasks ?? [];
  const latestReport = status?.latestReport;
  const report = React.useMemo(() => latestReport?.preview ? {
    ...latestReport.preview, artifactId: latestReport.id, title: latestReport.title,
    contentVersion: latestReport.contentVersion, createdAt: latestReport.createdAt,
  } : null, [latestReport]);
  const notStarted = started === false && !parentTaskId && tasks.length === 0;

  const specialistTasks = tasks.filter((task) => task.agentCode !== "qa_verifier");
  // 必须认服务端给的「当前有效 attempt」：历史终结过的 QA 也在这个列表里，
  // 直接 find 会拿到最早那条（实测旧 BLOCKED 排在新的前面），
  // 于是签字入口该出现时不出现、状态说明也说的是上一轮。
  const qaTask =
    tasks.find((task) => task.id === status?.currentQaTaskId) ?? null;
  const completedSpecialists = specialistTasks.filter((task) =>
    DONE_STATUSES.has(task.status)
  ).length;

  const pipeline: Array<{
    key: string;
    label: string;
    note: string;
    state: StageState;
  }> = [
    {
      key: "brief",
      label: "研发 Brief",
      note: parentTaskId ? "已建立本轮研发任务" : "等待启动",
      state: parentTaskId ? "done" : "pending",
    },
    {
      key: "specialists",
      label: "专业研究",
      note:
        specialistTasks.length > 0
          ? `${completedSpecialists}/${specialistTasks.length} 路完成`
          : "等待拆分专业任务",
      state: stageStateFromTasks(specialistTasks),
    },
    {
      key: "qa",
      label: "独立 QA",
      note: qaTask ? labelAgentTaskStatus(qaTask.status) : "等待专业研究",
      state: qaTask ? taskState(qaTask.status) : "pending",
    },
    {
      key: "report",
      label: "管理报告",
      note: report ? "报告已生成" : "等待 QA 与报告合成",
      state: report ? "done" : "pending",
    },
    {
      key: "review",
      label: "负责人审查",
      note: report ? "等待你的业务判断" : "报告生成后进入",
      state: report ? "current" : "pending",
    },
  ];

  return (
    <Panel
      eyebrow="AI 产品研发"
      icon="automation"
      title="研发工作流"
      sub="Kern 负责拆解和监督；专业数字员工完成研究，独立 QA 复核，最后生成可供负责人决策的管理报告。"
      actions={
        parentTaskId ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !canOperate}
            onClick={() =>
              void call(
                { action: "RECONCILE", parentTaskId },
                "已重新对齐一次产品研发状态"
              )
            }
          >
            刷新研发状态
          </Button>
        ) : undefined
      }
    >
      {loading ? (
        <Thinking label="读取产品研发状态…" />
      ) : notStarted ? (
        <div className="hermes-rnd-start">
          <div>
            <strong>先写清楚这轮研发要解决什么。</strong>
            <p>可以只写业务目标、目标人群、价格带和约束；缺少的信息会在后续研究中明确标成 UNKNOWN。</p>
          </div>
          <textarea
            className="hermes-textarea"
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            rows={4}
            placeholder="例如：面向 25–45 岁女性的肠道产品，售价约 299 元，重点验证排便舒适、配方可行性、法规与成本。"
          />
          <div className="hermes-inline">
            <Button
              disabled={busy || !canOperate || !brief.trim()}
              onClick={() =>
                void call(
                  { action: "START", brief: brief.trim() },
                  "AI 产品研发已启动"
                ).then((ok) => {
                  if (ok) setStarted(true);
                })
              }
            >
              启动完整研发
            </Button>
            {!canOperate ? (
              <span className="hermes-row-meta">只有项目负责人/决策人可以启动。</span>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="hermes-rnd-workspace">
          <div className="hermes-rnd-pipeline" aria-label="AI 产品研发阶段">
            {pipeline.map((stage, index) => (
              <div
                key={stage.key}
                className={`hermes-rnd-stage is-${stage.state}`}
                aria-current={stage.state === "current" ? "step" : undefined}
              >
                <div className="hermes-rnd-stage-index">
                  {stage.state === "done" ? "✓" : index + 1}
                </div>
                <div>
                  <strong>{stage.label}</strong>
                  <span>{stage.note}</span>
                </div>
              </div>
            ))}
          </div>

          {qaTask && qaTask.status === "QUEUED" && parentTaskId ? (
            <section className="hermes-rnd-qa" aria-label="独立 QA 人工复核签字">
              <div className="hermes-rnd-qa-head">
                <div>
                  <span className="eyebrow">独立 QA</span>
                  <strong>本轮研发在等你下复核结论</strong>
                </div>
                <Badge tone="warn">待人工签字</Badge>
              </div>
              <p className="hermes-row-meta" style={{ margin: 0 }}>
                独立 QA <strong>不会由后台 Worker 自动执行</strong> —— 这是设计如此：
                签字方要与执行研究的数字员工是两条身份，所以流程会一直停在这里等你。
                只有项目负责人 / 决策人可以签；<strong>选「通过」才会合成管理报告</strong>。
              </p>
              <div className="hermes-rnd-qa-form">
                <label>
                  <span>复核结论</span>
                  <select
                    className="hermes-select"
                    value={qaVerdict}
                    disabled={busy || !canOperate}
                    onChange={(event) =>
                      setQaVerdict(event.target.value as QaVerdict)
                    }
                  >
                    {QA_VERDICT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>复核说明（必填）</span>
                  <textarea
                    className="hermes-textarea"
                    rows={3}
                    value={qaSummary}
                    disabled={busy || !canOperate}
                    onChange={(event) => setQaSummary(event.target.value)}
                    placeholder="写清楚你核对了哪些证据、哪些 UNKNOWN 仍敞开、判断依据是什么。空说明会被拒绝。"
                  />
                </label>
                {qaVerdict !== "SUCCEEDED" ? (
                  <label className="is-wide">
                    <span>原因（可留空）</span>
                    <input
                      className="hermes-input"
                      value={qaReason}
                      disabled={busy || !canOperate}
                      onChange={(event) => setQaReason(event.target.value)}
                      placeholder="例如：配方路线缺少实测留存率，无法判断可支撑宣称。"
                    />
                  </label>
                ) : null}
                <div className="hermes-rnd-qa-actions">
                  <Button
                    disabled={busy || !canOperate || !qaSummary.trim()}
                    onClick={() => {
                      void call(
                        {
                          action: "SIGN_QA",
                          parentTaskId,
                          verdict: qaVerdict,
                          resultSummary: qaSummary.trim(),
                          reason: qaReason.trim() || null,
                        },
                        "独立 QA 复核结论已提交"
                      ).then((ok) => {
                        if (!ok) return;
                        setQaSummary("");
                        setQaReason("");
                        setQaVerdict("SUCCEEDED");
                      });
                    }}
                  >
                    提交复核结论
                  </Button>
                  {!canOperate ? (
                    <span className="hermes-row-meta">
                      只有项目负责人 / 决策人可以签字。
                    </span>
                  ) : (
                    <span className="hermes-row-meta">
                      签字会写入审计记录，并留在这里供追溯。
                    </span>
                  )}
                </div>
              </div>
            </section>
          ) : null}

          {qaTask && (qaTask.status === "FAILED" || qaTask.status === "BLOCKED") ? (
            <div className="hermes-banner is-warn">
              本轮独立 QA 的结论是「{labelAgentTaskStatus(qaTask.status)}」，报告不会合成。
              处理完上面的原因后，点右上角「刷新研发状态」会重新排队一次 QA（生成新的 attempt）。
            </div>
          ) : null}

          {status?.autoAdvance ? (
            <div
              className={`hermes-banner ${status.autoAdvance.exhausted ? "is-danger" : "is-warn"}`}
              role="status"
              style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}
            >
              <span>
                {status.autoAdvance.exhausted
                  ? `流程推进连续失败 ${status.autoAdvance.attempts} 次，已停止自动重试，需要你确认后再试。`
                  : `流程推进失败（第 ${status.autoAdvance.attempts}/${status.autoAdvance.maxAttempts} 次），Kern 会${
                      status.autoAdvance.nextRetryAt ? `在 ${fmtTime(status.autoAdvance.nextRetryAt)} ` : ""
                    }自动重试。`}
                <br />
                <small>原因：{status.autoAdvance.message || "未知"}</small>
              </span>
              {parentTaskId ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !canOperate}
                  onClick={() => void call({ action: "RECONCILE", parentTaskId }, "已重试推进")}
                >
                  立即重试
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="hermes-rnd-status-head">
            <div>
              <span className="eyebrow">专业工作</span>
              <strong>
                {report
                  ? "本轮研发已形成管理报告"
                  : specialistTasks.length > 0
                    ? `${completedSpecialists}/${specialistTasks.length} 路专业研究完成`
                    : "正在建立专业任务"}
              </strong>
            </div>
            {tasks.some((task) => BLOCKED_STATUSES.has(task.status)) ? (
              <Badge tone="warn">存在需要处理的阻断</Badge>
            ) : report ? (
              <Badge tone="ok">等待负责人审查</Badge>
            ) : (
              <Badge tone="info">研发进行中</Badge>
            )}
          </div>

          {tasks.length === 0 ? (
            <Empty title="专业任务尚未派生">
              后台尚未创建专业任务。可以使用上方“刷新研发状态”重新对齐一次。
            </Empty>
          ) : (
            <div className="hermes-rnd-task-grid">
              {tasks.map((task) => {
                const state = taskState(task.status);
                return (
                  <article key={task.id} className={`hermes-rnd-task is-${state}`}>
                    <div className="hermes-rnd-task-head">
                      <strong>{TASK_LABELS[task.agentCode] || task.agentName}</strong>
                      <Badge
                        tone={
                          state === "done"
                            ? "ok"
                            : state === "blocked"
                              ? "warn"
                              : state === "current"
                                ? "info"
                                : "neutral"
                        }
                      >
                        {labelAgentTaskStatus(task.status)}
                      </Badge>
                    </div>
                    <p>
                      {task.latestRun?.outputSummary ||
                        task.latestRun?.errorReason ||
                        "等待后台 Worker 执行并返回结果。"}
                    </p>
                  </article>
                );
              })}
            </div>
          )}

          {report && (
            <div className="hermes-rnd-report-wrap">
              <ExecutiveReportRoleBased
                report={report}
                reviewStatus={latestReport?.reviewStatus}
                onOpenDecisions={onOpenDecisions}
                onOpenEvidence={onOpenEvidence}
              />
            </div>
          )}

          <details className="hermes-details">
            <summary>运行说明</summary>
            <p className="hermes-row-meta" style={{ lineHeight: 1.7 }}>
              后台 Worker 会持续推进任务，关闭浏览器不会中断。页面只读取真实状态。
              没有真实数据的专业任务会停在 BLOCKED / WAITING_HUMAN 并列出缺口，
              不会为了完成流程补造数字。
            </p>
          </details>
        </div>
      )}
    </Panel>
  );
}


export function ProductRndPanel(props: React.ComponentProps<typeof ProductRndPanelOriginal>) {
  return <ProductRndPanelOriginal {...props} />;
}
