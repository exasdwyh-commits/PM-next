"use client";

import * as React from "react";
import type { CostScenario } from "@/modules/cost-engine/scenario";
import "./cost-collaboration.css";
import "./cost-collaboration-rich.css";
import { CostCollaborationRich } from "./cost-collaboration-rich";
import { useRole } from "./role-context";

export interface Comment {
  id: string;
  scenarioId: string;
  userId: string;
  userName: string;
  content: string;
  mentions: string[];
  createdAt: string;
}

export function CostCollaborationOriginal({
  scenario,
  comments = [],
  onAddComment,
  onMention,
}: {
  scenario: CostScenario;
  comments?: Comment[];
  onAddComment?: (content: string, mentions: string[]) => void;
  onMention?: (user: string) => void;
}) {
  const [newComment, setNewComment] = React.useState("");
  const [mentionSearch, setMentionSearch] = React.useState("");
  const [showMentions, setShowMentions] = React.useState(false);

  const mockUsers = ["张三-产品", "李四-研发", "王五-领导", "赵六-销售", "钱七-合规"];

  const handleAddComment = () => {
    if (!newComment.trim()) return;
    const mentions = Array.from(newComment.matchAll(/@(\S+)/g)).map(m => m[1]);
    onAddComment?.(newComment, mentions);
    setNewComment("");
    setShowMentions(false);
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
    onMention?.(user);
  };

  return (
    <div className="cost-collaboration">
      <div className="collab-header">
        <h4>💬 协作 · {scenario.name}</h4>
        <small>{comments.length}条评论 · @提及 · 版本历史</small>
      </div>

      <div className="comment-list">
        {comments.map((comment, idx) => (
          <div key={comment.id} className="comment-item" style={{ animationDelay: `${idx * 50}ms` }}>
            <div className="comment-avatar">{comment.userName[0]}</div>
            <div className="comment-content">
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <strong>{comment.userName}</strong>
                <small>{new Date(comment.createdAt).toLocaleString()}</small>
              </div>
              <p>{comment.content.split(/(@\S+)/).map((part, i) => part.startsWith("@") ? <span key={i} className="mention">{part}</span> : part)}</p>
              {comment.mentions.length > 0 && <small className="mentions">提及：{comment.mentions.join(", ")}</small>}
            </div>
          </div>
        ))}
        {comments.length === 0 && <div className="empty">暂无评论，@同事一起协作</div>}
      </div>

      <div className="comment-input">
        <textarea value={newComment} onChange={handleInputChange} placeholder="添加评论，@提及同事，例如：@张三-产品 这个成本方案原料占比有点高，看看能否优化？" rows={3} />
        {showMentions && (
          <div className="mention-dropdown">
            {mockUsers.filter(u => u.toLowerCase().includes(mentionSearch.toLowerCase())).map(user => (
              <button key={user} onClick={() => insertMention(user)}>@{user}</button>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
          <small>💡 输入@触发提及，支持@产品/研发/领导/销售/合规</small>
          <button className="primary" onClick={handleAddComment}>💬 发送</button>
        </div>
      </div>

      <div className="version-history">
        <small>📚 版本历史 · {scenario.name} · 当前版本</small>
        <div className="version-list">
          <div className="version-item current">
            <span className="version">v{comments.length + 1}</span>
            <span>当前版本 · {new Date(scenario.updatedAt).toLocaleDateString()} · 总成本¥{scenario.totalCost.toFixed(2)}</span>
            <span className="badge">当前</span>
          </div>
          <div className="version-item">
            <span className="version">v1</span>
            <span>初始版本 · {new Date(scenario.createdAt).toLocaleDateString()} · 总成本¥{scenario.totalCost.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}


export function CostCollaboration(props: any) {
  try {
    const { role, source } = useRole();
    if (source !== "default") {
      return <CostCollaborationRich {...props} category={props.category || props.scenario?.category || "health_food"} />;
    }
  } catch {}
  return <CostCollaborationOriginal {...props} />;
}
