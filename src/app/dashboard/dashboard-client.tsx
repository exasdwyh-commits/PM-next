"use client";

import React from "react";
import Link from "next/link";
import AppShell from "@/components/app-shell";
import CollapsibleList from "@/components/collapsible-list";
import { Panel, StatGrid, Stat, Badge, Empty, PageHeading } from "@/components/ui";
import {
  labelDecisionPacketStatus,
  labelEvidenceNature,
  labelEvidenceVerifyStatus,
  labelProjectStage,
  labelValidationStatus,
  labelWorkItemStatus,
} from "@/shared/status-labels";
import { fmtDateTime } from "@/shared/datetime";

// 分层信息设计 · 本页是第四层「原始依据」明细：全量计数的可追溯视图。
// 日常阅读请先看工作简报（/），本页不做结论、不做排序，只呈现真实聚合计数。

const CHALLENGE_PREVIEW_COUNT = 5;

export default function DashboardClient({ initialStats, user, runtime, knowledgeSampleMode }: { initialStats: any; user?: { name?: string | null; meta?: string | null }; runtime?: { tone: "ok" | "warn" | "neutral"; label: string; detail: string }; knowledgeSampleMode?: boolean }) {
  const s = initialStats;
  const count = (g: any, k: string) => g?.[k] ?? 0;
  const packetTotal = Object.values(s.packetGroups || {}).reduce((a: number, b: any) => a + (b || 0), 0);

  // 「最近挑战报告」分页：默认展示前 5 条，超过时由 CollapsibleList 提供「查看全部 / 收起」折叠。
  const challenges = s.recentChallenges || [];

  return (
    <AppShell
      active="dashboard"
      user={user}
      runtime={runtime}
      topbarRight={<Link href="/" className="hermes-link">← 返回工作简报</Link>}
    >
      <PageHeading
        eyebrow="RAW COUNTS · 明细层"
        title="数据明细"
        subtitle="本页是原始计数的可追溯视图，不做结论。日常阅读请先看工作简报。"
      />

      <StatGrid>
        <Stat label="参与项目" value={s.projectCount} />
        <Stat label="OPEN 数据缺口" value={s.openGapCount} />
        <Stat label="在册成员" value={s.memberCount} />
        <Stat label="决策包总数" value={packetTotal} />
        <Stat label="原料证据卡" value={s.ingredientCount} />
        <Stat label="低置信度原料" value={s.lowConfidenceCount} tone={s.lowConfidenceCount > 0 ? "alert" : "good"} />
      </StatGrid>

      {/* 科学证据等级分布 */}
      {s.ingredientCount > 0 && (
        <Panel title="科学证据资产" sub="原料卡证据等级分布（来自 hermes-brain 知识库）">
          <div className="hermes-inline">
            {Object.entries(s.evidenceLevels).map(([level, count]) => (
              <Badge key={level} tone={level === "A" ? "ok" : level === "B" ? "brand" : level === "C" ? "warn" : "danger"}>
                {level} 级 × {String(count)}
              </Badge>
            ))}
          </div>
          {knowledgeSampleMode && (
            <div className="hermes-note" style={{ marginTop: 10 }}>
              ⚠️ 内容性质声明：当前原料证据卡为示例 / 模板数据（待领域专家审核），证据分布仅反映知识库结构，不代表真实科学资产。
            </div>
          )}
          {s.lowConfidenceCount > 0 && (
            <div className="hermes-note is-alert" style={{ marginTop: 10 }}>
              ⚠️ {s.lowConfidenceCount} 张原料卡置信度低于 70%，建议复核后再用于产品决策
            </div>
          )}
        </Panel>
      )}

      {/* 最近挑战报告 */}
      {challenges.length > 0 && (
        <Panel
          title="最近挑战报告"
          sub={
            challenges.length > CHALLENGE_PREVIEW_COUNT
              ? `${challenges.length} 条 · 默认展示 ${CHALLENGE_PREVIEW_COUNT} 条 · 点击跳回原始对话`
              : "证伪式审查历史记录 · 点击跳回原始对话"
          }
        >
          <CollapsibleList
            items={challenges}
            previewCount={CHALLENGE_PREVIEW_COUNT}
            listClassName="hermes-list"
            renderItem={(c: any, i: number) => (
              <Link
                key={i}
                href={`/advisor?c=${c.conversationId}${c.productId ? `&product=${c.productId}` : ""}`}
                className="hermes-row"
              >
                <div className="hermes-row-head">
                  <span className="hermes-row-title">{c.productName}</span>
                  <Badge tone={c.overallRisk === "CRITICAL" ? "danger" : c.overallRisk === "HIGH" ? "warn" : "ok"}>
                    {c.overallRisk} · {c.recommendation}
                  </Badge>
                </div>
                <div className="hermes-row-meta">{fmtDateTime(c.createdAt)}</div>
              </Link>
            )}
          />
        </Panel>
      )}

      <div className="hermes-stack" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: 14, alignContent: "start" }}>
        {/* Evidence */}
        <Panel title="证据资产" sub="按核实状态 / 性质 / 验证状态 真实计数">
          <div className="hermes-stack">
            <div>
              <div className="hermes-subheading">核实状态</div>
              <div className="hermes-inline">
                <Badge status="VERIFIED">{labelEvidenceVerifyStatus("VERIFIED")} {count(s.verifyStatusGroups, "VERIFIED")}</Badge>
                <Badge status="UNVERIFIED">{labelEvidenceVerifyStatus("UNVERIFIED")} {count(s.verifyStatusGroups, "UNVERIFIED")}</Badge>
                <Badge status="REJECTED">{labelEvidenceVerifyStatus("REJECTED")} {count(s.verifyStatusGroups, "REJECTED")}</Badge>
              </div>
            </div>
            <div>
              <div className="hermes-subheading">性质隔离 (真实依据才可作决策依据)</div>
              <div className="hermes-inline">
                <Badge status="REAL">{labelEvidenceNature("REAL")} {count(s.natureGroups, "REAL")}</Badge>
                <Badge status="DEMO">{labelEvidenceNature("DEMO")} {count(s.natureGroups, "DEMO")}</Badge>
              </div>
            </div>
            <div>
              <div className="hermes-subheading">市场验证状态</div>
              <div className="hermes-inline">
                <Badge status="UNAPPLIED">{labelValidationStatus("UNAPPLIED")} {count(s.validationGroups, "UNAPPLIED")}</Badge>
                <Badge status="IN_PROGRESS">{labelValidationStatus("IN_PROGRESS")} {count(s.validationGroups, "IN_PROGRESS")}</Badge>
                <Badge status="VERIFIED_BY_LEAD">{labelValidationStatus("VERIFIED_BY_LEAD")} {count(s.validationGroups, "VERIFIED_BY_LEAD")}</Badge>
              </div>
            </div>
          </div>
        </Panel>

        {/* Stages */}
        <Panel title="项目阶段分布">
          {Object.keys(s.stageGroups).length === 0 ? (
            <Empty>当前组织还没有项目。先从「产品」启动研发或创建项目，进入执行后会在这里汇总。</Empty>
          ) : (
            <div className="hermes-list">
              {Object.entries(s.stageGroups).map(([k, v]) => (
                <div key={k} className="hermes-row is-flat">
                  <div className="hermes-row-head">
                    <span className="hermes-row-title">{labelProjectStage(k)}</span>
                    <span className="hermes-row-meta">{String(v)}</span>
                  </div>
                  <div className="hermes-progress" style={{ marginTop: 8 }}>
                    <i style={{ width: `${(Number(v) / Math.max(1, s.projectCount)) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Work items —— 标签必须过 status-labels，绝不打印数据库枚举（曾把 "IN_PROGRESS" 直接渲染到页面上） */}
        <Panel title="工作项状态">
          {Object.keys(s.workItemGroups).length === 0 ? (
            <Empty>当前没有工作项。进入具体项目的「任务」页安排第一项工作后，这里会汇总执行状态。</Empty>
          ) : (
            <div className="hermes-inline">
              {Object.entries(s.workItemGroups).map(([k, v]) => (
                <Badge key={k} status={k}>
                  {labelWorkItemStatus(k)} {String(v)}
                </Badge>
              ))}
            </div>
          )}
        </Panel>

        {/* Decision packets */}
        <Panel title="打样门决策包状态">
          {Object.keys(s.packetGroups).length === 0 ? (
            <Empty>当前没有决策包。项目需要正式放行时，由负责人在项目「决策」页起草并提交。</Empty>
          ) : (
            <div className="hermes-inline">
              {Object.entries(s.packetGroups).map(([k, v]) => (
                <Badge key={k} status={k}>
                  {labelDecisionPacketStatus(k)} {String(v)}
                </Badge>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Projects */}
      <Panel title="参与项目" sub="点击进入项目作战室查看详情">
        {s.projects.length === 0 ? (
          <Empty>当前账号还没有参与项目。由项目负责人添加成员，或先创建并启动一个产品项目。</Empty>
        ) : (
          <div className="hermes-list">
            {s.projects.map((p: any) => (
              <Link key={p.id} href={`/projects/${p.id}`} className="hermes-row">
                <div className="hermes-row-head">
                  <span className="hermes-row-title">{p.title}</span>
                  <Badge status={p.stage}>{labelProjectStage(p.stage)}</Badge>
                </div>
                <div className="hermes-row-meta">{p.target}</div>
                <div className="hermes-row-meta">负责人 {p.owner?.name || "未指定"}</div>
              </Link>
            ))}
          </div>
        )}
      </Panel>
    </AppShell>
  );
}
