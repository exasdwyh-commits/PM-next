"use client";

import { useEffect, useRef, useState } from "react";
import { executiveReportPath, type ExecutiveReportCitation } from "@/shared/executive-report-citation";
import "./report-card.css";

export function ReportCard({ citation }: { citation: ExecutiveReportCitation }) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: "240px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const href = executiveReportPath(citation.ref);
  return <div className="rc3" ref={root}>
    <div className="rc3-paper" aria-hidden="true"><span>产品研发报告</span><strong>{citation.title}</strong><i />{visible && <iframe src={href} title="报告缩略图" tabIndex={-1} loading="lazy" />}</div>
    <div className="rc3-body"><span className="rc3-kind">产品研发报告{citation.contentVersion ? ` · v${citation.contentVersion}` : ""}</span><h3>{citation.title}</h3><p>查看结论、待决策事项、资料缺口与完整来源。</p><a href={href} target="_blank" rel="noreferrer">打开报告 <span aria-hidden="true">↗</span></a></div>
  </div>;
}
