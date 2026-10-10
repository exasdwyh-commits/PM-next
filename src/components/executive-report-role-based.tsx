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

type Role = "leadership" | "product" | "sales" | "operator";

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


// ===== 操盘手（批次B 新增角色）=====
// 数据约定：全部来自 report.operator 投影（契约见 executive-report-types.ts）。
// 原则：缺什么显示什么缺口块，写明缺什么/如何补齐，绝不编造排期、数字或状态。

/** 甘特桶位：12 周分 6 桶，phase.window 用正则解析首个 W 编号映射桶位。 */
const OP_BUCKETS = ["W1-2", "W3-4", "W5-6", "W7-8", "W9-10", "W11-12"];
function opBucketIdx(window?: string | null): number {
  if (!window) return -1;
  const m = String(window).match(/W\s*(\d{1,2})/i);
  if (!m) return -1;
  const n = parseInt(m[1], 10);
  if (n <= 2) return 0;
  if (n <= 4) return 1;
  if (n <= 6) return 2;
  if (n <= 8) return 3;
  if (n <= 10) return 4;
  return 5;
}
function opStateCls(state?: string | null): "done" | "now" | "crit" | "plan" {
  const v = (state || "").toLowerCase();
  if (v === "done") return "done";
  if (v === "active") return "now";
  if (v === "critical") return "crit";
  return "plan";
}
function opSevCls(sev?: string | null): "p0" | "p1" | "p2" {
  const v = (sev || "").toLowerCase();
  if (v === "p0" || v === "high") return "p0";
  if (v === "p1" || v === "medium") return "p1";
  return "p2";
}
function opSlaCls(status?: string | null): "ok" | "tight" | "late" | "unknown" {
  const v = (status || "").toLowerCase();
  if (v === "ok") return "ok";
  if (v === "tight") return "tight";
  if (v === "late") return "late";
  return "unknown";
}

/** 缺口块：已知/缺/补齐三行，和 err-gap 同一诚实契约。 */
function OpGap({ known, miss, fill }: { known: string; miss: string; fill: string }) {
  return (
    <div className="op-gap">
      <strong>⚠️ 数据缺口</strong>
      <small>已知：{known}</small>
      <small>缺：{miss}</small>
      <small>→ 如何补齐：{fill}</small>
    </div>
  );
}

