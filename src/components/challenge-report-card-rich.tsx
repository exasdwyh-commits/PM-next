"use client";

import React from "react";
import { cx } from "@/components/ui";
import Icon from "@/components/icons";
import { fmtDateTime } from "@/shared/datetime";
import { useRole } from "./role-context";
import "./challenge-report-card-rich.css";

const CATEGORY_INFO: Record<string, { icon: string; name: string; color: string; gradient: string }> = {
  regular_food: { icon: "🍪", name: "普通食品", color: "#f59e0b", gradient: "linear-gradient(135deg,#fffbeb,#fef3c7)" },
  health_food: { icon: "💊", name: "保健食品", color: "#7c3aed", gradient: "linear-gradient(135deg,#f5f3ff,#ede9fe)" },
  cross_border_food: { icon: "🌍", name: "跨境食品", color: "#0891b2", gradient: "linear-gradient(135deg,#ecfeff,#cffafe)" },
  cosmetics: { icon: "💄", name: "化妆品", color: "#db2777", gradient: "linear-gradient(135deg,#fdf2f8,#fce7f3)" },
};

function getCategoryFromReport(report: any): string {
  const text = `${report.productName || ""} ${report.proposedClaim || ""}`.toLowerCase();
  if (text.includes("化妆") || text.includes("护肤") || text.includes("精华") || text.includes("面膜")) return "cosmetics";
  if (text.includes("跨境") || text.includes("进口") || text.includes("保税")) return "cross_border_food";
  if (text.includes("保健") || text.includes("多酚") || text.includes("胶囊") || text.includes("软糖")) return "health_food";
  return "regular_food";
}

const RISK_CONFIG: any = {
  LOW: { label: "低风险", tone: "ok", icon: "check", color: "#0b7a4f" },
  MEDIUM: { label: "中风险", tone: "warn", icon: "alert", color: "#f59e0b" },
  HIGH: { label: "高风险", tone: "danger", icon: "alert", color: "#ef4444" },
  CRITICAL: { label: "极高风险", tone: "danger", icon: "block", color: "#991b1b" },
};

