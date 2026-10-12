"use client";

import React from "react";
import { cx } from "@/components/ui";
import Icon from "@/components/icons";
import { fmtDateTime } from "@/shared/datetime";
import { useRole } from "./role-context";
import { categoryMeta, classifyCategoryByText } from "@/modules/tenant";
import "./challenge-report-card-rich.css";

/**
 * 从报告文本推断品类。
 *
 * ⚠️ 原先这里写死了一张「关键词 → 品类键」映射表，那是**语义级租户假设**：
 * 换租户后会把旧行业的判断带到新行业上。现已收口到共享的
 * `classifyCategoryByText()`（关键词来自 pack，见 @/modules/tenant）。
 */
function getCategoryFromReport(report: any): string {
  return classifyCategoryByText(`${report.productName || ""} ${report.proposedClaim || ""}`);
}

const RISK_CONFIG: any = {
  LOW: { label: "低风险", tone: "ok", icon: "check", color: "var(--ok)" },
  MEDIUM: { label: "中风险", tone: "warn", icon: "alert", color: "var(--warn)" },
  HIGH: { label: "高风险", tone: "danger", icon: "alert", color: "var(--block)" },
  CRITICAL: { label: "极高风险", tone: "danger", icon: "block", color: "var(--block)" },
};

export default function ChallengeReportCardRich({ report }: { report: any }) {
  const { role } = useRole();
  const category = getCategoryFromReport(report);
  const catInfo = categoryMeta(category);
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
              <div><div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-muted)", marginBottom: 6 }}>证据缺口</div>{report.scientificGaps.map((g: any, i: number) => <div key={i} style={{ fontSize: 12, padding: "4px 0", borderBottom: "1px dashed var(--line)" }}><strong>{g.ingredient}</strong> · {g.description}</div>)}</div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
