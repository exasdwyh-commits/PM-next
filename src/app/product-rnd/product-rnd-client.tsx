"use client";

import React, { useEffect, useState } from "react";
import AppShell from "@/components/app-shell";
import { Panel, Badge, Empty, PageHeading, GlassCard } from "@/components/ui";
import { identityHeaders } from "@/shared/client-identity";

type Conclusion = {
  claim: string;
  claimKind: string;
  evidenceLevel: string;
  evidenceIds?: string[];
  verification?: {
    verifierIdentity?: string;
    sourceCount?: number;
    sourceHosts?: string[];
    note?: string;
  };
};

type ReportView = {
  id: string;
  title: string;
  executiveSummary: string;
  conclusions: Conclusion[];
  decisionsRequired: string[];
  risks: string[];
  unresolvedQuestions: string[];
  nextActions: string[];
  advisoryNotes?: { source: string; trust: string; summary: string; suggestedNextActions?: string[] }[];
  verifierIdentity?: string;
  verifierRunId?: string;
};

type RunResult = {
  project: { id: string; title: string } | null;
  task: { id: string; status: string; stage: string; reportId?: string } | null;
  route?: { recommendedModel?: string; selectedModel?: string; shadow?: boolean } | null;
  report: ReportView | null;
  evidence: {
    id: string;
    title: string;
    sourceType: string;
    sourceUri?: string;
    trustTier: string;
    httpStatus?: number;
  }[];
  knowledgeDebt: { id: string; topic: string; status: string; occurrences: number }[];
  provider: { id: string; error?: string | null };
  recoveryRequired?: boolean;
};

function levelBadge(level: string) {
  const map: Record<string, "ok" | "warn" | "danger" | "info" | "neutral" | "brand"> = {
    VERIFIED: "ok",
    STRONG: "ok",
    SUPPORTED: "info",
    WEAK: "warn",
    UNKNOWN: "neutral",
  };
  return <Badge tone={map[level] || "neutral"}>{level}</Badge>;
}

