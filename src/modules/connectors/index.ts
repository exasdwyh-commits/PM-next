/**
 * KX-31 · 连接器服务（数据库部分）
 * ================================
 * 用户接入一个 MCP 服务器（Streamable HTTP）：Kern 列出它的全部工具并保存快照；
 * 读工具默认启用，写工具默认停用。凭证不存在这里——同主机的凭证由 vault 在调用时注入。
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "@/shared/db";
import type { SessionContext } from "@/modules/identity/session";
import { ConflictError, NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import { UnsafeUrlError, validateUrlShape } from "@/shared/net/safe-fetch";
import { injectCredential } from "@/modules/vault";
import type { KernTool } from "@/modules/kern-contracts";
import { ApprovalService } from "@/modules/governance/approval-service";
import { McpError, McpHttpClient, safeTransport, type McpTransport } from "./mcp-client";
import {
  accessOf,
  applyAccess,
  connectorSlug,
  refreshSpecs,
  toToolSpecs,
  type ConnectorAccess,
  type ConnectorAccessView,
  type ConnectorToolSpec,
} from "./policy";
import { connectorTools, type ConnectorRecord, type ConnectorRuntimeDeps } from "./runtime";

export * from "./policy";
export { connectorActionHash, connectorTools, type BlockedCall } from "./runtime";

/** 审批服务需要 PM_OS_APPROVAL_HMAC_SECRET；未配置时返回 null（写工具一律被拦下，不会误放行）。 */
export function connectorApprovalService(): ApprovalService | null {
  try {
    return new ApprovalService();
  } catch {
    return null;
  }
}

export const MAX_CONNECTORS_PER_USER = 10;

type Owner = Pick<SessionContext, "userId" | "organizationId">;

