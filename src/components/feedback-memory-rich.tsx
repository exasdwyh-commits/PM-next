"use client";

import * as React from "react";
import { useRole } from "./role-context";
import { categoryMeta } from "@/modules/tenant";
import "./feedback-memory-rich.css";

export function FeedbackMemoryRich({ category = "health_food", onFeedback }: any) {
  const { role } = useRole();
  const catInfo = categoryMeta(category);
  const [feedbackType, setFeedbackType] = React.useState<"thumbs_up" | "thumbs_down" | "correction">("thumbs_up");
  const [content, setContent] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);

  const memories = [
    { kind: "PREFERENCE", content: "偏好保健食品，关注蓝帽子认证", pinned: true, useCount: 12, createdAt: "2024-10-01" },
    { kind: "PREFERENCE", content: "喜欢简洁版话术，给老板看", pinned: true, useCount: 8, createdAt: "2024-10-02" },
    { kind: "CORRECTION", content: "不要用通用模板，要4类专用", pinned: false, useCount: 5, createdAt: "2024-10-03" },
    { kind: "CORRECTION", content: "避免: 成本计算用通用6模板", pinned: false, useCount: 3, createdAt: "2024-10-04" },
    { kind: "FACT", content: "多酚软糖成本10.2，竞品199，利润高", pinned: false, useCount: 15, createdAt: "2024-10-05" },
  ];

  const harnessSamples = [
    { query: "保健食品 蓝帽子", expected: "蓝帽子认证需提供功能声称+检测报告", actual: "蓝帽子认证需提供功能声称+检测报告+80℃烘焙", outcome: "better", promoted: true, rate: "+12%" },
    { query: "化妆品 备案", expected: "备案+功效宣称", actual: "备案+功效宣称+安全评估", outcome: "better", promoted: true, rate: "+8%" },
    { query: "普通食品 SC", expected: "SC合规", actual: "SC合规+标签", outcome: "same", promoted: false, rate: "0%" },
  ];

  const handleSubmit = () => {
    setSubmitted(true);
    onFeedback?.({ type: feedbackType, content });
    setTimeout(() => { setSubmitted(false); setContent(""); }, 1500);
  };

  return (
    <div className="feedback-memory-rich" data-role={role} style={{ borderColor: catInfo.color } as any}>
      <div className="feedback-header" style={{ background: catInfo.gradient }}>
        <div>
          <span className="eyebrow" style={{ background: catInfo.color, color: "white" }}>{catInfo.icon} {catInfo.name} · 反馈→记忆→Harness · {role}视角</span>
          <h2>反馈与记忆 · PREFERENCE/CORRECTION · Harness Promotion · 可回滚</h2>
          <small>用户 👍/纠正(含原因) → Feedback → PREFERENCE/LESSON 候选 + Harness 样本 → 同类场景优先新策略 → Outcome证明变好才Promotion · {catInfo.name}专用</small>
        </div>
      </div>

      <div className="feedback-section">
        <h4>💬 提交反馈 · {catInfo.name}</h4>
        <div className="feedback-types">
          <button className={feedbackType === "thumbs_up" ? "is-active" : ""} style={{ borderColor: feedbackType === "thumbs_up" ? catInfo.color : undefined, background: feedbackType === "thumbs_up" ? catInfo.color : "white", color: feedbackType === "thumbs_up" ? "white" : "#111" } as any} onClick={() => setFeedbackType("thumbs_up")}>👍 有用 · 记为偏好</button>
          <button className={feedbackType === "thumbs_down" ? "is-active" : ""} style={{ borderColor: feedbackType === "thumbs_down" ? "#f59e0b" : undefined, background: feedbackType === "thumbs_down" ? "#f59e0b" : "white", color: feedbackType === "thumbs_down" ? "white" : "#111" } as any} onClick={() => setFeedbackType("thumbs_down")}>👎 无用 · 记为避免</button>
          <button className={feedbackType === "correction" ? "is-active" : ""} style={{ borderColor: feedbackType === "correction" ? "#dc2626" : undefined, background: feedbackType === "correction" ? "#dc2626" : "white", color: feedbackType === "correction" ? "white" : "#111" } as any} onClick={() => setFeedbackType("correction")}>✏️ 纠正 · 含原因</button>
        </div>
        <div className="feedback-input">
          <textarea placeholder={feedbackType === "thumbs_up" ? "例如: 偏好保健食品，关注蓝帽子认证" : feedbackType === "thumbs_down" ? "例如: 避免用通用模板" : "例如: 不要用通用6模板，要4类专用，原因是..."} value={content} onChange={(e) => setContent(e.target.value)} style={{ borderColor: catInfo.color } as any} />
          <button className="primary" style={{ background: catInfo.color }} onClick={handleSubmit} disabled={!content || submitted}>{submitted ? "提交中..." : "提交反馈 · 生成记忆候选 + Harness样本"}</button>
        </div>
        <small>💡 禁止模型自评代替Outcome, 需真实Outcome证明变好才Promotion, 可回滚, source=null语义去重</small>
      </div>

      <div className="memory-board">
        <h4>🧠 记忆看板 · {memories.length}条 · {catInfo.icon} {catInfo.name}</h4>
        <div className="memory-grid">
          {memories.map((m, idx) => (
            <div key={idx} className={`memory-card ${m.kind.toLowerCase()} ${m.pinned ? "is-pinned" : ""}`} style={{ animationDelay: `${idx * 80}ms`, borderColor: m.pinned ? catInfo.color : "#e7e9ef", background: m.pinned ? `${catInfo.color}08` : "white" } as any}>
              <div className="memory-header">
                <span className={`kind ${m.kind.toLowerCase()}`} style={{ background: m.kind === "PREFERENCE" ? catInfo.color : m.kind === "CORRECTION" ? "#dc2626" : "#6b7280", color: "white" }}>{m.kind === "PREFERENCE" ? "偏好" : m.kind === "CORRECTION" ? "纠正" : "事实"}</span>
                {m.pinned && <span className="pinned" style={{ background: catInfo.color, color: "white" }}>📌 固定</span>}
                <small>使用 {m.useCount}次</small>
              </div>
              <strong>{m.content}</strong>
              <small>{m.createdAt} · {catInfo.name} · {m.pinned ? "Core Memory 始终注入" : "Recall Memory 相关时注入"}</small>
            </div>
          ))}
        </div>
        <div className="dedup-info" style={{ borderLeft: `3px solid ${catInfo.color}` }}>
          <strong>🔍 语义去重 · source=null</strong>
          <p>标准化: 小写+空白归一, 重复内容自动标记忘记, 保留最早一条</p>
        </div>
      </div>

      <div className="harness-board">
        <h4>🧪 Harness 评估 · {harnessSamples.length}样本 · Outcome证明变好才Promotion</h4>
        <div className="harness-grid">
          {harnessSamples.map((s, idx) => (
            <div key={idx} className={`harness-card ${s.outcome}`} style={{ animationDelay: `${idx * 100}ms`, borderColor: s.promoted ? "#0b7a4f" : "#e7e9ef", background: s.promoted ? "#ecfdf5" : "white" } as any}>
              <div className="harness-header">
                <strong>Query: {s.query}</strong>
                <span className={`outcome ${s.outcome}`} style={{ background: s.outcome === "better" ? "#0b7a4f" : s.outcome === "worse" ? "#dc2626" : "#6b7280", color: "white" }}>{s.outcome === "better" ? "变好" : s.outcome === "worse" ? "变差" : "相同"} {s.rate}</span>
                {s.promoted && <span className="promoted">🚀 已Promotion</span>}
              </div>
              <div className="harness-compare">
                <div className="compare-col"><small>Expected</small><p>{s.expected}</p></div>
                <span className="compare-arrow">→</span>
                <div className="compare-col"><small>Actual</small><p>{s.actual}</p></div>
              </div>
              <div className="harness-actions">
                <button style={{ background: s.promoted ? "#0b7a4f" : catInfo.color, color: "white" }}>{s.promoted ? "已Promotion 可回滚" : "Promotion"}</button>
                <small>禁止模型自评, 需真实Outcome</small>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