export default function ProductRndClient({
  currentSession,
  runtime,
  mockAuth,
}: {
  currentSession: { userId: string; userName: string };
  runtime: { tone: "ok" | "warn" | "neutral"; label: string; detail: string };
  mockAuth: boolean;
}) {
  const [idea, setIdea] = useState(
    "我想做一款新的功能食品，先看看市场、配方、成本和法规有没有机会。"
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RunResult | null>(null);
  const [history, setHistory] = useState<
    { id: string; title: string; createdAt?: string }[]
  >([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch("/api/kernel/product-rnd", {
        headers: identityHeaders(mockAuth, currentSession.userId),
      });
      const data = await res.json();
      if (res.ok) {
        setHistory(
          (data.reports || [])
            .map((r: any) => ({
              id: r.id,
              title: r.title,
              createdAt: r.createdAt,
            }))
            .slice(0, 12)
        );
      }
    } catch {
      // keep empty
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/kernel/product-rnd", {
        method: "POST",
        headers: identityHeaders(mockAuth, currentSession.userId, {
          "Content-Type": "application/json",
          "Idempotency-Key": `ui-${Date.now()}`,
        }),
        body: JSON.stringify({ idea, dataClass: "INTERNAL" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
      if (data.recoveryRequired && !data.report) {
        setError("检测到未完成的历史运行（recoveryRequired）。请查看历史或稍后重试。");
      }
      setResult(data as RunResult);
      void loadHistory();
    } catch (e: any) {
      setError(e.message || "运行失败");
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const report = result?.report;

  return (
    <AppShell active="product-rnd" user={{ name: currentSession.userName }} runtime={runtime}>
      <div className="hermes-stack">
        <PageHeading
          eyebrow="PM OS KERNEL"
          title="产品研发评估"
          subtitle="Department Assistant → Kernel → Independent Verifier → Report。模型输出仅为 advisory，不会直接升级为 VERIFIED。"
        />

        <Panel
          icon="flask"
          title="启动 Product R&D Analysis"
          sub="完整链路：Project / Task → Router → ResearchExecutor → ToolBroker → Source Fetch → Evidence Verifier → Knowledge Debt → Report"
        >
          <label className="hermes-label" style={{ display: "block" }}>
            <span>产品想法</span>
            <textarea
              className="hermes-input"
              value={idea}
              onChange={e => setIdea(e.target.value)}
              rows={4}
              style={{ width: "100%", resize: "vertical", minHeight: 96 }}
            />
          </label>
          <div style={{ display: "flex", gap: 12, marginTop: 12, alignItems: "center" }}>
            <button
              type="button"
              onClick={run}
              disabled={busy || !idea.trim()}
              style={{
                background: "#0f766e",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                padding: "12px 18px",
                cursor: busy ? "wait" : "pointer",
                font: "inherit",
                opacity: busy ? 0.7 : 1,
              }}
            >
              {busy ? "Running…" : "启动分析"}
            </button>
            {busy && <span className="hermes-note">正在通过 PM OS Kernel 执行…</span>}
            {error && <span style={{ color: "#b91c1c" }}>{error}</span>}
          </div>
        </Panel>

        <Panel
          icon="book"
          title="历史评估"
          sub="Kernel canonical records"
          className="hermes-panel"
        >
          {loadingHistory && <div className="hermes-note">加载中…</div>}
          {!loadingHistory && history.length === 0 && (
            <Empty>暂无历史报告。运行一次后会出现在这里。</Empty>
          )}
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            {history.map(h => (
              <li key={h.id}>
                <span className="hermes-note">{h.createdAt || ""}</span> {h.title}
              </li>
            ))}
          </ul>
        </Panel>

        {!result && !busy && (
          <Empty>输入产品想法并启动分析。完成后将展示 Report、Evidence、Knowledge Debt。</Empty>
        )}

        {result && (
          <>
            <GlassCard>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
                <div>
                  <span className="hermes-section-label">Project</span>
                  <div>{result.project?.title || "—"}</div>
                </div>
                <div>
                  <span className="hermes-section-label">Task</span>
                  <div>
                    {result.task?.status} / {result.task?.stage}
                  </div>
                </div>
                <div>
                  <span className="hermes-section-label">Router</span>
                  <div>
                    {result.route?.selectedModel || "—"}
                    {result.route?.shadow ? " (shadow)" : ""}
                  </div>
                </div>
                <div>
                  <span className="hermes-section-label">Provider</span>
                  <div>
                    {result.provider?.id}
                    {result.provider?.error ? ` · ${result.provider.error}` : ""}
                  </div>
                </div>
                <div>
                  <span className="hermes-section-label">Verifier</span>
                  <div>{report?.verifierIdentity || "—"}</div>
                </div>
              </div>
            </GlassCard>

            {report && (
              <Panel icon="search" title="Report" sub={report.title}>
                <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Executive Summary</h3>
                <p style={{ margin: "0 0 16px", lineHeight: 1.6 }}>{report.executiveSummary}</p>

                <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Conclusions</h3>
                <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
                  {report.conclusions.map((c, i) => (
                    <div
                      key={i}
                      style={{
                        border: "1px solid var(--border, #e5e7eb)",
                        borderRadius: 10,
                        padding: 12,
                      }}
                    >
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                        {levelBadge(c.evidenceLevel)}
                        <Badge tone="neutral">{c.claimKind}</Badge>
                      </div>
                      <div>{c.claim}</div>
                      {c.verification?.note && (
                        <div className="hermes-note" style={{ marginTop: 6 }}>
                          {c.verification.note}
                          {c.verification.sourceHosts?.length
                            ? ` · hosts: ${c.verification.sourceHosts.join(", ")}`
                            : ""}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Evidence</h3>
                <ul style={{ margin: "0 0 16px 18px", lineHeight: 1.6 }}>
                  {(result.evidence || []).map(e => (
                    <li key={e.id}>
                      <Badge tone={e.trustTier === "QUARANTINED" ? "danger" : "info"}>
                        {e.trustTier}
                      </Badge>{" "}
                      {e.title}
                      {e.sourceUri ? ` · ${e.sourceUri}` : ""}
                    </li>
                  ))}
                  {(result.evidence || []).length === 0 && <li className="hermes-note">无独立抓取来源</li>}
                </ul>

                <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Risks</h3>
                <ul style={{ margin: "0 0 16px 18px", lineHeight: 1.6 }}>
                  {report.risks.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>

                <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Unknown / Unresolved</h3>
                <ul style={{ margin: "0 0 16px 18px", lineHeight: 1.6 }}>
                  {report.unresolvedQuestions.map((u, i) => (
                    <li key={i}>{u}</li>
                  ))}
                  {report.unresolvedQuestions.length === 0 && <li className="hermes-note">无</li>}
                </ul>

                <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Knowledge Debt</h3>
                <ul style={{ margin: "0 0 16px 18px", lineHeight: 1.6 }}>
                  {(result.knowledgeDebt || []).map(d => (
                    <li key={d.id}>
                      {d.topic} <Badge tone="warn">{d.status}</Badge>
                    </li>
                  ))}
                  {(result.knowledgeDebt || []).length === 0 && <li className="hermes-note">无</li>}
                </ul>

                <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Decision Required</h3>
                <ul style={{ margin: "0 0 16px 18px", lineHeight: 1.6 }}>
                  {report.decisionsRequired.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>

                <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Next Actions（系统生成）</h3>
                <ol style={{ margin: "0 0 16px 18px", lineHeight: 1.6 }}>
                  {report.nextActions.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                  {report.nextActions.length === 0 && <li className="hermes-note">无</li>}
                </ol>

                {(report.advisoryNotes || []).length > 0 && (
                  <>
                    <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Advisory（UNTRUSTED_ADVISORY）</h3>
                    {report.advisoryNotes!.map((a, i) => (
                      <div
                        key={i}
                        style={{
                          border: "1px dashed #d4a72c",
                          borderRadius: 10,
                          padding: 12,
                          marginBottom: 8,
                        }}
                      >
                        <div style={{ marginBottom: 6 }}>
                          <Badge tone="warn">{a.trust}</Badge> <span className="hermes-note">{a.source}</span>
                        </div>
                        <p style={{ margin: 0 }}>{a.summary}</p>
                        {(a.suggestedNextActions || []).length > 0 && (
                          <ul style={{ margin: "8px 0 0 18px" }}>
                            {a.suggestedNextActions!.map((s, j) => (
                              <li key={j}>{s}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </Panel>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
