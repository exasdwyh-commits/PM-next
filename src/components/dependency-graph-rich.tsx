"use client";

import * as React from "react";
import { useRole } from "./role-context";
import "./dependency-graph-rich.css";

const CATEGORY_INFO: Record<string, { icon: string; name: string; color: string; gradient: string }> = {
  regular_food: { icon: "🍪", name: "普通食品", color: "#f59e0b", gradient: "linear-gradient(135deg,#fffbeb,#fef3c7)" },
  health_food: { icon: "💊", name: "保健食品", color: "#7c3aed", gradient: "linear-gradient(135deg,#f5f3ff,#ede9fe)" },
  cross_border_food: { icon: "🌍", name: "跨境食品", color: "#0891b2", gradient: "linear-gradient(135deg,#ecfeff,#cffafe)" },
  cosmetics: { icon: "💄", name: "化妆品", color: "#db2777", gradient: "linear-gradient(135deg,#fdf2f8,#fce7f3)" },
};

interface DependencyNode {
  id: string;
  label: string;
  status: "done" | "running" | "queued" | "blocked";
  duration: string;
  owner?: string;
  risk?: string;
  dependsOn?: string[];
}

const DEFAULT_NODES: DependencyNode[] = [
  { id: "formula", label: "配方确定", status: "done", duration: "5天", owner: "研发", dependsOn: [] },
  { id: "cost", label: "成本优化", status: "running", duration: "3天", owner: "成本组", risk: "成本偏高", dependsOn: ["formula"] },
  { id: "compliance", label: "合规检查", status: "queued", duration: "7天", owner: "合规", dependsOn: ["cost"] },
  { id: "supplier", label: "供应商打样", status: "queued", duration: "10天", owner: "供应链", dependsOn: ["compliance"] },
  { id: "evidence", label: "证据补充", status: "running", duration: "2天", owner: "研发", dependsOn: ["formula"] },
  { id: "test", label: "测试+留存验证", status: "queued", duration: "5天", owner: "实验室", dependsOn: ["supplier", "evidence"] },
  { id: "launch", label: "上市准备", status: "queued", duration: "5天", owner: "市场", dependsOn: ["test"] },
];

export interface DependencyGraphRichProps {
  category?: keyof typeof CATEGORY_INFO | string;
  nodes?: DependencyNode[];
  onAutoAdvance?: () => void | Promise<void>;
}

