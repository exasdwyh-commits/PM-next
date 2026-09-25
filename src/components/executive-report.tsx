"use client";

import * as React from "react";
import { Badge, Empty } from "@/components/ui";
import {
  EXECUTIVE_REPORT_PROVENANCE_PREVIEW_LIMIT,
  type ExecutiveReportPayload,
} from "@/shared/executive-report-types";

/**
 * Executive Report Renderer
 *
 * 负责人先看“能不能继续 / 还缺什么 / 要我决定什么”，
 * 再按需下钻结论、专业意见与溯源。UNKNOWN 与风险始终保持显式。
 */

function toneOfVerification(status?: string | null) {
  if (status === "READY_FOR_HUMAN_REVIEW") return "ok" as const;
  if (status === "BLOCKED_BY_QA") return "danger" as const;
  return "warn" as const;
}

function verificationLabel(status?: string | null) {
  switch (status) {
    case "READY_FOR_HUMAN_REVIEW":
      return "QA 已通过 · 待负责人审查";
    case "BLOCKED_BY_QA":
      return "独立 QA 阻断";
    case "PARTIAL":
      return "部分完成";
    default:
      return status || "状态未知";
  }
}

function evidenceLevelTone(level?: string | null) {
  switch ((level || "").toUpperCase()) {
    case "A":
    case "B":
      return "ok" as const;
    case "C":
      return "warn" as const;
    case "D":
      return "danger" as const;
    default:
      return "neutral" as const;
  }
}

