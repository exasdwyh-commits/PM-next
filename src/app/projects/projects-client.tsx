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
  const [query, setQuery] = React.useState("");

  const stages = React.useMemo(() => ["ALL", ...new Set(projects.map((p) => p.stage))], [projects]);
  const activeFilter = stages.includes(filter) ? filter : "ALL";
  const filtered = React.useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return projects.filter((project) =>
      (activeFilter === "ALL" || project.stage === activeFilter) &&
      (!search || [project.title, project.product?.name, project.product?.identityCode, project.owner.name, project.decisionMaker?.name]
        .some((value) => value?.toLocaleLowerCase().includes(search)))
    );
  }, [projects, activeFilter, query]);

  return (
    <AppShell
      active="projects"
      user={{ name: currentSession?.userName, meta: currentSession?.userEmail }}
      runtime={runtime}
      topbarLeft={
        <div className="hermes-topbar-title">
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
          <h1>项目管理</h1>
          <p>这里展示产品关联项目的执行计划。日常可从「产品」进入，再继续研发、工作项、证据与决策。</p>
        </div>
        <div className="hermes-inline">
          {stages.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={activeFilter === s}
              className={cx("hermes-chip", activeFilter === s && "is-active")}
              onClick={() => setFilter(s)}
            >
              {s === "ALL" ? "全部" : labelProjectStage(s)}
            </button>
          ))}
        </div>
      </div>

      <div className="hermes-inline" style={{ marginBottom: 16 }}>
        <label className="hermes-label" style={{ width: "min(100%, 360px)" }}>
          <span>查找项目</span>
          <input type="search" className="hermes-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="项目、产品或负责人" />
        </label>
        {(query || activeFilter !== "ALL") && <button type="button" className="hermes-outline-btn hermes-btn-sm" onClick={() => { setQuery(""); setFilter("ALL"); }}>清除筛选</button>}
      </div>
      <Panel icon="grid" title="项目列表" titleSmall={`(${filtered.length})`}>
        {filtered.length === 0 ? (
          <Empty>{projects.length === 0 ? "暂无项目。请从产品页启动研发或创建项目，建立后即可管理工作项、证据与决策。" : "没有匹配的项目。请调整关键词或清除筛选。"}</Empty>
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
                  {(() => {
                    const parts = [
                      p._count.workItems > 0 ? `${p._count.workItems} 工作项` : "",
                      p._count.evidences > 0 ? `${p._count.evidences} 证据` : "",
                      p._count.decisionPackets > 0 ? `${p._count.decisionPackets} 决策` : "",
                    ].filter(Boolean);
                    return parts.length > 0 ? <span>{parts.join(" · ")}</span> : null;
                  })()}
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
