import prisma from "@/shared/db";
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerSessionFromContext } from "@/modules/identity/session";
import AppShell from "@/components/app-shell";
import { PageHeading, Panel, KV, Badge, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function OrganizationPage() {
  const headerList = await headers();
  const cookieStore = await cookies();
  let session: any = null;
  try {
    session = await getServerSessionFromContext(headerList, cookieStore);
  } catch (e) {
    redirect("/login");
  }
  const orgId = session.organizationId;

  const [org, users, projects] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId } }),
    prisma.user.findMany({
      where: { organizationId: orgId, isActive: true },
      include: {
        projectMembers: { include: { project: { select: { title: true, stage: true } } } },
        ownedProjects: { select: { id: true, title: true } },
        decidingProjects: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.project.findMany({
      where: { organizationId: orgId },
      include: {
        owner: { select: { id: true, name: true } },
        decisionMaker: { select: { id: true, name: true } },
        _count: { select: { workItems: true, evidences: true, feedbackItems: true, decisionPackets: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <AppShell
      active="organization"
      user={{ name: session?.userName, meta: session?.userEmail }}
      runtime={{ tone: "neutral", label: "模型未配置", detail: "仅结构化能力可用" }}
    >
      <div className="hermes-stack">
        <PageHeading
          eyebrow="ORGANIZATION & ACCESS"
          title="组织与权限"
          subtitle="查看组织概况、成员角色分配与项目访问边界。"
        />

        <Panel eyebrow="ORGANIZATION" title="组织信息">
          <KV
            items={[
              { k: "名称", v: org?.name || "—" },
              { k: "代号", v: org?.code ? <span className="hermes-mono">{org.code}</span> : "—" },
              { k: "在册成员", v: users.length },
            ]}
          />
        </Panel>

        <Panel eyebrow="MEMBERS" title="成员与角色分配">
          <div className="hermes-list">
            {users.map((u) => (
              <div key={u.id} className="hermes-row is-flat">
                <div className="hermes-row-head">
                  <span className="hermes-row-title">{u.name}</span>
                  <span className="hermes-row-meta">{u.email}</span>
                  {u.id === session.userId && <Badge tone="brand">当前会话</Badge>}
                </div>
                <div className="hermes-row-meta">
                  负责项目 {u.ownedProjects.length} · 决策项目 {u.decidingProjects.length} · 成员项目 {u.projectMembers.length}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel eyebrow="PROJECT ACCESS" title="项目访问边界">
          {projects.length === 0 ? (
            <Empty>当前组织还没有项目。先从产品管理启动研发或创建项目，组织成员与执行数据会在这里汇总。</Empty>
          ) : (
            <div className="hermes-list">
              {projects.map((p) => (
                <div key={p.id} className="hermes-row is-flat hermes-row-head" style={{ justifyContent: "space-between" }}>
                  <div>
                    <Link href={`/projects/${p.id}`} className="hermes-link hermes-row-title">{p.title}</Link>
                    <div className="hermes-row-meta">负责人 {p.owner?.name || "未指定"} · 决策人 {p.decisionMaker?.name || "未指定"}</div>
                  </div>
                  <div className="hermes-row-meta">工作项 {p._count.workItems} · 证据 {p._count.evidences} · 反馈 {p._count.feedbackItems} · 决策包 {p._count.decisionPackets}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
