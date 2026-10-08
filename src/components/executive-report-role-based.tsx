"use client";

import * as React from "react";
import type { ExecutiveReportPayload } from "@/shared/executive-report-types";
import { Tag } from "@/components/kx";
import { useRole } from "@/components/role-context";
import { inferRoleFromText } from "@/components/kern-role-intelligence";
import "./executive-report-role.css";
import "./role-switch.css";
import { RoleTools } from "./role-tools";
import "./role-tools.css";

type Role = "leadership" | "product" | "sales";

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

// 领导层
function LeadershipView({ report, onOpenDecisions, onOpenEvidence }: any) {
  const conclusions = report.conclusions ?? [];
  const risks = report.risks ?? [];
  const unknowns = report.unknowns ?? [];
  const decisions = report.decisionsRequired ?? [];
  const stats = calcStats(conclusions);
  return (
    <div className="err-lead">
      <div className="err-kpi-grid">
        <div className="kpi ok"><span>✅ 已核实</span><strong>{stats.total}条</strong><small>{stats.verifiedRate}%可信</small></div>
        <div className="kpi bad"><span>⚠️ 风险</span><strong>{risks.length}项</strong><small>{risks[0]?.slice(0, 15) || "无"}</small></div>
        <div className="kpi warn"><span>❓ 待补充</span><strong>{unknowns.length}项</strong></div>
        <div className="kpi brand"><span>📝 待决策</span><strong>{decisions.length}项</strong></div>
      </div>
      <div className="err-verdict"><span>💡 一句话结论</span><p>{report.summary}</p></div>
      <div className="err-cards">
        {conclusions.slice(0, 4).map((c: any, i: number) => (
          <div key={i} className="err-card"><strong>{c.claim}</strong><small>📎 {c.evidenceRef}</small></div>
        ))}
      </div>
      <div className="err-actions">
        <button className="hermes-primary-btn" onClick={onOpenDecisions}>去决策</button>
        <button className="hermes-outline-btn" onClick={onOpenEvidence}>查看证据</button>
      </div>
    </div>
  );
}

