/**
 * KX-31 · 连接器策略（纯函数）
 * ============================
 * - 读写分类（U01）：destructiveHint=true → 写（与 readOnlyHint=true 冲突时也按写）；
 *   只有服务端显式声明 readOnlyHint=true 才算读；未声明一律当写。
 *   名称前缀不参与权限判定：get_/list_ 开头的工具照样可能有副作用，未审核工具不能默认可信只读。
 * - 默认：读工具启用，写工具停用。写工具要由用户在连接器设置里显式打开，
 *   打开后映射到受保护能力 external.send，每次调用仍需审批凭据（ToolBroker 强制）。
 */
import type { McpCallResult, McpTool } from "./mcp-client";

export type ToolEffect = "read" | "write";

export type ConnectorToolSpec = {
  name: string;
  title: string;
  description: string;
  effect: ToolEffect;
  enabled: boolean;
  /** 写工具映射的受保护能力；读工具为 connector.read。 */
  capability: string;
  inputSchema: Record<string, unknown> | null;
};

export const READ_CAPABILITY = "connector.read";
export const WRITE_CAPABILITY = "external.send";
export const MAX_CONNECTOR_TOOLS = 64;

export function classifyTool(t: McpTool): ToolEffect {
  const a = t.annotations ?? {};
  // 破坏性声明优先：readOnlyHint 与 destructiveHint 同时为 true 是自相矛盾的声明，按写处理。
  if (a.destructiveHint === true) return "write";
  // 只认显式只读声明；名称前缀、缺省标注都不能让工具变成默认启用的读工具。
  return a.readOnlyHint === true ? "read" : "write";
}

export function toToolSpecs(tools: McpTool[], previous: ConnectorToolSpec[] = []): ConnectorToolSpec[] {
  const prev = new Map(previous.map((p) => [p.name, p]));
  return tools.slice(0, MAX_CONNECTOR_TOOLS).map((t) => {
    const effect = classifyTool(t);
    const old = prev.get(t.name);
    // 刷新时保留用户的开关；但工具从读变成写时强制停用，需要重新确认。
    const enabled = old && !(old.effect === "read" && effect === "write") ? old.enabled : effect === "read";
    return {
      name: t.name,
      title: (t.annotations?.title ?? t.name).slice(0, 80),
      description: (t.description ?? "").replace(/\s+/g, " ").slice(0, 300),
      effect,
      enabled,
      capability: effect === "read" ? READ_CAPABILITY : WRITE_CAPABILITY,
      inputSchema: t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : null,
    };
  });
}

/**
 * KX-61 · 连接器权限三档（参考 Meta Muse 的 Off / Read only / Read and interact）。
 * 不新增存储：档位由逐工具开关推出，切换档位就是批量改开关。
 * - off：全部停用；read：读工具启用、写工具停用；interact：全部启用（写工具每次调用仍需审批）。
 * - 与三档都不一致的手动组合显示为 custom。
 */
export type ConnectorAccess = "off" | "read" | "interact";
export type ConnectorAccessView = ConnectorAccess | "custom";
export const CONNECTOR_ACCESS_LEVELS: readonly ConnectorAccess[] = ["off", "read", "interact"];

export function isConnectorAccess(v: unknown): v is ConnectorAccess {
  return typeof v === "string" && (CONNECTOR_ACCESS_LEVELS as readonly string[]).includes(v);
}

export function accessOf(specs: Pick<ConnectorToolSpec, "effect" | "enabled">[]): ConnectorAccessView {
  if (!specs.length || specs.every((t) => !t.enabled)) return "off";
  if (specs.every((t) => t.enabled)) return specs.some((t) => t.effect === "write") ? "interact" : "read";
  if (specs.every((t) => t.enabled === (t.effect === "read"))) return "read";
  return "custom";
}

export function applyAccess<T extends Pick<ConnectorToolSpec, "effect" | "enabled">>(specs: T[], level: ConnectorAccess): T[] {
  return specs.map((t) => ({ ...t, enabled: level === "interact" ? true : level === "read" ? t.effect === "read" : false }));
}

/** 刷新工具列表时保持档位：关闭的连接器新出现的工具也保持关闭；其余沿用 toToolSpecs 的规则（新写工具默认停用）。 */
export function refreshSpecs(tools: McpTool[], previous: ConnectorToolSpec[]): ConnectorToolSpec[] {
  const next = toToolSpecs(tools, previous);
  return previous.length && accessOf(previous) === "off" ? applyAccess(next, "off") : next;
}

export function connectorSlug(name: string, id: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 16);
  return s || `c${id.replace(/-/g, "").slice(0, 6)}`;
}

/** 暴露给模型的工具名：mcp_<slug>_<tool>，只含 [a-z0-9_]，≤ 64。 */
export function exposedToolName(slug: string, tool: string): string {
  const t = tool.replace(/[^A-Za-z0-9_]+/g, "_");
  return `mcp_${slug}_${t}`.slice(0, 64);
}

/** 简要的输入示例（从 JSON Schema 的 properties 生成），给模型看。 */
export function inputHintFromSchema(schema: Record<string, unknown> | null): string {
  const props = (schema?.properties ?? {}) as Record<string, { type?: string; description?: string }>;
  const required = new Set(Array.isArray(schema?.required) ? (schema!.required as string[]) : []);
  const keys = Object.keys(props).slice(0, 6);
  if (!keys.length) return "{}";
  const sample: Record<string, unknown> = {};
  for (const k of keys) {
    const t = props[k]?.type;
    sample[k + (required.has(k) ? "" : "?")] = t === "number" || t === "integer" ? 0 : t === "boolean" ? true : t === "array" ? [] : "…";
  }
  return JSON.stringify(sample);
}

/** 把 MCP 调用结果压成文本观察。非文本内容只写类型。 */
export function resultToText(r: McpCallResult, limit = 4000): string {
  const parts: string[] = [];
  for (const c of r.content ?? []) {
    if (c.type === "text" && typeof c.text === "string") parts.push(c.text);
    else parts.push(`[${c.type} 内容]`);
  }
  if (!parts.length && r.structuredContent !== undefined) parts.push(JSON.stringify(r.structuredContent));
  const text = parts.join("\n").trim() || "（空结果）";
  return text.length > limit ? text.slice(0, limit) + "…（已截断）" : text;
}
