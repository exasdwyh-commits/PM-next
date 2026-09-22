import prisma from "@/shared/db";
import Link from "next/link";
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSessionFromContext } from "@/modules/identity/session";
import { getRuntimeStatus } from "@/shared/runtime-status";
import AppShell from "@/components/app-shell";
import { Panel, Badge, Empty, KV, Stat, StatGrid } from "@/components/ui";
import {
  labelAgentRunStatus,
  labelKnowledgeSourceKind,
} from "@/shared/status-labels";
import Icon from "@/components/icons";
import { fmtDateTime } from "@/shared/datetime";
import RecentAuditList from "./recent-audit-list";
import ModelControlClient from "./model-control-client";
import { getModelControlOverview } from "@/modules/model-control/service";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const headerList = await headers();
  const cookieStore = await cookies();

  let session: any = null;
  try {
    session = await getServerSessionFromContext(headerList, cookieStore);
  } catch {
    redirect("/login");
  }

  const runtime = getRuntimeStatus();

  const [knowledgeSources, agentRunCounts, recentAudits, signalCount, productCount, modelControl] = await Promise.all([
    prisma.knowledgeSource.findMany({
      where: { organizationId: session.organizationId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { documents: true } } },
    }),
    prisma.agentRun.groupBy({
      by: ["status"],
      where: { organizationId: session.organizationId },
      _count: { _all: true },
    }),
    // 审计事件表没有 organizationId 列（schema 如此），因此按 actor 的组织归属过滤；
    // 口径与 trace/page.tsx:42-43 保持一致。
    // 此处此前漏了过滤条件，而同一个 Promise.all 里其余四个查询都带了 organizationId
    // —— 会取到全库最新 10 条审计事件（跨组织）。
    prisma.auditEvent.findMany({
      where: { actor: { organizationId: session.organizationId } },
      orderBy: { timestamp: "desc" },
      // 设置页的「最近审计事件」默认展示 10 条，其余由客户端「查看全部」展开
      take: 100,
      include: { actor: { select: { name: true } } },
    }),
    prisma.signalItem.count({ where: { organizationId: session.organizationId } }),
    prisma.product.count({ where: { organizationId: session.organizationId } }),
    getModelControlOverview(session),
  ]);

  const totalRuns = agentRunCounts.reduce((a, b) => a + b._count._all, 0);

  return (
    <AppShell
      active="settings"
      user={{ name: session?.userName, meta: session?.userEmail }}
      runtime={runtime}
      topbarLeft={
        <div className="hermes-topbar-title">
          <span className="eyebrow">SETTINGS</span>
          <strong>设置</strong>
        </div>
      }
    >
      <div className="hermes-page-heading">
        <div>
          <p className="eyebrow">系统配置</p>
          <h1>设置</h1>
          <p>组织权限、知识连接、模型配置与用量审计</p>
        </div>
      </div>

      <StatGrid className="hermes-overview-stats">
        <Stat label="组织内产品" value={productCount} hint="含全部生命周期" />
        <Stat label="已录入信号" value={signalCount} hint="组织私有" />
        <Stat label="Agent 运行记录" value={totalRuns} hint="含未接入真实模型时的模拟运行（见下方「模型配置」）" />
        <Stat label="知识源" value={knowledgeSources.length} hint="Obsidian / 本地目录" />
      </StatGrid>

      <div className="hermes-overview-grid">
        <Panel icon="shield" eyebrow="ORG" title="组织与权限" sub="角色、成员与访问范围">
          <KV
            items={[
              { k: "组织", v: session?.organizationId },
              { k: "当前用户", v: `${session?.userName}（${session?.userEmail}）` },
              { k: "权限范围", v: "仅本组织数据；项目级还需是项目成员" },
            ]}
          />
          <div className="hermes-inline-end" style={{ marginTop: 10 }}>
            <Link href="/organization" className="hermes-outline-btn hermes-btn-sm">
              打开组织与权限
              <Icon name="arrow" size={14} />
            </Link>
          </div>
        </Panel>

        <Panel icon="book" eyebrow="KNOWLEDGE" title="知识连接" sub="首版只读导入指定 Vault / 目录">
          {knowledgeSources.length === 0 ? (
            <Empty>
              尚未配置知识源。按蓝图要求，顾问需按权限从指定目录检索原文片段并给出出处；
              配置后公司知识页才能展示来源与同步状态（当前不会自动声称已接入 Obsidian）。
            </Empty>
          ) : (
            <div className="hermes-list">
              {knowledgeSources.map((s) => (
                <div key={s.id} className="hermes-row">
                  <div className="hermes-row-head">
                    <span className="hermes-row-title">{s.name}</span>
                    <Badge tone={s.enabled ? "ok" : "neutral"}>{s.enabled ? "启用" : "停用"}</Badge>
                  </div>
                  <div className="hermes-row-meta">
                    <span>{labelKnowledgeSourceKind(s.kind)}</span>
                    <span>文档 {s._count.documents}</span>
                    <span>{s.lastSyncAt ? `最近同步 ${fmtDateTime(s.lastSyncAt)}` : "从未同步"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          icon="nodes"
          className="is-span-all"
          eyebrow="MODEL CONTROL"
          title="模型控制中心"
          sub="按任务类型路由模型；日常低成本、核心研发 Frontier、红队复核与本地私密任务分开配置"
        >
          <div className={`hermes-banner ${runtime.modelConfigured ? "is-ok" : "is-warn"}`} style={{ marginBottom: 12 }}>
            <strong>旧 Advisor 环境变量：{runtime.label}</strong>
            <div style={{ marginTop: 4 }}>
              {runtime.detail}。Model Control V1 先建立配置平面，不会在未验证 Provider 插件前替换现有 Advisor 执行链。
            </div>
          </div>
          <ModelControlClient initial={JSON.parse(JSON.stringify(modelControl))} />
        </Panel>

        <Panel icon="chart" className="is-span-all" eyebrow="USAGE" title="用量与审计" sub="留痕用于追溯，不用于考核">
          {agentRunCounts.length === 0 ? (
            <Empty>还没有 Agent 运行记录。</Empty>
          ) : (
            <div className="hermes-list is-2col">
              {agentRunCounts.map((r) => (
                <div key={r.status} className="hermes-row">
                  <div className="hermes-row-head">
                    <span className="hermes-row-title">{labelAgentRunStatus(r.status)}</span>
                    <Badge tone="info">{r._count._all} 次</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="hermes-section-label" style={{ marginTop: 14 }}>
            最近审计事件
          </div>
          <RecentAuditList audits={JSON.parse(JSON.stringify(recentAudits))} />
        </Panel>
      </div>
    </AppShell>
  );
}
