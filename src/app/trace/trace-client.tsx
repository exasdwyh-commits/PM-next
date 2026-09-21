"use client";

import React from "react";
import Link from "next/link";
import AppShell from "@/components/app-shell";
import CollapsibleList from "@/components/collapsible-list";
import { Panel, Badge, Empty, PageHeading } from "@/components/ui";
import { Timeline } from "@/components/viz";
import { fmtDateTimeFull } from "@/shared/datetime";
import { labelDecisionPacketStatus, labelFeedbackStatus, labelAuditAction } from "@/shared/status-labels";

const decisionLabel: Record<string, string> = { APPROVE: "批准", REQUEST_CHANGES: "退回修改", DEFER: "延后", REJECT: "否决", WITHDRAW: "撤回" };

const AUDIT_PREVIEW_COUNT = 20;

export default function TraceClient({ initialPackets, initialFeeds, initialAudits, user, runtime }: { initialPackets: any[]; initialFeeds: any[]; initialAudits: any[]; user?: { name?: string | null; meta?: string | null }; runtime?: { tone: "ok" | "warn" | "neutral"; label: string; detail: string } }) {
  const fmt = (d: any) => (d ? fmtDateTimeFull(d) : "—");

  // 审计时间线分页：默认展示最近 20 条，其余由 CollapsibleList 提供「查看全部 / 收起」折叠。

  return (
    <AppShell
      active="trace"
      user={user}
      runtime={runtime}
      topbarRight={<Link href="/" className="hermes-link">← 返回工作台</Link>}
    >
      <PageHeading
        eyebrow="TRACEABILITY"
        title="决策追溯链"
        subtitle="从输入成果/证据版本 → 打样门决策包 → 负责人裁决 → 反馈修订，全程留痕可追溯。"
      />

      {/* Decision packets */}
      <Panel title={<>打样门决策包 {initialPackets.length ? `(${initialPackets.length})` : ""}</>}>
        {initialPackets.length === 0 ? (
          <Empty>暂无决策包。在项目作战室起草首个研发打样门决策包后在此留痕。</Empty>
        ) : (
          <div className="hermes-list">
            {initialPackets.map((pkt) => (
              <div key={pkt.id} className="hermes-row">
                <div className="hermes-row-head">
                  <Badge status={pkt.status}>{labelDecisionPacketStatus(pkt.status)}</Badge>
                  {pkt.project ? (
                    <Link href={`/projects/${pkt.project.id}`} className="hermes-link">{pkt.project.title}</Link>
                  ) : (
                    <span className="hermes-row-title">—</span>
                  )}
                  <span className="hermes-mono">指纹 {pkt.scopeHash.slice(0, 12)}…</span>
                </div>
                <div className="hermes-row-meta">起草 {fmt(pkt.createdAt)}{pkt.productVersion?.versionTag ? ` · 版本 ${pkt.productVersion.versionTag}` : ""}</div>
                {Number(pkt.budgetAmount) ? (
                  <div className="hermes-row-body">拟投入预算 ¥{Number(pkt.budgetAmount).toLocaleString()} · 授权范围: {pkt.budgetScope || "未填写"}</div>
                ) : null}
                <div className="hermes-row-body">验证计划: {pkt.validationPlan}</div>

                {pkt.decisions?.length > 0 && (
                  <>
                    <div className="hermes-divider" />
                    <div className="hermes-list">
                      {pkt.decisions.map((dec: any) => (
                        <div key={dec.id} className="hermes-row is-flat">
                          <div className="hermes-row-head">
                            <Badge tone={dec.decision === "APPROVE" ? "ok" : "danger"}>{decisionLabel[dec.decision] || dec.decision}</Badge>
                          </div>
                          <div className="hermes-row-body">
                            <strong>{dec.actor?.name}</strong>: {dec.reason}
                            <span className="hermes-row-meta"> — {fmt(dec.decidedAt)}</span>
                            {dec.obligations && <div>义务: {dec.obligations}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Feedback revisions */}
      <Panel title={<>反馈处置修订 {`(${initialFeeds.length})`}</>}>
        {initialFeeds.length === 0 ? (
          <Empty>暂无反馈处置记录。</Empty>
        ) : (
          <div className="hermes-list">
            {initialFeeds.map((fb) => (
              <div key={fb.id} className="hermes-row is-flat">
                <div className="hermes-row-head">
                  <Badge tone={fb.status === "ACCEPTED" ? "ok" : "danger"}>{labelFeedbackStatus(fb.status)}</Badge>
                  {fb.project ? (
                    <Link href={`/projects/${fb.project.id}`} className="hermes-link">{fb.project.title}</Link>
                  ) : (
                    <strong className="hermes-row-title">—</strong>
                  )}
                  <span className="hermes-row-meta">by {fb.author?.name}</span>
                </div>
                <div className="hermes-row-body">{fb.content}</div>
                {fb.dispositionReason && <div className="hermes-row-body">处置: {fb.dispositionReason}</div>}
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Audit trail */}
      <Panel
        // 「最近 N 条」而非「共 N 条」：服务端 take 200，不代表组织全部审计事件
        title={`系统审计事件（最近 ${initialAudits.length} 条）`}
        sub={initialAudits.length > AUDIT_PREVIEW_COUNT ? `默认展示最近 ${AUDIT_PREVIEW_COUNT} 条 · 服务端最多保留 200 条` : undefined}
      >
        {initialAudits.length === 0 ? (
          <Empty>暂无审计记录。</Empty>
        ) : (
          <>
            <CollapsibleList
              items={initialAudits}
              previewCount={AUDIT_PREVIEW_COUNT}
              renderList={(visible) => (
                <Timeline
                  ariaLabel="系统审计事件时间线"
                  items={visible.map((a) => ({
                    id: a.id,
                    at: a.timestamp,
                    title: `${a.actor?.name ?? "系统"} · ${labelAuditAction(a.action)}`,
                    body: a.summary,
                    tone: "neutral" as const,
                  }))}
                />
              )}
            />
          </>
        )}
      </Panel>
    </AppShell>
  );
}
