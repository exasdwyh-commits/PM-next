"use client";

import * as React from "react";
import { Empty } from "@/components/ui";
import { type ExecutiveReportPayload } from "@/shared/executive-report-types";
import { Count, Tag, type Tone } from "@/components/kx";
import "./executive-report-v2.css";
import { useRole } from "./role-context";
import { Notice, type NoticeMessage } from "./notice";
import { ExecutiveReportRich } from "./executive-report-rich";
import "./executive-report-rich.css";

/**
 * Executive Report V2 - 领导层友好版 (B证据式为主，去学术化)
 * 用户偏好：
 * - B为主：证据式但要直观，无基础领导也能看懂
 * - C用于项目跟进：行动式
 * - A用于老板通知：极简老板式
 */

function verificationLabel(status?: string | null) {
  switch (status) {
    case "READY_FOR_HUMAN_REVIEW":
      return "已完成核验";
    case "BLOCKED_BY_QA":
      return "需补充材料";
    case "PARTIAL":
      return "部分完成";
    default:
      return "进行中";
  }
}

function toneOfVerification(status?: string | null): Tone {
  if (status === "READY_FOR_HUMAN_REVIEW") return "ok";
  if (status === "BLOCKED_BY_QA") return "bad";
  return "warn";
}

// 领导层友好的证据等级翻译 (去学术化)
function friendlyLevel(level?: string | null) {
  const l = (level || "").toUpperCase();
  if (l === "A") return { label: "高可信", desc: "已核实，来源可靠", color: "var(--k-ok)", icon: "✅" };
  if (l === "B") return { label: "较可信", desc: "基本核实", color: "var(--k-brand)", icon: "👍" };
  if (l === "C") return { label: "待加强", desc: "需补充验证", color: "var(--k-warn)", icon: "⚠️" };
  if (l === "D") return { label: "待核实", desc: "尚未核实", color: "var(--k-bad)", icon: "❓" };
  return { label: "未知", desc: "信息不足", color: "var(--k-ink-3)", icon: "⬜" };
}

function calcStats(conclusions: any[]) {
  const levels: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, UNKNOWN: 0 };
  conclusions.forEach((c) => {
    const lvl = (c.evidenceLevel || "UNKNOWN").toUpperCase();
    if (levels[lvl] !== undefined) levels[lvl]++;
    else levels["UNKNOWN"]++;
  });
  const verified = levels.A + levels.B;
  const total = conclusions.length || 1;
  return { levels, total: conclusions.length, verified, verifiedRate: Math.round((verified / total) * 100) };
}

// 极简环形图
function DonutChart({ a, b, c, d }: { a: number; b: number; c: number; d: number }) {
  const total = a + b + c + d || 1;
  const data = [
    { v: a, color: "var(--k-ok)" },
    { v: b, color: "var(--k-brand)" },
    { v: c, color: "var(--k-warn)" },
    { v: d, color: "var(--k-bad)" },
  ];
  let offset = 0;
  return (
    <svg viewBox="0 0 42 42" width="80" height="80" aria-hidden>
      <circle cx="21" cy="21" r="15.9" fill="transparent" stroke="var(--k-line-soft)" strokeWidth="3" />
      {data.map((seg, i) => {
        if (seg.v === 0) return null;
        const dash = (seg.v / total) * 100;
        const el = (
          <circle key={i} cx="21" cy="21" r="15.9" fill="transparent" stroke={seg.color} strokeWidth="3.5" strokeDasharray={`${dash} ${100 - dash}`} strokeDashoffset={25 - offset} strokeLinecap="round" />
        );
        offset += dash;
        return el;
      })}
      <text x="21" y="22" textAnchor="middle" dominantBaseline="middle" fontSize="7.5" fontWeight="800" fill="var(--k-ink)">
        {a + b > 0 ? `${Math.round(((a + b) / total) * 100)}%` : "0%"}
      </text>
      <text x="21" y="26" textAnchor="middle" fontSize="3.5" fill="var(--k-ink-2)">可信</text>
    </svg>
  );
}

