"use client";
/**
 * Executive Report 卡片：对话里呈现报告缩略图、标题和摘要。
 *
 * 缩略图用同源 iframe 直接渲染 /reports/[id]（真实版式，会随报告更新），
 * 外层按纵向纸页比例裁切并缩放；iframe 不可用时下面的封面仍在。
 * 卡片正文只读不写：数字全部来自引用本身，不额外请求、不估算。
 */
import { useEffect, useRef, useState } from "react";
import {
  executiveReportPath,
  missionPosterPath,
  readExecutiveReportStats,
  type ExecutiveReportCitation,
} from "@/shared/executive-report-citation";

function reviewStatusLabel(status?: string): string {
  switch ((status ?? "").toUpperCase()) {
    case "PENDING":
      return "待评审";
    case "ACCEPTED":
      return "已采纳";
    case "REJECTED":
      return "已驳回";
    default:
      return status ?? "";
  }
}

export function ReportCard({ citation }: { citation: ExecutiveReportCitation }) {
  const thumbRef = useRef<HTMLAnchorElement>(null);
  const [visible, setVisible] = useState(false);

  // 长会话里可能堆积很多卡片：进入视口前不挂 iframe，避免一次渲染几十份报告页。
  useEffect(() => {
    const el = thumbRef.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "240px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  const isMission = citation.kind === "mission-report";
  const href = isMission ? missionPosterPath(citation.ref) : executiveReportPath(citation.ref);
  const stats = readExecutiveReportStats(citation);
  const summary = citation.summary
    ?.replace(/READY_FOR_HUMAN_REVIEW/g, "等待负责人复核")
    .replace(/BLOCKED_BY_QA/g, "独立 QA 未通过");

  return (
    <div className="kxr-report" role="group" aria-label={`Executive Report：${citation.title}`}>
      {/* 缩略图本身不参与 Tab 序列（真正的入口是右侧「打开报告」，避免重复焦点）。 */}
      <a
        className="kxr-report-thumb"
        ref={thumbRef}
        href={href}
        target="_blank"
        rel="noreferrer"
        tabIndex={-1}
        aria-hidden
      >
        <span className="kxr-report-cover" aria-hidden>
          <span className="kxr-report-cover-mark">Kern · V3</span>
          <span className="kxr-report-cover-title">{citation.title}</span>
        </span>
        {visible ? (
          <iframe className="kxr-report-frame" src={href} title="报告海报缩略图" aria-hidden="true" tabIndex={-1} loading="lazy" />
        ) : null}
        <span className="kxr-report-veil" aria-hidden />
      </a>

      <div className="kxr-report-body">
        <div className="kxr-report-meta">
          <span className="kxr-report-kind">研究报告 · V3 海报</span>
          {citation.contentVersion ? <span className="kxr-report-ver">v{citation.contentVersion}</span> : null}
          {citation.reviewStatus ? (
            <span className="kxr-report-status">· {reviewStatusLabel(citation.reviewStatus)}</span>
          ) : null}
          {citation.qualityStatus && citation.qualityStatus !== "DELIVERABLE" ? (
            <span className="kxr-report-quality" data-status={citation.qualityStatus}>
              {citation.qualityStatus === "BLOCKED" ? "未通过质量检查" : "待补证草稿"}
            </span>
          ) : null}
        </div>
        <h3 className="kxr-report-title">{citation.title}</h3>
        {summary ? <p className="kxr-report-summary">{summary}</p> : null}
        <div className="kxr-report-stats">
          <span>
            <strong>{stats.conclusions}</strong> 条依据
          </span>
          <span>
            <strong>{stats.verified}</strong> 条含核验记录
          </span>
          <span>
            <strong>{stats.risks}</strong> 项风险
          </span>
          <span>
            <strong>{stats.unknowns}</strong> 项待验证
          </span>
          <span>
            <strong>{stats.decisions}</strong> 项待决策
          </span>
        </div>
        <div className="kxr-report-actions">
          <a className="kxr-btn" data-v="primary" href={href} target="_blank" rel="noreferrer">
            查看完整海报 →
          </a>
          <a className="kxr-report-data-link" href={isMission ? `/api/missions/${encodeURIComponent(citation.ref)}/export?format=md` : `/api/reports/${encodeURIComponent(citation.ref)}`} target="_blank" rel="noreferrer">
            {isMission ? "下载研究原文" : "原始数据"}
          </a>
        </div>
      </div>
    </div>
  );
}
