import prisma from "@/shared/db";
import Link from "next/link";
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSessionFromContext } from "@/modules/identity/session";
import { getRuntimeStatus } from "@/shared/runtime-status";
import AppShell from "@/components/app-shell";
import LogoutButton from "@/components/logout-button";
import { Badge, Empty } from "@/components/ui";
import {
  labelAgentRunStatus,
  labelAuditAction,
  labelKnowledgeSourceKind,
} from "@/shared/status-labels";
import Icon from "@/components/icons";
import { fmtDate, fmtDateTime } from "@/shared/datetime";
import RecentAuditList from "./recent-audit-list";
import ModelControlClient from "./model-control-client";
import SettingsOverview, { CopyOrgId, type SettingsCard } from "./settings-overview";
import { getModelControlOverview } from "@/modules/model-control/service";
import { getAdvisorLLMConfig, isAdvisorLLMEnabled } from "@/modules/model-gateway";
import { getUsage } from "@/modules/usage";

export const dynamic = "force-dynamic";

/** KX-22 设置页（方案 B：概览卡片 + 下钻）；完整面板在抽屉里，见 settings-overview.tsx。 */
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

  const [knowledgeSources, agentRunCounts, recentAudits, projectCount, modelControl] = await Promise.all([
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
    // 口径与 trace/page.tsx:42-43 保持一致，避免取到跨组织的审计事件。
    prisma.auditEvent.findMany({
      where: { actor: { organizationId: session.organizationId } },
      orderBy: { timestamp: "desc" },
      // 抽屉里默认展示 10 条，其余由客户端「查看全部」展开
      take: 100,
      include: { actor: { select: { name: true } } },
    }),
    prisma.projectMember.count({ where: { userId: session.userId } }),
    getModelControlOverview(session),
  ]);
  const usage = await getUsage(session.organizationId);

  const orgId: string = session?.organizationId || "";
  const orgShort = orgId.slice(0, 8);
  const enabledSources = knowledgeSources.filter((s) => s.enabled);
  const profileCount = modelControl.profiles.length;
  const policyCount = modelControl.policies.length;
  const bindingCount = modelControl.bindings.length;
  // 徽章只认真实可用（配了 Profile 但没接模型时不能显示已配置）。
  const runnableProfileCount = modelControl.profiles.filter(profile => profile.enabled && profile.runtimeConfigured).length;
  const legacyReady = isAdvisorLLMEnabled() && Boolean(getAdvisorLLMConfig().modelId);
  const modelReady = runnableProfileCount > 0 || legacyReady;
  const totalRuns = agentRunCounts.reduce((a, b) => a + b._count._all, 0);

  const cards: SettingsCard[] = [
    {
      key: "acct",
      title: "账户",
      tone: "ok",
      statusText: "已登录",
      line1: session?.userName || "未命名用户",
      line2: session?.userEmail || "",
    },
    {
      key: "org",
      title: "组织与权限",
      tone: "ok",
      statusText: "正常",
      line1: "仅本组织数据；项目级还需是项目成员",
      line2: `我参与 ${projectCount} 个项目 · 组织 ${orgShort}`,
    },
    {
      key: "know",
      title: "知识连接",
      tone: enabledSources.length > 0 ? "ok" : "warn",
      statusText: enabledSources.length > 0 ? `${enabledSources.length} 个已启用` : "未配置",
      line1:
        knowledgeSources.length > 0
          ? `知识源 ${knowledgeSources.length} 个 · 文档 ${knowledgeSources.reduce((a, s) => a + s._count.documents, 0)} 篇`
          : "尚未配置知识源",
      line2: "Obsidian / 本地目录只读导入",
    },
    {
      key: "model",
      title: "模型",
      tone: modelReady ? "ok" : "warn",
      statusText: modelReady ? "具备调用配置" : "尚未启用",
      line1: `可调用配置 ${runnableProfileCount} / Profile ${profileCount} · Policy ${policyCount} · 绑定 ${bindingCount}`,
      line2: modelReady ? "实际连通性在执行时验证" : runtime.modelConfigured ? "已保存端点，请启用模型并检查策略" : runtime.label,
    },
  ];

  const panels = {
    acct: (
      <div className="kx-st-rows">
        <div className="kx-st-row"><span>姓名</span><b>{session?.userName}</b></div>
        <div className="kx-st-row"><span>邮箱<small>登录账号</small></span><b>{session?.userEmail}</b></div>
        <div className="kx-st-row">
          <span>组织<small>短码，用于排查问题</small></span>
          <b>{orgShort}</b>
          <CopyOrgId value={orgId} />
        </div>
        <div className="kx-st-row"><span>退出登录<small>结束当前会话</small></span><LogoutButton /></div>
      </div>
    ),
    org: (
      <div className="kx-st-rows">
        <div className="kx-st-row"><span>权限范围</span><b>仅本组织数据；项目级还需是项目成员</b></div>
        <div className="kx-st-row"><span>我参与的项目</span><b>{projectCount} 个</b></div>
        <div className="kx-st-row">
          <span>成员与角色</span>
          <Link href="/organization" className="hermes-outline-btn hermes-btn-sm">
            打开组织与权限
            <Icon name="arrow" size={14} />
          </Link>
        </div>
      </div>
    ),
    know:
      knowledgeSources.length === 0 ? (
        <Empty>
          尚未配置知识源。按范围要求，顾问只会按权限从指定目录检索原文片段并给出出处；
          配置后公司知识页才能展示来源与同步状态（当前不会自动声称已接入 Obsidian）。
        </Empty>
      ) : (
        <div className="kx-st-rows">
          {knowledgeSources.map((s) => (
            <div key={s.id} className="kx-st-row">
              <span>
                {s.name}
                <small>
                  {labelKnowledgeSourceKind(s.kind)} · 文档 {s._count.documents} ·{" "}
                  {s.lastSyncAt ? `最近同步 ${fmtDateTime(s.lastSyncAt)}` : "从未同步"}
                </small>
              </span>
              <Badge tone={s.enabled ? "ok" : "neutral"}>{s.enabled ? "启用" : "停用"}</Badge>
            </div>
          ))}
        </div>
      ),
    model: (
      <>
        <div className={`hermes-banner ${runtime.modelConfigured ? "is-ok" : "is-warn"}`}>
          <strong>{runtime.label}</strong>
          <div style={{ marginTop: 4 }}>
            {runtime.detail}。未配置的官方 Profile 默认禁用，不会静默切换到其它模型。
          </div>
        </div>
        <ModelControlClient initial={JSON.parse(JSON.stringify(modelControl))} />
      </>
    ),
    usage: (
      <>
        <p className="kx-st-sub">运行记录 · 共 {totalRuns} 次（留痕用于追溯，不用于考核）</p>
        {agentRunCounts.length === 0 ? (
          <Empty>还没有 Agent 运行记录。启动一次 Kern 自动化或数字员工任务后，这里会显示真实运行状态与结果。</Empty>
        ) : (
          <div className="kx-st-rows">
            {agentRunCounts.map((r) => (
              <div key={r.status} className="kx-st-row">
                <span>{labelAgentRunStatus(r.status)}</span>
                <b>{r._count._all} 次</b>
              </div>
            ))}
          </div>
        )}
        <p className="kx-st-sub">最近审计事件</p>
        <RecentAuditList audits={JSON.parse(JSON.stringify(recentAudits))} />
      </>
    ),
  };

  const auditPreview =
    recentAudits.length === 0 ? (
      <Empty>还没有审计事件。完成一次受治理的配置、审批或业务变更后，会在这里留下记录。</Empty>
    ) : (
      <div className="kx-st-rows">
        {recentAudits.slice(0, 3).map((a) => (
          <div key={a.id} className="kx-st-row">
            <span>
              {labelAuditAction(a.action)}
              <small>{a.summary}</small>
            </span>
            <small>{fmtDateTime(a.timestamp)}</small>
          </div>
        ))}
      </div>
    );

  const hasLimit = usage.limits.missionsPerMonth !== null || usage.limits.modelCallsPerMonth !== null;

  return (
    <AppShell
      active="settings"
      user={{ name: session?.userName, meta: session?.userEmail }}
      runtime={runtime}
      topbarLeft={
        /* 2026-10-04：顶栏页名与页内 h1 同名会重复一次（首屏可见的冗余）。
           顶栏改为只放**分区上下文**，页面主标题由 h1 独占。 */
        <div className="hermes-topbar-title">
          <span className="hermes-topbar-scope">工作台</span>
        </div>
      }
    >
      <header className="kx-st-head">
        <h1>设置</h1>
        <p>账户、组织、知识、模型与用量</p>
      </header>
      <SettingsOverview
        period={`${fmtDate(usage.period.start)} ~ ${fmtDate(usage.period.end)}`}
        meters={[
          { label: "Kern 接手的工作", used: usage.used.missions, limit: usage.limits.missionsPerMonth },
          { label: "模型配额占用", used: usage.used.modelCalls, limit: usage.limits.modelCallsPerMonth },
          { label: "已知模型请求", used: usage.used.knownModelAttempts, limit: null },
        ]}
        limitNote={[
          hasLimit ? "上限是本部署设置的安全闸，用来防止模型花费失控；需要调整请联系管理员。" : "",
          usage.used.modelReservations ? `${usage.used.modelReservations} 次调用正在等待发送，临时占用配额。` : "",
          usage.used.unknownModelAttempts ? `${usage.used.unknownModelAttempts} 条历史调用的请求次数无法确认，配额按已有记录保守计入。` : "",
        ].filter(Boolean).join(" ") || null}
        cards={cards}
        auditCount={recentAudits.length}
        auditPreview={auditPreview}
        panels={panels}
      />
    </AppShell>
  );
}
