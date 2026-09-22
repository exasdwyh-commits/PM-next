"use client";

import React from "react";
import { Panel, Badge, Empty, KV, Modal, Thinking, cx } from "@/components/ui";
import { GateLine, type GateNode } from "@/components/viz";
import { useReasonDialog } from "@/components/reason-dialog";
import Icon from "@/components/icons";
import { fmtDate, fmtDateTime } from "@/shared/datetime";
import { LAUNCH_MILESTONE_KIND_LABELS, LAUNCH_MILESTONE_STATUS_LABELS, labelLaunchMilestoneKind, labelLaunchMilestoneStatus, labelProductLifecycleStage, labelLaunchPlanStatus } from "@/shared/status-labels";

/**
 * 上市计划页签（蓝图 §4.3、§4.5）
 *
 * 关键交互约束（都是业务规则，不是样式选择）：
 * - 门禁由服务端计算，本组件只展示，**不自行判断能否放行**；
 * - `gate.ready === false` 时「放行」按钮 disabled，并把阻断原因显示出来；
 * - 未获准时「确认实际上市」按钮 disabled —— 审批通过只表示获准，不等于已上市；
 * - 确认实际上市必须填写实际动作说明（服务端也会再校验一次，前端校验只是提示）。
 */

function toDateInput(v: string | null | undefined): string {
  if (!v) return "";
  return String(v).slice(0, 10);
}