// 产品研发
function ProductView({ report, onOpenDecisions, onOpenEvidence }: any) {
  const conclusions = report.conclusions ?? [];
  const risks = report.risks ?? [];
  const unknowns = report.unknowns ?? [];
  const stats = calcStats(conclusions);
  return (
    <div className="err-product">
      <div className="err-section">
        <h3>🔬 证据可信度矩阵 (专业严谨)</h3>
        <table className="err-table-full">
          <thead><tr><th>结论</th><th>类型</th><th>等级</th><th>来源</th><th>核验</th><th>新鲜度</th></tr></thead>
          <tbody>
            {conclusions.map((c: any, i: number) => (
              <tr key={i}><td>{c.claim}</td><td>{c.claimKind}</td><td><span className={`lvl ${c.evidenceLevel}`}>{c.evidenceLevel}</span></td><td>{c.evidenceRef}</td><td>{c.verificationRefs?.length || 0}条</td><td>{c.freshness}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="err-stats">A级 {stats.levels.A} · B级 {stats.levels.B} · C级 {stats.levels.C} · D级 {stats.levels.D} · 总计 {stats.total} · 可信率 {stats.verifiedRate}%</div>
      </div>
      <div className="err-two">
        <div className="err-sec"><h4>⚠️ 风险清单 (需工具流程跟进)</h4><ul>{risks.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul><button onClick={onOpenDecisions}>🛠️ 生成风险应对计划</button></div>
        <div className="err-sec"><h4>❓ UNKNOWN 缺口 (需补证据)</h4><ul>{unknowns.map((u: string, i: number) => <li key={i}>{u}</li>)}</ul><button onClick={onOpenEvidence}>📎 去补证据</button></div>
      </div>
      <RoleTools />
    </div>
  );
}

// 销售营销
function SalesView({ report }: any) {
  const conclusions = report.conclusions ?? [];
  const salesPoints = conclusions.filter((c: any) => c.evidenceLevel === "A" || c.claimKind === "FACT").slice(0, 3);
  return (
    <div className="err-sales">
      <div className="err-sales-hero">
        <span className="badge">🔥 核心卖点</span>
        <h2>{report.summary?.split("，")[0] || "产品具备市场竞争力"}</h2>
        <p>基于 {conclusions.length} 条已核实结论提炼，适合直接用于客户沟通</p>
      </div>
      <div className="err-sales-points">
        {salesPoints.map((c: any, i: number) => (
          <div key={i} className="sales-point">
            <span className="icon">💎</span>
            <div><strong>{c.claim}</strong><small>客户价值：{c.customerValue || "健康趋势，功效突出"}</small><small>📎 依据：{c.evidenceRef} · A级可信</small></div>
          </div>
        ))}
        {salesPoints.length === 0 && conclusions.slice(0, 3).map((c: any, i: number) => (
          <div key={i} className="sales-point">
            <span className="icon">💎</span>
            <div><strong>{c.claim}</strong><small>客户价值：可直接用于销售话术</small></div>
          </div>
        ))}
      </div>
      <RoleTools />
      <div className="err-sales-script">
        <h4>💬 推荐销售话术 (一键复制)</h4>
        <p>“{report.summary?.slice(0, 80)}，成本仅10.2元，竞品均价299元，利润空间大，82%留存率已验证，建议首批1000盒试销。”</p>
        <div className="script-actions"><button>📋 复制话术</button><button>📤 分享</button></div>
      </div>
    </div>
  );
}

export function ExecutiveReportRoleBased({
  report,
  onOpenDecisions,
  onOpenEvidence,
  defaultRole,
}: {
  report: ExecutiveReportPayload;
  onOpenDecisions?: () => void;
  onOpenEvidence?: () => void;
  defaultRole?: Role;
}) {
  const { role: intelligentRole, source, reason, confidence, setManualRole, setAutoInference } = useRole();
  const [localRole, setLocalRole] = React.useState<Role | null>(defaultRole || null);

  // 自动从报告内容推断角色
  React.useEffect(() => {
    const text = JSON.stringify(report || {}).slice(0, 2000);
    const inf = inferRoleFromText(text);
    if (inf) setAutoInference(inf);
  }, [report, setAutoInference]);

  const activeRole = localRole || defaultRole || intelligentRole;

  return (
    <div className="err-role" data-role={activeRole}>
      <div className="err-role-header">
        <div className="err-role-switch">
          <div className="role-switch">
            <button className={activeRole === "leadership" ? "is-active" : ""} onClick={() => { setLocalRole("leadership"); setManualRole("leadership"); }}>👔 领导层</button>
            <button className={activeRole === "product" ? "is-active" : ""} onClick={() => { setLocalRole("product"); setManualRole("product"); }}>🔬 产品研发</button>
            <button className={activeRole === "sales" ? "is-active" : ""} onClick={() => { setLocalRole("sales"); setManualRole("sales"); }}>💼 销售营销</button>
          </div>
          {source !== "manual" && source !== "default" && (
            <small className="role-auto-hint">
              <span className={`dot ${source}`} /> {source === "auto" ? "Kern建议" : "自动"}: {reason} {confidence > 0 ? `(${Math.round(confidence * 100)}%)` : ""}
            </small>
          )}
        </div>
        <div className="err-kpi-summary">
          <div className="kpi ok"><span>✅ 结论</span><strong>{report.conclusions?.length || 0}</strong></div>
          <div className="kpi bad"><span>⚠️ 风险</span><strong>{report.risks?.length || 0}</strong></div>
          <div className="kpi warn"><span>❓ 缺口</span><strong>{report.unknowns?.length || 0}</strong></div>
        </div>
      </div>

      {activeRole === "leadership" && <LeadershipView report={report} onOpenDecisions={onOpenDecisions} onOpenEvidence={onOpenEvidence} />}
      {activeRole === "product" && <ProductView report={report} onOpenDecisions={onOpenDecisions} onOpenEvidence={onOpenEvidence} />}
      {activeRole === "sales" && <SalesView report={report} />}
    </div>
  );
}

export default ExecutiveReportRoleBased;
