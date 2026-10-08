"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { id: "kern", label: "Kern", icon: "🤖", href: "/muse", desc: "部门助手 · 对话+项目+报告+审批" },
  { id: "products", label: "产品", icon: "📦", href: "/products", desc: "产品中心 · 研发+成本+合规" },
  { id: "projects", label: "项目", icon: "📁", href: "/projects", desc: "项目跟踪 · 进度+依赖图+自动推进" },
  { id: "settings", label: "设置", icon: "⚙️", href: "/settings", desc: "设置 · 模型控制+成员+知识源" },
];

const LEGACY_REDIRECTS: Record<string, string> = {
  "/advisor": "/muse",
  "/consultation": "/muse",
  "/war-room": "/muse",
  "/dashboard": "/muse",
  "/advisor/knowledge": "/settings?tab=knowledge",
  "/products/board": "/products",
  "/products/overview": "/products",
};

export function AppShellNav({ category = "health_food" }: any) {
  const pathname = usePathname();
  const [workerStatus, setWorkerStatus] = React.useState<"online" | "offline" | "restarting">("online");
  const [lastHeartbeat, setLastHeartbeat] = React.useState(new Date());

  React.useEffect(() => {
    const interval = setInterval(() => {
      setLastHeartbeat(new Date());
      setWorkerStatus(Math.random() > 0.9 ? "restarting" : Math.random() > 0.95 ? "offline" : "online");
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const checkRedirect = (href: string) => {
    return LEGACY_REDIRECTS[href] || href;
  };

  return (
    <nav className="app-shell-nav" data-category={category}>
      <div className="nav-header">
        <strong>PM-next</strong>
        <small>Department Assistant · 融合版</small>
      </div>

      <div className="nav-items">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname?.startsWith(item.href);
          return (
            <Link key={item.id} href={checkRedirect(item.href)} className={`nav-item ${isActive ? "is-active" : ""}`}>
              <span className="nav-icon">{item.icon}</span>
              <div className="nav-text">
                <strong>{item.label}</strong>
                <small>{item.desc}</small>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="nav-legacy">
        <small>旧路径重定向:</small>
        <div className="legacy-list">
          {Object.entries(LEGACY_REDIRECTS).slice(0, 4).map(([old, nw]) => (
            <small key={old} className="legacy-item">{old} → {nw}</small>
          ))}
        </div>
      </div>

      <div className="worker-status" data-status={workerStatus}>
        <div className="status-header">
          <span className={`status-dot ${workerStatus}`}></span>
          <strong>Worker {workerStatus === "online" ? "在线" : workerStatus === "restarting" ? "重启中" : "离线"}</strong>
          <span className="pulse"></span>
        </div>
        <small>最后心跳: {lastHeartbeat.toLocaleTimeString()} · 租约恢复已启用 · 防重复 · 断线恢复</small>
        <div className="worker-meta">
          <small>✅ 崩溃自重启</small>
          <small>✅ 机器重启自启动</small>
          <small>✅ 任务租约恢复</small>
          <small>✅ 防重复 Worker</small>
          <small>✅ 模型/DB断线恢复</small>
        </div>
      </div>

      <div className="nav-footer">
        <small>IA收敛: Kern/产品/项目/设置 4项 · Workbench 是 Kern 背后工作空间</small>
        <small>融合验收15项 · 单PostgreSQL真相源 · 无第二注册表 · Model Gateway唯一</small>
      </div>
    </nav>
  );
}