export default function LaunchTab({ productId, onChanged }: { productId: string; onChanged: () => void }) {
  const [loading, setLoading] = React.useState(true);
  const [ctx, setCtx] = React.useState<any>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  // 理由输入对话框（替代原生 window.prompt）
  const [askReason, reasonDialog] = useReasonDialog();

  // 建立计划表单
  const [createOpen, setCreateOpen] = React.useState(false);
  const [cOwner, setCOwner] = React.useState("");
  const [cDate, setCDate] = React.useState("");
  const [cTitle, setCTitle] = React.useState("");
  const [cMilestones, setCMilestones] = React.useState<{ title: string; kind: string; dueDate: string }[]>([
    { title: "素材与包装定稿", kind: "MATERIAL", dueDate: "" },
  ]);

  // 里程碑编辑
  const [mOpen, setMOpen] = React.useState(false);
  const [mEdit, setMEdit] = React.useState<any>(null);

  // 确认上市
  const [lOpen, setLOpen] = React.useState(false);
  const [lNote, setLNote] = React.useState("");
  const [lEvidence, setLEvidence] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/products/${productId}/launch`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "读取上市计划失败");
      setCtx(json);
      if (json.plan && !cOwner) setCOwner(json.plan.ownerId ?? "");
    } catch (e: any) {
      setErr(e.message || "读取失败");
    } finally {
      setLoading(false);
    }
  }, [productId, cOwner]);

  React.useEffect(() => {
    load();
  }, [load]);

  const call = async (url: string, method: string, body?: any) => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || "操作失败");
      await load();
      onChanged();
      return json;
    } catch (e: any) {
      setErr(e.message || "操作失败");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const plan = ctx?.plan ?? null;
  const gate = ctx?.gate ?? null;
  const canEdit = !!ctx?.canEdit;
  const authorization = ctx?.authorization ?? null;
  const g3Packet = ctx?.g3Packet ?? null;
  const canRequestG3 = !!ctx?.canRequestG3;
  const canDecideG3 = !!ctx?.canDecideG3;

  if (loading) {
    return (
      <Panel eyebrow="LAUNCH" title="上市计划">
        <Thinking label="正在读取上市计划…" />
      </Panel>
    );
  }

  if (err && !plan) {
    return (
      <Panel eyebrow="LAUNCH" title="上市计划">
        <div className="hermes-banner is-danger">{err}</div>
      </Panel>
    );
  }

  // ---------------- 无计划：建立 ----------------
  if (!plan) {
    return (
      <>
        <Panel
          eyebrow="LAUNCH"
          title="上市计划"
          sub="上市计划必须有负责人与目标日期；审批通过只表示获准，不会自动把产品标记为已上市"
        >
          {err && <div className="hermes-banner is-danger">{err}</div>}
          <Empty>
            尚未建立上市计划。建立后才能评估「上市准备度」，并记录依赖项、阻塞原因与实际上市时间。
          </Empty>
          <div className="hermes-inline-end" style={{ marginTop: 14 }}>
            <button
              className="hermes-primary-btn"
              onClick={() => setCreateOpen(true)}
              disabled={!canEdit}
              title={canEdit ? undefined : "只有该产品所属项目的负责人或决策人可以修改上市计划"}
            >
              <Icon name="signal" size={15} />
              建立上市计划
            </button>
          </div>
          {!canEdit && (
            <p className="hermes-note" style={{ marginTop: 8 }}>
              当前账号在该产品所属项目中没有负责人/决策人角色，只能查看。
            </p>
          )}
        </Panel>

        {createOpen && (
          <Modal
            eyebrow="NEW LAUNCH PLAN"
            title="建立上市计划"
            sub="负责人与目标日期为必填；里程碑可先填一条，之后随时增补"
            onClose={() => setCreateOpen(false)}
            wide
          >
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const r = await call(`/api/products/${productId}/launch`, "POST", {
                  title: cTitle || undefined,
                  ownerId: cOwner,
                  targetDate: cDate || null,
                  milestones: cMilestones
                    .filter((m) => m.title.trim())
                    .map((m) => ({ title: m.title, kind: m.kind, dueDate: m.dueDate || null })),
                });
                if (r) {
                  setCreateOpen(false);
                  setMsg("上市计划已建立");
                }
              }}
            >
              <label className="hermes-label">
                负责人
                <select
                  className="hermes-select hermes-input"
                  required
                  value={cOwner}
                  onChange={(e) => setCOwner(e.target.value)}
                >
                  <option value="">请选择</option>
                  {(ctx?.ownerCandidates ?? []).map((u: any) => (
                    <option key={u.id} value={u.id}>
                      {u.name}（{u.role}）
                    </option>
                  ))}
                </select>
              </label>

              <label className="hermes-label">
                目标上市日期
                <input
                  className="hermes-input"
                  type="date"
                  required
                  value={cDate}
                  onChange={(e) => setCDate(e.target.value)}
                />
              </label>

              <label className="hermes-label">
                计划标题（选填）
                <input
                  className="hermes-input"
                  value={cTitle}
                  placeholder="默认使用「产品名 上市计划」"
                  onChange={(e) => setCTitle(e.target.value)}
                />
              </label>

              <div className="hermes-section-label">初始里程碑（依赖项）</div>
              {cMilestones.map((m, i) => (
                <div key={i} className="hermes-inline" style={{ gap: 8, alignItems: "flex-end" }}>
                  <label className="hermes-label" style={{ flex: 1 }}>
                    标题
                    <input
                      className="hermes-input"
                      value={m.title}
                      onChange={(e) =>
                        setCMilestones((arr) => arr.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                      }
                    />
                  </label>
                  <label className="hermes-label" style={{ width: 120 }}>
                    类型
                    <select
                      className="hermes-select hermes-input"
                      value={m.kind}
                      onChange={(e) =>
                        setCMilestones((arr) => arr.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))
                      }
                    >
                      {Object.entries(LAUNCH_MILESTONE_KIND_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="hermes-label" style={{ width: 150 }}>
                    截止日
                    <input
                      className="hermes-input"
                      type="date"
                      value={m.dueDate}
                      onChange={(e) =>
                        setCMilestones((arr) => arr.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))
                      }
                    />
                  </label>
                </div>
              ))}
              <button
                type="button"
                className="hermes-ghost-btn"
                onClick={() => setCMilestones((arr) => [...arr, { title: "", kind: "OTHER", dueDate: "" }])}
              >
                + 再加一条
              </button>

              {err && <div className="hermes-banner is-danger">{err}</div>}

              <div className="hermes-modal-actions">
                <button type="button" className="hermes-outline-btn" onClick={() => setCreateOpen(false)}>
                  取消
                </button>
                <button type="submit" className="hermes-primary-btn" disabled={busy}>
                  {busy ? "提交中…" : "建立计划"}
                </button>
              </div>
            </form>
          </Modal>
        )}
      </>
    );
  }

  // ---------------- 有计划 ----------------
  const milestones: any[] = plan.milestones ?? [];
  const doneCount = milestones.filter((m) => m.status === "DONE").length;

  // 正式 G3 与实际上市是两步：G3 只授权，实际上市仍需单独记录真实动作。
  const blockedMilestones = milestones.filter((m) => m.status === "BLOCKED");
  const hasFormalG3 = !!authorization?.formalG3;
  const hasLegacyApproval = !!plan.approvedAt && !hasFormalG3;
  const isLaunched = !!plan.actualLaunchedAt;
  const g3InReview = g3Packet?.status === "IN_REVIEW";
  const nextMilestone = milestones.find((m) => m.status !== "DONE") ?? null;

  const nextFocusText = isLaunched
    ? "流程已完成，无待办里程碑。"
    : blockedMilestones.length > 0
      ? `下一里程碑「${blockedMilestones[0].title}」被阻塞${blockedMilestones[0].blockerReason ? `（${blockedMilestones[0].blockerReason}）` : ""}。`
      : nextMilestone
        ? `下一里程碑「${nextMilestone.title}」${nextMilestone.dueDate ? `，截止 ${toDateInput(nextMilestone.dueDate)}` : "，未设截止日"}。`
        : hasFormalG3
          ? "正式 G3 已批准，等待真实渠道/供货动作后确认实际上市。"
          : g3InReview
            ? "正式 G3 已提交，等待指定决策人审批。"
            : "里程碑已全部完成，可提交正式 G3 上市授权审批。";

  const g3State: GateNode["state"] = hasFormalG3 || isLaunched
    ? "passed"
    : g3InReview || gate?.ready
      ? "pending"
      : "blocked";
  const g3Detail = isLaunched
    ? "已上市"
    : hasFormalG3
      ? "正式 G3 已批准"
      : g3InReview
        ? "正式 G3 待审批"
        : gate?.ready
          ? "可提交正式 G3"
          : `门禁未满足：${gate?.blockers?.length ?? 0} 项`;
  const gateNodes: GateNode[] = [
    { key: "G3", label: "上市授权", state: g3State, source: "decision-packet", detail: g3Detail, refId: g3Packet?.id ?? plan.id },
  ];
  return (
    <div className="hermes-stack">
      {err && <div className="hermes-banner is-danger">{err}</div>}
      {msg && <div className="hermes-banner">{msg}</div>}

      {/* 阶段导引条：明确当前最重要的推进动作，避免多阶段动作同时抢占注意 */}
      <div className={cx("hermes-banner", isLaunched || hasFormalG3 ? "is-ok" : blockedMilestones.length > 0 ? "is-danger" : "is-warn")}>
        <strong>当前推进阶段：</strong>{" "}
        {isLaunched
          ? `已于 ${fmtDate(plan.actualLaunchedAt)} 确认上市，产品生命周期已转为「已上市」。`
          : hasFormalG3
            ? "正式 G3 已由指定决策人批准。下一步：在渠道/供货真实发生后记录实际上市动作。"
            : g3InReview
              ? "正式 G3 已送审，当前等待指定决策人批准或驳回；负责人不能自批。"
              : blockedMilestones.length > 0
                ? `当前存在 ${blockedMilestones.length} 项阻塞里程碑，G3 门禁已拦截。当前焦点：协调解决阻塞原因。`
                : gate?.ready
                  ? "前置依赖已满足。当前焦点：由项目负责人提交正式 G3，再由指定决策人审批。"
                  : "上市计划推进中，请继续完善依赖项并满足正式 G3 前置门禁。"}
      </div>

      {authorization?.approved && !authorization.formalG3 && (
        <div className="hermes-banner is-warn">
          <strong>授权缺口：</strong>
          {authorization.gap}
        </div>
      )}

      <Panel eyebrow="LAUNCH" title="上市计划" sub={plan.title}>
        <p className="hermes-theme-conclusion" style={{ margin: "0 0 8px" }}>{nextFocusText}</p>
        <p className="hermes-theme-detail-p">
          负责人 {plan.owner?.name ?? "未设置"} · 目标 {plan.targetDate ? toDateInput(plan.targetDate) : "未设置日期"} · 里程碑 {doneCount}/{milestones.length} 完成 · {hasFormalG3 ? "正式 G3 已批准" : g3InReview ? "G3 待审批" : "G3 未授权"}
        </p>
        <details className="hermes-details" style={{ marginTop: 10 }}>
          <summary style={{ fontWeight: 600, padding: "4px 0" }}>查看计划与时间明细</summary>
          <div style={{ marginTop: 10 }}>
            <KV
              items={[
                { k: "计划状态", v: labelLaunchPlanStatus(plan.status) },
                {
                  k: "正式 G3",
                  v: hasFormalG3
                    ? `已批准 · ${authorization?.approvedAt ? fmtDateTime(authorization.approvedAt) : "时间已记录"}`
                    : g3InReview
                      ? "等待指定决策人审批"
                      : "尚未授权",
                },
                {
                  k: "实际上市时间",
                  v: plan.actualLaunchedAt ? fmtDateTime(plan.actualLaunchedAt) : "尚未上市",
                },
                { k: "产品生命周期", v: labelProductLifecycleStage(ctx?.product?.lifecycleStage) },
                { k: "说明", v: plan.notes || "未填写" },
              ]}
            />
          </div>
        </details>
      </Panel>

      <Panel
        eyebrow="GATE"
        title="放行门禁"
        sub="由服务端逐项校验；未完成阻塞项不会被自动放行"
      >
        <div className={cx("hermes-banner", gate?.ready ? undefined : "is-warn")} style={{ marginTop: 12 }}>
          {gate?.summary}
        </div>

        {/* 门槛线 G3：依据上市计划（LaunchPlan + evaluateGate）。获准 ≠ 已上市。 */}
        <GateLine gates={gateNodes} ariaLabel="上市放行门槛" />
        <p className="viz-source-note">依据：上市计划 + 正式 DecisionPacket。负责人提交 G3，指定决策人审批，负责人不得自批；计划、里程碑、产品版本或项目基线变化会让当前 G3 授权失效。G3 批准 ≠ 已上市，实际上市仍需单独记录真实动作。</p>

        <details className="hermes-details" style={{ marginTop: 10 }} open={gate?.ready === false}>
          <summary style={{ fontWeight: 600, padding: "4px 0" }}>
            查看全部依赖与门禁明细（{(gate?.checks ?? []).length} 项）
          </summary>
          <div className="hermes-list" style={{ marginTop: 10 }}>
            {gate?.checks?.map((c: any) => (
              <div key={c.key} className="hermes-row">
                <div className="hermes-row-head">
                  <span className="hermes-row-title">{c.label}</span>
                  {c.ok ? <Badge status="VERIFIED" tone="ok">满足</Badge> : <Badge status="BLOCKED">未满足</Badge>}
                </div>
                <div className="hermes-row-meta">
                  <span>{c.detail}</span>
                </div>
              </div>
            ))}
          </div>
        </details>

        <div className="hermes-inline-end" style={{ marginTop: 14 }}>
          {canRequestG3 && !hasFormalG3 && !g3InReview && (
            <button
              className="hermes-primary-btn"
              disabled={busy || !gate?.ready}
              title={gate?.ready ? undefined : "门禁未全部满足，不能提交正式 G3"}
              onClick={async () => {
                const r = await call(`/api/launch/plans/${plan.id}/approve`, "POST");
                if (r) setMsg("正式 G3 已提交，等待指定决策人审批");
              }}
            >
              提交正式 G3 审批
            </button>
          )}
          {canDecideG3 && g3InReview && (
            <>
              <button
                className="hermes-primary-btn"
                disabled={busy}
                onClick={async () => {
                  const reason = await askReason({
                    title: "批准正式 G3",
                    label: "批准理由",
                    placeholder: "说明为什么当前上市计划可以获得正式上市授权…",
                    confirmText: "批准 G3",
                  });
                  if (!reason) return;
                  const r = await call(`/api/decision-packets/${g3Packet.id}/decide`, "POST", {
                    decision: "APPROVE",
                    reason,
                  });
                  if (r) setMsg("正式 G3 已批准；实际上市仍需单独确认");
                }}
              >
                批准 G3
              </button>
              <button
                className="hermes-danger-btn"
                disabled={busy}
                onClick={async () => {
                  const reason = await askReason({
                    title: "驳回正式 G3",
                    label: "驳回理由",
                    placeholder: "说明需要补充或修改的事项…",
                    confirmText: "确认驳回",
                    tone: "danger",
                  });
                  if (!reason) return;
                  await call(`/api/decision-packets/${g3Packet.id}/decide`, "POST", {
                    decision: "REJECT",
                    reason,
                  });
                }}
              >
                驳回 G3
              </button>
            </>
          )}
          {g3InReview && !canDecideG3 && (
            <span className="hermes-note">已送审，等待指定决策人处理</span>
          )}
          {hasFormalG3 && <Badge status="VERIFIED" tone="ok">正式 G3 已批准</Badge>}
        </div>
        <p className="hermes-note" style={{ marginTop: 8 }}>
          G3 批准只表示正式授权，不会自动把产品标为已上市；实际上市由下一步的「确认实际上市」记录。
        </p>
      </Panel>

      <Panel
        eyebrow="MILESTONES"
        title="依赖与准备项"
        titleSmall={`(${milestones.length})`}
        sub="素材 / 渠道 / 供货 / 合规；阻塞项必须写明原因"
        actions={
          <button
            className="hermes-outline-btn"
            disabled={!canEdit}
            onClick={() => {
              setMEdit({ title: "", kind: "OTHER", dueDate: "", status: "PENDING", blockerReason: "" });
              setMOpen(true);
            }}
          >
            新增里程碑
          </button>
        }
      >
        {milestones.length === 0 ? (
          <Empty>还没有里程碑。上市计划需要至少一个依赖项才能放行。</Empty>
        ) : (
          <table className="hermes-table">
            <thead>
              <tr>
                <th>标题</th>
                <th>类型</th>
                <th>负责人</th>
                <th>截止日</th>
                <th>状态</th>
                <th>阻塞原因</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {milestones.map((m: any) => (
                <tr key={m.id}>
                  <td>{m.title}</td>
                  <td>{labelLaunchMilestoneKind(m.kind)}</td>
                  <td>{m.owner?.name ?? "未指定"}</td>
                  <td className="muted-line">{toDateInput(m.dueDate) || "未设置"}</td>
                  <td>
                    <Badge status={m.status}>{labelLaunchMilestoneStatus(m.status)}</Badge>
                  </td>
                  <td className="muted-line">{m.blockerReason || "—"}</td>
                  <td>
                    <span className="hermes-inline">
                      <button
                        className="hermes-btn-sm"
                        disabled={!canEdit || busy}
                        onClick={() => {
                          setMEdit({ ...m, dueDate: toDateInput(m.dueDate) });
                          setMOpen(true);
                        }}
                      >
                        编辑
                      </button>
                      {m.status !== "DONE" && (
                        <button
                          className="hermes-btn-sm"
                          disabled={!canEdit || busy}
                          onClick={() =>
                            call(`/api/launch/plans/${plan.id}/milestones`, "POST", {
                              id: m.id,
                              title: m.title,
                              kind: m.kind,
                              dueDate: toDateInput(m.dueDate) || null,
                              ownerId: m.ownerId,
                              status: "DONE",
                            })
                          }
                        >
                          标记完成
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel
        eyebrow="EXECUTE"
        title="确认实际上市"
        sub="与正式 G3 授权分开：必须先取得当前有效 G3，再记录真实上市动作"
      >
        <KV
          items={[
            { k: "正式 G3 授权", v: hasFormalG3 ? "已批准" : hasLegacyApproval ? "仅有旧批准，不可上市" : "未授权" },
            {
              k: "实际上市",
              v: plan.actualLaunchedAt ? fmtDateTime(plan.actualLaunchedAt) : "未记录",
            },
          ]}
        />
        <div className="hermes-inline-end" style={{ marginTop: 14 }}>
          <button
            className="hermes-primary-btn"
            disabled={busy || !canEdit || !hasFormalG3 || !!plan.actualLaunchedAt}
            title={
              !canEdit
                ? "没有修改权限"
                : !hasFormalG3
                  ? "需先取得当前有效的正式 G3 授权"
                  : plan.actualLaunchedAt
                    ? "已记录实际上市时间"
                    : undefined
            }
            onClick={() => {
              setLNote("");
              setLEvidence("");
              setLOpen(true);
            }}
          >
            确认实际上市
          </button>
        </div>
        <p className="hermes-note" style={{ marginTop: 8 }}>
          确认后会写入实际上市时间，并把产品生命周期更新为「已上市」。没有当前有效的正式 G3 时按钮不可用。
        </p>
      </Panel>

      {mOpen && mEdit && (
        <Modal
          eyebrow="MILESTONE"
          title={mEdit.id ? "编辑里程碑" : "新增里程碑"}
          onClose={() => setMOpen(false)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await call(`/api/launch/plans/${plan.id}/milestones`, "POST", {
                id: mEdit.id,
                title: mEdit.title,
                kind: mEdit.kind,
                dueDate: mEdit.dueDate || null,
                ownerId: mEdit.ownerId ?? null,
                status: mEdit.status,
                blockerReason: mEdit.blockerReason || null,
              });
              if (r) setMOpen(false);
            }}
          >
            <label className="hermes-label">
              标题
              <input
                className="hermes-input"
                required
                value={mEdit.title}
                onChange={(e) => setMEdit({ ...mEdit, title: e.target.value })}
              />
            </label>
            <label className="hermes-label">
              类型
              <select
                className="hermes-select hermes-input"
                value={mEdit.kind}
                onChange={(e) => setMEdit({ ...mEdit, kind: e.target.value })}
              >
                {Object.entries(LAUNCH_MILESTONE_KIND_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="hermes-label">
              负责人
              <select
                className="hermes-select hermes-input"
                value={mEdit.ownerId ?? ""}
                onChange={(e) => setMEdit({ ...mEdit, ownerId: e.target.value || null })}
              >
                <option value="">未指定</option>
                {(ctx?.ownerCandidates ?? []).map((u: any) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="hermes-label">
              截止日
              <input
                className="hermes-input"
                type="date"
                value={mEdit.dueDate ?? ""}
                onChange={(e) => setMEdit({ ...mEdit, dueDate: e.target.value })}
              />
            </label>
            <label className="hermes-label">
              状态
              <select
                className="hermes-select hermes-input"
                value={mEdit.status}
                onChange={(e) => setMEdit({ ...mEdit, status: e.target.value })}
              >
                {Object.entries(LAUNCH_MILESTONE_STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            {mEdit.status === "BLOCKED" && (
              <label className="hermes-label">
                阻塞原因（必填）
                <input
                  className="hermes-input"
                  required
                  value={mEdit.blockerReason ?? ""}
                  onChange={(e) => setMEdit({ ...mEdit, blockerReason: e.target.value })}
                  placeholder="例如：包装供应商报价未回"
                />
              </label>
            )}
            {err && <div className="hermes-banner is-danger">{err}</div>}
            <div className="hermes-modal-actions">
              <button type="button" className="hermes-outline-btn" onClick={() => setMOpen(false)}>
                取消
              </button>
              <button type="submit" className="hermes-primary-btn" disabled={busy}>
                保存
              </button>
            </div>
          </form>
        </Modal>
      )}

      {lOpen && (
        <Modal
          eyebrow="CONFIRM LAUNCH"
          title="确认实际上市"
          sub="需要记录实际动作依据；这一步会写入实际上市时间并更新产品生命周期"
          onClose={() => setLOpen(false)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await call(`/api/launch/plans/${plan.id}/launch`, "POST", {
                note: lNote,
                evidenceId: lEvidence || null,
              });
              if (r) {
                setLOpen(false);
                setMsg(
                  `已记录实际上市时间：${fmtDateTime(r.actualLaunchedAt)} · 正式 G3 授权已验证`
                );
              }
            }}
          >
            <label className="hermes-label">
              实际动作说明（必填）
              <textarea
                className="hermes-textarea"
                rows={3}
                required
                value={lNote}
                onChange={(e) => setLNote(e.target.value)}
                placeholder="例如：抖音自播首场已开播，首批 2000 盒已入仓；附渠道上线截图"
              />
            </label>
            <label className="hermes-label">
              关联证据 id（选填，必须是本组织已存在的证据）
              <input
                className="hermes-input"
                value={lEvidence}
                onChange={(e) => setLEvidence(e.target.value)}
                placeholder="留空表示仅以文字说明为准"
              />
            </label>
            {err && <div className="hermes-banner is-danger">{err}</div>}
            <div className="hermes-modal-actions">
              <button type="button" className="hermes-outline-btn" onClick={() => setLOpen(false)}>
                取消
              </button>
              <button type="submit" className="hermes-primary-btn" disabled={busy || !lNote.trim()}>
                确认上市
              </button>
            </div>
          </form>
        </Modal>
      )}

      {reasonDialog}
    </div>
  );
}
