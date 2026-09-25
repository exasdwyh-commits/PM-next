"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "@/components/icons";
import { PageHeading, Panel, Badge, Empty } from "@/components/ui";
import { useReasonDialog } from "@/components/reason-dialog";
import { identityHeaders } from "@/shared/client-identity";
import { fmtDateTimeFull } from "@/shared/datetime";
import { labelFeedbackStatus } from "@/shared/status-labels";

export default function ConsultationClient({
  initialFeedbacks,
  projects,
  allUsers,
  currentSession,
  mockAuth = false,
}: {
  initialFeedbacks: any[];
  projects: { id: string; title: string; ownerId: string }[];
  allUsers: { id: string; name: string }[];
  currentSession?: any;
  mockAuth?: boolean;
}) {
  const router = useRouter();
  const [activeUserId, setActiveUserId] = useState(currentSession?.userId || allUsers[0]?.id || "");
  const [feedbacks, setFeedbacks] = useState(initialFeedbacks);
  const [targetProjectId, setTargetProjectId] = useState(projects[0]?.id || "");
  const [content, setContent] = useState("");
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  // 理由输入对话框（替代原生 prompt）
  const [askReason, reasonDialog] = useReasonDialog();

  // 操作后改用 router.refresh() 局部刷新；服务端会重新取数并把新 props 传下来，
  // 但 useState 的初始值只在首次挂载生效，这里显式跟随 props 同步（依赖用可稳定比较的键）。
  const feedbacksKey = initialFeedbacks.map((f: any) => `${f.id}:${f.status}`).join(",");
  React.useEffect(() => {
    setFeedbacks(initialFeedbacks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedbacksKey]);

  const activeUser = allUsers.find((u) => u.id === activeUserId);
  const isOwnerOf = (projectId: string) =>
    projects.find((p) => p.id === projectId)?.ownerId === activeUserId;

  const showMsg = (text: string, type: "success" | "error" = "success") => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 5000);
  };

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

  // 局部刷新：不整页 reload，保留滚动位置与本地状态
  const reload = () => router.refresh();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetProjectId || !content.trim()) return;
    try {
      await apiCall(`/api/projects/${targetProjectId}/feedback`, "POST", {
        targetType: "Project",
        targetId: targetProjectId,
        content: content.trim(),
      });
      showMsg("反馈已提交至对应项目");
      setContent("");
      reload();
    } catch (err: any) {
      showMsg(err.message, "error");
    }
  };

  const handleDispose = async (feedbackId: string, status: "ACCEPTED" | "REJECTED") => {
    const reason = await askReason(
      status === "ACCEPTED"
        ? {
            title: "采纳反馈并立项修订",
            label: "采纳意见并建立修订任务说明",
            placeholder: "填写采纳意见，将作为修订任务说明…",
            confirmText: "采纳并立项",
            tone: "primary",
          }
        : {
            title: "驳回反馈",
            label: "驳回反馈理由",
            placeholder: "填写驳回理由…",
            confirmText: "确认驳回",
            tone: "danger",
          }
    );
    // 取消 / Esc / 点遮罩 → null：不触发任何写操作
    if (!reason) return;
    try {
      await apiCall(`/api/feedback/${feedbackId}/disposition`, "POST", {
        status,
        reason,
        createRevisionWorkItem: status === "ACCEPTED",
      });
      showMsg(status === "ACCEPTED" ? "反馈已采纳并立项修订" : "反馈已驳回");
      reload();
    } catch (err: any) {
      showMsg(err.message, "error");
    }
  };

  const openCount = feedbacks.filter((f) => f.status === "OPEN").length;

  return (
    <div className="hermes-stack">
      <PageHeading
        eyebrow="ADVISORY BOARD"
        title="顾问议事厅"
        subtitle="提交顾问反馈，并由项目负责人就地采纳或驳回。"
        actions={
          mockAuth ? (
            <div className="hermes-identity">
              <span>当前身份（开发态）</span>
              <select
                value={activeUserId}
                onChange={(e) => setActiveUserId(e.target.value)}
                aria-label="切换操作人"
                className="hermes-select"
              >
                {allUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          ) : undefined
        }
      />

      {msg && (
        <div
          className={`hermes-banner ${msg.type === "error" ? "is-danger" : "is-ok"}`}
          role={msg.type === "error" ? "alert" : "status"}
          aria-live={msg.type === "error" ? "assertive" : "polite"}
        >
          {msg.text}
        </div>
      )}

      <Panel
        eyebrow="NEW FEEDBACK"
        title="发起顾问反馈"
        sub="择目标项目后提交意见；当事人均可在此统一议事。作为负责人可在下方就地采纳/驳回。"
      >
        <form onSubmit={handleSubmit} className="hermes-form-grid">
          <label className="hermes-label">
            <span>目标项目</span>
            <select
              value={targetProjectId}
              onChange={(e) => setTargetProjectId(e.target.value)}
              className="hermes-select"
            >
              {projects.length === 0 && <option value="">— 暂无项目 —</option>}
              {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </label>
          <label className="hermes-label">
            <span>反馈内容</span>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="针对方案、口感或成分提出建议..."
              rows={2}
              required
              className="hermes-textarea"
            />
          </label>
          <div className="hermes-modal-actions">
            <button type="submit" className="hermes-primary-btn hermes-btn-sm"><Icon name="plus" size={16} />提交反馈</button>
          </div>
        </form>
      </Panel>

      <Panel
        eyebrow="FEEDBACK POOL"
        title="协作反馈池"
        titleSmall={`(${feedbacks.length})`}
        sub={`${labelFeedbackStatus("OPEN")} ${openCount}`}
      >
        {feedbacks.length === 0 ? (
          <Empty>还没有反馈记录。先选择项目并提交一条反馈；后续采纳、驳回或补充信息都会保留处置记录。</Empty>
        ) : (
          <div className="hermes-list">
            {feedbacks.map((fb) => (
              <div key={fb.id} className="hermes-row is-flat space-y-1">
                <div className="hermes-row-head">
                  <Badge status={fb.status}>{labelFeedbackStatus(fb.status)}</Badge>
                  <Link href={`/projects/${fb.projectId}`} className="hermes-link hermes-row-title">{fb.project?.title}</Link>
                  <span className="hermes-row-meta">by {fb.author?.name}</span>
                  <span className="hermes-row-meta">· {fmtDateTimeFull(fb.createdAt)}</span>
                </div>
                <div className="hermes-row-body">{fb.content}</div>
                {fb.dispositionReason && <div className="hermes-row-meta">处置: {fb.dispositionReason}</div>}
                {fb.status === "OPEN" && isOwnerOf(fb.projectId) && (
                  <div className="hermes-inline-end">
                    <button onClick={() => handleDispose(fb.id, "REJECTED")} className="hermes-ghost-btn hermes-btn-sm">驳回</button>
                    <button onClick={() => handleDispose(fb.id, "ACCEPTED")} className="hermes-primary-btn hermes-btn-sm">采纳并立项修订</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      {reasonDialog}
    </div>
  );
}
