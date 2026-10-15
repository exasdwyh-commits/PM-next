"use client";

import React, { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { ExecutiveReportPayload } from "@/shared/executive-report-types";
import { fmtDateTime } from "@/shared/datetime";
import "./report-v3.css";
import { Prose } from "@/app/muse/components/prose";

export function reportStatusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    READY_FOR_HUMAN_REVIEW: "等待负责人复核", BLOCKED_BY_QA: "独立 QA 未通过", PARTIAL: "资料仍需补齐",
    PENDING: "待评审", ACCEPTED: "已采纳", REJECTED: "已驳回", SUCCEEDED: "已完成", COMPLETED: "已完成", SUBMITTED: "已提交",
    BLOCKED: "已阻塞", FAILED: "未完成", WAITING_HUMAN: "等待补充", SUPPORTED: "有证据支持",
    CONTRADICTED: "证据不支持", AMBIGUOUS: "证据有歧义", NOT_FOUND: "未找到依据", NO_VERIFICATION: "尚未核验",
    BLOCKED_BY_QUALITY: "未通过质量检查", DRAFT_UNVERIFIED: "待补证草稿",
  };
  return status ? labels[status.toUpperCase()] ?? status : "未登记";
}

function readable(text?: string | null) {
  return (text ?? "").replace(/READY_FOR_HUMAN_REVIEW|BLOCKED_BY_QA/g, reportStatusLabel).replace(/\bUNKNOWN\b/gi, "待验证");
}

function ClaimBadge({ kind }: { kind?: string | null }) {
  const key = kind?.toUpperCase();
  const fact = key === "FACT";
  const inference = key === "INFERENCE" || key === "ESTIMATE";
  return <span className={`badge ${fact ? "fact" : "unknown"}`}>{fact ? "事实" : inference ? "推断 / 估算" : "待验证"}</span>;
}

const SECTION_NAMES = [
  ["definition", "① 产品定义与规格"], ["bom", "② 配方与 BOM 成本"], ["process", "③ 工艺与中试"],
  ["quality", "④ 质量与稳定性"], ["economics", "⑤ 经济性与定价"], ["compliance", "⑥ 合规与宣称边界"],
  ["fmea", "⑦ FMEA 风险"], ["validation", "⑧ 验证计划与待拍板"], ["appendix", "⑨ 附录 · 出处 / 假设 / 未决"],
] as const;

function Table({ headings, rows }: { headings: string[]; rows: ReactNode[][] }) {
  return <div className="tscroll table-wrap" role="region" aria-label={headings.join("、")} tabIndex={0}>
    <table className="verify"><thead><tr>{headings.map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
      <tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell ?? "—"}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}