export function DependencyGraphRich({
  category = "health_food",
  nodes = DEFAULT_NODES,
  onAutoAdvance,
}: DependencyGraphRichProps) {
  const { role } = useRole();
  const catInfo = CATEGORY_INFO[category] || CATEGORY_INFO.health_food;
  const [selected, setSelected] = React.useState<string | null>(null);
  const [autoAdvancing, setAutoAdvancing] = React.useState(false);

  const handleAutoAdvance = () => {
    setAutoAdvancing(true);
    setTimeout(() => {
      setAutoAdvancing(false);
      onAutoAdvance?.();
    }, 1200);
  };

  const getStatusConfig = (status: string) => {
    switch (status) {
      case "done": return { color: "#0b7a4f", bg: "#ecfdf5", label: "已完成", icon: "✅" };
      case "running": return { color: "#f59e0b", bg: "#fffbeb", label: "进行中", icon: "🔄" };
      case "queued": return { color: "#6b7280", bg: "#f9fafb", label: "待开始", icon: "⏳" };
      case "blocked": return { color: "#dc2626", bg: "#fef2f2", label: "阻塞", icon: "🚧" };
      default: return { color: "#6b7280", bg: "#f9fafb", label: "未知", icon: "❓" };
    }
  };

  return (
    <div className="dependency-graph-rich" data-role={role} style={{ borderColor: catInfo.color } as any}>
      <div className="graph-header" style={{ background: catInfo.gradient }}>
        <div>
          <span className="eyebrow" style={{ background: catInfo.color, color: "white" }}>
            {catInfo.icon} {catInfo.name} · 依赖图谱 · 关键路径 · 自动推进 · {role}视角 · 富可视化
          </span>
          <h2>项目依赖图 · {nodes.length}节点 · 关键路径 {nodes.filter(n => n.status !== "done").length}待完成 · Kern自动调度</h2>
          <small>配方 → 成本 → 合规 → 供应商 → 测试 → 上市 · 阻塞自动重试 · {catInfo.name}专用 · 一页看懂</small>
        </div>
        <div className="header-actions">
          <button className="primary" style={{ background: catInfo.color }} onClick={handleAutoAdvance} disabled={autoAdvancing}>
            {autoAdvancing ? "推进中..." : "🚀 自动推进 · 解阻塞"}
          </button>
          <div className="category-badge" style={{ background: catInfo.color, color: "white" }}>{catInfo.icon} {catInfo.name}</div>
        </div>
      </div>

      <div className="graph-legend">
        <div className="legend-item"><span className="dot" style={{ background: "#0b7a4f" }}></span><small>已完成</small></div>
        <div className="legend-item"><span className="dot" style={{ background: "#f59e0b" }}></span><small>进行中</small></div>
        <div className="legend-item"><span className="dot" style={{ background: "#6b7280" }}></span><small>待开始</small></div>
        <div className="legend-item"><span className="dot" style={{ background: "#dc2626" }}></span><small>阻塞</small></div>
        <div className="legend-item"><span className="line"></span><small>依赖关系</small></div>
      </div>

      <div className="graph-canvas">
        <svg viewBox="0 0 800 300" className="graph-svg">
          {/* 依赖连线 */}
          <path d="M 120 80 L 200 80 L 200 120 L 280 120" stroke={catInfo.color} strokeWidth="2" fill="none" strokeDasharray="4 4" opacity={0.5} />
          <path d="M 360 120 L 440 120 L 440 80 L 520 80" stroke={catInfo.color} strokeWidth="2" fill="none" strokeDasharray="4 4" opacity={0.5} />
          <path d="M 120 180 L 200 180 L 200 120 L 280 120" stroke="#f59e0b" strokeWidth="2" fill="none" opacity={0.4} />
          <path d="M 600 80 L 680 80 L 680 150 L 600 150" stroke={catInfo.color} strokeWidth="2" fill="none" strokeDasharray="4 4" opacity={0.5} />
          <path d="M 600 180 L 680 180 L 680 150 L 600 150" stroke={catInfo.color} strokeWidth="2" fill="none" opacity={0.5} />
          {/* 关键路径高亮 */}
          <rect x="10" y="10" width="780" height="280" rx="12" fill="none" stroke={catInfo.color} strokeWidth="1" strokeDasharray="8 4" opacity={0.2} />
        </svg>

        <div className="nodes-grid">
          {nodes.map((node, idx) => {
            const cfg = getStatusConfig(node.status);
            const isSelected = selected === node.id;
            return (
              <div
                key={node.id}
                className={`graph-node ${node.status} ${isSelected ? "is-selected" : ""}`}
                style={{
                  animationDelay: `${idx * 80}ms`,
                  borderColor: isSelected ? catInfo.color : `${cfg.color}30`,
                  background: isSelected ? `${catInfo.color}08` : cfg.bg,
                } as any}
                onClick={() => setSelected(isSelected ? null : node.id)}
              >
                <div className="node-header">
                  <span className="node-icon" style={{ background: `${cfg.color}15`, color: cfg.color }}>{cfg.icon}</span>
                  <strong>{node.label}</strong>
                  <span className="node-status" style={{ background: cfg.color, color: "white" }}>{cfg.label}</span>
                </div>
                <div className="node-meta">
                  <small>⏱️ {node.duration}</small>
                  {node.owner && <small>👤 {node.owner}</small>}
                  {node.risk && <small style={{ color: "#dc2626" }}>⚠️ {node.risk}</small>}
                </div>
                {node.dependsOn && node.dependsOn.length > 0 && (
                  <div className="node-deps">
                    <small>依赖: {node.dependsOn.join(" → ")}</small>
                  </div>
                )}
                <div className="node-bar">
                  <div className="track"><div className="fill" style={{ width: node.status === "done" ? "100%" : node.status === "running" ? "60%" : "0%", background: cfg.color } as any}></div></div>
                </div>
                {isSelected && (
                  <div className="node-detail" style={{ borderColor: catInfo.color }}>
                    <strong>🔍 {node.label} 详情 · {catInfo.name}</strong>
                    <p>状态: {cfg.label} · 时长: {node.duration} · 负责人: {node.owner || "未分配"}</p>
                    {node.dependsOn && <p>前置依赖: {node.dependsOn.join(", ")} · 阻塞自动重试</p>}
                    <div className="detail-actions">
                      <button style={{ background: catInfo.color, color: "white" }}>查看证据</button>
                      <button>推进</button>
                      <button>指派</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="critical-path" style={{ borderColor: catInfo.color, background: `${catInfo.color}08` }}>
        <strong>🔥 关键路径:</strong> 配方确定 → 成本优化 → 合规检查 → 供应商打样 → 测试+上市 · 总计45天 · 当前进度62% · 阻塞: 成本偏高需优化 · {catInfo.name}专用 · 自动推进已启用
        <div className="path-bar"><div className="track"><div className="fill" style={{ width: "62%", background: catInfo.color } as any}></div></div><small>62% · 预计2024-11-15上市</small></div>
      </div>

      <div className="auto-advance-info" style={{ borderLeft: `3px solid ${catInfo.color}` }}>
        <strong>🤖 自动推进 · AutoAdvance · {catInfo.icon} {catInfo.name}</strong>
        <p>当阻塞原因解除时自动重试：成本优化完成后自动触发合规检查，合规通过后自动触发供应商打样。当前：成本优化进行中 → 完成后自动推进合规</p>
        <div className="advance-chips">
          <span style={{ background: `${catInfo.color}15`, color: catInfo.color }}>配方→成本 已自动</span>
          <span style={{ background: "#f59e0b15", color: "#f59e0b" }}>成本→合规 待自动</span>
          <span style={{ background: "#6b728015", color: "#6b7280" }}>合规→供应商 排队</span>
        </div>
      </div>
    </div>
  );
}
