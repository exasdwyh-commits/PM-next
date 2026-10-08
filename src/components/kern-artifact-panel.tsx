"use client";

import * as React from "react";
import "./kern-artifact-panel.css";

export interface Artifact {
  id: string;
  title: string;
  html: string;
  category: string;
  timestamp: string;
  role: string;
}

export function KernArtifactPanel({
  artifact,
  artifacts = [],
  onSelect,
  onClose,
}: {
  artifact: Artifact | null;
  artifacts?: Artifact[];
  onSelect?: (id: string) => void;
  onClose?: () => void;
}) {
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [isCollapsed, setIsCollapsed] = React.useState(false);

  const handleDownload = () => {
    if (!artifact) return;
    const blob = new Blob([artifact.html], { type: "text/html;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${artifact.title}-${artifact.category}-${new Date().toISOString().slice(0,10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    if (!artifact) return;
    await navigator.clipboard.writeText(artifact.html);
    alert("富可视化HTML已复制");
  };

  const handlePrint = () => {
    if (!artifact) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(artifact.html);
    w.document.close();
    w.print();
  };

  if (!artifact) {
    return (
      <div className="kern-artifact-panel empty">
        <div className="empty-icon">🎨</div>
        <h4>富可视化Artifact</h4>
        <p>当Kern生成成本报告时，富可视化HTML将在这里展示，支持15个可视化组件+8种动效，Claude风格</p>
        <div className="empty-features">
          <span>📊 瀑布图</span>
          <span>🍩 环形图</span>
          <span>🏁 柱状赛跑</span>
          <span>🌱 BOM翻转卡片</span>
          <span>🛰️ 供应商雷达</span>
          <span>📅 合规时间轴</span>
          <span>💧 动画KPI</span>
          <span>🎯 决策卡</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`kern-artifact-panel ${isFullscreen ? "fullscreen" : ""} ${isCollapsed ? "collapsed" : ""}`}>
      <div className="artifact-header">
        <div className="artifact-title">
          <span className="artifact-icon">🎨</span>
          <div>
            <strong>{artifact.title}</strong>
            <small>{artifact.category} · {artifact.role}视角 · {new Date(artifact.timestamp).toLocaleTimeString()} · 富可视化</small>
          </div>
        </div>
        <div className="artifact-actions">
          <button onClick={() => setIsCollapsed(!isCollapsed)} title={isCollapsed ? "展开" : "收起"}>{isCollapsed ? "📂" : "📁"}</button>
          <button onClick={() => setIsFullscreen(!isFullscreen)} title={isFullscreen ? "退出全屏" : "全屏"}>{isFullscreen ? "🔙" : "🔍"}</button>
          <button onClick={handleDownload} title="下载HTML">📥</button>
          <button onClick={handleCopy} title="复制HTML">📋</button>
          <button onClick={handlePrint} title="打印">🖨️</button>
          {onClose && <button onClick={onClose} title="关闭">✕</button>}
        </div>
      </div>

      {!isCollapsed && (
        <>
          <div className="artifact-content">
            <iframe srcDoc={artifact.html} title={artifact.title} sandbox="allow-same-origin allow-scripts" style={{ width: "100%", height: "100%", border: 0, background: "white" }} />
          </div>

          {artifacts.length > 1 && (
            <div className="artifact-history">
              <small>历史Artifact · {artifacts.length}个</small>
              <div className="history-list">
                {artifacts.map(a => (
                  <button key={a.id} className={a.id === artifact.id ? "active" : ""} onClick={() => onSelect?.(a.id)}>
                    {a.title.slice(0, 20)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
