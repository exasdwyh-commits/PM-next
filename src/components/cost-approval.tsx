"use client";

import * as React from "react";
import type { CostScenario } from "@/modules/cost-engine/scenario";
import "./cost-approval.css";

export interface Approval {
  id: string;
  scenarioId: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "ARCHIVED";
  requestedBy: string;
  approverId?: string;
  comment?: string;
  createdAt: string;
  updatedAt: string;
  requester?: { id: string; name: string };
  approver?: { id: string; name: string };
}

export function CostApproval({
  scenario,
  approvals = [],
  onSubmit,
  onApprove,
  onReject,
}: {
  scenario: CostScenario;
  approvals?: Approval[];
  onSubmit?: (comment?: string) => void;
  onApprove?: (approvalId: string, comment?: string) => void;
  onReject?: (approvalId: string, comment?: string) => void;
}) {
  const [comment, setComment] = React.useState("");
  const [showComment, setShowComment] = React.useState(false);

  const currentStatus = scenario.status || "DRAFT";
  const pendingApproval = approvals.find(a => a.status === "PENDING_APPROVAL");

  const statusConfig: Record<string, { label: string; color: string; icon: string }> = {
    DRAFT: { label: "草稿", color: "#6b7280", icon: "📝" },
    PENDING_APPROVAL: { label: "待审批", color: "#d97706", icon: "⏳" },
    APPROVED: { label: "已批准", color: "#0b7a4f", icon: "✅" },
    REJECTED: { label: "已驳回", color: "#b32b23", icon: "❌" },
    ARCHIVED: { label: "已归档", color: "#6b7280", icon: "📦" },
  };

  const currentConfig = statusConfig[currentStatus] || statusConfig.DRAFT;

  return (
    <div className="cost-approval">
      <div className="approval-header">
        <div>
          <h4>📋 审批流 · {scenario.name}</h4>
          <small>当前状态：{currentConfig.icon} {currentConfig.label} · {approvals.length}次审批 · 4类专用</small>
        </div>
        <div className="status-badge" style={{ background: `${currentConfig.color}15`, color: currentConfig.color, border: `1px solid ${currentConfig.color}30` }}>
          {currentConfig.icon} {currentConfig.label}
        </div>
      </div>

      <div className="approval-actions">
        {currentStatus === "DRAFT" && (
          <>
            <button className="primary" onClick={() => { setShowComment(true); }} style={{ background: "#0f1116" }}>📤 提交审批</button>
            <small>提交后进入待审批，产品审核→领导审批</small>
          </>
        )}
        {currentStatus === "PENDING_APPROVAL" && pendingApproval && (
          <>
            <button className="approve" onClick={() => onApprove?.(pendingApproval.id, comment)}>✅ 批准</button>
            <button className="reject" onClick={() => onReject?.(pendingApproval.id, comment)}>❌ 驳回</button>
            <small>待审批：{pendingApproval.requester?.name || "申请人"}提交，{new Date(pendingApproval.createdAt).toLocaleString()}</small>
          </>
        )}
        {currentStatus === "APPROVED" && <small style={{ color: "#0b7a4f" }}>✅ 已批准，可进入生产</small>}
        {currentStatus === "REJECTED" && <small style={{ color: "#b32b23" }}>❌ 已驳回，需修改后重新提交</small>}
      </div>

      {showComment && (
        <div className="comment-box">
          <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="审批说明，例如：成本合理，符合保健食品备案要求，建议批准" rows={3} />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="primary" onClick={() => { onSubmit?.(comment); setShowComment(false); setComment(""); }}>提交</button>
            <button onClick={() => setShowComment(false)}>取消</button>
          </div>
        </div>
      )}

      <div className="approval-timeline">
        {approvals.map((approval, idx) => {
          const config = statusConfig[approval.status] || statusConfig.DRAFT;
          return (
            <div key={approval.id} className="timeline-item" style={{ animationDelay: `${idx * 100}ms` }}>
              <div className="timeline-dot" style={{ background: config.color }}></div>
              <div className="timeline-content">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>{config.icon} {config.label} · {approval.requester?.name || approval.requestedBy}</strong>
                  <small>{new Date(approval.createdAt).toLocaleString()}</small>
                </div>
                {approval.comment && <p>{approval.comment}</p>}
                {approval.approver && <small>审批人：{approval.approver.name}</small>}
              </div>
            </div>
          );
        })}
        {approvals.length === 0 && <div className="empty">暂无审批记录，草稿状态可提交审批</div>}
      </div>

      <div className="approval-flow">
        <small>流程：📝草稿 → ⏳待审批（产品审核） → ⏳待审批（领导审批） → ✅已批准 / ❌已驳回 → 📦归档</small>
      </div>
    </div>
  );
}
