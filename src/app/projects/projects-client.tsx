"use client";

import React from "react";
import Link from "next/link";
import AppShell from "@/components/app-shell";
import { Panel, Badge, Empty, cx } from "@/components/ui";
import Icon from "@/components/icons";
import { fmtDateTime } from "@/shared/datetime";
import { labelProjectStage } from "@/shared/status-labels";

interface Project {
  id: string;
  title: string;
  stage: string;
  createdAt: string;
  updatedAt: string;
  owner: { id: string; name: string };
  decisionMaker: { id: string; name: string } | null;
  product: { id: string; name: string; identityCode: string } | null;
  _count: { workItems: number; evidences: number; decisionPackets: number };
}

// ⚠️ 这里曾经自带一份 STAGE_LABEL / STAGE_TONE，取值是**过期的**旧枚举
// （IDEA / PROTOTYPE / VALIDATION / LAUNCH / ARCHIVED），而真实 ProjectStage 是
// DRAFT / RESEARCH / SAMPLING / PRODUCTION_PREP / PRODUCTION / DELIVERED。
// 查不到 → fallback 打印原始枚举 → 筛选条与徽章上直接出现「DRAFT」「PRODUCTION_PREP」。
// 阶段标签一律走 `labelProjectStage`（唯一来源 status-labels）；tone 交给 Badge 的 status 映射。

export default function ProjectsClient({
  projects,
  currentSession,
  runtime,
}: {
  projects: Project[];
  currentSession: { userName: string; userEmail: string };
  runtime: { tone: "ok" | "warn" | "neutral"; label: string; detail: string; modelConfigured: boolean };
}) {
  const [filter, setFilter] = React.useState<string>("ALL");

  const filtered = filter === "ALL" ? projects : projects.filter((p) => p.stage === filter);
  const stages = ["ALL", ...new Set(projects.map((p) => p.stage))];

  return (
    <AppShell
      active="projects"
      user={{ name: currentSession?.userName, meta: currentSession?.userEmail }}
      runtime={runtime}
      topbarLeft={
        <div className="hermes-topbar-title">
          <span className="eyebrow">PROJECTS</span>
          <strong>项目管理</strong>
        </div>
      }
      topbarRight={
        <Link href="/products" className="hermes-outline-btn hermes-btn-sm">
          <Icon name="back" size={14} />
          返回产品
        </Link>
      }
    >
      <div className="hermes-page-heading">
        <div>
          <p className="eyebrow">产品执行</p>
          <h1>项目管理</h1>
          <p>这里展示产品关联项目的执行计划。日常可从「产品」进入，再继续研发、工作项、证据与决策。</p>
        </div>
        <div className="hermes-inline">
          {stages.map((s) => (
            <button
              key={s}
              className={cx("hermes-chip", filter === s && "is-active")}
              onClick={() => setFilter(s)}
            >
              {s === "ALL" ? "全部" : labelProjectStage(s)}
            </button>
          ))}
        </div>
      </div>

      <Panel icon="grid" eyebrow="LIST" title="项目列表" titleSmall={`(${filtered.length})`}>
        {filtered.length === 0 ? (
          <Empty>暂无项目。请从产品页启动研发或创建项目，建立后即可管理工作项、证据与决策。</Empty>
        ) : (
          <div className="hermes-list">
            {filtered.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`} className="hermes-row">
                <div className="hermes-row-head">
                  {/* 首字母块：与产品列表、首页推进行一致，让列表可扫读 */}
                  <span className="hermes-row-mark" aria-hidden="true">
                    {p.title.trim().slice(0, 1)}
                  </span>
                  <span className="hermes-row-title">{p.title}</span>
                  <Badge status={p.stage}>{labelProjectStage(p.stage)}</Badge>
                </div>
                <div className="hermes-row-meta">
                  <span>
                    {p.product ? `${p.product.name} (${p.product.identityCode})` : "未关联产品"}
                    {" · "}负责人: {p.owner.name}
                    {p.decisionMaker ? ` · 决策人: ${p.decisionMaker.name}` : ""}
                  </span>
                  <span>
                    {p._count.workItems} 工作项 · {p._count.evidences} 证据 · {p._count.decisionPackets} 决策
                  </span>
                  <span>{fmtDateTime(p.updatedAt)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Panel>
    </AppShell>
  );
}