export function ReportV3({ report, reviewStatus, embedded = false, controls, children, onOpenDecisions, onOpenEvidence }: {
  report: ExecutiveReportPayload; reviewStatus?: string; embedded?: boolean; controls?: ReactNode; children?: ReactNode;
  onOpenDecisions?: () => void; onOpenEvidence?: () => void;
}) {
  const scope = useId().replace(/:/g, "");
  const root = useRef<HTMLElement>(null);
  const [filter, setFilter] = useState<"all" | "input" | "agent">("all");
  const id = (name: string) => `${scope}-${name}`;
  const conclusions = report.conclusions ?? [];
  const risks = report.risks ?? [];
  const decisions = report.decisionsRequired ?? [];
  const unknowns = report.unknowns ?? [];
  const actions = report.recommendedActions ?? [];
  const notes = report.advisoryNotes ?? [];
  const assumptions = report.assumptions ?? [];
  const provenance = report.provenance;
  const deep = report.deepReport;
  const gaps = unknowns.map((text, index) => ({ text, index, kind: /未成功完成|Agent.*(?:阻塞|失败)|执行器|(?:BLOCKED|FAILED|WAITING_HUMAN)/i.test(text) ? "agent" : "input" }));
  const manual = (note: (typeof notes)[number]) => /代签/.test(`${note.agentName ?? ""} ${note.summary ?? ""}`);
  const completed = notes.filter(n => !manual(n) && /^(SUCCEEDED|COMPLETED)$/.test(n.status ?? "")).length;
  const blocked = notes.filter(n => !manual(n) && /^(BLOCKED|FAILED|WAITING_HUMAN)$/.test(n.status ?? "")).length;
  const delegated = notes.filter(manual).length;
  const other = notes.length - completed - blocked - delegated;
  const title = report.title || "产品研发报告";
  const parts = title.split(/\s*[·•]\s*/);
  const projectTitle = parts.length > 1 ? parts.slice(0, -1).join(" · ") : title;
  const realRun = /\s*\(REAL\)\s*$/i.test(projectTitle);
  const mainTitle = projectTitle.replace(/\s*\(REAL\)\s*$/i, "");
  const detailTitle = parts.length > 1 ? parts.at(-1) : "产品研发综合报告";

  // Printing always includes collapsed evidence. Restore exactly the user's disclosure state afterwards.
  useEffect(() => {
    let closed: HTMLDetailsElement[] = [];
    const before = () => {
      closed = Array.from(root.current?.querySelectorAll<HTMLDetailsElement>("details:not([open])") ?? []);
      closed.forEach(d => { d.open = true; });
    };
    const after = () => { closed.forEach(d => { d.open = false; }); closed = []; };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => { window.removeEventListener("beforeprint", before); window.removeEventListener("afterprint", after); after(); };
  }, []);

  const heading = (code: string, title: string, lede?: string) => <>
    <div className="sec-hd"><span className="sec-no">{code}</span><h2>{title}</h2></div>
    {lede && <p className="sec-lede">{lede}</p>}
  </>;
  const refs = (label: string, items?: string[]) => items?.length ? <div><b>{label}</b><div className="refs">{items.map((ref, i) => <code key={i}>{ref}</code>)}</div></div> : null;

  return <article ref={root} className="rv3" data-density={report.presentation?.density === "compact" ? "compact" : "comfortable"} data-embedded={embedded} data-testid="executive-report" data-report-version="muse-v3">
    <header className="topbar"><div className="wrap">
      <a className="brand" href="/muse">Kern<span>报告</span></a><span className="sp" />
      <a className="btn btn-ghost" href={`#${id("src")}`}>查看来源</a>
      <button className="btn btn-solid" type="button" onClick={() => window.print()}>打印 / 存为 PDF</button>
    </div></header>
    <div className="wrap"><div className="hero">
      <div className="kicker">产品研发报告{realRun ? " · REAL" : ""}{report.contentVersion ? ` · v${report.contentVersion}` : ""}<span className="pill review">{reportStatusLabel(reviewStatus ?? report.verificationStatus)}</span></div>
      <h1>{mainTitle}</h1><p className="sub">{detailTitle}</p>
      <div className="dek"><strong>{conclusions.length ? `已汇总 ${conclusions.length} 条依据。` : "尚无可对外引用的结论。"}</strong>
        {unknowns.length} 个未闭合项{report.verificationStatus ? `，${reportStatusLabel(report.verificationStatus)}。` : "。"}
        <span className="go" style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: report.presentation?.summaryLines === 3 ? 3 : report.presentation?.summaryLines === 5 ? 5 : 4, overflow: "hidden", maxWidth: report.presentation?.density === "compact" ? "60ch" : "75ch", marginBlock: report.presentation?.density === "compact" ? "0.25rem" : "0.75rem", lineHeight: report.presentation?.summaryLines === 3 ? 1.5 : report.presentation?.summaryLines === 5 ? 1.8 : 1.65 }}>{readable(report.summary) || "查看下方证据与缺口，再决定下一步。"}</span>
      </div>
      <p className="meta">{report.createdAt && <span>生成于 <b>{fmtDateTime(report.createdAt)}</b></span>}
        <span>已汇总 <b>{notes.length}</b> 条执行说明 · <b>{provenance?.sourceRefs.length ?? 0}</b> 条来源引用 · <b>{conclusions.length}</b> 条依据</span>
      </p>
      {controls && <div className="rolebar">{controls}</div>}
    </div></div>
    {report.quality && report.quality.status !== "DELIVERABLE" && <div className="wrap"><section className="qgate" data-status={report.quality.status} role="status">
      <div className="qgate-hd"><span className="qgate-badge">{report.quality.status === "BLOCKED" ? "未通过质量检查" : "待补证草稿"}</span>
        <strong>{report.quality.status === "BLOCKED" ? "这份报告不能作为正式研究交付" : "这份报告还需要补证才能定稿"}</strong></div>
      <ul className="qgate-list">{report.quality.issues.map((issue, i) => <li key={i}><b>{issue.where}</b>：{issue.detail}<span className="qgate-fix">补齐方式：{issue.fix}</span></li>)}</ul>
    </section></div>}
    <nav className="secnav" aria-label="章节导航"><div className="wrap">{[
      ["a", "结论与依据"], ["bc", "风险与待决策"], ["d", `缺口 ${unknowns.length}`], ["next", "下一步"],
      ["spec", "专业明细"], ["g", "核验台账"], ["src", "来源与未核实"],
    ].map(([key, label]) => <a key={key} href={`#${id(key)}`}>{label}</a>)}</div></nav>
    <div className="wrap">
      <section className="block" id={id("a")}>{heading("A", "结论与依据", "先看结论，再查看事实属性、证据等级与核验记录。")}
        {conclusions.length ? conclusions.map((c, i) => <div className="card" key={i}>
          <div className="card-hd"><span className="id">A{i + 1}</span><ClaimBadge kind={c.claimKind} /></div>
          <p className="t">{c.claim}</p><p className="muted">{c.evidenceRef || "来源未登记"}{c.evidenceLevel ? ` · ${c.evidenceLevel} 级` : ""}{c.freshness ? ` · ${c.freshness}` : ""}</p>
          {!!c.verificationRefs?.length && <p className="muted">含 {c.verificationRefs.length} 条核验记录（结果需逐项查看）</p>}
          {refs("核验引用", c.verificationRefs)}
        </div>) : <div className="card unknown"><div className="card-hd"><span className="badge unknown">待验证</span><span className="t">尚无结论</span></div><p>请先补齐研究资料与核验记录，再形成可引用的结论。</p></div>}
      </section>
      <section className="block" id={id("bc")}>{heading("B · C", "风险与待决策", "B 回答「要承担什么」，C 回答「要拍什么板」。")}
        <div className="dual"><div>{risks.length ? risks.map((r, i) => <div className="card risk-card" key={i}><div className="card-hd"><span className="id">B{i + 1}</span><span className="badge risk">风险</span></div><p className="t">{r}</p></div>) : <div className="empty">报告未登记显式风险。</div>}</div>
          <div>{decisions.length ? decisions.map((d, i) => <div className="card decide-card" key={i}><div className="card-hd"><span className="id">C{i + 1}</span><span className="badge decide">待决策</span></div><p className="t">{d}</p></div>) : <div className="empty">报告未登记待决策事项。</div>}</div></div>
        {onOpenDecisions && <button className="btn btn-solid host-actions" onClick={onOpenDecisions}>进入决策</button>}
      </section>
      <section className="block" id={id("d")}>{heading("D", "待补资料与未核实项", "以下内容仍缺输入或证据，补齐后可继续核验。")}
        <div className="filterbar" role="group" aria-label="按缺口类型筛选">{(["all", "input", "agent"] as const).map(key => <button type="button" className={`chip${filter === key ? " on" : ""}`} aria-pressed={filter === key} key={key} onClick={() => setFilter(key)}>{key === "all" ? "全部" : key === "input" ? "输入缺口" : "Agent 阻塞"}<span className="n">{key === "all" ? gaps.length : gaps.filter(g => g.kind === key).length}</span></button>)}</div>
        <div className="gap-grid">{gaps.map(g => {
          const split = readable(g.text).match(/^(.{1,80}?)[：:]\s*([\s\S]+)$/);
          return <div className="card unknown gap-card" key={g.index} hidden={filter !== "all" && filter !== g.kind}>
            <div className="card-hd"><span className="id">D{g.index + 1}</span><span className="badge unknown">待验证</span></div><div className="grow"><p className="gap-kind">{g.kind === "agent" ? "Agent 阻塞" : "输入缺口"}</p>{split && <p className="t">{split[1]}</p>}<p className="gap-text">{split?.[2] ?? readable(g.text)}</p></div>
          </div>;
        })}</div>{!gaps.length && <div className="empty">报告未登记未核实项。</div>}
        {onOpenEvidence && <button className="btn btn-solid host-actions" onClick={onOpenEvidence}>补充证据</button>}
      </section>
      <section className="block" id={id("next")}><div className="nextcard">{heading("NEXT", "下一步行动")}
        {actions.length ? actions.map((a, i) => <div className="act" key={i}><span className="k">ACTION {i + 1}</span><p>{a}</p></div>) : <p>报告未登记建议动作。</p>}
      </div></section>
      {report.researchBody !== undefined ? <section className="block" id={id("spec")}>{heading("RESEARCH", "完整研究分析", "保留原始汇总的全部章节、标注与来源；执行完成不代表所有判断已核实。") }
        <div className="research-prose"><Prose text={report.researchBody} /></div>
        {report.originalResearchBody && <details className="exec"><summary>查看编辑前原始综合稿（留档，非审校定稿）</summary><div className="research-prose"><Prose text={report.originalResearchBody} /></div></details>}
      </section> : <section className="block" id={id("spec")}>{heading("SPEC", "专业明细", "规格、成本与验证各项的资料状态。")}
        {SECTION_NAMES.map(([key, fallback]) => { const s = deep?.sections.find(s => s.key === key); return <div className="spec-row" key={key}><span className="n">{fallback.slice(0, 1)}</span><div className="body"><div className="t">{(s?.title ?? fallback).replace(/^[①-⑨]\s*/, "")}</div><p>{s?.gap ?? (s?.ready ? "已有内容，来源与核验情况请查看对应明细。" : "资料尚未登记，请补充该项输入与来源后更新报告。")}</p></div><span className={`st ${s?.ready ? "done" : "todo"}`}>{s?.ready ? "有内容" : "待补资料"}</span></div>; })}
        {deep?.spec && <details className="exec"><summary>产品定义与规格 · {deep.spec.title ?? "明细"}</summary><div className="rows">
          {deep.spec.dosageForm && <p>剂型：{deep.spec.dosageForm}</p>}
          <Table headings={["项目", "取值", "三态", "来源"]} rows={deep.spec.rows.map(r => [r.name, <span key="value">{r.value} {r.unit}{r.note && <p>{r.note}</p>}</span>, <ClaimBadge key="kind" kind={r.claimKind} />, r.evidenceRef])} />
        </div></details>}
        {deep?.bom && <details className="exec"><summary>配方与 BOM 成本 · {deep.bom.basis ?? "明细"}</summary><div className="rows"><p className="muted">货币：{deep.bom.currency ?? "未登记"} · 无来源的数字不得用作报价依据。</p><Table headings={["物料", "数量", "单价", "合计", "来源"]} rows={deep.bom.lines.map(l => [<span key="item">{l.item}{l.note && <p>{l.note}</p>}</span>, `${l.qty ?? "—"} ${l.uom ?? ""}`, l.unitCost, l.total, l.sourceRef || "无来源（不得报价）"])} /></div></details>}
      </section>}
      <section className="block" id={id("g")}>{heading("G", `断言核验台账 · ${reportStatusLabel(deep?.validation?.qaStatus ?? report.verificationStatus)}`, "每条断言当前是否被证据支持；未核实的条目不会被写成已证实。")}
        {deep?.validation?.items.length ? <Table headings={["断言", "核验结果", "核验时间", "三态", "证据等级"]} rows={deep.validation.items.map(v => [v.claim, reportStatusLabel(v.latestStatus), v.checkedAt ? fmtDateTime(v.checkedAt) : "未登记", <ClaimBadge key="kind" kind={v.claimKind} />, v.evidenceLevel])} /> : <div className="empty"><div className="big">验证台账里还没有条目</div><p><a href={`#${id("d")}`}>查看核验缺口（{gaps.length} 项）→</a></p></div>}
        {!!deep?.validation?.gaps?.length && <details className="exec"><summary>核验缺口 · {deep.validation.gaps.length} 项</summary><div className="rows">{deep.validation.gaps.map((g, i) => <p key={i}>{g}</p>)}</div></details>}
        <div className="card unknown"><div className="card-hd"><span className="badge unknown">待验证</span><span className="t">假设 · 还没被证实的部分</span></div>{assumptions.length ? assumptions.map((a, i) => <p key={i}>{a}</p>) : <p>报告没有登记假设。</p>}</div>
        {!!notes.length && <details className="exec"><summary><span>专业执行说明 · {notes.length} 条</span><span className="tag ok">{completed} 完成</span><span className="tag no">{blocked} 阻塞 / 未完成</span>{delegated > 0 && <span className="tag mid">{delegated} 代签</span>}{other > 0 && <span className="tag mid">{other} 其他状态</span>}<span className="arrow">›</span></summary><div className="rows">{notes.map((n, i) => <div className="erow" key={i}><span className={`tag ${manual(n) ? "mid" : /^(SUCCEEDED|COMPLETED)$/.test(n.status ?? "") ? "ok" : /^(BLOCKED|FAILED|WAITING_HUMAN)$/.test(n.status ?? "") ? "no" : "mid"}`}>{manual(n) ? "代签" : reportStatusLabel(n.status)}</span><div><span className="t">{n.agentName || n.agentCode}</span>{n.summary && <p>{readable(n.summary)}</p>}{n.errorReason && <p>{n.errorReason}</p>}</div></div>)}</div></details>}
      </section>
      {children}
      <div className="honest"><h3>别把留白读成「没问题」</h3><p>这份报告里 <b>{gaps.length} 个未闭合项</b>、<b>{assumptions.length} 条假设</b>、<b>{risks.length} 项风险</b>仍需逐项复核。对外引用前请确认相关依据与核验结果。</p></div>
      <section className="block" id={id("src")}>{heading("SRC", "数据来源与未核实项", "保留每条来源引用与核验口径。")}
        <div className="src"><p><b>口径声明</b> · 本页数据来自{report.researchBody !== undefined ? "当前个人研究任务的持久化输出" : "产品研发报告成果"}{report.contentVersion ? `（v${report.contentVersion}）` : ""}。核验状态：{reportStatusLabel(report.verificationStatus)}。</p>
          {!!report.researchSources?.length && <ol className="research-source-list">{report.researchSources.map((source, index) => <li key={source.id}>
            <span>[{index + 1}] </span>{/^https?:\/\//i.test(source.url) ? <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a> : <span>{source.title}</span>}
            <p className="muted">抓取于 {fmtDateTime(source.fetchedAt)} · 捕获来源不等于结论已核实</p>
          </li>)}</ol>}
          {refs("证据来源", provenance?.sourceRefs)}{refs("执行记录", provenance?.agentRunRefs)}{refs("模型调用", provenance?.modelRunRefs)}{refs("知识债", provenance?.knowledgeDebtRefs)}{provenance?.researchSnapshotRef && refs("研究快照", [provenance.researchSnapshotRef])}
          {!provenance?.sourceRefs.length && <p>报告未登记来源引用。</p>}
        </div>
        {!!gaps.length && <Table headings={["未核实项", "类型", "待补内容"]} rows={gaps.map(g => [`D${g.index + 1}`, g.kind === "agent" ? "Agent 阻塞" : "输入缺口", g.text])} />}
      </section>
      <footer>Kern · 产品研发报告 · Muse v3</footer>
    </div>
  </article>;
}
