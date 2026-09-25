"use client";

import React from "react";
import { cx } from "@/components/ui";
import Icon from "@/components/icons";
import { fmtDateTime } from "@/shared/datetime";

interface ChallengeReportCardProps {
  report: {
    productName: string;
    proposedClaim: string;
    generatedAt: string;
    reviewTriggers: string[];
    topFailureReasons: string[];
    unvalidatedAssumptions: string[];
    vetoData: string[];
    cheapestExperiments: string[];
    recommendedMVP: string;
    scientificGaps: { ingredient: string; field: string; description: string }[];
    scientificConflicts: { ingredient: string; field: string; description: string }[];
    overallRisk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    recommendation: "PROCEED" | "MODIFY" | "PAUSE" | "KILL";
    evidenceScope?: {
      considered: number;
      matched: number;
      ingredientNames: string[];
      note: string;
    } | null;
  };
}

const RISK_CONFIG = {
  LOW: { label: "低风险", tone: "ok" as const, icon: "check" },
  MEDIUM: { label: "中风险", tone: "warn" as const, icon: "alert" },
  HIGH: { label: "高风险", tone: "danger" as const, icon: "alert" },
  CRITICAL: { label: "极高风险", tone: "danger" as const, icon: "block" },
};

const RECOMMENDATION_CONFIG = {
  PROCEED: { label: "建议继续", tone: "ok" as const },
  MODIFY: { label: "建议修改", tone: "warn" as const },
  PAUSE: { label: "建议暂停", tone: "danger" as const },
  KILL: { label: "建议放弃", tone: "danger" as const },
};