function OperatorView({ report }: any) {
  const op = report.operator ?? {};
  const phases: any[] = op.phases ?? [];
  const blockers: any[] = op.blockers ?? [];
  const slas: any[] = op.slas ?? [];
  const funnel: any[] = op.funnel ?? [];
  const criteria: any[] = op.criteria ?? [];
  const currentWeek: string | null = op.currentWeek ?? null;

  return (
    <div className="err-op">
      {/* 头部三张简报砖 */}
      <div className="op-brief">
        <div className="op-tile">
          <span>📅 当前节奏</span>
          {currentWeek ? <strong>{currentWeek}</strong> : <em>UNKNOWN</em>}
        </div>
        <div className="op-tile">
          <span>🚧 进行中阶段</span>
          <strong>{phases.filter((x: any) => opStateCls(x?.state) === "now").length}</strong>
        </div>
        <div className="op-tile">
          <span>⛔ 未解卡点</span>
          <strong>{blockers.length}</strong>
        </div>
      </div>

      {/* 1. 甘特 */}
      <section className="op-sec">
        <h3>🗓️ 排期甘特（按 phase.window 映射 6 桶位）</h3>
        {phases.length === 0 ? (
          <OpGap
            known="envelope 未附带 operator.phases 投影"
            miss="阶段名/时间窗（如 W1-2)/状态/负责人"
            fill='让 kern 在回复中产出 operator.phases: [{ name, window:"Wn-m", state, owner }]'
          />
        ) : (
          <div className="op-gantt">
            <table>
              <thead>
                <tr>
                  <th className="op-gantt-name">阶段</th>
                  {OP_BUCKETS.map((b) => (
                    <th key={b} className={currentWeek && b === currentWeek ? "wk is-now" : "wk"}>{b}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {phases.map((ph: any, i: number) => {
                  const idx = opBucketIdx(ph?.window);
                  const cls = opStateCls(ph?.state);
                  return (
                    <tr key={i}>
                      <td className="op-gantt-name">
                        <strong>{ph?.name || "未命名阶段"}</strong>
                        {ph?.owner ? <small> · {ph.owner}</small> : null}
                        {idx < 0 && <small className="op-gap-inline">时间窗缺失，未定位桶位</small>}
                      </td>
                      {OP_BUCKETS.map((_, bi) => (
                        <td key={bi} className="wk">{bi === idx ? <span className={`op-gbar ${cls}`} title={ph?.note || ph?.window || ""} /> : null}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <small className="op-legend">■ 已完成　■ 进行中　■ 计划　■ 风险　｜ 状态未知一律按计划态弱化展示</small>
          </div>
        )}
      </section>

      {/* 2. 卡点 */}
      <section className="op-sec">
        <h3>⛔ 卡点清单</h3>
        {blockers.length === 0 ? (
          <OpGap
            known="envelope 未附带 operator.blockers 投影"
            miss="卡点标题/严重度（P0-P2)/负责人/预计解除时间"
            fill='让 kern 产出 operator.blockers: [{ title, severity, owner, eta }]'
          />
        ) : (
          <div className="op-blockers">
            {blockers.map((b: any, i: number) => (
              <div key={i} className={`op-alert ${opSevCls(b?.severity)}`}>
                <span className="op-sev">{(b?.severity || "P2").toString().toUpperCase()}</span>
                <div>
                  <strong>{b?.title || "未命名卡点"}</strong>
                  <small>{[b?.owner && `负责人:${b.owner}`, b?.eta && `预计解除:${b.eta}`, b?.note].filter(Boolean).join("　") || "负责人/解除时间待补"}</small>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 3. SLA */}
      <section className="op-sec">
        <h3>⏱️ SLA 盯防</h3>
        {slas.length === 0 ? (
          <OpGap
            known="envelope 未附带 operator.slas 投影"
            miss="指标名/目标值/当前值/状态（ok|tight|late)"
            fill='让 kern 产出 operator.slas: [{ name, target, current, status }]'
          />
        ) : (
          <div className="op-sla">
            {slas.map((x: any, i: number) => (
              <div key={i} className="op-sla-row">
                <span className={`op-chip ${opSlaCls(x?.status)}`}>{opSlaCls(x?.status) === "unknown" ? "UNKNOWN" : (x?.status || "").toString().toUpperCase()}</span>
                <strong>{x?.name || "未命名指标"}</strong>
                <small>目标 {x?.target || "—"} ｜ 当前 {x?.current ?? "—"}</small>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 4. 渠道漏斗 */}
      <section className="op-sec">
        <h3>🔻 渠道准入漏斗</h3>
        {funnel.length === 0 ? (
          <OpGap
            known="envelope 未附带 operator.funnel 投影"
            miss="各阶段名称/数量/转化率"
            fill='让 kern 产出 operator.funnel: [{ stage, count, rate }]，数据不足允许 count:"—" 显式标缺'
          />
        ) : (
          <div className="err-table-wrap">
            <table className="err-table err-table-full op-funnel">
              <thead><tr><th>阶段</th><th>数量</th><th>转化率</th></tr></thead>
              <tbody>
                {funnel.map((f: any, i: number) => (
                  <tr key={i}>
                    <td>{f?.stage || "未命名阶段"}</td>
                    <td>{f?.count ?? "—"}</td>
                    <td>{f?.rate || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 5. 复盘判据 */}
      <section className="op-sec">
        <h3>🧭 复盘判据（放量/止损以事实为准）</h3>
        {criteria.length === 0 ? (
          <OpGap
            known="envelope 未附带 operator.criteria 投影"
            miss="判据条目/结果/事实等级"
            fill='让 kern 产出 operator.criteria: [{ item, result, kind:"fact|inference|estimate|unknown" }]'
          />
        ) : (
          <div className="op-crit">
            {criteria.map((c: any, i: number) => (
              <div key={i} className="op-crit-row">
                <ErrEv kind={c?.kind} />
                <strong>{c?.item || "未命名判据"}</strong>
                <small>{c?.result || "结果待补"}</small>
              </div>
            ))}
          </div>
        )}
      </section>
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
            <button className={activeRole === "operator" ? "is-active" : ""} onClick={() => { setLocalRole("operator"); setManualRole("operator"); }}>🧭 操盘手</button>
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
      {activeRole === "operator" && <OperatorView report={report} />}
    </div>
  );
}

export default ExecutiveReportRoleBased;
