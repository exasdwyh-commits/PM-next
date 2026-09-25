"use client";

import * as React from "react";
import { Badge, Empty } from "@/components/ui";
import {
  EXECUTIVE_REPORT_PROVENANCE_PREVIEW_LIMIT,
  type ExecutiveReportPayload,
} from "@/shared/executive-report-types";

/**
 * Executive Report Renderer
 * =========================
 *
 * 把后端已经结构化好的 `ProductRndExecutiveReport` 渲染成负责人能直接读的报告，
 * 而不是把 JSON 原文丢到页面上。
 *
 * 设计原则（与系统哲学一致）：
 * - **UNKNOWN 是一等公民**：未闭合项/缺口不能藏在折叠区里，必须在「风险」和
 *   「需决策」之前就摆出来，因为负责人首先要看的是「还差什么」；
 * - **区分事实与推断**：结论区明确标出 claim 的证据等级（A/B/C/D/UNKNOWN），
 *   不把弱证据写成结论；
 * - **可追溯**：每个数字员工的意见、每类溯源引用都能看到来源 id。
 *
 * 纯展示组件：不做请求、不做状态机，空数据一律走 Empty 空态。
 */

function Section({
  index,
  title,
  hint,
  tone,
  count,
  children,
}: {
  index: number;
  title: string;
  hint?: string;
  tone?: "ok" | "warn" | "danger" | "neutral";
  count?: number;
  children: React.ReactNode;
}) {
  const color =
    tone === "warn"
      ? "var(--warn-ink)"
      : tone === "danger"
        ? "var(--block-ink)"
        : tone === "ok"
          ? "var(--ok-ink)"
          : "var(--neutral-ink)";
  return (
    <section style={{ marginTop: 14 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span className="hermes-section-label" style={{ color }}>
          {index}. {title}
        </span>
        {typeof count === "number" && (
          <span className="hermes-row-meta">({count})</span>
        )}
      </div>
      {hint && (
        <p
          className="hermes-row-meta"
          style={{ margin: "0 0 6px", lineHeight: 1.7 }}
        >
          {hint}
        </p>
      )}
      {children}
    </section>
  );
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
    return (
      <p className="hermes-row-meta" style={{ margin: 0 }}>
        {emptyText}
      </p>
    );
  }
  const color =
    tone === "warn" ? "var(--warn-ink)" : tone === "danger" ? "var(--block-ink)" : undefined;
  return (
    <ul
      className="hermes-list"
      style={{ color, lineHeight: 1.8, margin: 0 }}
    >
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

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
      return "被独立 QA 阻断";
    case "PARTIAL":
      return "部分完成（尚无独立 QA 结论）";
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

export function ExecutiveReportView({
  report,
}: {
  report: ExecutiveReportPayload | null;
}) {
  if (!report) {
    return (
      <div data-testid="executive-report-empty">
        <Empty title="还没有管理报告">
          五个数字员工与独立 QA 全部完成后，报告会在无人干预下自动落盘并展示在这里。
          如果 QA 未通过，报告不会生成——这是治理要求，不是故障。
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
    <div
      data-testid="executive-report"
      style={{
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <strong style={{ fontSize: 14 }}>产品研发管理报告</strong>
        <Badge tone={tone}>{verificationLabel(report.verificationStatus)}</Badge>
        {report.contentVersion !== undefined && (
          <span className="hermes-chip">v{report.contentVersion}</span>
        )}
        {report.createdAt && (
          <span className="hermes-row-meta">
            生成于 {new Date(report.createdAt).toLocaleString()}
          </span>
        )}
      </div>

      <Section index={1} title="摘要">
        <p style={{ margin: 0, lineHeight: 1.8 }}>
          {report.summary || "（报告未包含摘要字段）"}
        </p>
      </Section>

      <Section
        index={2}
        title="结论与证据"
        hint="每条结论都绑定证据引用；证据等级 D / UNKNOWN 不应当作结论使用。"
        count={conclusions.length}
      >
        {conclusions.length === 0 ? (
          <p className="hermes-row-meta" style={{ margin: 0 }}>
            尚无任何 claim 进入结论（证据尚未闭合）。
          </p>
        ) : (
          <ul className="hermes-list">
            {conclusions.map((conclusion, i) => (
              <li key={i} className="hermes-row is-flat">
                <span className="hermes-row-body">
                  {conclusion.claim}{" "}
                  <Badge tone={evidenceLevelTone(conclusion.evidenceLevel)}>
                    证据 {conclusion.evidenceLevel || "UNKNOWN"}
                  </Badge>
                  <span className="hermes-row-meta">
                    {conclusion.claimKind ? ` · ${conclusion.claimKind}` : ""}
                    {conclusion.freshness ? ` · ${conclusion.freshness}` : ""}
                    {conclusion.evidenceRef ? ` · ${conclusion.evidenceRef}` : ""}
                    {conclusion.verificationRefs?.length
                      ? ` · ${conclusion.verificationRefs.length} 条核验`
                      : " · 未核验"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        index={3}
        title="未闭合项（UNKNOWN / 缺口）"
        hint="这些是当前不能下结论、必须补数据或由人确认的点。"
        tone="warn"
        count={unknowns.length}
      >
        <BulletList
          items={unknowns}
          tone="warn"
          emptyText="没有未闭合项。"
        />
      </Section>

      <Section index={4} title="风险" tone="danger" count={risks.length}>
        <BulletList items={risks} tone="danger" emptyText="未识别到显式风险。" />
      </Section>

      <Section index={5} title="需负责人决策" count={decisions.length}>
        <BulletList items={decisions} emptyText="当前没有待决策项。" />
      </Section>

      <Section index={6} title="建议动作" count={actions.length}>
        <BulletList items={actions} emptyText="无建议动作。" />
      </Section>

      {assumptions.length > 0 && (
        <Section index={7} title="假设" count={assumptions.length}>
          <BulletList items={assumptions} emptyText="无假设项。" />
        </Section>
      )}

      <Section
        index={assumptions.length > 0 ? 8 : 7}
        title="数字员工意见"
        hint="每个专业员工的最终产出摘要，含「诚实缺省」时明确说明缺什么。"
        count={notes.length}
      >
        {notes.length === 0 ? (
          <p className="hermes-row-meta" style={{ margin: 0 }}>
            无数字员工意见记录。
          </p>
        ) : (
          <ul className="hermes-list">
            {notes.map((note) => (
              <li key={note.agentCode} className="hermes-row is-flat">
                <span className="hermes-row-body">
                  <strong>{note.agentName || note.agentCode}</strong>{" "}
                  <Badge status={note.status}>{note.status}</Badge>
                  <div className="hermes-row-meta" style={{ lineHeight: 1.7 }}>
                    {note.summary || note.errorReason || "（无摘要）"}
                  </div>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        index={assumptions.length > 0 ? 9 : 8}
        title="溯源（Provenance）"
        hint="报告里每个结论都能沿这些引用回到原始证据与执行记录。"
      >
        {provenance ? (
          <div>
            <div className="hermes-inline" style={{ flexWrap: "wrap", gap: 6 }}>
              <span className="hermes-chip">
                证据来源 {provenance.sourceRefs.length}
              </span>
              <span className="hermes-chip">
                执行记录 {provenance.agentRunRefs.length}
              </span>
              <span className="hermes-chip">
                模型调用 {provenance.modelRunRefs.length}
              </span>
              <span className="hermes-chip">
                知识债 {provenance.knowledgeDebtRefs.length}
              </span>
              {provenance.researchSnapshotRef && (
                <span className="hermes-chip">
                  {provenance.researchSnapshotRef}
                </span>
              )}
            </div>
            {provenance.sourceRefs.length > 0 && (
              <div className="hermes-row-meta" style={{ marginTop: 6 }}>
                证据：
                {provenance.sourceRefs
                  .slice(0, EXECUTIVE_REPORT_PROVENANCE_PREVIEW_LIMIT)
                  .join("、")}
                {provenance.sourceRefs.length >
                EXECUTIVE_REPORT_PROVENANCE_PREVIEW_LIMIT
                  ? ` …等 ${provenance.sourceRefs.length} 条`
                  : ""}
              </div>
            )}
          </div>
        ) : (
          <p className="hermes-row-meta" style={{ margin: 0 }}>
            报告未携带溯源信息。
          </p>
        )}
      </Section>
    </div>
  );
}