// A: 老板式极简摘要 (用于通知)
function BossSummary({ report, stats }: { report: ExecutiveReportPayload; stats: ReturnType<typeof calcStats> }) {
  const risks = report.risks ?? [];
  const decisions = report.decisionsRequired ?? [];
  return (
    <div className="er2-boss">
      <span className="er2-boss-badge">老板摘要</span>
      <p>
        <strong>结论：</strong>{report.summary?.slice(0, 80) || "暂无结论"}
        <br />
        <strong>依据：</strong>{stats.total}条结论，{stats.verified}条已核实（{stats.verifiedRate}%可信）
        {risks.length > 0 && (
          <>
            <br />
            <strong>风险：</strong>{risks[0]}
          </>
        )}
        {decisions.length > 0 && (
          <>
            <br />
            <strong>待决策：</strong>{decisions[0]}
          </>
        )}
      </p>
    </div>
  );
}

// C: 行动式跟进提示
function ActionFollowUp({ report }: { report: ExecutiveReportPayload }) {
  const unknowns = report.unknowns ?? [];
  const actions = report.recommendedActions ?? [];
  const decisions = report.decisionsRequired ?? [];
  
  // 智能生成行动式提示
  const primaryAction = unknowns[0] || actions[0] || decisions[0] || "暂无紧急事项";
  
  return (
    <div className="er2-action">
      <div className="er2-action-header">
        <span className="er2-action-badge">📍 项目跟进</span>
        <span className="er2-action-time">需要关注</span>
      </div>
      <div className="er2-action-grid">
        <div className="er2-action-item">
          <span className="er2-action-label">现在最重要的事</span>
          <strong>{primaryAction}</strong>
        </div>
        <div className="er2-action-item">
          <span className="er2-action-label">为什么重要</span>
          <span>{unknowns.length > 0 ? `还有${unknowns.length}项信息未闭合，影响决策` : actions.length > 0 ? "完成这些可推进到下一阶段" : "等待负责人处理"}</span>
        </div>
        <div className="er2-action-item">
          <span className="er2-action-label">谁来做</span>
          <span>项目负责人</span>
        </div>
        <div className="er2-action-item">
          <span className="er2-action-label">下一步</span>
          <span>{actions[0] || decisions[0] || "查看详细报告"}</span>
        </div>
      </div>
    </div>
  );
}