function Section({
  title,
  items,
  icon,
  tone = "neutral",
}: {
  title: string;
  items: string[];
  icon: string;
  tone?: "neutral" | "warn" | "danger" | "ok";
}) {
  if (items.length === 0) return null;
  return (
    <div className="hermes-challenge-section">
      <div className={cx("hermes-challenge-section-title", `is-${tone}`)}>
        <Icon name={icon} size={13} />
        {title}
        <span className="hermes-challenge-count">{items.length}</span>
      </div>
      <ul className="hermes-challenge-list">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
/** 从 ChallengeReport 生成 Prism 可读的 Markdown 审查包 */
function buildReviewPacketFromReport(report: ChallengeReportCardProps["report"]): string {
  const sections: string[] = [];

  sections.push(`# 外部科学复核请求\n`);
  sections.push(`## 复核问题\n请验证产品「${report.productName}」的宣称「${report.proposedClaim}」是否被现有科学证据支持。\n`);

  if (report.evidenceScope) {
    sections.push(`## 证据范围\n${report.evidenceScope.note}\n- 纳入原料卡：${report.evidenceScope.ingredientNames.join("、") || "无"}\n`);
  }

  if (report.topFailureReasons.length > 0) {
    sections.push(`## 内部识别的主要风险\n${report.topFailureReasons.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n`);
  }

  if (report.vetoData.length > 0) {
    sections.push(`## 一票否决数据\n${report.vetoData.map((v) => `- ${v}`).join("\n")}\n`);
  }

  if (report.scientificGaps.length > 0) {
    sections.push(`## 已知证据缺口\n${report.scientificGaps.map((g) => `- ${g.ingredient}：${g.description}`).join("\n")}\n`);
  }

  if (report.scientificConflicts.length > 0) {
    sections.push(`## 待解决科学冲突\n${report.scientificConflicts.map((c) => `- ${c.description}`).join("\n")}\n`);
  }

  sections.push(`## 复核任务\n1. 验证上述宣称是否有足够人体证据支持\n2. 寻找最强反证与矛盾研究\n3. 评估剂量-效应关系与安全性\n4. 指出夸大宣传与营销红线\n5. 建议最低成本验证实验\n`);

  sections.push(`## 内部建议\n- 风险等级：${report.overallRisk}\n- 建议动作：${report.recommendation}\n- 建议 MVP：${report.recommendedMVP}\n`);

  sections.push(`---\n生成时间：${report.generatedAt}\n来源：Kern 科学证据引擎（内部审查包）`);

  return sections.join("\n");
}


export default function ChallengeReportCard({ report }: ChallengeReportCardProps) {
  const risk = RISK_CONFIG[report.overallRisk];
  const rec = RECOMMENDATION_CONFIG[report.recommendation];
  const generatedDate = fmtDateTime(report.generatedAt);

  const [copied, setCopied] = React.useState(false);
  const [copyError, setCopyError] = React.useState(false);

  /** 导出 Prism 审查包（Markdown 格式，可直接粘贴到 Prism 或发给外部专家） */
  const exportReviewPacket = async () => {
    const packet = buildReviewPacketFromReport(report);
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(packet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  };

  return (
    <div className={cx("hermes-challenge-card", `is-${report.overallRisk.toLowerCase()}`)}>
      {/* 头部：风险等级 + 建议 */}
      <div className="hermes-challenge-header">
        <div className="hermes-challenge-header-left">
          <Icon name="shield" size={16} />
          <div>
            <div className="hermes-challenge-title">挑战我的判断 · {report.productName}</div>
            <div className="hermes-challenge-sub">
              针对宣称「{report.proposedClaim}」的证伪式审查 · {generatedDate}
            </div>
          </div>
        </div>
        <div className="hermes-challenge-badges">
          <span className={cx("hermes-chip", `is-${risk.tone}`)}>
            <Icon name={risk.icon} size={11} />
            {risk.label}
          </span>
          <span className={cx("hermes-chip", `is-${rec.tone}`)}>{rec.label}</span>
        </div>
      </div>

      {/* 触发原因 */}
      {report.reviewTriggers.length > 0 && (
        <div className="hermes-challenge-triggers">
          {report.reviewTriggers.map((t, i) => (
            <span key={i} className="hermes-chip is-outline">
              {t}
            </span>
          ))}
        </div>
      )}

      {/* 证据范围说明 */}
      {report.evidenceScope && (
        <div className="hermes-challenge-scope">
          <Icon name="search" size={12} />
          <span>{report.evidenceScope.note}</span>
        </div>
      )}

      {/* 核心内容 */}
      <div className="hermes-challenge-body">
        <Section title="最可能失败的 3 个原因" items={report.topFailureReasons} icon="x-circle" tone="danger" />
        <Section title="尚未验证的假设" items={report.unvalidatedAssumptions} icon="help-circle" tone="warn" />
        <Section title="一票否决数据" items={report.vetoData} icon="alert" tone="danger" />
        <Section title="最低成本验证实验" items={report.cheapestExperiments} icon="flask" tone="ok" />
      </div>

      {/* 建议 MVP */}
      <div className="hermes-challenge-mvp">
        <div className="hermes-challenge-mvp-label">
          <Icon name="target" size={13} />
          建议 MVP
        </div>
        <div className="hermes-challenge-mvp-content">{report.recommendedMVP}</div>
      </div>

      {/* 导出 Prism 审查包 */}
      <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
        <button className="hermes-challenge-btn" onClick={exportReviewPacket} style={{ fontSize: 11 }}>
          <Icon name="download" size={12} />
          {copied ? "已复制到剪贴板" : copyError ? "复制失败，请检查浏览器权限" : "📋 导出 Prism 审查包"}
        </button>
      </div>

      {/* 证据缺口与冲突（可折叠） */}
      {(report.scientificGaps.length > 0 || report.scientificConflicts.length > 0) && (
        <details className="hermes-details" style={{ marginTop: 12 }}>
          <summary style={{ fontWeight: 600, fontSize: 12 }}>
            查看证据缺口（{report.scientificGaps.length}）与科学冲突（{report.scientificConflicts.length}）
          </summary>
          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            {report.scientificGaps.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-muted)", marginBottom: 6 }}>证据缺口</div>
                {report.scientificGaps.map((g, i) => (
                  <div key={i} style={{ fontSize: 12, padding: "4px 0", borderBottom: "1px dashed var(--line)" }}>
                    <strong>{g.ingredient}</strong> · {g.description}
                  </div>
                ))}
              </div>
            )}
            {report.scientificConflicts.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-muted)", marginBottom: 6 }}>科学冲突</div>
                {report.scientificConflicts.map((c, i) => (
                  <div key={i} style={{ fontSize: 12, padding: "4px 0", borderBottom: "1px dashed var(--line)" }}>
                    <strong>{c.ingredient}</strong> · {c.description}
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
