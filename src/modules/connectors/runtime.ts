/**
 * KX-31 · 连接器运行时：把已保存的连接器变成工具循环可用的 KernTool。
 * 不碰数据库，依赖全部注入，便于用本地 mock MCP 服务器测试。
 *
 * 调用链：模型 → KernTool.run → ToolBroker.call（能力校验 + 受保护能力需审批凭据）
 *        → 注入凭证（injectCredential）→ MCP tools/call → redactSecrets → 观察。
 */
import { ExecutionStoppedError } from "@/modules/worker/claim";
import { ToolBroker, ToolBrokerDeniedError } from "@/modules/governance/tool-broker";
import type { ApprovalService } from "@/modules/governance/approval-service";
import { computeActionHash } from "@/modules/governance/action-hash";
import type { KernTool, ToolResult } from "@/modules/kern-contracts";
import { redactSecrets } from "@/modules/vault/crypto";
import { McpHttpClient, type McpTransport } from "./mcp-client";
import { READ_CAPABILITY, exposedToolName, inputHintFromSchema, resultToText, type ConnectorToolSpec } from "./policy";

export type ConnectorRecord = {
  id: string;
  name: string;
  slug: string;
  url: string;
  tools: ConnectorToolSpec[];
};

export type CredentialInjector = (req: { host: string; purpose: string }) => Promise<{ headers: Record<string, string>; secrets: string[] } | null>;

/** 被拦下的写调用：足够生成一张「允许一次 / 不允许」的审批卡，并在批准后精确匹配同一次调用。 */
export type BlockedCall = {
  connectorId: string;
  connector: string;
  tool: string;
  toolName: string;
  title: string;
  input: Record<string, unknown>;
  capability: string;
  resource: string;
  actionHash: string;
  reason: string;
};

/** 一次写调用的指纹：连接器 + 工具 + 输入（规范化 JSON）。批准只对完全相同的调用有效。 */
export function connectorActionHash(connectorId: string, tool: string, input: Record<string, unknown>): string {
  return computeActionHash({ connectorId, tool, input });
}

export type ConnectorRuntimeDeps = {
  owner: { userId: string; organizationId: string };
  transport: McpTransport;
  signal?: AbortSignal;
  assertActive?: () => Promise<void>;
  inject?: CredentialInjector;
  taskRef: string;
  runId: string;
  /** KX-31b：签发 / 核销审批凭据。缺省（或未配置密钥）时写工具一律被拦下。 */
  approvalService?: ApprovalService | null;
  /** KX-31b：用户已批准的调用，actionHash → grantId。 */
  grants?: Map<string, string>;
  /** 写工具被拦下时通知调用方（执行器据此发「需要你」事件）。 */
  onBlocked?: (info: BlockedCall) => Promise<void> | void;
};

export function connectorTools(connectors: ConnectorRecord[], deps: ConnectorRuntimeDeps): KernTool[] {
  const assertActive = async () => {
    deps.signal?.throwIfAborted();
    await deps.assertActive?.();
    deps.signal?.throwIfAborted();
  };
  const out: KernTool[] = [];
  for (const c of connectors) {
    const enabled = c.tools.filter((t) => t.enabled);
    if (!enabled.length) continue;
    const host = new URL(c.url).host.toLowerCase();
    // 每个连接器一个 broker：只登记已启用的工具；授权器只放行它们声明的能力。
    const handlers: Record<string, (input: unknown) => Promise<unknown>> = {};
    for (const t of enabled) {
      handlers[t.name] = async (input) => {
        await assertActive();
        const cred = deps.inject ? await deps.inject({ host, purpose: `连接器 ${c.name} · ${t.name}` }) : null;
        const client = new McpHttpClient(c.url, async (request) => {
          await assertActive();
          return deps.transport(request);
        }, cred?.headers ?? {}, deps.signal);
        try {
          const r = await client.callTool(t.name, input as Record<string, unknown>);
          const text = redactSecrets(resultToText(r), cred?.secrets ?? []);
          return { ok: !r.isError, text };
        } catch (e) {
          deps.signal?.throwIfAborted();
          if (e instanceof ExecutionStoppedError) throw e;
          throw new Error(redactSecrets(e instanceof Error ? e.message : String(e), cred?.secrets ?? []));
        }
      };
    }
    const allowed = new Set(enabled.map((t) => `${t.name}|${t.capability}`));
    const broker = new ToolBroker({
      identity: { actorId: deps.owner.userId, organizationId: deps.owner.organizationId, agentCode: "kern-connector", runId: deps.runId },
      tools: handlers,
      authorizer: ({ capability, resource }) => allowed.has(`${resource.split("#")[1]}|${capability}`),
      approvalService: deps.approvalService ?? null,
    });
    for (const t of enabled) {
      const toolName = exposedToolName(c.slug, t.name);
      const resource = `connector:${c.id}#${t.name}`;
      out.push({
        name: toolName,
        label: `${c.name} · ${t.title}`,
        description: `${t.effect === "write" ? "【写操作，需要用户确认】" : ""}${t.description || t.title}`.slice(0, 300),
        inputHint: inputHintFromSchema(t.inputSchema),
        risk: t.effect === "read" ? "read" : "ask",
        run: async (input): Promise<ToolResult> => {
          await assertActive();
          const actionHash = connectorActionHash(c.id, t.name, input);
          const grantId = t.capability === READ_CAPABILITY ? null : deps.grants?.get(actionHash) ?? null;
          try {
            const r = (await broker.call<Record<string, unknown>, { ok: boolean; text: string }>({
              tool: t.name,
              capability: t.capability,
              resource,
              taskRef: deps.taskRef,
              runId: deps.runId,
              input,
              actionHash,
              approvalGrantId: grantId,
            })) ?? { ok: false, text: "" };
            if (grantId) deps.grants?.delete(actionHash); // 一次性：用过即失效
            return { ok: r.ok, output: r.text, citations: [{ title: `${c.name} · ${t.title}`, ref: resource }] };
          } catch (e) {
            deps.signal?.throwIfAborted();
            if (e instanceof ExecutionStoppedError) throw e;
            await assertActive();
            if (e instanceof ToolBrokerDeniedError) {
              const needsApproval = t.capability !== READ_CAPABILITY && /approval/.test(e.reason);
              if (needsApproval) {
                await deps.onBlocked?.({
                  connectorId: c.id,
                  connector: c.name,
                  tool: t.name,
                  toolName,
                  title: t.title,
                  input,
                  capability: t.capability,
                  resource,
                  actionHash,
                  reason: e.reason,
                });
              }
              return {
                ok: false,
                output: needsApproval
                  ? `已拦下：${c.name} 的「${t.title}」会写入外部系统，已请用户确认（批准后会重做这一步）。不要重试；在结论里写明「待用户确认」并继续其他部分。`
                  : `无权调用该工具（${e.reason}）。`,
              };
            }
            return { ok: false, output: `连接器调用失败：${e instanceof Error ? e.message : String(e)}` };
          }
        },
      });
    }
  }
  return out;
}