export function ExecutiveReportV2({
  report,
  onOpenDecisions,
  onOpenEvidence,
  projectTitle,
  viewMode = "leadership", // leadership | boss | action
}: {
  report: ExecutiveReportPayload | null;
  onOpenDecisions?: () => void;
  onOpenEvidence?: () => void;
  projectTitle?: string;
  viewMode?: "leadership" | "boss" | "action" | "all";
}) {
  const [exporting, setExporting] = React.useState<string | null>(null);
  const [activeView, setActiveView] = React.useState(viewMode);
  const [msg, setMsg] = React.useState<NoticeMessage | null>(null);

  if (!report) {
    return (
      <div className="er2-empty">
        <Empty title="管理报告还没有生成">
          专业研究与独立 QA 完成后，系统会生成一页纸管理报告。若关键输入不足，会保持缺口状态，不会补造结论。
        </Empty>
      </div>
    );
  }

  const conclusions = report.conclusions ?? [];
  const unknowns = report.unknowns ?? [];
  const risks = report.risks ?? [];
  const decisions = report.decisionsRequired ?? [];
  const actions = report.recommendedActions ?? [];
  const stats = calcStats(conclusions);
  const tone = toneOfVerification(report.verificationStatus);

  const handleExport = async (format: "docx" | "xlsx" | "pptx") => {
    if (!report.artifactId) return;
    setExporting(format);
    try {
      const res = await fetch(`/api/missions/${report.artifactId}/export?format=${format}`);
      if (!res.ok) throw new Error("导出失败");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${projectTitle || "report"}-${new Date().toISOString().slice(0, 10)}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      // 导出失败是错误态：用 danger 提示，常驻直到用户关闭（不自动消失）
      setMsg({ tone: "danger", text: e instanceof Error ? e.message : "导出失败" });
    } finally {
      setExporting(null);
    }
  };

  return (
    <section className="er2" data-testid="executive-report-v2">
      <Notice msg={msg} onClose={() => setMsg(null)} />
      {/* 视图切换 - 让领导层可切换不同角色视角 */}
      <div className="er2-view-switch">
        <button className={activeView === "leadership" || activeView === "all" ? "is-active" : ""} onClick={() => setActiveView("leadership")}>👔 领导视图 (直观证据式)</button>
        <button className={activeView === "action" ? "is-active" : ""} onClick={() => setActiveView("action")}>📍 跟进视图 (行动式)</button>
        <button className={activeView === "boss" ? "is-active" : ""} onClick={() => setActiveView("boss")}>💬 老板通知 (极简式)</button>
        <button className={activeView === "all" ? "is-active" : ""} onClick={() => setActiveView("all")}>📄 完整视图</button>
      </div>

      {/* B: 领导层友好 - 直观证据式 (主视图) */}
      {(activeView === "leadership" || activeView === "all") && (
        <>
          <header className="er2-header">
            <div className="er2-title-row">
              <h2>{report.title || "产品研发管理报告"}</h2>
              <Tag tone={tone}>{verificationLabel(report.verificationStatus)}</Tag>
              <span className="er2-meta">v{report.contentVersion} · {report.createdAt ? new Date(report.createdAt).toLocaleDateString() : ""}</span>
            </div>

            {/* 4张指标卡 - 用大白话 */}
            <div className="er2-kpi-grid">
              <div className="er2-kpi is-ok">
                <span className="er2-kpi-label">✅ 已核实结论</span>
                <strong className="er2-kpi-value">{stats.total}条</strong>
                <small className="er2-kpi-sub">{stats.verified}条可信 · {stats.verifiedRate}%可靠</small>
              </div>
              <div className="er2-kpi is-bad">
                <span className="er2-kpi-label">⚠️ 需关注风险</span>
                <strong className="er2-kpi-value">{risks.length}项</strong>
                <small className="er2-kpi-sub">{risks[0]?.slice(0, 20) || "暂无显式风险"}</small>
              </div>
              <div className="er2-kpi is-warn">
                <span className="er2-kpi-label">❓ 待补充信息</span>
                <strong className="er2-kpi-value">{unknowns.length}项</strong>
                <small className="er2-kpi-sub">影响决策的未知项</small>
              </div>
              <div className="er2-kpi is-brand">
                <span className="er2-kpi-label">📝 待您决策</span>
                <strong className="er2-kpi-value">{decisions.length}项</strong>
                <small className="er2-kpi-sub">{decisions.length > 0 ? "需负责人拍板" : "暂无"}</small>
              </div>
            </div>
          </header>

          <section className={`er2-verdict is-${tone}`}>
            <div className="er2-verdict-accent" />
            <div className="er2-verdict-body">
              <span className="er2-verdict-eyebrow">💡 一句话结论 · 领导层可直接决策</span>
              <p>{report.summary || "报告未提供摘要。"}</p>
              <div className="er2-verdict-stats">
                基于 <strong>{stats.total}条</strong> 结论，其中 <strong>{stats.verified}条</strong> 已核实，<strong>{stats.verifiedRate}%</strong> 高可信
              </div>
            </div>
          </section>

          <div className="er2-layout">
            <div className="er2-main">
              <section className="er2-card">
                <div className="er2-card-head">
                  <h3>📊 结论可信度</h3>
                  <span className="er2-hint">颜色越绿越可信，领导层一眼看懂</span>
                </div>
                <div className="er2-chart-row">
                  <DonutChart a={stats.levels.A} b={stats.levels.B} c={stats.levels.C} d={stats.levels.D} />
                  <div className="er2-bar-list">
                    {[
                      { k: "A", v: stats.levels.A, label: "高可信", desc: "已核实，来源可靠" },
                      { k: "B", v: stats.levels.B, label: "较可信", desc: "基本核实" },
                      { k: "C", v: stats.levels.C, label: "待加强", desc: "需补充验证" },
                      { k: "D", v: stats.levels.D, label: "待核实", desc: "尚未核实" },
                    ].map((bar) => {
                      const friendly = friendlyLevel(bar.k);
                      return (
                        <div key={bar.k} className="er2-bar">
                          <span className="er2-bar-label">
                            {friendly.icon} {bar.label}
                          </span>
                          <div className="er2-bar-track">
                            <div className="er2-bar-fill" style={{ width: `${stats.total ? (bar.v / stats.total) * 100 : 0}%`, background: friendly.color }} />
                          </div>
                          <span className="er2-bar-count">{bar.v}条</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>

              <section className="er2-card">
                <div className="er2-card-head">
                  <h3>🔍 关键依据</h3>
                  <span className="er2-hint">每条都可追溯来源，已核实</span>
                </div>
                <div className="er2-evidence-grid">
                  {conclusions.map((c, i) => {
                    const f = friendlyLevel(c.evidenceLevel);
                    return (
                      <div key={i} className="er2-evidence-card">
                        <div className="er2-evidence-top">
                          <span className="er2-evidence-badge" style={{ background: `${f.color}15`, color: f.color, borderColor: `${f.color}30` }}>
                            {f.icon} {f.label}
                          </span>
                          <span className="er2-evidence-fresh">{c.freshness || ""}</span>
                        </div>
                        <strong className="er2-evidence-claim">{c.claim}</strong>
                        <span className="er2-evidence-src">📎 {c.evidenceRef || "内部数据"} · {c.verificationRefs?.length ? `${c.verificationRefs.length}人已核验` : "待核验"}</span>
                      </div>
                    );
                  })}
                </div>
              </section>

              <div className="er2-two">
                <section className="er2-sec is-bad">
                  <h3>⚠️ 最大风险</h3>
                  <ul>{risks.length === 0 ? <li className="er2-muted">暂无显式风险</li> : risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </section>
                <section className="er2-sec is-warn">
                  <h3>❓ 还需补充</h3>
                  <ul>{unknowns.length === 0 ? <li className="er2-muted">信息已闭合</li> : unknowns.map((u, i) => <li key={i}>{u}</li>)}</ul>
                </section>
              </div>
            </div>

            <aside className="er2-dock">
              <h3>📝 需要您决定</h3>
              {decisions.length ? <ol>{decisions.map((d, i) => <li key={i}>{d}</li>)}</ol> : <p className="er2-muted">当前无待决策项</p>}
              <div className="er2-divider" />
              <h3 className="er2-sub">下一步建议</h3>
              {actions.length ? <ol>{actions.map((a, i) => <li key={i}>{a}</li>)}</ol> : <p className="er2-muted">暂无额外建议</p>}
              <div className="er2-actions">
                {decisions.length > 0 && onOpenDecisions && <button className="hermes-primary-btn hermes-btn-sm" onClick={onOpenDecisions}>去做决策</button>}
                {unknowns.length > 0 && onOpenEvidence && <button className="hermes-outline-btn hermes-btn-sm" onClick={onOpenEvidence}>去补信息</button>}
              </div>
              <div className="er2-divider" />
              <h3 className="er2-sub">一键导出</h3>
              <div className="er2-export-grid">
                <button disabled={!!exporting} onClick={() => handleExport("docx")} className="er2-export-btn">{exporting === "docx" ? "生成中…" : "📄 Word"}</button>
                <button disabled={!!exporting} onClick={() => handleExport("xlsx")} className="er2-export-btn">{exporting === "xlsx" ? "生成中…" : "📊 Excel"}</button>
                <button disabled={!!exporting} onClick={() => handleExport("pptx")} className="er2-export-btn">{exporting === "pptx" ? "生成中…" : "📽️ PPT"}</button>
              </div>
            </aside>
          </div>
        </>
      )}

      {/* C: 行动式跟进视图 */}
      {(activeView === "action" || activeView === "all") && (
        <div style={{ display: "grid", gap: 16, marginTop: activeView === "all" ? 24 : 0 }}>
          {activeView === "all" && <h3 style={{ fontSize: 16, fontWeight: 700, borderTop: "1px solid var(--k-line)", paddingTop: 16 }}>📍 项目跟进视图 (行动式)</h3>}
          <ActionFollowUp report={report} />
        </div>
      )}

      {/* A: 老板式极简通知 */}
      {(activeView === "boss" || activeView === "all") && (
        <div style={{ display: "grid", gap: 16, marginTop: activeView === "all" ? 24 : 0 }}>
          {activeView === "all" && <h3 style={{ fontSize: 16, fontWeight: 700, borderTop: "1px solid var(--k-line)", paddingTop: 16 }}>💬 老板通知视图 (极简式)</h3>}
          <BossSummary report={report} stats={stats} />
        </div>
      )}
    </section>
  );
}