/** 本机开发可放行的 MCP 服务器（host:port，逗号分隔）；生产环境忽略。 */
export function devAllowHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV === "production") return [];
  return (env.KERN_CONNECTOR_ALLOW_HOSTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

let transportOverride: McpTransport | null = null;
/** 仅测试用。 */
export function setConnectorTransportForTest(t: McpTransport | null) {
  transportOverride = t;
}
function transport(): McpTransport {
  return transportOverride ?? safeTransport({ allowHosts: devAllowHosts() });
}

export type ConnectorView = {
  id: string;
  name: string;
  url: string;
  host: string;
  tools: Array<Omit<ConnectorToolSpec, "inputSchema">>;
  /** KX-61：由工具开关推出的档位。 */
  access: ConnectorAccessView;
  lastError: string | null;
  refreshedAt: string | null;
  createdAt: string;
};

type Row = { id: string; name: string; slug: string; url: string; tools: Prisma.JsonValue; lastError: string | null; refreshedAt: Date | null; createdAt: Date };

const specsOf = (r: Row): ConnectorToolSpec[] => (Array.isArray(r.tools) ? (r.tools as unknown as ConnectorToolSpec[]) : []);

function view(r: Row): ConnectorView {
  return {
    id: r.id,
    name: r.name,
    url: r.url,
    host: new URL(r.url).host,
    tools: specsOf(r).map(({ inputSchema: _s, ...t }) => t),
    access: accessOf(specsOf(r)),
    lastError: r.lastError,
    refreshedAt: r.refreshedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

function checkUrl(raw: string): URL {
  try {
    return validateUrlShape(raw.trim(), devAllowHosts());
  } catch (e) {
    if (e instanceof UnsafeUrlError) throw new UnprocessableEntityError(`连接器地址不可用：${e.message}`);
    throw e;
  }
}

async function discover(owner: Owner, url: URL, name: string, previous: ConnectorToolSpec[] = []) {
  const cred = await injectCredential(owner, { host: url.host.toLowerCase(), purpose: `连接器 ${name} · 列出工具` });
  const client = new McpHttpClient(url.toString(), transport(), cred?.headers ?? {});
  const tools = await client.listTools();
  return { specs: previous.length ? refreshSpecs(tools, previous) : toToolSpecs(tools), server: client.serverInfo };
}

function explain(e: unknown): string {
  if (e instanceof McpError || e instanceof UnsafeUrlError) return e.message;
  return `连接失败：${e instanceof Error ? e.message.split("\n")[0].slice(0, 200) : String(e)}`;
}

export async function listConnectors(session: Owner): Promise<ConnectorView[]> {
  const rows = await prisma.kernConnector.findMany({
    where: { userId: session.userId, organizationId: session.organizationId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(view);
}

export async function addConnector(session: Owner, input: { name?: string; url: string }): Promise<ConnectorView> {
  const url = checkUrl(input.url ?? "");
  const count = await prisma.kernConnector.count({ where: { userId: session.userId, organizationId: session.organizationId } });
  if (count >= MAX_CONNECTORS_PER_USER) throw new ConflictError(`最多接入 ${MAX_CONNECTORS_PER_USER} 个连接器`);
  let found: Awaited<ReturnType<typeof discover>>;
  try {
    found = await discover(session, url, input.name?.trim() || url.host);
  } catch (e) {
    throw new UnprocessableEntityError(explain(e));
  }
  const name = (input.name?.trim() || found.server?.name || url.host).slice(0, 40);
  const id = randomUUID();
  const row = await prisma.kernConnector.create({
    data: {
      id,
      organizationId: session.organizationId,
      userId: session.userId,
      name,
      slug: connectorSlug(name, id),
      url: url.toString(),
      tools: found.specs as unknown as Prisma.InputJsonValue,
      refreshedAt: new Date(),
    },
  });
  await prisma.auditEvent.create({
    data: {
      actorId: session.userId,
      action: "connector.add",
      objectType: "KernConnector",
      objectId: id,
      summary: `接入连接器：${name}（${url.host}），${found.specs.length} 个工具`,
      details: { url: url.toString(), tools: found.specs.map((t) => ({ name: t.name, effect: t.effect, enabled: t.enabled })) },
    },
  });
  return view(row);
}

async function ownRow(session: Owner, id: string) {
  const row = await prisma.kernConnector.findFirst({ where: { id, userId: session.userId, organizationId: session.organizationId } });
  if (!row) throw new NotFoundError("Connector not found");
  return row;
}

export async function refreshConnector(session: Owner, id: string): Promise<ConnectorView> {
  const row = await ownRow(session, id);
  try {
    const found = await discover(session, new URL(row.url), row.name, specsOf(row));
    return view(
      await prisma.kernConnector.update({
        where: { id },
        data: { tools: found.specs as unknown as Prisma.InputJsonValue, lastError: null, refreshedAt: new Date() },
      })
    );
  } catch (e) {
    return view(await prisma.kernConnector.update({ where: { id }, data: { lastError: explain(e) } }));
  }
}

export async function setConnectorTool(session: Owner, id: string, tool: string, enabled: boolean): Promise<ConnectorView> {
  const row = await ownRow(session, id);
  const specs = specsOf(row);
  const spec = specs.find((t) => t.name === tool);
  if (!spec) throw new UnprocessableEntityError(`没有名为 ${tool} 的工具`);
  spec.enabled = enabled;
  const updated = await prisma.kernConnector.update({ where: { id }, data: { tools: specs as unknown as Prisma.InputJsonValue } });
  await prisma.auditEvent.create({
    data: {
      actorId: session.userId,
      action: enabled ? "connector.tool.enable" : "connector.tool.disable",
      objectType: "KernConnector",
      objectId: id,
      summary: `${enabled ? "启用" : "停用"}工具 ${row.name} · ${tool}${spec.effect === "write" ? "（写操作，每次调用仍需确认）" : ""}`,
      details: { tool, effect: spec.effect, capability: spec.capability },
    },
  });
  return view(updated);
}

const ACCESS_LABEL: Record<ConnectorAccess, string> = { off: "关闭", read: "只读", interact: "读写交互" };

/** KX-61：整体切换档位（批量改工具开关）。 */
export async function setConnectorAccess(session: Owner, id: string, level: ConnectorAccess): Promise<ConnectorView> {
  const row = await ownRow(session, id);
  const before = accessOf(specsOf(row));
  const specs = applyAccess(specsOf(row), level);
  const updated = await prisma.kernConnector.update({ where: { id }, data: { tools: specs as unknown as Prisma.InputJsonValue } });
  const writes = specs.filter((t) => t.effect === "write").length;
  await prisma.auditEvent.create({
    data: {
      actorId: session.userId,
      action: "connector.access",
      objectType: "KernConnector",
      objectId: id,
      summary: `连接器 ${row.name} 权限：${ACCESS_LABEL[level]}${level === "interact" && writes ? `（${writes} 个写工具，每次调用仍需确认）` : ""}`,
      details: { from: before, to: level },
    },
  });
  return view(updated);
}

export async function removeConnector(session: Owner, id: string): Promise<boolean> {
  const res = await prisma.kernConnector.deleteMany({ where: { id, userId: session.userId, organizationId: session.organizationId } });
  if (res.count) {
    await prisma.auditEvent.create({
      data: { actorId: session.userId, action: "connector.remove", objectType: "KernConnector", objectId: id, summary: "移除连接器" },
    });
  }
  return res.count > 0;
}

/** 执行器用：当前用户已启用的连接器工具。任何失败都只让连接器工具缺席，不影响任务。 */
export async function loadConnectorTools(
  owner: Owner,
  opts: Pick<ConnectorRuntimeDeps, "taskRef" | "runId" | "onBlocked" | "grants" | "signal" | "assertActive">
): Promise<KernTool[]> {
  try {
    const rows = await prisma.kernConnector.findMany({ where: { userId: owner.userId, organizationId: owner.organizationId } });
    const records: ConnectorRecord[] = rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, url: r.url, tools: specsOf(r) }));
    return connectorTools(records, {
      owner,
      transport: transport(),
      inject: (req) => injectCredential(owner, { ...req, missionTaskId: opts.taskRef }),
      approvalService: connectorApprovalService(),
      ...opts,
    });
  } catch {
    return [];
  }
}
