"use client";

import * as React from "react";
import type { ExecutiveReportPayload } from "@/shared/executive-report-types";
import { useRole, type UserRole } from "./role-context";
import { inferRoleFromText } from "./kern-role-intelligence";
import { ReportV3 } from "./report-v3";

function RoleDetails({ role, report }: { role: UserRole; report: ExecutiveReportPayload }) {
  const [copied, setCopied] = React.useState("");
  if (role === "sales") {
    const facts = (report.conclusions ?? []).filter(c => c.claimKind?.toUpperCase() === "FACT");
    return <section className="block"><div className="sec-hd"><span className="sec-no">SALES</span><h2>销售沟通草稿</h2></div>
      <p className="sec-lede">依据报告登记的事实整理，发布前仍需复核证据与宣称边界。</p>
      {facts.length ? <div className="card"><p>{facts.map(c => c.claim).join("；")}</p>
        <button type="button" className="btn btn-solid host-actions" onClick={async () => { try { await navigator.clipboard.writeText(facts.map(c => c.claim).join("；")); setCopied("已复制"); } catch { setCopied("复制失败，请手动选择文字复制"); } }}>复制草稿</button><span role="status">{copied}</span>
      </div> : <div className="empty">暂无登记为事实的卖点，请先补齐依据与核验记录。</div>}
    </section>;
  }
  if (role !== "operator") return null;
  const op = report.operator;
  const rows = (title: string, entries: string[]) => <div className="card"><div className="card-hd"><span className="t">{title}</span></div>{entries.length ? entries.map((text, i) => <p key={i}>{text}</p>) : <p className="muted">尚未登记，请补充相关业务资料。</p>}</div>;
  return <section className="block"><div className="sec-hd"><span className="sec-no">OPS</span><h2>执行节奏与卡点</h2></div>
    <p className="sec-lede">当前节奏：{op?.currentWeek || "尚未登记"}</p>
    {rows("阶段与排期", (op?.phases ?? []).map(p => [p.name, p.window, p.state, p.owner, p.note].filter(Boolean).join(" · ")))}
    {rows("卡点与负责人", (op?.blockers ?? []).map(b => [b.title, b.severity, b.owner, b.eta, b.note].filter(Boolean).join(" · ")))}
    {rows("SLA 盯防", (op?.slas ?? []).map(s => `${s.name || "未命名指标"} · 目标 ${s.target ?? "未登记"} · 当前 ${s.current ?? "未登记"} · ${s.status ?? "UNKNOWN"}`))}
    {rows("渠道准入漏斗", (op?.funnel ?? []).map(f => `${f.stage || "未命名阶段"} · 数量 ${f.count ?? "未登记"} · 转化率 ${f.rate ?? "未登记"}`))}
    {rows("复盘判据", (op?.criteria ?? []).map(c => `${c.item || "未命名判据"} · ${c.result ?? "待复核"} · ${c.kind ?? "UNKNOWN"}`))}
  </section>;
}

export function ExecutiveReportRoleBased({ report, onOpenDecisions, onOpenEvidence, defaultRole, reviewStatus }: {
  report: ExecutiveReportPayload; onOpenDecisions?: () => void; onOpenEvidence?: () => void; defaultRole?: UserRole; reviewStatus?: string;
}) {
  const { role, setManualRole, setAutoInference } = useRole();
  const [localRole, setLocalRole] = React.useState<UserRole | null>(defaultRole || null);
  React.useEffect(() => { const inference = inferRoleFromText(JSON.stringify(report).slice(0, 2000)); if (inference) setAutoInference(inference); }, [report, setAutoInference]);
  const activeRole = localRole || defaultRole || role;
  const controls = <div className="filterbar" role="group" aria-label="报告阅读角色">{([
    ["leadership", "领导层"], ["product", "产品研发"], ["sales", "销售营销"], ["operator", "操盘手"],
  ] as const).map(([key, label]) => <button type="button" className={`chip${activeRole === key ? " on" : ""}`} key={key} aria-pressed={activeRole === key} onClick={() => { setLocalRole(key); setManualRole(key); }}>{label}</button>)}</div>;
  return <ReportV3 report={report} reviewStatus={reviewStatus} embedded controls={controls} onOpenDecisions={onOpenDecisions} onOpenEvidence={onOpenEvidence}>
    <RoleDetails role={activeRole} report={report} />
  </ReportV3>;
}

export default ExecutiveReportRoleBased;