export default function ChallengeReportCardRich({ report }: { report: any }) {
  const { role } = useRole();
  const category = getCategoryFromReport(report);
  const catInfo = CATEGORY_INFO[category] || CATEGORY_INFO.health_food;
  const risk = RISK_CONFIG[report.overallRisk] || RISK_CONFIG.MEDIUM;
  const generatedDate = fmtDateTime(report.generatedAt);

  if (role === "leadership") {
    return (
      <div className="challenge-rich leadership" style={{ borderColor: catInfo.color }}>
        <div className="challenge-header-rich" style={{ background: catInfo.gradient }}>
          <div>
            <span className="eyebrow" style={{ background: catInfo.color, color: "white" }}>{catInfo.icon} {catInfo.name} · 挑战报告 · {risk.label}</span>
            <h3>{report.productName} · {report.proposedClaim.slice(0, 30)}</h3>
            <small>{generatedDate} · Kern挑战 · {catInfo.name}专用</small>
          </div>
          <div className="risk-badge" style={{ background: risk.color, color: "white" }}>{risk.label}</div>
        </div>
        <div className="boss-summary" style={{ borderLeft: `3px solid ${catInfo.color}` }}>
          <strong>💡 老板一句话结论</strong>
          <p>{report.recommendation === "PROCEED" ? "建议继续，风险可控" : report.recommendation === "MODIFY" ? "建议修改后继续" : report.recommendation === "PAUSE" ? "建议暂停，补充证据" : "建议放弃，风险过高"} · {report.overallRisk} · {catInfo.name}专用 · 需决策</p>
        </div>
      </div>
    );
  }

  if (role === "sales") {
    return (
      <div className="challenge-rich sales" style={{ background: catInfo.gradient }}>
        <div className="challenge-header-rich">
          <h3>💼 挑战报告 · {catInfo.icon} {catInfo.name} · 销售视角</h3>
          <small>{report.productName} · {report.proposedClaim.slice(0, 40)} · 已识别风险{report.topFailureReasons?.length || 0}个 · Kern挑战</small>
        </div>
        <div className="selling-card" style={{ borderLeft: `3px solid ${catInfo.color}` }}>
          <strong>💎 风险转卖点</strong>
          <p>挑战报告显示{report.overallRisk}，但{catInfo.name}核心卖点突出：{report.topFailureReasons?.[0] ? `已识别风险${report.topFailureReasons[0].slice(0, 30)}，但可通过${report.cheapestExperiments?.[0]?.slice(0, 30) || "补充证据"}解决` : "风险可控"}，建议话术：合规可宣称，已做最严谨审查。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="challenge-rich product" style={{ borderColor: catInfo.color }}>
      <div className="challenge-header-rich" style={{ background: catInfo.gradient }}>
        <div className="header-left">
          <Icon name="shield" size={16} />
          <div>
            <div className="challenge-title">挑战我的判断 · {report.productName} · {catInfo.icon} {catInfo.name} · 富可视化</div>
            <div className="challenge-sub">针对宣称「{report.proposedClaim}」的证伪式审查 · {generatedDate} · Kern科学证据引擎</div>
          </div>
        </div>
        <div className="challenge-badges">
          <span className={cx("hermes-chip", `is-${risk.tone}`)} style={{ background: risk.color, color: "white" }}>{risk.label}</span>
          <span className="category-badge" style={{ background: catInfo.color, color: "white" }}>{catInfo.icon} {catInfo.name}</span>
        </div>
      </div>

      <div className="challenge-kpi-grid">
        <div className="kpi" style={{ animationDelay: "0ms" }}><strong>{report.topFailureReasons?.length || 0}</strong><small>失败原因</small></div>
        <div className="kpi" style={{ animationDelay: "80ms" }}><strong>{report.unvalidatedAssumptions?.length || 0}</strong><small>未验证假设</small></div>
        <div className="kpi" style={{ animationDelay: "160ms" }}><strong>{report.vetoData?.length || 0}</strong><small>一票否决</small></div>
        <div className="kpi" style={{ animationDelay: "240ms" }}><strong>{report.cheapestExperiments?.length || 0}</strong><small>验证实验</small></div>
      </div>

      <div className="challenge-body-rich">
        {[
          { title: "最可能失败的3个原因", items: report.topFailureReasons, icon: "x-circle", tone: "danger" },
          { title: "尚未验证的假设", items: report.unvalidatedAssumptions, icon: "help-circle", tone: "warn" },
          { title: "一票否决数据", items: report.vetoData, icon: "alert", tone: "danger" },
          { title: "最低成本验证实验", items: report.cheapestExperiments, icon: "flask", tone: "ok" },
        ].map((sec: any, idx: number) => (
          sec.items?.length > 0 && (
            <div key={idx} className="challenge-section-rich" style={{ animationDelay: `${idx * 80}ms` }}>
              <div className={`section-title is-${sec.tone}`}><Icon name={sec.icon} size={13} />{sec.title}<span className="count">{sec.items.length}</span></div>
              <ul>{sec.items.map((it: string, i: number) => <li key={i}>{it}</li>)}</ul>
            </div>
          )
        ))}
      </div>

      <div className="challenge-mvp" style={{ borderLeft: `3px solid ${catInfo.color}` }}>
        <div className="mvp-label"><Icon name="target" size={13} />建议 MVP · {catInfo.name}专用</div>
        <div className="mvp-content">{report.recommendedMVP}</div>
      </div>

      {(report.scientificGaps?.length > 0 || report.scientificConflicts?.length > 0) && (
        <details className="hermes-details" style={{ marginTop: 12 }}>
          <summary style={{ fontWeight: 600, fontSize: 12 }}>查看证据缺口（{report.scientificGaps?.length || 0}）与科学冲突（{report.scientificConflicts?.length || 0}）· {catInfo.name}专用</summary>
          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            {report.scientificGaps?.length > 0 && (
              <div><div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 6 }}>证据缺口</div>{report.scientificGaps.map((g: any, i: number) => <div key={i} style={{ fontSize: 12, padding: "4px 0", borderBottom: "1px dashed #e7e9ef" }}><strong>{g.ingredient}</strong> · {g.description}</div>)}</div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
