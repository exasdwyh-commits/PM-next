"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/app-shell";
import { GlassCard, StatGrid, Stat, Badge, Empty } from "@/components/ui";
import { useReasonDialog } from "@/components/reason-dialog";
import { identityHeaders } from "@/shared/client-identity";
import { labelEvidenceNature, labelProjectStage } from "@/shared/status-labels";

function Block({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <GlassCard className="hermes-panel">
      <div className="hermes-panel-head">
        <span className="hermes-section-label">{title}</span>
        <span className="hermes-chip">{count}</span>
      </div>
      {count === 0 ? <div className="hermes-note">无待处理项</div> : children}
    </GlassCard>
  );
}

export default function WarRoomClient({ initialProjects, allUsers, currentSession, mockAuth = false }: { initialProjects: any[]; allUsers: any[]; currentSession?: any; mockAuth?: boolean }) {
  const router = useRouter();
  const [activeUserId, setActiveUserId] = useState(currentSession?.userId || initialProjects[0]?.ownerId || allUsers[0]?.id || "");
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  // 理由输入对话框（替代原生 prompt）
  const [askReason, reasonDialog] = useReasonDialog();
  const activeUser = allUsers.find((u) => u.id === activeUserId);

  const scoped = useMemo(() => {
    const rows: Record<string, any> = {};
    // 待办按项目聚合
    for (const p of initialProjects) {
      rows[p.id] = {
        project: p,
        owner: p.ownerId === activeUserId,
        isDecisionMaker: p.decisionMakerId === activeUserId,
        evidencePending: p.evidences.filter((e: any) => e.verifyStatus === "UNVERIFIED" && p.ownerId === activeUserId).length,
        packetsReview: p.decisionPackets.filter((pk: any) => pk.status === "IN_REVIEW" && p.decisionMakerId === activeUserId).length,
        workPending: p.workItems.filter((w: any) => w.status === "SUBMITTED" && p.ownerId === activeUserId).length,
        feedbackOpen: p.feedbackItems.filter((f: any) => f.status === "OPEN" && p.ownerId === activeUserId).length,
        hasVerifiedPrice: p.evidences.some((e: any) => e.verifyStatus === "VERIFIED" && e.claims.some((c: any) => c.fieldKey === "price")),
        evidenceList: p.evidences.filter((e: any) => e.verifyStatus === "UNVERIFIED" && p.ownerId === activeUserId),
        packets: p.decisionPackets.filter((pk: any) => pk.status === "IN_REVIEW" && p.decisionMakerId === activeUserId),
        works: p.workItems.filter((w: any) => w.status === "SUBMITTED" && p.ownerId === activeUserId),
        feedbacks: p.feedbackItems.filter((f: any) => f.status === "OPEN" && p.ownerId === activeUserId),
      };
    }
    // 只有「当前身份」需要处理的项目
    return Object.fromEntries(Object.entries(rows).filter(([, r]: any) => r.owner || r.isDecisionMaker));
  }, [initialProjects, activeUserId]);

  const totals = useMemo(() => {
    let ev = 0, pk = 0, wk = 0, fb = 0, gaps = 0;
    for (const [, r] of Object.entries(scoped) as any) {
      ev += r.evidencePending; pk += r.packetsReview; wk += r.workPending; fb += r.feedbackOpen;
      if (!r.hasVerifiedPrice) gaps += 1;
    }
    return { ev, pk, wk, fb, gaps };
  }, [scoped]);

  const rows = Object.values(scoped) as any[];

  // 复用项目详情页的写接口模式（x-user-id 头 + 服务端角色校验），就地完成审批/核实/验收/处置
  const apiCall = async (url: string, method: string, body?: any) => {
    const res = await fetch(url, {
      method,
      headers: identityHeaders(mockAuth, activeUserId, { "Content-Type": "application/json" }),
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "操作失败");
    return data;
  };

  const showMsg = (text: string, type: "success" | "error" = "success") => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 5000);
  };

  // 结果改为页内横幅播报；用 router.refresh() 局部刷新（本组件的数据全部派生自 props，
  // 服务端重取后 useMemo 会自动重算，无需本地 useState 同步）。
  const act = async (fn: () => Promise<any>, okMsg: string) => {
    try {
      await fn();
      showMsg(okMsg, "success");
      router.refresh();
    } catch (err: any) {
      showMsg(err.message || "操作失败", "error");
    }
  };

  const verifyEvidence = (evidenceId: string, status: "VERIFIED" | "REJECTED") =>
    act(() => apiCall(`/api/evidences/${evidenceId}/verify`, "POST", { status }),
        status === "VERIFIED" ? "证据已独立核实，现可作为决策凭据" : "证据已否决");

  const decidePacket = async (packetId: string, decision: string) => {
    const reason = await askReason(
      decision === "APPROVE"
        ? { title: "批准决策包", label: "请输入批准理由", placeholder: "填写批准理由…", confirmText: "批准", tone: "primary" }
        : { title: "退回修改", label: "请输入退回/修改理由", placeholder: "填写退回或修改理由…", confirmText: "退回修改", tone: "danger" }
    );
    // 取消 / Esc / 点遮罩 → null：不触发任何写操作
    if (!reason) return;
    return act(() => apiCall(`/api/decision-packets/${packetId}/decide`, "POST", { decision, reason, idempotencyKey: `warroom-${Date.now()}` }),
      // 阶段是否推进由服务端门禁决定（FIXED_PRODUCT 等模式就不会推进），
      // 这里不替它宣布结果；实际阶段以刷新后的项目数据为准。
      decision === "APPROVE" ? "打样门已批准" : "已退回修改");
  };

  const reviewWork = async (workItemId: string, accepted: boolean) => {
    const reason = await askReason(
      accepted
        ? { title: "验收成果", label: "请输入验收通过意见", placeholder: "填写验收意见…", confirmText: "通过", tone: "primary" }
        : { title: "退回成果", label: "请输入退回修改理由", placeholder: "填写退回理由…", confirmText: "退回修改", tone: "danger" }
    );
    if (!reason) return;
    return act(() => apiCall(`/api/work-items/${workItemId}/reviews`, "POST", { accepted, reason }),
      accepted ? "成果已验收通过" : "成果已退回并要求修改");
  };

  const disposeFeedback = async (feedbackId: string, status: "ACCEPTED" | "REJECTED") => {
    const reason = await askReason(
      status === "ACCEPTED"
        ? { title: "采纳反馈并立项修订", label: "采纳意见并建立修订任务说明", placeholder: "填写采纳意见，将作为修订任务说明…", confirmText: "采纳并立项", tone: "primary" }
        : { title: "驳回反馈", label: "驳回反馈理由", placeholder: "填写驳回理由…", confirmText: "确认驳回", tone: "danger" }
    );
    if (!reason) return;
    return act(() => apiCall(`/api/feedback/${feedbackId}/disposition`, "POST", { status, reason, createRevisionWorkItem: status === "ACCEPTED" }),
      status === "ACCEPTED" ? "反馈已采纳并立项修订" : "反馈已驳回");
  };

  return (
    <AppShell
      active="war-room"
      user={{ name: currentSession?.userName, meta: currentSession?.userEmail }}
      topbarRight={
        mockAuth ? (
          <div className="hermes-identity">
            <span>当前操作身份（开发态）</span>
            <select value={activeUserId} onChange={(e) => setActiveUserId(e.target.value)} aria-label="切换操作人">
              {allUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        ) : undefined
      }
    >
      <div className="hermes-stack">
        <Link href="/" className="hermes-link">← 返回工作台</Link>

        <div className="hermes-page-heading">
          <div>
            <p className="eyebrow">HERMES · 研发作战室</p>
            <h1>研发作战室</h1>
            <p>按身份聚合各项目的「待我处理」清单——证据核实、决策审批、成果验收、反馈处置，均为系统真实待办。</p>
          </div>
        </div>

        {msg && (
          <div
            className={`hermes-banner ${msg.type === "error" ? "is-danger" : "is-ok"}`}
            role={msg.type === "error" ? "alert" : "status"}
            aria-live={msg.type === "error" ? "assertive" : "polite"}
          >
            {msg.text}
          </div>
        )}

        {/* Summary cards */}
        <StatGrid>
          <Stat label="待核实证据" value={totals.ev} />
          <Stat label="待审批决策包" value={totals.pk} />
          <Stat label="待验收成果" value={totals.wk} />
          <Stat label="待处置反馈" value={totals.fb} />
          <Stat label="缺价格预警项目" value={totals.gaps} />
        </StatGrid>

        {rows.length === 0 ? (
          <Empty>{activeUser?.name || "该身份"}名下暂无项目或待办。</Empty>
        ) : (
          <div className="space-y-4">
            {rows.map(({ project: p, evidenceList, packets, works, feedbacks, hasVerifiedPrice, isDecisionMaker, owner }: any) => (
              <GlassCard key={p.id} className="hermes-panel">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/projects/${p.id}`} className="hermes-link font-bold">{p.title}</Link>
                      <span className="stage-badge">{labelProjectStage(p.stage)}</span>
                      {!hasVerifiedPrice && <span className="hermes-badge is-danger">缺已核实价格证据 (P1-02 阻断)</span>}
                    </div>
                    <div className="hermes-row-meta">{owner ? "负责人" : ""}{isDecisionMaker ? " · 决策人" : ""}</div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Block title="待核实证据" count={evidenceList.length}>
                      <ul className="text-xs space-y-1.5">
                        {evidenceList.map((e: any) => (
                          <li key={e.id} className="hermes-row is-flat">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge tone={e.nature === "REAL" ? "ok" : "warn"}>{labelEvidenceNature(e.nature)}</Badge>
                              <span>{e.contentOrUri}</span>
                            </div>
                            <div className="hermes-row-meta">{e.source}</div>
                            <div className="pt-1 flex gap-1.5">
                              <button onClick={() => verifyEvidence(e.id, "VERIFIED")} className="hermes-primary-btn hermes-btn-sm">核实</button>
                              <button onClick={() => verifyEvidence(e.id, "REJECTED")} className="hermes-danger-btn hermes-btn-sm">否决</button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </Block>

                    <Block title="待审批决策包" count={packets.length}>
                      <ul className="text-xs space-y-1.5">
                        {packets.map((pk: any) => (
                          <li key={pk.id} className="hermes-row is-flat">
                            <span className="hermes-mono">{pk.scopeHash.slice(0, 10)}…</span>
                            <span className="ml-2">{pk.validationPlan.slice(0, 40)}</span>
                            {Number(pk.budgetAmount) ? <div className="hermes-row-meta">预算 ¥{Number(pk.budgetAmount).toLocaleString()}</div> : null}
                            <div className="pt-1 flex gap-1.5">
                              <button onClick={() => decidePacket(pk.id, "REQUEST_CHANGES")} className="hermes-danger-btn hermes-btn-sm">退回修改</button>
                              <button onClick={() => decidePacket(pk.id, "APPROVE")} className="hermes-primary-btn hermes-btn-sm">准予批准</button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </Block>

                    <Block title="待验收成果" count={works.length}>
                      <ul className="text-xs space-y-1.5">
                        {works.map((w: any) => (
                          <li key={w.id} className="hermes-row is-flat">
                            <span>{w.title}</span>
                            {w.artifacts?.length ? <div className="hermes-row-meta">{w.artifacts.length} 个产物 / {w.submissions?.[0]?.runMode ?? ""}</div> : null}
                            <div className="pt-1 flex gap-1.5">
                              <button onClick={() => reviewWork(w.id, false)} className="hermes-danger-btn hermes-btn-sm">退回修改</button>
                              <button onClick={() => reviewWork(w.id, true)} className="hermes-primary-btn hermes-btn-sm">检查通过 (Accept)</button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </Block>

                    <Block title="待处置反馈" count={feedbacks.length}>
                      <ul className="text-xs space-y-1.5">
                        {feedbacks.map((f: any) => (
                          <li key={f.id} className="hermes-row is-flat">
                            <strong>{f.author?.name}:</strong> <span>{f.content}</span>
                            <div className="pt-1 flex justify-end gap-1.5">
                              <button onClick={() => disposeFeedback(f.id, "REJECTED")} className="hermes-ghost-btn hermes-btn-sm">驳回</button>
                              <button onClick={() => disposeFeedback(f.id, "ACCEPTED")} className="hermes-link">采纳并立项修订</button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </Block>
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        )}

        {reasonDialog}
      </div>
    </AppShell>
  );
}
