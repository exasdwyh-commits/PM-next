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

/* 三态标注（系统级契约）：结论只携带事实属性，呈现层只翻译不发明。
 * FACT→事实；INFERENCE/ESTIMATE→推断；其余（含 OPINION/缺失）→UNKNOWN。 */
type ClaimKindView = "fact" | "infer" | "unknown";

function claimKindView(kind?: string): ClaimKindView {
  const k = (kind || "").toUpperCase();
  if (k === "FACT") return "fact";
  if (k === "INFERENCE" || k === "ESTIMATE") return "infer";
  return "unknown";
}

function ErrEv({ kind }: { kind?: string }) {
  const v = claimKindView(kind);
  const label = v === "fact" ? "事实" : v === "infer" ? "推断" : "UNKNOWN";
  return <span className={`err-ev err-ev--${v}`}>{label}</span>;
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
        <div className="kpi bad"><span>⚠️ 风险</span><strong>{risks.length}项</strong><small>{risks[0] ?? "无"}</small></div>
        <div className="kpi warn"><span>❓ 待补充</span><strong>{unknowns.length}项</strong></div>
        <div className="kpi brand"><span>📝 待决策</span><strong>{decisions.length}项</strong></div>
      </div>
      <div className="err-verdict"><span>💡 一句话结论</span><p>{report.summary}</p></div>
      <div className="err-cards">
        {conclusions.slice(0, 4).map((c: any, i: number) => (
          <div key={i} className="err-card"><ErrEv kind={c.claimKind} /><strong>{c.claim}</strong><small>📎 {c.evidenceRef}</small></div>
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
        <div className="err-table-wrap">
          <table className="err-table-full">
            <thead><tr><th>结论</th><th>三态</th><th>等级</th><th>来源</th><th>核验</th><th>新鲜度</th></tr></thead>
            <tbody>
              {conclusions.map((c: any, i: number) => (
                <tr key={i}><td>{c.claim}</td><td><ErrEv kind={c.claimKind} /></td><td><span className={`lvl ${c.evidenceLevel || "UNKNOWN"}`}>{c.evidenceLevel || "?"}</span></td><td>{c.evidenceRef}</td><td>{c.verificationRefs?.length || 0}条</td><td>{c.freshness}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="err-stats">A级 {stats.levels.A} · B级 {stats.levels.B} · C级 {stats.levels.C} · D级 {stats.levels.D} · 总计 {stats.total} · 可信率 {stats.verifiedRate}%</div>
      </div>
      <div className="err-two">
        <div className="err-sec"><h4>⚠️ 风险清单 (需工具流程跟进)</h4><ul>{risks.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul><button onClick={onOpenDecisions}>🛠️ 生成风险应对计划</button></div>
        <div className="err-sec"><h4>❓ UNKNOWN 缺口（每条须给出补齐路径）</h4><ul>{unknowns.map((u: string, i: number) => <li key={i}>{u}</li>)}</ul><button onClick={onOpenEvidence}>📎 去补证据</button></div>
      </div>
      <RoleTools />
    </div>
  );
}

// 销售营销
function SalesView({ report }: any) {
  const conclusions = report.conclusions ?? [];
  const salesPoints = conclusions.filter((c: any) => c.evidenceLevel === "A" || c.claimKind === "FACT").slice(0, 3);
  /* 话术只由报告数据字段拼装，禁止写死任何数字/竞品结论（拆雷：原硬编码模板串）。 */
  const headline: string = report.summary?.split("，")[0] || "";
  const scriptClaims: any[] = (salesPoints.length > 0 ? salesPoints : conclusions.slice(0, 3)).filter((c: any) => !!c?.claim);
  const scriptText = [headline, ...scriptClaims.map((c: any) => String(c.claim))].filter(Boolean).join("；");
  return (
    <div className="err-sales">
      <div className="err-sales-hero">
        <span className="badge">🔥 核心卖点</span>
        <h2>{headline || "产品竞争力待结论核实后生成"}</h2>
        <p>基于 {conclusions.length} 条已入库结论提炼，仅可直接引用已核实内容</p>
      </div>
      <div className="err-sales-points">
        {scriptClaims.map((c: any, i: number) => (
          <div key={i} className="sales-point">
            <span className="icon">💎</span>
            <div>
              <ErrEv kind={c.claimKind} />
              <strong>{c.claim}</strong>
              {c.customerValue ? <small>客户价值：{c.customerValue}</small> : null}
              <small>📎 依据：{c.evidenceRef}{c.evidenceLevel ? ` · ${c.evidenceLevel}级` : ""}</small>
            </div>
          </div>
        ))}
      </div>
      <RoleTools />
      <div className="err-sales-script">
        <h4>💬 推荐销售话术 (一键复制)</h4>
        {scriptText ? (
          <p>“{scriptText}。”</p>
        ) : (
          <p className="err-gap">暂无可直接引用的已核实结论。缺：已核实卖点；如何补齐：先在「产品研发」完成证据核验，话术由 kern 依据核实结果生成。</p>
        )}
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
              <span className={`dot ${source}`} /> {source === "kern" ? "Kern建议" : "自动"}: {reason} {confidence > 0 ? `(${Math.round(confidence * 100)}%)` : ""}
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
