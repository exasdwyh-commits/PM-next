/**
 * KX-31 · 最小 MCP 客户端（Streamable HTTP 传输）
 * ================================================
 * 只实现 Kern 需要的四个方法：initialize → notifications/initialized → tools/list → tools/call。
 * - 出站走 safeFetch（SSRF 校验 + 钉死已解析 IP）；POST 不跟随重定向。
 * - 响应既可以是 application/json，也可以是 text/event-stream（取与请求 id 匹配的那条 data）。
 * - 会话：服务器返回 mcp-session-id 时，后续请求带上。
 */
import { safeFetch, type SafeFetchOptions } from "@/shared/net/safe-fetch";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

export type McpToolAnnotations = { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean; title?: string };
export type McpTool = { name: string; description?: string; inputSchema?: Record<string, unknown>; annotations?: McpToolAnnotations };
export type McpContent = { type: string; text?: string; [k: string]: unknown };
export type McpCallResult = { content?: McpContent[]; structuredContent?: unknown; isError?: boolean };

export class McpError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
    this.name = "McpError";
  }
}

export type McpTransport = (req: { url: string; body: string; headers: Record<string, string>; signal?: AbortSignal }) => Promise<{
  status: number;
  contentType: string;
  body: string;
  headers: Record<string, string>;
}>;

/** 生产传输：safeFetch。allowHosts 仅用于本机开发 / 测试的 MCP 服务器。 */
export function safeTransport(opts: Pick<SafeFetchOptions, "allowHosts" | "timeoutMs"> = {}): McpTransport {
  return async ({ url, body, headers, signal }) => {
    const r = await safeFetch(url, { method: "POST", body, headers, maxBytes: 2_000_000, timeoutMs: opts.timeoutMs ?? 20_000, allowHosts: opts.allowHosts, signal });
    return { status: r.status, contentType: r.contentType, body: r.body, headers: r.headers ?? {} };
  };
}

/** 从 JSON 或 SSE 响应体中取出 id 对应的 JSON-RPC 消息。 */
export function parseRpcResponse(contentType: string, body: string, id: number): { result?: unknown; error?: { code: number; message: string } } | null {
  const candidates: string[] = [];
  if (/event-stream/i.test(contentType)) {
    for (const block of body.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""))
        .join("\n");
      if (data.trim()) candidates.push(data);
    }
  } else if (body.trim()) {
    candidates.push(body);
  }
  for (const c of candidates) {
    let msg: unknown;
    try {
      msg = JSON.parse(c);
    } catch {
      continue;
    }
    for (const m of Array.isArray(msg) ? msg : [msg]) {
      if (m && typeof m === "object" && (m as { id?: unknown }).id === id) return m as { result?: unknown; error?: { code: number; message: string } };
    }
  }
  return null;
}

export class McpHttpClient {
  #id = 0;
  #session: string | null = null;
  #initialized = false;
  serverInfo: { name?: string; version?: string } | null = null;

  constructor(
    readonly url: string,
    private readonly transport: McpTransport,
    private readonly extraHeaders: Record<string, string> = {},
    private readonly signal?: AbortSignal
  ) {}

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": MCP_PROTOCOL_VERSION,
      ...(this.#session ? { "mcp-session-id": this.#session } : {}),
      ...this.extraHeaders,
    };
  }

  private async send(method: string, params: unknown, notify = false): Promise<unknown> {
    this.signal?.throwIfAborted();
    const id = notify ? 0 : ++this.#id;
    const payload = notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params };
    const r = await this.transport({ url: this.url, body: JSON.stringify(payload), headers: this.headers(), signal: this.signal });
    this.signal?.throwIfAborted();
    if (r.headers["mcp-session-id"]) this.#session = r.headers["mcp-session-id"];
    if (notify) return null;
    if (r.status === 401 || r.status === 403) throw new McpError(`MCP 服务器拒绝访问（${r.status}），请检查凭证`, r.status);
    if (r.status >= 400) throw new McpError(`MCP 服务器返回 ${r.status}`, r.status);
    const msg = parseRpcResponse(r.contentType, r.body, id);
    if (!msg) throw new McpError("MCP 响应里没有对应的结果");
    if (msg.error) throw new McpError(`MCP 错误：${msg.error.message}`, msg.error.code);
    return msg.result;
  }

  async initialize(): Promise<void> {
    if (this.#initialized) return;
    const res = (await this.send("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "kern", version: "1.0" },
    })) as { serverInfo?: { name?: string; version?: string } } | null;
    this.serverInfo = res?.serverInfo ?? null;
    await this.send("notifications/initialized", {}, true);
    this.#initialized = true;
  }

  async listTools(maxPages = 5): Promise<McpTool[]> {
    await this.initialize();
    const out: McpTool[] = [];
    let cursor: string | undefined;
    for (let p = 0; p < maxPages; p++) {
      const res = (await this.send("tools/list", cursor ? { cursor } : {})) as { tools?: McpTool[]; nextCursor?: string } | null;
      out.push(...(res?.tools ?? []).filter((t) => t && typeof t.name === "string"));
      if (!res?.nextCursor) break;
      cursor = res.nextCursor;
    }
    return out;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    await this.initialize();
    return ((await this.send("tools/call", { name, arguments: args })) ?? {}) as McpCallResult;
  }
}