function BulletList({
  items,
  emptyText,
  tone,
}: {
  items: string[];
  emptyText: string;
  tone?: "warn" | "danger";
}) {
  if (!items.length) {
    return <p className="hermes-row-meta">{emptyText}</p>;
  }

  return (
    <ul className={`hermes-report-list ${tone ? `is-${tone}` : ""}`}>
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

export function ExecutiveReportView({
  report,
  onOpenDecisions,
  onOpenEvidence,
}: {
  report: ExecutiveReportPayload | null;
  onOpenDecisions?: () => void;
  onOpenEvidence?: () => void;
}) {
  if (!report) {
    return (
      <div data-testid="executive-report-empty" className="hermes-report-empty">
        <Empty title="管理报告还没有生成">
          专业研究与独立 QA 完成后，系统会生成结构化管理报告。若关键输入不足或 QA
          阻断，会保持缺口状态，不会为了“完成流程”补造结论。
        </Empty>
      </div>
    );
  }

  const conclusions = report.conclusions ?? [];
  const unknowns = report.unknowns ?? [];
  const risks = report.risks ?? [];
  const decisions = report.decisionsRequired ?? [];
  const actions = report.recommendedActions ?? [];
  const assumptions = report.assumptions ?? [];
  const notes = report.advisoryNotes ?? [];
  const provenance = report.provenance;
  const tone = toneOfVerification(report.verificationStatus);

  const primaryMessage =
    report.verificationStatus === "BLOCKED_BY_QA"
      ? "这份报告暂不能用于推进正式决策。先处理独立 QA 指出的阻断项。"
      : unknowns.length > 0
        ? `当前还有 ${unknowns.length} 个未闭合项。建议先补证据或人工确认，再做不可逆决策。`
        : decisions.length > 0
          ? `证据与 QA 已形成管理结论，现在有 ${decisions.length} 个事项需要负责人判断。`
          : "当前没有显式未闭合项或待决策项，可以结合正式门禁要求继续推进。";

  return (
    <section data-testid="executive-report" className="hermes-executive-report">
      <header className="hermes-report-hero">
        <div className="hermes-report-hero-copy">
          <span className="eyebrow">EXECUTIVE REPORT</span>
          <h2>{report.title || "产品研发管理报告"}</h2>
          <p>{report.summary || "报告未提供摘要。"}</p>
        </div>
        <div className="hermes-report-hero-meta">
          <Badge tone={tone}>{verificationLabel(report.verificationStatus)}</Badge>
          {report.contentVersion !== undefined ? (
            <span className="hermes-chip">v{report.contentVersion}</span>
          ) : null}
          {report.createdAt ? (
            <span>{new Date(report.createdAt).toLocaleString()}</span>
          ) : null}
        </div>
      </header>

      <div
        className={`hermes-report-next-action is-${
          report.verificationStatus === "BLOCKED_BY_QA"
            ? "danger"
            : unknowns.length > 0
              ? "warn"
              : "ok"
        }`}
      >
        <div>
          <span>负责人现在最需要知道</span>
          <strong>{primaryMessage}</strong>
        </div>
        <div className="hermes-inline">
          {unknowns.length > 0 && onOpenEvidence ? (
            <button type="button" className="hermes-outline-btn hermes-btn-sm" onClick={onOpenEvidence}>
              去补证据
            </button>
          ) : null}
          {decisions.length > 0 && onOpenDecisions ? (
            <button type="button" className="hermes-primary-btn hermes-btn-sm" onClick={onOpenDecisions}>
              去做决策
            </button>
          ) : null}
        </div>
      </div>

      <div className="hermes-report-metrics" aria-label="管理报告关键事项">
        <button type="button" onClick={onOpenEvidence} disabled={!onOpenEvidence}>
          <span>未闭合项</span>
          <strong>{unknowns.length}</strong>
          <small>UNKNOWN / 缺口</small>
        </button>
        <div>
          <span>显式风险</span>
          <strong>{risks.length}</strong>
          <small>需要控制或验证</small>
        </div>
        <button type="button" onClick={onOpenDecisions} disabled={!onOpenDecisions}>
          <span>需负责人决策</span>
          <strong>{decisions.length}</strong>
          <small>不会由 AI 自动批准</small>
        </button>
        <div>
          <span>有效结论</span>
          <strong>{conclusions.length}</strong>
          <small>绑定证据与核验</small>
        </div>
      </div>

      <div className="hermes-report-priority-grid">
        <section className="hermes-report-block is-decision">
          <div className="hermes-report-block-head">
            <div>
              <span className="eyebrow">HUMAN DECISION</span>
              <h3>需要你决定</h3>
            </div>
            <Badge tone={decisions.length > 0 ? "warn" : "neutral"}>
              {decisions.length}
            </Badge>
          </div>
          <BulletList items={decisions} emptyText="当前没有待负责人决策项。" />
        </section>

        <section className="hermes-report-block is-gap">
          <div className="hermes-report-block-head">
            <div>
              <span className="eyebrow">UNKNOWN</span>
              <h3>还不能下结论</h3>
            </div>
            <Badge tone={unknowns.length > 0 ? "warn" : "neutral"}>
              {unknowns.length}
            </Badge>
          </div>
          <BulletList
            items={unknowns}
            tone="warn"
            emptyText="当前报告没有显式未闭合项。"
          />
        </section>
      </div>

      {risks.length > 0 ? (
        <section className="hermes-report-block is-risk">
          <div className="hermes-report-block-head">
            <div>
              <span className="eyebrow">RISK</span>
              <h3>关键风险</h3>
            </div>
            <Badge tone="danger">{risks.length}</Badge>
          </div>
          <BulletList items={risks} tone="danger" emptyText="未识别到显式风险。" />
        </section>
      ) : null}

      <section className="hermes-report-block">
        <div className="hermes-report-block-head">
          <div>
            <span className="eyebrow">RECOMMENDATION</span>
            <h3>建议动作</h3>
          </div>
          <Badge tone="neutral">{actions.length}</Badge>
        </div>
        <BulletList items={actions} emptyText="报告未给出额外建议动作。" />
      </section>

      <section className="hermes-report-block">
        <div className="hermes-report-block-head">
          <div>
            <span className="eyebrow">EVIDENCE-BACKED CLAIMS</span>
            <h3>结论与证据</h3>
          </div>
          <Badge tone="neutral">{conclusions.length}</Badge>
        </div>
        {conclusions.length === 0 ? (
          <p className="hermes-row-meta">尚无 claim 满足进入管理结论的条件。</p>
        ) : (
          <div className="hermes-report-claims">
            {conclusions.map((conclusion, index) => (
              <article key={index}>
                <div>
                  <strong>{conclusion.claim}</strong>
                  <Badge tone={evidenceLevelTone(conclusion.evidenceLevel)}>
                    证据 {conclusion.evidenceLevel || "UNKNOWN"}
                  </Badge>
                </div>
                <p>
                  {[
                    conclusion.claimKind,
                    conclusion.freshness,
                    conclusion.evidenceRef,
                    conclusion.verificationRefs?.length
                      ? `${conclusion.verificationRefs.length} 条核验`
                      : "未核验",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      {assumptions.length > 0 ? (
        <details className="hermes-details">
          <summary>查看报告假设（{assumptions.length}）</summary>
          <div style={{ marginTop: 10 }}>
            <BulletList items={assumptions} emptyText="无假设项。" />
          </div>
        </details>
      ) : null}

      <details className="hermes-details">
        <summary>查看专业数字员工意见（{notes.length}）</summary>
        <div style={{ marginTop: 10 }}>
          {notes.length === 0 ? (
            <p className="hermes-row-meta">无专业数字员工意见记录。</p>
          ) : (
            <div className="hermes-report-agent-notes">
              {notes.map((note) => (
                <article key={note.agentCode}>
                  <div>
                    <strong>{note.agentName || note.agentCode}</strong>
                    <Badge status={note.status}>{note.status || "UNKNOWN"}</Badge>
                  </div>
                  <p>{note.summary || note.errorReason || "（无摘要）"}</p>
                </article>
              ))}
            </div>
          )}
        </div>
      </details>

      <details className="hermes-details">
        <summary>查看报告溯源</summary>
        <div style={{ marginTop: 10 }}>
          {provenance ? (
            <>
              <div className="hermes-inline" style={{ flexWrap: "wrap", gap: 6 }}>
                <span className="hermes-chip">证据来源 {provenance.sourceRefs.length}</span>
                <span className="hermes-chip">执行记录 {provenance.agentRunRefs.length}</span>
                <span className="hermes-chip">模型调用 {provenance.modelRunRefs.length}</span>
                <span className="hermes-chip">知识债 {provenance.knowledgeDebtRefs.length}</span>
                {provenance.researchSnapshotRef ? (
                  <span className="hermes-chip">{provenance.researchSnapshotRef}</span>
                ) : null}
              </div>
              {provenance.sourceRefs.length > 0 ? (
                <p className="hermes-row-meta" style={{ marginTop: 8 }}>
                  证据：
                  {provenance.sourceRefs
                    .slice(0, EXECUTIVE_REPORT_PROVENANCE_PREVIEW_LIMIT)
                    .join("、")}
                  {provenance.sourceRefs.length > EXECUTIVE_REPORT_PROVENANCE_PREVIEW_LIMIT
                    ? ` …等 ${provenance.sourceRefs.length} 条`
                    : ""}
                </p>
              ) : null}
            </>
          ) : (
            <p className="hermes-row-meta">报告未携带溯源信息。</p>
          )}
        </div>
      </details>
    </section>
  );
}
