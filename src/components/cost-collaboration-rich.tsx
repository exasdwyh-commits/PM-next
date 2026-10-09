"use client";

import * as React from "react";
import type { CostScenario } from "@/modules/cost-engine/scenario";
import "./cost-collaboration.css";
import "./cost-collaboration-rich.css";
import { useRole } from "./role-context";
import { useReasonDialog } from "./reason-dialog";

const CATEGORY_INFO: Record<string, { icon: string; name: string; color: string }> = {
  regular_food: { icon: "🍪", name: "普通食品", color: "#f59e0b" },
  health_food: { icon: "💊", name: "保健食品", color: "#7c3aed" },
  cross_border_food: { icon: "🌍", name: "跨境食品", color: "#0891b2" },
  cosmetics: { icon: "💄", name: "化妆品", color: "#db2777" },
};

export interface Comment {
  id: string;
  scenarioId: string;
  userId: string;
  userName: string;
  content: string;
  mentions: string[];
  createdAt: string;
}

export function CostCollaborationRich({
  scenario,
  category = "health_food",
}: {
  scenario: CostScenario;
  category?: string;
}) {
  const { role } = useRole();
  const catInfo = CATEGORY_INFO[category] || CATEGORY_INFO.health_food;
  const [comments, setComments] = React.useState<Comment[]>([]);
  const [versions, setVersions] = React.useState<any[]>([]);
  const [newComment, setNewComment] = React.useState("");
  const [mentionSearch, setMentionSearch] = React.useState("");
  const [showMentions, setShowMentions] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  // 版本变更说明用理由对话框收集（替代原生 prompt；取消时 resolve(null)）
  const [askReason, reasonDialog] = useReasonDialog();
  const mockUsers = ["张三-产品", "李四-研发", "王五-领导", "赵六-销售", "钱七-合规"];

  const fetchComments = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/cost/scenarios/${scenario.id}/comments`);
      if (res.ok) {
        const data = await res.json();
        const mapped = (data.comments || []).map((c: any) => ({
          id: c.id,
          scenarioId: c.scenarioId,
          userId: c.userId,
          userName: c.user?.name || c.userId.slice(0, 6),
          content: c.content,
          mentions: c.mentions || [],
          createdAt: c.createdAt,
        }));
        setComments(mapped);
      }
    } catch {}
  }, [scenario.id]);

  const fetchVersions = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/cost/scenarios/${scenario.id}/versions`);
      if (res.ok) {
        const data = await res.json();
        setVersions(data.versions || []);
      }
    } catch {}
  }, [scenario.id]);

  React.useEffect(() => {
    fetchComments();
    fetchVersions();
  }, [fetchComments, fetchVersions]);

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    const mentions = Array.from(newComment.matchAll(/@(\S+)/g)).map((m: any) => m[1]);
    setLoading(true);
    try {
      const res = await fetch(`/api/cost/scenarios/${scenario.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newComment, mentions }),
      });
      if (res.ok) {
        setNewComment("");
        setShowMentions(false);
        fetchComments();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setNewComment(value);
    const atMatch = value.match(/@(\w*)$/);
    if (atMatch) {
      setMentionSearch(atMatch[1]);
      setShowMentions(true);
    } else {
      setShowMentions(false);
    }
  };

  const insertMention = (user: string) => {
    const newValue = newComment.replace(/@\w*$/, `@${user} `);
    setNewComment(newValue);
    setShowMentions(false);
  };

  if (role === "leadership") {
    return (
      <div className="cost-collaboration-rich leadership" style={{ borderColor: catInfo.color }}>
        <div className="collab-header"><h4>💬 协作 · {scenario.name} · {catInfo.icon} {catInfo.name}</h4><small>{comments.length}条评论 · {versions.length}版本 · {catInfo.name}专用</small></div>
        <div className="comment-list">
          {comments.slice(0, 3).map((c, idx) => (
            <div key={c.id} className="comment-item" style={{ animationDelay: `${idx * 50}ms` }}><div className="comment-avatar" style={{ background: catInfo.color }}>{c.userName[0]}</div><div className="comment-content"><strong>{c.userName}</strong><p>{c.content.slice(0, 60)}</p></div></div>
          ))}
          {comments.length === 0 && <div className="empty">暂无评论 · {catInfo.name}专用协作</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="cost-collaboration-rich product" style={{ borderColor: catInfo.color }}>
      {reasonDialog}
      <div className="collab-header">
        <div>
          <h4>💬 协作 · {scenario.name} · {catInfo.icon} {catInfo.name} · 富可视化 · 持久化</h4>
          <small>{comments.length}条评论 · {versions.length}版本 · @提及 · {catInfo.name}专用 · Kern调度</small>
        </div>
        <div className="category-badge" style={{ background: catInfo.color, color: "white" }}>{catInfo.icon} {catInfo.name}</div>
      </div>

      <div className="comment-list">
        {comments.map((comment, idx) => (
          <div key={comment.id} className="comment-item" style={{ animationDelay: `${idx * 50}ms` }}>
            <div className="comment-avatar" style={{ background: catInfo.color }}>{comment.userName[0]}</div>
            <div className="comment-content">
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <strong>{comment.userName}</strong>
                <small>{new Date(comment.createdAt).toLocaleString()}</small>
              </div>
              <p>{comment.content.split(/(@\S+)/).map((part: string, i: number) => part.startsWith("@") ? <span key={i} className="mention" style={{ background: `${catInfo.color}15`, color: catInfo.color }}>{part}</span> : part)}</p>
              {comment.mentions.length > 0 && <small className="mentions">提及：{comment.mentions.join(", ")}</small>}
            </div>
          </div>
        ))}
        {comments.length === 0 && <div className="empty">暂无评论，@同事一起协作 · {catInfo.name}专用</div>}
      </div>

      <div className="comment-input" style={{ borderColor: catInfo.color }}>
        <textarea value={newComment} onChange={handleInputChange} placeholder={`添加评论，@提及同事，例如：@张三-产品 这个${catInfo.name}成本方案原料占比有点高，看看能否优化？`} rows={3} />
        {showMentions && (
          <div className="mention-dropdown">
            {mockUsers.filter(u => u.toLowerCase().includes(mentionSearch.toLowerCase())).map(user => (
              <button key={user} onClick={() => insertMention(user)}>@{user}</button>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
          <small>💡 输入@触发提及 · {catInfo.name}专用 · 持久化到数据库</small>
          <button className="primary" style={{ background: catInfo.color }} onClick={handleAddComment} disabled={loading}>{loading ? "发送中..." : "💬 发送"}</button>
        </div>
      </div>

      <div className="version-history">
        <small>📚 版本历史 · {scenario.name} · {catInfo.name} · 持久化</small>
        <div className="version-list">
          {versions.length > 0 ? versions.map((v: any, idx: number) => (
            <div key={v.id} className={`version-item ${idx === 0 ? "current" : ""}`} style={{ animationDelay: `${idx * 60}ms` }}>
              <span className="version">v{v.version}</span>
              <span>{v.changeNote || `版本${v.version}`} · {new Date(v.createdAt).toLocaleDateString()} · ¥{v.totalCost?.toFixed(2)} · {v.creator?.name || "系统"}</span>
              {idx === 0 && <span className="badge" style={{ background: catInfo.color, color: "white" }}>当前</span>}
            </div>
          )) : (
            <>
              <div className="version-item current"><span className="version">v1</span><span>当前版本 · {new Date(scenario.updatedAt).toLocaleDateString()} · 总成本¥{scenario.totalCost.toFixed(2)}</span><span className="badge" style={{ background: catInfo.color, color: "white" }}>当前</span></div>
              <div className="version-item"><span className="version">v0</span><span>初始版本 · {new Date(scenario.createdAt).toLocaleDateString()}</span></div>
            </>
          )}
        </div>
        <button className="outline" style={{ marginTop: 8, fontSize: 11 }} onClick={async () => {
          const note = await askReason({
            title: "保存为新版本",
            label: "请输入版本变更说明",
            placeholder: "例如：调整了原料单价与包材成本…",
            confirmText: "保存新版本",
          });
          // 取消 / Esc / 点遮罩 → null：不触发任何写操作
          if (!note) return;
          await fetch(`/api/cost/scenarios/${scenario.id}/versions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changeNote: note }) });
          fetchVersions();
        }}>📸 保存当前为新版本 · {catInfo.name}专用</button>
      </div>
    </div>
  );
}
