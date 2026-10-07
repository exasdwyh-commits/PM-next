"use client";

import * as React from "react";
import { Empty } from "@/components/ui";
import {
  EXECUTIVE_REPORT_PROVENANCE_PREVIEW_LIMIT,
  type ExecutiveReportPayload,
} from "@/shared/executive-report-types";
import { labelAgentTaskStatus, labelEvidenceClaimKind, labelEvidenceLevel } from "@/shared/status-labels";
import { Count, Tag, type Tone } from "@/components/kx";
import "./executive-report.css";

/**
 * Executive Report Renderer（KX-22 方案 C：决策面板 + 依据表）
 *
 * 主区：结论 → 关键依据表 → 最大风险 / UNKNOWN 并排 → 附录折叠；
 * 右侧常驻「需要你决定」面板（含下一步与去做决策 / 去补证据），手机上落到正文下方。
 * UNKNOWN 与风险始终显式；决策不会由 AI 自动批准。
 */

function toneOfVerification(status?: string | null): Tone {
  if (status === "READY_FOR_HUMAN_REVIEW") return "ok";
  if (status === "BLOCKED_BY_QA") return "bad";
  return "warn";
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

function evidenceLevelTone(level?: string | null): Tone {
  switch ((level || "").toUpperCase()) {
    case "A":
    case "B":
      return "ok";
    case "C":
      return "warn";
    case "D":
      return "bad";
    default:
      return "";
  }
}

function agentStatusTone(status?: string | null): Tone {
  switch (status) {
    case "COMPLETED":
      return "ok";
    case "FAILED":
    case "BLOCKED":
      return "bad";
    case "PARTIAL":
    case "WAITING_HUMAN":
      return "warn";
    default:
      return "";
  }
}

function DotList({ items, tone, emptyText }: { items: string[]; tone: Tone; emptyText: string }) {
  if (!items.length) {
    return (
      <ul className="kx-rp-list">
        <li>
          <i className="kx-dot is-ok" aria-hidden />
          <span className="kx-rp-muted">{emptyText}</span>
        </li>
      </ul>
    );
  }
  return (
    <ul className="kx-rp-list">
      {items.map((item, index) => (
        <li key={index}>
          <i className={`kx-dot${tone ? ` is-${tone}` : ""}`} aria-hidden />
          <span>{item}</span>
        </li>
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

  return (
    <section data-testid="executive-report" className="kx-rp">
      <header className="kx-rp-title">
        <h2>{report.title || "产品研发管理报告"}</h2>
        <Tag tone={tone}>{verificationLabel(report.verificationStatus)}</Tag>
        <span className="kx-rp-meta">
          {[
            report.contentVersion !== undefined ? `v${report.contentVersion}` : null,
            report.createdAt ? new Date(report.createdAt).toLocaleString() : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </header>

      <div className="kx-rp-layout">
        <div className="kx-rp-main">
          <section className={`kx-rp-verdict is-${tone}`} aria-label="当前结论">
            <p>
              <b>当前结论：</b>
              {report.summary || "报告未提供摘要。"}
            </p>
            {report.verificationStatus === "BLOCKED_BY_QA" ? (
              <p className="kx-rp-note">这份报告暂不能用于推进正式决策。先处理独立 QA 指出的阻断项。</p>
            ) : null}
          </section>

          <section className="kx-rp-card" aria-labelledby="kx-rp-evidence">
            <div className="kx-rp-card-h">
              <h3 id="kx-rp-evidence">关键依据</h3>
              <Count n={conclusions.length} />
            </div>
            {conclusions.length === 0 ? (
              <p className="kx-rp-muted kx-rp-pad">尚无 claim 满足进入管理结论的条件。</p>
            ) : (
              <table className="kx-rp-table">
                <thead>
                  <tr>
                    <th scope="col">结论</th>
                    <th scope="col">类型</th>
                    <th scope="col">证据</th>
                    <th scope="col">新鲜度 / 来源</th>
                  </tr>
                </thead>
                <tbody>
                  {conclusions.map((conclusion, index) => (
                    <tr key={index}>
                      <td className="kx-rp-claim">{conclusion.claim}</td>
                      <td>
                        {conclusion.claimKind ? <Tag>{labelEvidenceClaimKind(conclusion.claimKind)}</Tag> : null}
                      </td>
                      <td>
                        <Tag tone={evidenceLevelTone(conclusion.evidenceLevel)}>
                          证据 {labelEvidenceLevel(conclusion.evidenceLevel || "UNKNOWN")}
                        </Tag>
                      </td>
                      <td className="kx-rp-src">
                        {[
                          conclusion.freshness,
                          conclusion.evidenceRef,
                          conclusion.verificationRefs?.length
                            ? `${conclusion.verificationRefs.length} 条核验`
                            : "未核验",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <div className="kx-rp-two">
            <section className="kx-rp-sec" aria-labelledby="kx-rp-risk">
              <h3 id="kx-rp-risk">
                最大风险 <Count n={risks.length} bad />
              </h3>
              <DotList items={risks} tone="bad" emptyText="未识别到显式风险。" />
            </section>
            <section className="kx-rp-sec" aria-labelledby="kx-rp-unknown">
              <h3 id="kx-rp-unknown">
                UNKNOWN · 还不能下结论 <Count n={unknowns.length} bad />
              </h3>
              <DotList items={unknowns} tone="warn" emptyText="当前报告没有显式未闭合项。" />
            </section>
          </div>

          <div className="kx-rp-appendix">
            <h3>附录</h3>
            {assumptions.length > 0 ? (
              <details className="kx-rp-det">
                <summary>报告假设 · {assumptions.length}</summary>
                <div className="kx-rp-det-b">
                  <DotList items={assumptions} tone="" emptyText="无假设项。" />
                </div>
              </details>
            ) : null}

            <details className="kx-rp-det">
              <summary>专业数字员工意见 · {notes.length}</summary>
              <div className="kx-rp-det-b">
                {notes.length === 0 ? (
                  <p className="kx-rp-muted">无专业数字员工意见记录。</p>
                ) : (
                  <ul className="kx-rp-list">
                    {notes.map((note) => (
                      <li key={note.agentCode} className="kx-rp-noteitem">
                        <span className="kx-rp-noteh">
                          <b>{note.agentName || note.agentCode}</b>
                          <Tag tone={agentStatusTone(note.status)}>
                            {note.status ? labelAgentTaskStatus(note.status) : "未知"}
                          </Tag>
                        </span>
                        <span>{note.summary || note.errorReason || "（无摘要）"}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>

            <details className="kx-rp-det">
              <summary>报告溯源</summary>
              <div className="kx-rp-det-b">
                {provenance ? (
                  <>
                    <div className="kx-rp-tags">
                      <Tag>证据来源 {provenance.sourceRefs.length}</Tag>
                      <Tag>执行记录 {provenance.agentRunRefs.length}</Tag>
                      <Tag>模型调用 {provenance.modelRunRefs.length}</Tag>
                      <Tag>知识债 {provenance.knowledgeDebtRefs.length}</Tag>
                      {provenance.researchSnapshotRef ? <Tag>{provenance.researchSnapshotRef}</Tag> : null}
                    </div>
                    {provenance.sourceRefs.length > 0 ? (
                      <p className="kx-rp-note">
                        证据：
                        {provenance.sourceRefs.slice(0, EXECUTIVE_REPORT_PROVENANCE_PREVIEW_LIMIT).join("、")}
                        {provenance.sourceRefs.length > EXECUTIVE_REPORT_PROVENANCE_PREVIEW_LIMIT
                          ? ` …等 ${provenance.sourceRefs.length} 条`
                          : ""}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="kx-rp-muted">报告未携带溯源信息。</p>
                )}
              </div>
            </details>
          </div>
        </div>

        <aside className="kx-rp-dock" aria-labelledby="kx-rp-decide">
          <h3 id="kx-rp-decide">
            需要你决定 <Count n={decisions.length} />
          </h3>
          {decisions.length ? (
            <ol>
              {decisions.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ol>
          ) : (
            <p className="kx-rp-muted">当前没有待负责人决策项。</p>
          )}
          <div className="kx-rp-rule" />
          <h3 className="is-sub">
            下一步 <Count n={actions.length} />
          </h3>
          {actions.length ? (
            <ol>
              {actions.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ol>
          ) : (
            <p className="kx-rp-muted">报告未给出额外建议动作。</p>
          )}
          {(decisions.length > 0 && onOpenDecisions) || (unknowns.length > 0 && onOpenEvidence) ? (
            <div className="kx-rp-actions">
              {decisions.length > 0 && onOpenDecisions ? (
                <button type="button" className="hermes-primary-btn hermes-btn-sm" onClick={onOpenDecisions}>
                  去做决策
                </button>
              ) : null}
              {unknowns.length > 0 && onOpenEvidence ? (
                <button type="button" className="hermes-outline-btn hermes-btn-sm" onClick={onOpenEvidence}>
                  去补证据
                </button>
              ) : null}
            </div>
          ) : null}
          <p className="kx-rp-note">决策只由负责人做出，不会由 AI 自动批准。</p>
        </aside>
      </div>
    </section>
  );
}
